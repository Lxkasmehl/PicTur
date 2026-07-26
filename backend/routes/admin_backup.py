"""
Scoped backup download: a streamed ZIP with a mirror of (part of) the backend
data/ tree plus the matching Google Sheets CSV/JSON exports.

Access is limited to **team leads and admins**. A global caller (admin, or a
global-scope group) can download everything, a single State, or a single
Location. A scoped **team lead** can only download their group's assigned areas
(all of them, or one State/Location within scope) — the requested scope is
resolved and CLAMPED against the caller's areas at token-mint time.

The archive is streamed in constant memory (a zipfile written to a write-only
sink, drained chunk-by-chunk) instead of being built in a BytesIO buffer — the
full data/ tree is multi-GB, so buffering it guaranteed OOM/timeout and the
download never started. Because a navigation/anchor download can't send the
Authorization header, the client first mints a short-lived *capability* token at
POST /api/backup/archive/token and passes it as ?dl= on the GET. That token
embeds the resolved roots + sheet filter, so tampering the URL can't widen the
archive.
"""

import csv
import io
import json
import os
import posixpath
import re
import shutil
import time
import zipfile
from datetime import datetime, timedelta, timezone

from flask import Response, jsonify, request, stream_with_context

import auth
from auth import mint_download_token, require_admin, verify_download_token
from backup.run import _safe_filename
from scope import SCOPE_DENIED_ERROR, area_covers, get_ctx, is_global, scope_allows_location
from services import manager_service
from services.manager_service import get_community_sheets_service, get_sheets_service


def _csv_bytes(rows: list) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows or []:
        writer.writerow([str(c) if c is not None else "" for c in row])
    return buf.getvalue().encode("utf-8")


# OS-junk and in-flight reference-replacement artifacts that must never enter a
# backup. '*_staged_*' files are half-written staging files that the reference
# flows promote to canonical names; '.json' is deliberately NOT skipped so
# data/general_locations.json (production state) is preserved.
_SKIP_BASENAMES = {"desktop.ini", "Thumbs.db", ".DS_Store"}


def _should_skip_backup_file(fn: str) -> bool:
    if fn in _SKIP_BASENAMES:
        return True
    if "_staged_" in fn:
        return True
    return False


class _ChunkSink:
    """A write-only file object for zipfile: buffers written bytes until drained.

    It deliberately has no tell()/seek(), so zipfile treats the stream as
    non-seekable and emits data descriptors — exactly the streaming-zip case.
    Memory stays flat: each drained chunk is yielded to the client and cleared.
    """

    def __init__(self):
        self._buf = bytearray()

    def write(self, b):
        self._buf.extend(b)
        return len(b)

    def flush(self):
        pass

    def drain(self) -> bytes:
        if not self._buf:
            return b""
        chunk = bytes(self._buf)
        self._buf.clear()
        return chunk


def _zip_add_tree_streamed(zipf, sink, source_root, arc_prefix):
    """Stream every file under source_root into the open zip, yielding drained chunks.

    Preserves the original _zip_add_tree guards (forward-slash arcnames, '..'
    skip) but copies each file incrementally (1 MB at a time) and tolerates a
    file vanishing or becoming unreadable mid-walk (a concurrent approval,
    relocation, soft-delete or nightly rename) so one bad file can't abort a
    multi-GB stream. os.walk uses the real on-disk names, so uppercase .JPG,
    deep CPBS nests, bio-only folders, and 'Incidental Places' all archive
    verbatim with no case/extension probing.
    """
    source_root = os.path.abspath(source_root)
    if not os.path.isdir(source_root):
        return
    arc_prefix = arc_prefix.strip("/").replace("\\", "/")
    for dirpath, _dirs, filenames in os.walk(source_root):
        for fn in filenames:
            if _should_skip_backup_file(fn):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, source_root)
            rel_posix = rel.replace("\\", "/")
            if rel_posix.startswith(".."):
                continue
            arcname = posixpath.join(arc_prefix, rel_posix)
            try:
                st = os.stat(full)
                zi = zipfile.ZipInfo(arcname, date_time=time.localtime(st.st_mtime)[:6])
                zi.compress_type = zipfile.ZIP_DEFLATED
                with zipf.open(zi, "w") as dst, open(full, "rb") as src:
                    shutil.copyfileobj(src, dst, length=1024 * 1024)
            except Exception as e:  # noqa: BLE001 — never let one file kill the stream
                print(f"⚠️ backup: skipped {full!r}: {e}", flush=True)
                continue
            chunk = sink.drain()
            if chunk:
                yield chunk


# ---------------------------------------------------------------------------
# Access + scope resolution
# ---------------------------------------------------------------------------


def _is_backup_authorized(ctx):
    """True for a full admin OR a staff **Team Lead** (staff + group_role 'lead').

    Regular staff/members and community are rejected — the backup download is
    limited to team leads and admins.
    """
    ctx = ctx or {}
    role = ctx.get("role")
    if role == "admin":
        return True
    return role == "staff" and ctx.get("group_role") == "lead"


def _wait_for_manager():
    """Block until the data manager is ready; RuntimeError (-> 503) if it isn't."""
    if not manager_service.manager_ready.wait(timeout=30):
        raise RuntimeError("Data manager not ready")
    mgr = manager_service.manager
    if mgr is None:
        raise RuntimeError("Data manager unavailable")
    return mgr


def _normalize_rel_area(area):
    """Normalize an area path to a POSIX rel path under data/ (no leading/trailing
    slash, '\\' -> '/'). Raises ValueError on a '..' traversal segment."""
    a = (area or "").strip().strip("/").replace("\\", "/")
    if not a:
        return ""
    if ".." in a.split("/"):
        raise ValueError(f"Invalid area path: {area!r}")
    return a


def _safe_rel_area(area):
    """Normalize + containment-check an area path under data/, WITHOUT requiring
    the folder to exist. Returns the normalized rel path (POSIX). Raises
    ValueError on blank / '..' traversal / a path that escapes data/.

    Used for an in-scope scoped area that may have no on-disk folder yet (a newly
    assigned area) — the request is authorized, it just yields an empty data tree
    rather than a confusing 400. The traversal/containment guard is the
    security-critical part and always runs.
    """
    rel = _normalize_rel_area(area)
    if not rel:
        raise ValueError("area parameter required for scope=area")
    mgr = _wait_for_manager()
    base_dir = os.path.abspath(mgr.base_dir)
    target = os.path.abspath(os.path.join(base_dir, *rel.split("/")))
    if os.path.commonpath([base_dir, target]) != base_dir:
        raise ValueError(f"Invalid area path: {area!r}")
    return rel


def _validate_area_folder(area):
    """Like ``_safe_rel_area`` but ALSO requires the folder to exist. Used for a
    GLOBAL caller (whose dropdown is built from the on-disk location list, so a
    missing folder means a genuinely bad request)."""
    rel = _safe_rel_area(area)
    mgr = _wait_for_manager()
    target = os.path.abspath(os.path.join(os.path.abspath(mgr.base_dir), *rel.split("/")))
    if not os.path.isdir(target):
        raise ValueError(f"Area folder not found under data/: {rel!r}")
    return rel


def _dedupe_roots(roots):
    """Drop any root covered by another so a scope=all backup never zips the same
    subtree twice: overlapping owned areas ``['Kansas', 'Kansas/Topeka']`` -> ``['Kansas']``."""
    out = []
    for r in roots:
        if any(r != other and area_covers(other, r) for other in roots):
            continue  # r sits under another owned root -> already covered
        if r not in out:
            out.append(r)
    return out


def _owning_sheet_for_area(area):
    """Map an area path to its owning Google Sheet tab (for the snapshot filter).

    The tab is the top-level path segment (``Kansas/Topeka`` -> ``Kansas``,
    ``NebraskaCPBS/CPBS`` -> ``NebraskaCPBS``). Best-effort case-corrects against
    the live tab list; falls back to the raw segment if Sheets is unavailable, so
    minting never hard-depends on Google being reachable.
    """
    top = (area or "").split("/", 1)[0].strip()
    if not top:
        return top
    try:
        svc = get_sheets_service()
        tabs = svc.list_sheets() if svc else None
    except Exception:  # noqa: BLE001 — snapshot filter is best-effort
        tabs = None
    if tabs:
        exact = next((t for t in tabs if t == top), None)
        if exact:
            return exact
        ci = next((t for t in tabs if t.lower() == top.lower()), None)
        if ci:
            return ci
    return top


def resolve_backup_scope(ctx, scope, area):
    """Resolve + CLAMP the requested backup slice against the caller's scope.

    Returns::

        {'roots': [rel, ...], 'sheets': [tab, ...] | '*', 'label': str,
         'scope': 'all'|'area', 'area': str}

    ``roots`` are rel paths under data/; ``roots == ['']`` means the whole tree.
    ``sheets == '*'`` means every tab. Raises ``ValueError`` (-> 400) on bad
    input and ``PermissionError`` (-> 403) when the request falls outside the
    caller's assigned areas.
    """
    scope = (scope or "").strip().lower()
    if scope not in ("all", "area"):
        raise ValueError("scope must be 'all' or 'area'")

    # Global caller (admin, Operations, or a global-scope group) — no clamp.
    if is_global(ctx):
        if scope == "all":
            return {"roots": [""], "sheets": "*", "label": "all", "scope": "all", "area": ""}
        rel = _validate_area_folder(area)
        return {
            "roots": [rel],
            "sheets": [_owning_sheet_for_area(rel)],
            "label": rel,
            "scope": "area",
            "area": rel,
        }

    # Scoped caller — a team lead of a scoped group. Clamp to owned areas.
    areas = [a.strip() for a in (ctx.get("areas") or []) if a and a.strip()]
    if not areas:
        raise PermissionError("Your group has no assigned areas to back up")

    if scope == "all":
        roots = _dedupe_roots([r for r in (_normalize_rel_area(a) for a in areas) if r])
        sheets = sorted({_owning_sheet_for_area(r) for r in roots})
        return {"roots": roots, "sheets": sheets, "label": "my-areas", "scope": "all", "area": ""}

    # scope == "area": the requested area must sit within an owned area.
    rel_req = _normalize_rel_area(area)
    if not rel_req:
        raise ValueError("area parameter required for scope=area")
    if not scope_allows_location(ctx, rel_req):
        raise PermissionError(SCOPE_DENIED_ERROR)
    # In-scope but folder-tolerant: an owned area with no on-disk folder yet is a
    # valid (empty) backup, not a 400 — the dropdown always offers owned areas.
    rel = _safe_rel_area(rel_req)
    return {
        "roots": [rel],
        "sheets": [_owning_sheet_for_area(rel)],
        "label": rel,
        "scope": "area",
        "area": rel,
    }


def _resolve_backup_context(resolved):
    """Turn a resolved-scope dict (from the token or a re-clamp) into everything
    needed to stream the backup: the (source_root, arc_prefix) pairs, the sheet
    filter, the label and the download filename.

    Runs BEFORE any bytes are streamed so we can still return clean 400/503 JSON
    (once streaming starts the headers are sent and an error code is impossible).
    Raises ValueError (-> 400) or RuntimeError (-> 503).
    """
    mgr = _wait_for_manager()
    base_dir = os.path.abspath(mgr.base_dir)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")

    roots = resolved.get("roots") or []
    sheets = resolved.get("sheets")
    label = resolved.get("label") or "backup"

    # Build (source_root_abs, arc_prefix) pairs. roots == [''] -> the whole tree;
    # arc_prefix stays data/<rel> so the ZIP layout mirrors backend/data.
    pairs = []
    for rel in roots:
        rel_norm = (rel or "").strip().strip("/").replace("\\", "/")
        if not rel_norm:
            pairs.append((base_dir, "data"))
            continue
        src = os.path.abspath(os.path.join(base_dir, *rel_norm.split("/")))
        if os.path.commonpath([base_dir, src]) != base_dir:
            continue  # never escape data/
        pairs.append((src, posixpath.join("data", rel_norm)))

    safe_stub = re.sub(r"[^a-zA-Z0-9._-]+", "_", label).strip("_") or "backup"
    return {
        "roots": roots,
        "sheets": sheets,
        "source_pairs": pairs,
        "filename": f"turtle-backup-{safe_stub}-{stamp}.zip",
        "label": label,
    }


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


def _sheet_allowed(name, allowed):
    """allowed is None ('*') -> every tab; else a list of tab names (case-insensitive)."""
    if allowed is None:
        return True
    low = {s.lower() for s in allowed}
    return (name or "").lower() in low


def _filter_sheet_values_for_roots(values, sheet_name, roots, service):
    """Row-filter a sheet snapshot to the backup's areas, mirroring the in-app
    turtle list EXACTLY (routes/sheets.list_all_turtles).

    A tab is per-STATE, so a sub-location backup of the whole ``Kansas`` tab would
    otherwise leak sibling sub-locations' rows (Lawrence, Wichita) that the caller
    can't see in-app. This drops a row ONLY when it has a general location outside
    the backup's roots; the header, rows with no general location, and any sheet
    with no mappable general-location column (e.g. the community pool) are kept
    unchanged — so the backup never exposes more than the in-app list does. Only
    called for a BOUNDED backup (a specific area/scope); the whole-tree admin
    export is never filtered.
    """
    if not values or not roots:
        return values
    header = values[0] or []
    mapping = getattr(service, "COLUMN_MAPPING", None) or {}
    gl_idx = None
    for idx, col in enumerate(header):
        if (col or "").strip() and mapping.get((col or "").strip()) == "general_location":
            gl_idx = idx
            break
    if gl_idx is None:
        return values  # not location-scoped (no general-location column)
    ctx = {"is_global": False, "areas": list(roots)}
    out = [header]
    for row in values[1:]:
        gl = (row[gl_idx].strip() if gl_idx < len(row) and row[gl_idx] else "")
        if gl and not scope_allows_location(ctx, f"{sheet_name}/{gl}"):
            continue
        out.append(row)
    return out


def _backup_readme(ctx):
    label = ctx.get("label") or "backup"
    sheets = ctx.get("sheets")
    if label == "all" and sheets == "*":
        # Byte-for-byte the original whole-server README (the disaster-recovery path).
        return (
            "TurtleTracker offline backup (admin download)\n"
            "=============================================\n"
            "data/     — mirror of the server backend data directory for this scope.\n"
            "sheets_export/ — CSV + JSON snapshots from Google Sheets (research + community).\n"
            "\n"
            "Restore: copy contents of data/ over the backend data folder. "
            "If spreadsheets are lost, recreate tabs and import the matching CSV files.\n"
        )
    roots = ctx.get("roots") or []
    root_lines = ", ".join(r or "(whole data tree)" for r in roots) or "(none)"
    sheet_lines = "all tabs" if sheets == "*" else (", ".join(sheets) if sheets else "(none)")
    return (
        "TurtleTracker offline backup (scoped download)\n"
        "==============================================\n"
        f"Scope label: {label}\n"
        f"data/ areas: {root_lines}\n"
        f"Google Sheets tabs: {sheet_lines}\n"
        "\n"
        "data/ mirrors the listed area folders under backend/data. "
        "sheets_export/ has CSV + JSON snapshots for the listed tabs (research + community).\n"
        "\n"
        "Restore: copy the data/ folders back over backend/data. "
        "If spreadsheets are lost, recreate the tabs and import the matching CSV files.\n"
    )


def _iter_backup_zip(ctx):
    """Yield a ZIP (filtered Sheets snapshots + one or more data trees) as a
    constant-memory stream.

    Sheets CSV/JSON exports go first (small/fast, so the connection commits
    early); the large data/ tree(s) stream last. Each Sheets call is wrapped so a
    mid-stream Sheets outage skips a snapshot instead of corrupting the archive.
    The ``sheets`` value drives the export: ``'*'`` = every tab (the whole-server
    behavior); a list = only those tabs (filtered across BOTH the research and
    community spreadsheets).
    """
    sink = _ChunkSink()
    sheets = ctx.get("sheets")
    allowed = None if sheets == "*" else list(sheets or [])
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
        for kind, svc in (
            ("admin", get_sheets_service()),
            ("community", get_community_sheets_service()),
        ):
            if not svc:
                continue
            try:
                sheet_names = svc.list_sheets() or []
            except Exception as e:  # noqa: BLE001
                sheet_names = []
                print(f"⚠️ backup: {kind} list_sheets failed: {e}", flush=True)
            collected = {}
            for sn in sheet_names:
                if not _sheet_allowed(sn, allowed):
                    continue
                try:
                    values = svc.get_sheet_rows(sn)
                except Exception as e:  # noqa: BLE001
                    print(f"⚠️ backup: {kind} get_sheet_rows({sn!r}) failed: {e}", flush=True)
                    continue
                if values is None:
                    continue
                # Bounded (scoped/area) backup: drop out-of-scope rows so a
                # sub-location backup can't leak sibling sub-locations' rows.
                if allowed is not None:
                    values = _filter_sheet_values_for_roots(values, sn, ctx.get("roots") or [], svc)
                zipf.writestr(
                    f"sheets_export/{kind}_{_safe_filename(sn)}.csv",
                    _csv_bytes(values),
                    compress_type=zipfile.ZIP_DEFLATED,
                )
                collected[sn] = values
                chunk = sink.drain()
                if chunk:
                    yield chunk
            if collected:
                zipf.writestr(
                    f"sheets_export/{kind}.json",
                    json.dumps(collected, ensure_ascii=False, indent=2).encode("utf-8"),
                    compress_type=zipfile.ZIP_DEFLATED,
                )

        zipf.writestr(
            "sheets_export/README.txt",
            _backup_readme(ctx).encode("utf-8"),
            compress_type=zipfile.ZIP_DEFLATED,
        )

        chunk = sink.drain()
        if chunk:
            yield chunk

        # Large/slow last: the on-disk data tree(s), copied in constant memory.
        for source_root, arc_prefix in ctx["source_pairs"]:
            for chunk in _zip_add_tree_streamed(zipf, sink, source_root, arc_prefix):
                yield chunk

    # ZipFile.__exit__ wrote the central directory into the sink — flush it.
    final = sink.drain()
    if final:
        yield final


def _authorize_archive_request():
    """Authorize the *header* (non-?dl=) download path.

    Admin OR staff **Team Lead**, decided off ``validate_and_get_context`` (the
    DB-fresh validate body, with the revocation check baked in) — never off the
    JWT claim, consistent with the rest of the scoped-group work. Sets
    ``request.scope_ctx`` so the caller can re-clamp the requested scope. The
    ``?dl=`` token path is handled separately (the token is its own signed
    capability).

    Returns (ok: bool, error_payload: dict|None, status: int).
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return False, {"error": "Authentication required"}, 401
    allowed, err, ctx = auth.validate_and_get_context(auth_header)
    if not allowed:
        return False, {"error": err or "Token has been revoked"}, 403
    if not _is_backup_authorized(ctx):
        return False, {"error": "Backup download is limited to team leads and admins"}, 403
    request.scope_ctx = ctx
    return True, None, 200


def _compute_next_backup_window():
    """Compute the next chronodrop window in server-local time.

    The schedule is hard-pinned to the cron line in scripts/daily-backup.sh
    (default 03:00); env vars BACKUP_SCHEDULE_HOUR / BACKUP_SCHEDULE_MINUTE
    let an admin shift it without redeploying. BACKUP_DURATION_SECONDS is
    the conservative max-window the UI uses to lock interaction.
    """
    schedule_hour = int(os.environ.get("BACKUP_SCHEDULE_HOUR", "3"))
    schedule_minute = int(os.environ.get("BACKUP_SCHEDULE_MINUTE", "0"))
    duration_seconds = int(os.environ.get("BACKUP_DURATION_SECONDS", "480"))

    now = datetime.now()
    today_run = now.replace(
        hour=schedule_hour, minute=schedule_minute, second=0, microsecond=0
    )
    next_run = today_run if today_run > now else today_run + timedelta(days=1)
    server_tz = time.tzname[time.localtime().tm_isdst] or "UTC"

    return {
        "next_start_unix": int(next_run.timestamp()),
        "duration_seconds": duration_seconds,
        "schedule_hour": schedule_hour,
        "schedule_minute": schedule_minute,
        "server_tz": server_tz,
    }


def register_admin_backup_routes(app):
    # Not under /api/admin/* — that prefix is served by the Express auth backend in production.
    @app.route("/api/backup/window", methods=["GET", "OPTIONS"])
    @require_admin
    def get_backup_window():
        """Schedule info for the admin-page countdown overlay (staff + admin)."""
        if request.method == "OPTIONS":
            return "", 200
        return jsonify(_compute_next_backup_window())

    @app.route("/api/backup/archive/token", methods=["POST", "OPTIONS"])
    @require_admin
    def create_admin_backup_token():
        """Mint a short-lived capability token so the browser can stream the
        download via a plain navigation (which can't carry the Authorization
        header). Limited to team leads + admins; the requested scope is resolved
        and CLAMPED against the caller's areas here, where we still have the ctx."""
        if request.method == "OPTIONS":
            return "", 200
        ctx = get_ctx()
        if not _is_backup_authorized(ctx):
            return jsonify({"error": "Backup download is limited to team leads and admins"}), 403
        scope = (request.args.get("scope") or "").strip().lower()
        area = (request.args.get("area") or "").strip() or None
        try:
            resolved = resolve_backup_scope(ctx, scope, area)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except RuntimeError as e:
            return jsonify({"error": str(e)}), 503
        uid = (getattr(request, "user", None) or {}).get("id")
        token = mint_download_token(uid, resolved)
        return jsonify({"token": token, "expires_in": 120, "label": resolved["label"]})

    @app.route("/api/backup/archive", methods=["GET", "OPTIONS"])
    def download_admin_backup_archive():
        if request.method == "OPTIONS":
            return "", 200

        dl = request.args.get("dl")
        if dl:
            # The token IS the capability: roots/sheets/label are baked in + signed,
            # so a tampered ?scope=/?area= on the URL can't widen the archive.
            resolved = verify_download_token(dl)
            if not resolved:
                return jsonify({"error": "Authentication required"}), 401
        else:
            # Header path: admin OR team lead, then re-clamp from the live ctx.
            ok, err_payload, status = _authorize_archive_request()
            if not ok:
                return jsonify(err_payload), status
            scope = (request.args.get("scope") or "").strip().lower()
            area = (request.args.get("area") or "").strip() or None
            try:
                resolved = resolve_backup_scope(get_ctx(), scope, area)
            except ValueError as e:
                return jsonify({"error": str(e)}), 400
            except PermissionError as e:
                return jsonify({"error": str(e)}), 403
            except RuntimeError as e:
                return jsonify({"error": str(e)}), 503

        # Resolve + validate before streaming so 400/503 are still possible.
        try:
            ctx = _resolve_backup_context(resolved)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except RuntimeError as e:
            return jsonify({"error": str(e)}), 503
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"Backup failed: {e}"}), 500

        headers = {
            "Content-Disposition": f'attachment; filename="{ctx["filename"]}"',
            # No Content-Length: chunked transfer. X-Accel-Buffering disables
            # proxy buffering if a reverse proxy is ever placed in front.
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-store",
        }
        return Response(
            stream_with_context(_iter_backup_zip(ctx)),
            mimetype="application/zip",
            headers=headers,
        )
