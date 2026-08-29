"""
Admin-only backup download: a streamed ZIP with a mirror of backend data/ plus
Google Sheets CSV/JSON exports.

The archive is streamed in constant memory (a zipfile written to a write-only
sink, drained chunk-by-chunk) instead of being built in a BytesIO buffer — the
full data/ tree is multi-GB, so buffering it guaranteed OOM/timeout and the
download never started. Because a navigation/anchor download can't send the
Authorization header, the client first mints a short-lived token at
POST /api/backup/archive/token and passes it as ?dl= on the GET.
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

from auth import (
    check_auth_revocation,
    get_user_from_request,
    mint_download_token,
    require_admin,
    require_admin_only,
    verify_download_token,
)
from backup.run import _safe_filename
from services import manager_service
from services.manager_service import get_community_sheets_service, get_sheets_service


def _safe_folder_name(sheet_name: str) -> str:
    """Match turtle_manager._safe_folder_name for on-disk paths."""
    invalid = r'\/:*?"<>|'
    if not sheet_name or not isinstance(sheet_name, str):
        return "_"
    out = sheet_name.strip()
    for c in invalid:
        out = out.replace(c, "_")
    return out or "_"


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


def _resolve_backup_context(scope: str, sheet_name):
    """Validate inputs and resolve everything needed to stream the backup.

    Runs BEFORE any bytes are streamed so we can still return clean 400/503 JSON
    (once streaming starts the headers are sent and an error code is impossible).
    Raises ValueError (-> 400) or RuntimeError (-> 503).
    """
    if not manager_service.manager_ready.wait(timeout=30):
        raise RuntimeError("Data manager not ready")
    mgr = manager_service.manager
    if mgr is None:
        raise RuntimeError("Data manager unavailable")

    base_dir = os.path.abspath(mgr.base_dir)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")

    if scope == "all":
        return {
            "scope": "all",
            "source_root": base_dir,
            "arc_prefix": "data",
            "filename": f"turtle-backup-all-{stamp}.zip",
            "sheet_name": None,
        }
    if scope == "sheet":
        sn = (sheet_name or "").strip()
        if not sn:
            raise ValueError("sheet parameter required for scope=sheet")
        admin_svc = get_sheets_service()
        if not admin_svc:
            raise RuntimeError("Google Sheets service not configured")
        valid = admin_svc.list_sheets() or []
        if sn not in valid:
            raise ValueError(f"Unknown sheet tab: {sn!r}")
        safe_folder = _safe_folder_name(sn)
        safe_stub = re.sub(r"[^a-zA-Z0-9._-]+", "_", sn).strip("_") or "sheet"
        return {
            "scope": "sheet",
            "source_root": os.path.join(base_dir, safe_folder),
            "arc_prefix": posixpath.join("data", safe_folder),
            "filename": f"turtle-backup-sheet-{safe_stub}-{stamp}.zip",
            "sheet_name": sn,
        }
    raise ValueError("scope must be 'all' or 'sheet'")


def _iter_backup_zip(ctx):
    """Yield a ZIP (data tree + Google Sheets snapshots) as a constant-memory stream.

    Sheets CSV/JSON exports go first (small/fast, so the connection commits
    early); the large data/ tree streams last. Each Sheets call is wrapped so a
    mid-stream Sheets outage skips a snapshot instead of corrupting the archive.
    """
    sink = _ChunkSink()
    scope = ctx["scope"]
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
        if scope == "all":
            admin_svc = get_sheets_service()
            if admin_svc:
                all_data = {}
                try:
                    sheet_names = admin_svc.list_sheets() or []
                except Exception as e:  # noqa: BLE001
                    sheet_names = []
                    print(f"⚠️ backup: admin list_sheets failed: {e}", flush=True)
                for sn in sheet_names:
                    try:
                        values = admin_svc.get_sheet_rows(sn)
                    except Exception as e:  # noqa: BLE001
                        print(f"⚠️ backup: admin get_sheet_rows({sn!r}) failed: {e}", flush=True)
                        continue
                    if values is None:
                        continue
                    zipf.writestr(
                        f"sheets_export/admin_{_safe_filename(sn)}.csv",
                        _csv_bytes(values),
                        compress_type=zipfile.ZIP_DEFLATED,
                    )
                    all_data[sn] = values
                    chunk = sink.drain()
                    if chunk:
                        yield chunk
                if all_data:
                    zipf.writestr(
                        "sheets_export/admin.json",
                        json.dumps(all_data, ensure_ascii=False, indent=2).encode("utf-8"),
                        compress_type=zipfile.ZIP_DEFLATED,
                    )
            comm = get_community_sheets_service()
            if comm:
                all_comm = {}
                try:
                    sheet_names = comm.list_sheets() or []
                except Exception as e:  # noqa: BLE001
                    sheet_names = []
                    print(f"⚠️ backup: community list_sheets failed: {e}", flush=True)
                for sn in sheet_names:
                    try:
                        values = comm.get_sheet_rows(sn)
                    except Exception as e:  # noqa: BLE001
                        print(f"⚠️ backup: community get_sheet_rows({sn!r}) failed: {e}", flush=True)
                        continue
                    if values is None:
                        continue
                    zipf.writestr(
                        f"sheets_export/community_{_safe_filename(sn)}.csv",
                        _csv_bytes(values),
                        compress_type=zipfile.ZIP_DEFLATED,
                    )
                    all_comm[sn] = values
                    chunk = sink.drain()
                    if chunk:
                        yield chunk
                if all_comm:
                    zipf.writestr(
                        "sheets_export/community.json",
                        json.dumps(all_comm, ensure_ascii=False, indent=2).encode("utf-8"),
                        compress_type=zipfile.ZIP_DEFLATED,
                    )
            readme = (
                "TurtleTracker offline backup (admin download)\n"
                "=============================================\n"
                "data/     — mirror of the server backend data directory for this scope.\n"
                "sheets_export/ — CSV + JSON snapshots from Google Sheets (research + community).\n"
                "\n"
                "Restore: copy contents of data/ over the backend data folder. "
                "If spreadsheets are lost, recreate tabs and import the matching CSV files.\n"
            )
            zipf.writestr("sheets_export/README.txt", readme.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
        else:  # scope == "sheet"
            sn = ctx["sheet_name"]
            admin_svc = get_sheets_service()
            values = None
            if admin_svc:
                try:
                    values = admin_svc.get_sheet_rows(sn)
                except Exception as e:  # noqa: BLE001
                    print(f"⚠️ backup: admin get_sheet_rows({sn!r}) failed: {e}", flush=True)
            if values is not None:
                zipf.writestr(
                    f"sheets_export/admin_{_safe_filename(sn)}.csv",
                    _csv_bytes(values),
                    compress_type=zipfile.ZIP_DEFLATED,
                )
                zipf.writestr(
                    "sheets_export/admin_sheet.json",
                    json.dumps({sn: values}, ensure_ascii=False, indent=2).encode("utf-8"),
                    compress_type=zipfile.ZIP_DEFLATED,
                )
            readme = (
                "TurtleTracker offline backup (single spreadsheet tab)\n"
                "======================================================\n"
                f"Sheet tab: {sn}\n"
                "data/ contains only the on-disk folder for this tab (as under backend/data).\n"
                "sheets_export/ has CSV + JSON for this tab.\n"
            )
            zipf.writestr("sheets_export/README.txt", readme.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)

        chunk = sink.drain()
        if chunk:
            yield chunk

        # Large/slow last: the on-disk data tree, copied in constant memory.
        for chunk in _zip_add_tree_streamed(zipf, sink, ctx["source_root"], ctx["arc_prefix"]):
            yield chunk

    # ZipFile.__exit__ wrote the central directory into the sink — flush it.
    final = sink.drain()
    if final:
        yield final


def _authorize_archive_request(scope, sheet_name):
    """Authorize the streaming download via EITHER the Authorization header
    (full admin role + revocation check) OR a valid short-lived ?dl= token whose
    embedded scope/sheet match this request.

    Returns (ok: bool, error_payload: dict|None, status: int).
    """
    auth_header = request.headers.get("Authorization")
    if auth_header:
        ok, user, err = get_user_from_request()
        if not ok:
            return False, {"error": err or "Authentication required"}, 401
        if (user or {}).get("role") != "admin":
            return False, {"error": "Admin access required"}, 403
        allowed, revoke_err = check_auth_revocation(auth_header)
        if not allowed:
            return False, {"error": revoke_err or "Token has been revoked"}, 403
        return True, None, 200

    dl = request.args.get("dl")
    if dl and verify_download_token(dl, scope, sheet_name):
        return True, None, 200
    return False, {"error": "Authentication required"}, 401


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
    @require_admin_only
    def create_admin_backup_token():
        """Mint a short-lived token so the browser can stream the download via a
        plain navigation (which can't carry the Authorization header)."""
        if request.method == "OPTIONS":
            return "", 200
        scope = (request.args.get("scope") or "").strip().lower()
        sheet_name = (request.args.get("sheet") or "").strip() or None
        if scope not in ("all", "sheet"):
            return jsonify({"error": "scope must be 'all' or 'sheet'"}), 400
        if scope == "sheet" and not sheet_name:
            return jsonify({"error": "sheet parameter required for scope=sheet"}), 400
        uid = (getattr(request, "user", None) or {}).get("id")
        token = mint_download_token(uid, scope, sheet_name)
        return jsonify({"token": token, "expires_in": 120})

    @app.route("/api/backup/archive", methods=["GET", "OPTIONS"])
    def download_admin_backup_archive():
        if request.method == "OPTIONS":
            return "", 200
        scope = (request.args.get("scope") or "").strip().lower()
        sheet_name = (request.args.get("sheet") or "").strip() or None
        if not scope:
            return jsonify({"error": "Missing query parameter: scope (all or sheet)"}), 400

        ok, err_payload, status = _authorize_archive_request(scope, sheet_name)
        if not ok:
            return jsonify(err_payload), status

        # Resolve + validate before streaming so 400/503 are still possible.
        try:
            ctx = _resolve_backup_context(scope, sheet_name)
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
