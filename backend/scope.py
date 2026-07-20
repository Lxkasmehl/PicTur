"""
Group-scope enforcement primitives (PR-2).

Pure functions that turn a per-request scope *context* (produced by
``auth.validate_and_get_context`` from the auth service's ``/auth/validate``
body) into filter/gate decisions. Authorization is always done off this
context — never off JWT claims — so a promotion/move applies without re-login.

A context (``ctx``) is a dict::

    {'role', 'user_id', 'email', 'group_id', 'group_name', 'group_scope',
     'system_key', 'group_role', 'areas': [...], 'is_global': bool}

``areas`` are opaque path prefixes matching the VRAM index ``location`` strings
(``"Kansas"``, ``"Kansas/Lawrence"``, ``"NebraskaCPBS"`` — the ``"/".join`` of
the path above ``<TurtleID>/<reffolder>``). A global context (admin, or a group
whose ``scope == 'global'``) bypasses every filter and write gate, so behavior
is byte-identical to pre-PR-2 for Operations/Primary members. Only scoped-group
members are restricted; community/anon paths never set a context.

This module imports Flask only for the tiny ``get_ctx`` request accessor; every
other function is a pure transform (ctx + data → decision), fully unit-testable
without Flask, and the turtle/packet resolvers take the manager/metadata as
arguments so they stay testable too.
"""

import os

from flask import request

# Standard 403 body for an out-of-scope write attempt.
SCOPE_DENIED_ERROR = "Target is outside your group's assigned areas"


def get_ctx():
    """Return the current request's scope context (set by the auth guards), or None.

    None means a non-guarded/legacy path (community/anon upload, or a caller that
    never set ``request.scope_ctx``) — treated as global by ``is_global``.
    """
    return getattr(request, 'scope_ctx', None)


def is_global(ctx):
    """True when the context is unrestricted.

    - ``ctx is None`` (non-guarded/legacy path) → global (no filtering applied).
    - ``ctx['is_global']`` → global (admin, or a group with ``scope == 'global'``).
    """
    if ctx is None:
        return True
    return bool(ctx.get('is_global'))


def _clean(value):
    return value.strip() if isinstance(value, str) else ''


def top_level_of(location):
    """First path segment of a location string (the sheet/tab), e.g.
    ``"Kansas/Lawrence"`` → ``"Kansas"``. Empty for a falsy/blank value."""
    loc = _clean(location)
    if not loc:
        return ''
    return loc.split('/', 1)[0]


def area_covers(area, location):
    """True when ``location`` is at or below ``area`` in the path tree.

    ``location == area`` or ``location`` is a descendant (``location.startswith(area + '/')``).
    This is the simple prefix primitive both gates build on. Blank inputs → False.
    """
    a = _clean(area)
    loc = _clean(location)
    if not a or not loc:
        return False
    return loc == a or loc.startswith(a + '/')


def scope_allows_location(ctx, location):
    """WRITE gate: may this context write to ``location``?

    - Global → True.
    - Falsy/unresolvable ``location`` → **False (fail closed)** — an unresolved
      target is never writable for a scoped user.
    - Else True when any owned area covers the location.
    """
    if is_global(ctx):
        return True
    loc = _clean(location)
    if not loc:
        return False
    return any(area_covers(a, loc) for a in (ctx.get('areas') or []))


def scope_allows_sheet(ctx, sheet):
    """LIST gate: may this context SEE ``sheet`` (a top-level tab) in a list?

    Broader than the write gate: a group owning only ``Kansas/Lawrence`` can
    still see the ``Kansas`` sheet/tab (an owned area lives under it). Global →
    True; blank sheet → False.
    """
    if is_global(ctx):
        return True
    s = _clean(sheet)
    if not s:
        return False
    return any(a == s or a.startswith(s + '/') for a in (ctx.get('areas') or []))


def filter_locations(ctx, locations):
    """Filter a ``get_all_locations()``-style list to what a scoped ctx may see.

    Global → unchanged. Otherwise: ``Community_Uploads`` is always kept (shared
    pool); a top-level entry is kept when its sheet passes ``scope_allows_sheet``;
    a nested ``State/SubLoc`` entry is kept only when it is within an owned area
    OR an owned area is within it (so ``Kansas/Lawrence`` is hidden from a
    ``Kansas/Topeka`` owner, but a whole-``Kansas`` owner keeps every sub-site).
    """
    if is_global(ctx):
        return list(locations)
    areas = ctx.get('areas') or []
    out = []
    for loc in locations:
        if loc == 'Community_Uploads':
            out.append(loc)
            continue
        if not scope_allows_sheet(ctx, top_level_of(loc)):
            continue
        if '/' not in str(loc):
            # Top-level entry (the sheet itself) — already passed the sheet gate.
            out.append(loc)
            continue
        # Nested entry: keep when the entry is within an owned area or vice-versa.
        if any(area_covers(a, loc) or area_covers(loc, a) for a in areas):
            out.append(loc)
    return out


def effective_match_filter(ctx, requested):
    """Resolve the location filter to pass to ``search_for_matches``.

    Returns ``(location_filter, scope_forced)`` where ``scope_forced`` is True
    when the requested scope was narrowed/overridden to the group's areas.

    - Global → ``(requested, False)`` unchanged.
    - Scoped:
      * empty / ``'All Locations'`` / ``'__all__'`` → ``(list(areas), True)``.
      * ``'Community_Uploads'`` → ``('Community_Uploads', False)`` (shared pool).
      * within scope (an owned area covers it, or it is a prefix of an owned
        area) → narrow to the owned areas touching it, ``(that_list, False)``.
      * fully out of scope → ``(list(areas), True)``.
    """
    if is_global(ctx):
        return requested, False
    areas = list(ctx.get('areas') or [])
    req = requested.strip() if isinstance(requested, str) else requested
    if not req or req in ('All Locations', '__all__'):
        return list(areas), True
    if req == 'Community_Uploads':
        return 'Community_Uploads', False
    narrowed = [a for a in areas if area_covers(req, a) or area_covers(a, req)]
    if narrowed:
        return narrowed, False
    return list(areas), True


def annotate_in_scope(ctx, matches):
    """Set ``match['in_scope']`` on each match dict; return ``scope_expanded``.

    ``in_scope`` = whether the match's ``location`` is writable by this ctx
    (global → all True). ``scope_expanded`` is True when any match fell outside
    scope (e.g. the ``<5 ⇒ expand to all`` fallback pulled in distant turtles).
    """
    scope_expanded = False
    for m in matches:
        in_scope = scope_allows_location(ctx, m.get('location'))
        m['in_scope'] = in_scope
        if not in_scope:
            scope_expanded = True
    return scope_expanded


def resolve_turtle_location(manager, turtle_id, sheet_hint=None, primary_id=None):
    """Resolve a turtle's on-disk location relative to ``data/`` (e.g. ``Kansas/Topeka``).

    Returns the location string, or ``None`` when the folder can't be resolved
    (caller then fails closed for a scoped user). Primary-first (globally unique)
    then bio_id (sheet-scoped) — reuses ``_get_turtle_folder`` unchanged, so the
    existing scoped / fail-closed lookup semantics are preserved (bio IDs stay
    sheet-scoped; only a globally-unique primary may resolve unscoped).
    """
    if manager is None:
        return None
    turtle_dir = None
    pid = _clean(primary_id)
    tid = _clean(turtle_id)
    if pid and pid != tid:
        turtle_dir = manager._get_turtle_folder(pid, sheet_hint)
    if (not turtle_dir or not os.path.isdir(turtle_dir)) and tid:
        turtle_dir = manager._get_turtle_folder(tid, sheet_hint)
    if not turtle_dir or not os.path.isdir(turtle_dir):
        return None
    try:
        rel = os.path.relpath(os.path.dirname(turtle_dir), manager.base_dir)
    except (ValueError, OSError):
        return None
    if not rel or rel == '.' or rel.startswith('..'):
        return None
    return rel.replace(os.sep, '/')


def packet_scope_locations(meta):
    """Location string(s) that describe a review packet's scope, from its metadata.

    Order of precedence:
      1. ``match_sheet`` (staff/admin upload's chosen scope).
      2. ``scope_filter`` (the persisted effective filter for a scoped uploader).
      3. community ``state``/``location`` the uploader declared.
    Returns ``[]`` when the packet carries no location info (→ global-only).
    """
    if not isinstance(meta, dict):
        return []
    ms = _clean(meta.get('match_sheet'))
    if ms:
        return [ms]
    sf = meta.get('scope_filter')
    if isinstance(sf, (list, tuple)):
        locs = [_clean(x) for x in sf if _clean(x)]
        if locs:
            return locs
    state = _clean(meta.get('state'))
    location = _clean(meta.get('location'))
    if state and location:
        return [f"{state}/{location}"]
    if state:
        return [state]
    return []


def packet_scope_allows(ctx, meta):
    """True when a scoped ctx may see/act on a review packet (by its metadata).

    Global → True. A packet with no location info is visible only to global (a
    scoped user can't prove it is theirs → fail closed). Otherwise the packet is
    in scope when any of its scope-locations passes the write gate OR the (looser)
    sheet gate — mirroring the review-queue visibility rule so "see == act".
    """
    if is_global(ctx):
        return True
    locs = packet_scope_locations(meta)
    if not locs:
        return False
    for loc in locs:
        if scope_allows_location(ctx, loc) or scope_allows_sheet(ctx, top_level_of(loc)):
            return True
    return False
