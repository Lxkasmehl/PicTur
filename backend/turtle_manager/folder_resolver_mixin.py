"""
Resolve and create turtle folder paths on disk.
"""
import json
import os
import re
import shutil
import time
import uuid

import sys
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    import sys; sys.path.insert(0, _backend_dir)

from .path_utils import (
    _extract_exif_date, _date_suffix, _find_image_next_to_pt, _find_image_in_dir,
    _ref_data_folder_score, _is_turtle_data_folder, _basename_matches_turtle_id,
    _safe_folder_name, _BIO_ID_RE, _CARAPACE_RE, _looks_like_primary_id,
    canonical_new_turtle_folder_id, _parse_bio_id, _detect_photo_type,
    _location_dir_from_sheet_name, _resolved_path_under_base,
    _MAX_TURTLE_DIR_DEPTH, _turtle_dir_depth, _clamp_turtle_dir_depth,
    _expand_flat_drive_folder_prefix, _IMAGE_EXTENSIONS,
    DRIVE_LOCATION_TO_BACKEND_PATH, DRIVE_STATE_LEVEL_FOLDERS,
    DRIVE_STATE_NAME_MAP, LOCATION_NAME_MAP,
    _resolve_drive_state_name, _resolve_drive_location_name,
)

try:
    from turtles.image_processing import brain
except ImportError:
    from image_processing import brain  # type: ignore

from additional_image_labels import (
    label_query_matches, migrate_labels_to_archive, normalize_additional_type,
    normalize_label_list, read_labels_for_file, set_labels_for_file,
)


class TurtleFolderResolverMixin:
    """Resolve and create turtle folder paths on disk.

    Mixin for TurtleManager.
    """
    def _data_walk_roots_for_hint(self, location_hint):
        """Subtrees to search with os.walk when resolving a folder id.

        Biology IDs repeat across state/location sheets; walking the entire
        ``data/`` tree would collect multiple same-named turtles and pick the
        wrong one after scoring. When a sheet path hint is present, restrict the
        walk to that subtree (e.g. ``data/Kansas`` or ``data/NebraskaCPBS/CPBS``).

        A leading flash-drive location key (``CPBS``, ``North Topeka``, ...) is
        expanded to its canonical ``State/Location`` so a hint that omits the
        top-level folder still scopes correctly. When a hint IS given but cannot
        be resolved to any existing directory, this returns ``[]`` (fail closed)
        so the lookup reports "not found" rather than silently broadening to a
        same-bio_id turtle in another sheet. ``[base_dir]`` is returned only for
        the genuine no-hint case.
        """
        if not location_hint or not str(location_hint).strip() or location_hint == "Unknown":
            return [self.base_dir]
        rel = _location_dir_from_sheet_name(location_hint)
        if not rel:
            return []
        rel_parts = [p for p in rel.replace("\\", "/").split("/") if str(p).strip()]
        rel_parts = _expand_flat_drive_folder_prefix(rel_parts)
        if not rel_parts:
            return []
        # Walk the deepest hinted prefix that exists; fall back to shorter
        # prefixes but never below the top-level (sheet) folder.
        for depth in range(len(rel_parts), 0, -1):
            cand = _resolved_path_under_base(self.base_dir, *rel_parts[:depth])
            if cand and os.path.isdir(cand):
                return [cand]
        return []

    def _get_turtle_folder(self, turtle_id, location_hint=None):
        """
        Resolve turtle folder path by turtle_id and optional location_hint.

        If ``join(base_dir, hint, turtle_id)`` exists it used to win unconditionally, which breaks
        when that directory is an empty shell (e.g. partial path) while the real data lives under
        a deeper location discovered by walking. We pick the candidate with the strongest ref_data.
        """
        if not turtle_id or not isinstance(turtle_id, str):
            return None
        tid = turtle_id.strip()
        if not tid:
            return None

        candidates = []
        real_seen = set()

        def add_candidate(path):
            if not path or not os.path.isdir(path):
                return
            try:
                rp = os.path.realpath(path)
            except OSError:
                return
            if rp in real_seen:
                return
            real_seen.add(rp)
            candidates.append(path)

        hinted_path = None
        if location_hint and str(location_hint).strip() and location_hint != "Unknown":
            rel = _location_dir_from_sheet_name(location_hint)
            if rel:
                rel_parts = [p for p in rel.replace("\\", "/").split("/") if str(p).strip()]
                rel_parts = _expand_flat_drive_folder_prefix(rel_parts)
                if rel_parts:
                    hinted_path = _resolved_path_under_base(self.base_dir, *rel_parts, tid)
            if not hinted_path:
                hinted_path = os.path.join(self.base_dir, location_hint, tid)
            add_candidate(hinted_path)

        walk_roots = self._data_walk_roots_for_hint(location_hint)
        try:
            for walk_root in walk_roots:
                for root, dirs, files in os.walk(walk_root):
                    # Never resolve a turtle from an archived or soft-deleted copy:
                    # an archived folder is named "<ts>_State__Location__F###", whose
                    # basename endswith "_F###" and would otherwise match tid F###.
                    dirs[:] = [d for d in dirs if d not in ('_Archive', 'Deleted')]
                    if _basename_matches_turtle_id(os.path.basename(root), tid):
                        add_candidate(root)
        except OSError:
            pass

        # Stale-location fallback: the hint scoped us to a subtree that doesn't
        # hold this turtle (e.g. Location="Shredder" but folder lives directly
        # under .../CPBS/). A globally-unique primary_id is safe to recover with
        # a full unscoped walk; bio_ids repeat across sheets so we skip those.
        if (not candidates
                and _looks_like_primary_id(tid)
                and self.base_dir not in walk_roots):
            try:
                for root, dirs, files in os.walk(self.base_dir):
                    dirs[:] = [d for d in dirs if d not in ('_Archive', 'Deleted')]
                    if _basename_matches_turtle_id(os.path.basename(root), tid):
                        add_candidate(root)
            except OSError:
                pass

        if not candidates:
            return None
        # No usable hint + a bare biology id matching more than one folder is
        # ambiguous (bio_ids repeat across top-level sheet folders). Refuse to
        # guess; only a globally-unique primary_id may resolve unscoped.
        no_usable_hint = (
            not location_hint
            or not str(location_hint).strip()
            or location_hint == "Unknown"
        )
        if no_usable_hint and len(candidates) > 1 and not _looks_like_primary_id(tid):
            return None
        if len(candidates) == 1:
            return candidates[0]

        scored = [(_ref_data_folder_score(p, tid), p) for p in candidates]
        max_score = max(s for s, _ in scored)
        best = [p for s, p in scored if s == max_score]
        if len(best) == 1:
            return best[0]
        if hinted_path and os.path.isdir(hinted_path):
            try:
                hr = os.path.realpath(hinted_path)
                for p in best:
                    if os.path.realpath(p) == hr:
                        return hinted_path
            except OSError:
                pass
        return sorted(best)[0]

    def _state_dir_has_site_subfolders(self, state_path):
        """
        True when ``state_path`` has intermediate site folders (each containing turtle dirs).

        Used to avoid creating ``data/Kansas/<primary_id>/`` when real layout is
        ``data/Kansas/North Topeka/<biology_id>/``.
        """
        if not state_path or not os.path.isdir(state_path):
            return False
        try:
            for child in os.listdir(state_path):
                site = os.path.join(state_path, child)
                if not os.path.isdir(site):
                    continue
                if _is_turtle_data_folder(site):
                    continue
                try:
                    for sub in os.listdir(site):
                        q = os.path.join(site, sub)
                        if _is_turtle_data_folder(q):
                            return True
                except OSError:
                    continue
        except OSError:
            pass
        return False

    def _find_turtle_under_single_state_segment(self, state_segment, tid):
        """``data/<State>/<tid>`` (flat) or ``data/<State>/<Site>/<tid>`` (nested).

        Recognizes bio-id-only, primary-id-only, and combined ``{bio_id}_{primary_id}``
        folder names via ``_basename_matches_turtle_id`` so a sheet lookup with
        either ID resolves to the same folder.
        """
        state_path = _resolved_path_under_base(self.base_dir, state_segment)
        if not state_path or not os.path.isdir(state_path):
            return None
        # Flat layout: data/<State>/<turtle>
        try:
            for entry in sorted(os.listdir(state_path)):
                cand = os.path.join(state_path, entry)
                if (os.path.isdir(cand)
                        and _basename_matches_turtle_id(entry, tid)
                        and _is_turtle_data_folder(cand)):
                    return cand
        except OSError:
            pass
        # Nested layout: data/<State>/<Site>/<turtle>
        try:
            for child in sorted(os.listdir(state_path)):
                site = os.path.join(state_path, child)
                if not os.path.isdir(site):
                    continue
                try:
                    for entry in sorted(os.listdir(site)):
                        cand = os.path.join(site, entry)
                        if (os.path.isdir(cand)
                                and _basename_matches_turtle_id(entry, tid)
                                and _is_turtle_data_folder(cand)):
                            return cand
                except OSError:
                    continue
        except OSError:
            pass
        return None

    def resolve_turtle_dir_for_sheet_upload(self, turtle_id, sheet_name, primary_id=None):
        """
        Resolve or create the on-disk turtle folder for admin uploads from the Sheets browser.

        When ``sheet_name`` is set (e.g. Kansas/Topeka), prefers ``data/<sheet...>/<turtle_id>/``.
        If that path does not exist but another folder named ``turtle_id`` is found elsewhere,
        returns the existing folder (same behaviour as a plain search). If nothing exists,
        creates ``data/<sheet...>/<turtle_id>/`` with ``ref_data`` and ``loose_images``.

        When ``primary_id`` is provided, tries that lookup FIRST. Primary IDs are
        globally unique while biology IDs collide across US state sheets, so a
        primary-first resolution avoids picking the wrong same-bio_id turtle in
        another state. Falls through to ``turtle_id`` when the primary lookup
        misses (or the folder is still in bio-id-only form pre-chronodrop rename).
        """
        if primary_id and isinstance(primary_id, str) and primary_id.strip() and primary_id.strip() != (turtle_id or '').strip():
            # Read-only lookup via _get_turtle_folder — finds existing combined-
            # name or primary-only folders without creating anything.
            primary_dir = self._get_turtle_folder(primary_id.strip(), sheet_name)
            if primary_dir and os.path.isdir(primary_dir):
                return primary_dir
        if not turtle_id or not isinstance(turtle_id, str):
            return None
        tid = turtle_id.strip()
        if not tid or os.path.isabs(tid) or "/" in tid or "\\" in tid or tid in (".", ".."):
            return None
        rel = _location_dir_from_sheet_name(sheet_name) if sheet_name else None
        if rel:
            rel_parts = [p for p in rel.replace("\\", "/").split("/") if str(p).strip()]
            # Expand a leading flash-drive location key (e.g. "CPBS" ->
            # "NebraskaCPBS/CPBS") so an upload hint that omits the top-level
            # folder neither broadens across sheets nor creates a misplaced
            # top-level folder.
            rel_parts = _expand_flat_drive_folder_prefix(rel_parts)
            if not rel_parts:
                return None
            explicit = _resolved_path_under_base(self.base_dir, *rel_parts, tid)
            if not explicit:
                return None
            if os.path.isdir(explicit):
                return explicit
            if len(rel_parts) == 1:
                nested = self._find_turtle_under_single_state_segment(rel_parts[0], tid)
                if nested:
                    return nested
            search_under = _resolved_path_under_base(self.base_dir, *rel_parts)
            if search_under and os.path.isdir(search_under):
                for root, dirs, files in os.walk(search_under):
                    if _basename_matches_turtle_id(os.path.basename(root), tid):
                        return root
            if len(rel_parts) == 1:
                state_only = _resolved_path_under_base(self.base_dir, rel_parts[0])
                if state_only and self._state_dir_has_site_subfolders(state_only):
                    return None
            # Clamp before creating so a deep location hint can't make a 4-level folder.
            # (Lookups above used the unclamped path, so existing deep folders still resolve.)
            explicit = _clamp_turtle_dir_depth(self.base_dir, explicit)
            os.makedirs(os.path.join(explicit, "ref_data"), exist_ok=True)
            os.makedirs(os.path.join(explicit, "loose_images"), exist_ok=True)
            return explicit
        return self._get_turtle_folder(tid, None)

    def resolve_or_create_canonical_turtle_dir(self, turtle_id, sheet_name, primary_id=None, bio_id=None):
        """Find an existing turtle folder, or create a canonical one if none exists.

        Returns ``(turtle_dir | None, created: bool, reason: str | None)``.
        ``reason`` is ``None`` on success and a short human-readable explanation
        when the folder could not be resolved or created, so callers can surface
        a useful error instead of a bare "not found".

        Unlike ``resolve_turtle_dir_for_sheet_upload`` (which creates a
        *bare*-named ``turtle_id`` folder with only ``ref_data/`` +
        ``loose_images/``), a folder created here is named ``<bio_id>_<primary_id>``
        via ``canonical_new_turtle_folder_id`` and gets the full modern structure.
        Used by the Sheets-Browser upload paths so a sheet-only ("Null") turtle's
        first reference photo lands in a correctly-named, correctly-located dir.
        """
        existing = None
        if (primary_id and isinstance(primary_id, str) and primary_id.strip()
                and primary_id.strip() != (turtle_id or '').strip()):
            existing = self._get_turtle_folder(primary_id.strip(), sheet_name)
        if (not existing or not os.path.isdir(existing)) and turtle_id:
            bio_match = self._get_turtle_folder(turtle_id, sheet_name)
            # Guard against biology-id collisions: turtle_id is usually a bare
            # bio_id, unique only within a sheet. If the matched folder carries a
            # DIFFERENT primary_id, it belongs to another turtle -- don't adopt
            # it; fall through to creating this turtle's own canonical folder.
            if bio_match and primary_id and primary_id.strip():
                other = re.search(r'T\d{10,}', os.path.basename(bio_match))
                if other and other.group(0) != primary_id.strip():
                    bio_match = None
            if bio_match and os.path.isdir(bio_match):
                existing = bio_match
        if existing and os.path.isdir(existing):
            return existing, False, None

        if not turtle_id or not isinstance(turtle_id, str):
            return None, False, "no turtle id provided"
        tid = turtle_id.strip()
        if not tid or os.path.isabs(tid) or "/" in tid or "\\" in tid or tid in (".", ".."):
            return None, False, f"invalid turtle id '{turtle_id}'"
        rel = _location_dir_from_sheet_name(sheet_name) if sheet_name else None
        if not rel:
            return None, False, (
                "no location to create the folder under -- set the turtle's "
                "sheet/location first"
            )
        rel_parts = [p for p in rel.replace("\\", "/").split("/") if str(p).strip()]
        rel_parts = _expand_flat_drive_folder_prefix(rel_parts)
        if not rel_parts:
            return None, False, "could not resolve a location path from the sheet hint"
        # Don't create a shallow data/<State>/<turtle>/ when the real layout is
        # data/<State>/<Site>/<turtle>/ (mirrors resolve_turtle_dir_for_sheet_upload).
        if len(rel_parts) == 1:
            state_only = _resolved_path_under_base(self.base_dir, rel_parts[0])
            if state_only and self._state_dir_has_site_subfolders(state_only):
                return None, False, (
                    f"'{rel_parts[0]}' organizes turtles by site -- set a General "
                    f"Location for this turtle before adding photos"
                )
        location_dir = _resolved_path_under_base(self.base_dir, *rel_parts)
        if not location_dir:
            return None, False, "could not resolve a safe folder path"
        # Never create a bio-id-only folder: bio_ids repeat across sheets so a
        # bio-only name is a cross-sheet collision risk. Require primary_id;
        # return a retryable error so the caller can 503 and create nothing.
        if (bio_id or '').strip() and not (primary_id or '').strip():
            return None, False, (
                "Can't create a canonical turtle folder without a Primary ID. "
                "If Google Sheets was momentarily unavailable, try again in a "
                "moment; otherwise assign this turtle a Primary ID first."
            )
        folder_name = canonical_new_turtle_folder_id(bio_id, primary_id, tid)
        turtle_dir = _resolved_path_under_base(location_dir, folder_name)
        if not turtle_dir:
            return None, False, "could not resolve a safe folder path"
        # Never create a new turtle below State/Location (no 4-level sub-site nesting).
        turtle_dir = _clamp_turtle_dir_depth(self.base_dir, turtle_dir)
        self._create_modern_turtle_structure(turtle_dir)
        return turtle_dir, True, None

    def relocate_turtle_folder(self, primary_id, sheet_name, new_general_location, *, bio_id=None):
        """Move a turtle's on-disk folder to match (sheet_name, new_general_location).

        Returns ``(moved: bool, message: str)``. Idempotent and fail-soft:
        - No on-disk folder for this turtle: ``(False, "no on-disk folder to move")``
        - Already at destination: ``(False, "already at destination")``
        - Destination occupied by a different folder: ``(False, "destination already exists: ...")``
        - Successful move: ``(True, "moved <old_relpath> -> <new_relpath>")``

        The current folder is located unscoped via primary_id (globally unique)
        with a bio_id fallback, since the whole point of relocate is that the
        folder is NOT where the new sheet hint says it should be. The
        destination is computed from ``(sheet_name, new_general_location)`` the
        same way ``resolve_or_create_canonical_turtle_dir`` does, so flat-drive
        sheets and the shallow-state-with-sites guard behave consistently.

        Refreshes the database index after a successful move so VRAM/db_index
        point at the new path.
        """
        if not primary_id or not isinstance(primary_id, str) or not primary_id.strip():
            return False, "primary_id required"
        if not sheet_name or not str(sheet_name).strip():
            return False, "sheet_name required"

        pid = primary_id.strip()

        current = self._get_turtle_folder(pid)
        if not current and bio_id and isinstance(bio_id, str) and bio_id.strip():
            current = self._get_turtle_folder(bio_id.strip(), sheet_name)
        if not current or not os.path.isdir(current):
            return False, "no on-disk folder to move"

        folder_basename = os.path.basename(current)
        if not folder_basename:
            return False, "current folder has no basename"

        new_gl_str = (new_general_location or "").strip() if isinstance(new_general_location, str) else ""
        sheet_hint = f"{sheet_name}/{new_gl_str}" if new_gl_str else sheet_name
        rel = _location_dir_from_sheet_name(sheet_hint)
        if not rel:
            return False, f"could not resolve destination from sheet hint '{sheet_hint}'"
        rel_parts = [p for p in rel.replace("\\", "/").split("/") if str(p).strip()]
        rel_parts = _expand_flat_drive_folder_prefix(rel_parts)
        if not rel_parts:
            return False, "destination resolved to an empty path"

        if len(rel_parts) == 1:
            state_only = _resolved_path_under_base(self.base_dir, rel_parts[0])
            if state_only and self._state_dir_has_site_subfolders(state_only):
                return False, (
                    f"'{rel_parts[0]}' organizes turtles by site -- "
                    f"set a General Location before relocating"
                )

        location_dir = _resolved_path_under_base(self.base_dir, *rel_parts)
        if not location_dir:
            return False, "could not resolve a safe destination path"
        new_dir = _resolved_path_under_base(location_dir, folder_basename)
        if not new_dir:
            return False, "could not resolve a safe destination path"
        # Relocations also stay at State/Location (no 4-level sub-site nesting).
        new_dir = _clamp_turtle_dir_depth(self.base_dir, new_dir)

        try:
            if os.path.realpath(current) == os.path.realpath(new_dir):
                return False, "already at destination"
        except OSError:
            pass

        if os.path.exists(new_dir):
            try:
                rel_existing = os.path.relpath(new_dir, self.base_dir)
            except ValueError:
                rel_existing = new_dir
            return False, f"destination already exists: {rel_existing}"

        try:
            # Parent of new_dir, which may have been clamped to State/Location.
            os.makedirs(os.path.dirname(new_dir) or location_dir, exist_ok=True)
            shutil.move(current, new_dir)
        except (OSError, shutil.Error) as exc:
            return False, f"move failed: {exc}"

        try:
            self.refresh_database_index()
        except Exception as exc:
            print(f"⚠️ relocate: refresh_database_index failed after move: {exc}")

        try:
            rel_old = os.path.relpath(current, self.base_dir)
            rel_new = os.path.relpath(new_dir, self.base_dir)
        except ValueError:
            rel_old, rel_new = current, new_dir
        return True, f"moved {rel_old} -> {rel_new}"
