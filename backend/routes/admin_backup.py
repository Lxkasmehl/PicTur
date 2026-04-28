"""
Admin-only backup download: ZIP with a mirror of backend data/ plus Google Sheets CSV/JSON exports.
"""

import csv
import io
import json
import os
import posixpath
import re
import time
import zipfile
from datetime import datetime, timedelta, timezone

from flask import Response, jsonify, request

from auth import require_admin, require_admin_only
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


def _zip_add_tree(zipf: zipfile.ZipFile, source_root: str, arc_prefix: str) -> None:
    """Add all files under source_root into the zip under arc_prefix (forward slashes)."""
    source_root = os.path.abspath(source_root)
    if not os.path.isdir(source_root):
        return
    arc_prefix = arc_prefix.strip("/").replace("\\", "/")
    for dirpath, _, filenames in os.walk(source_root):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            if not os.path.isfile(full):
                continue
            rel = os.path.relpath(full, source_root)
            rel_posix = rel.replace("\\", "/")
            if rel_posix.startswith(".."):
                continue
            arcname = posixpath.join(arc_prefix, rel_posix)
            zipf.write(full, arcname, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)


def _csv_bytes(rows: list) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows or []:
        writer.writerow([str(c) if c is not None else "" for c in row])
    return buf.getvalue().encode("utf-8")


def _build_backup_zip(scope: str, sheet_name: str | None) -> tuple[bytes, str]:
    """
    scope: 'all' | 'sheet'
    sheet_name: required for scope=sheet (Google Sheet tab name).
    Returns (zip_bytes, suggested_filename).
    """
    if not manager_service.manager_ready.wait(timeout=30):
        raise RuntimeError("Data manager not ready")
    mgr = manager_service.manager
    if mgr is None:
        raise RuntimeError("Data manager unavailable")

    base_dir = os.path.abspath(mgr.base_dir)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    admin_svc = get_sheets_service()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
        if scope == "all":
            _zip_add_tree(zipf, base_dir, "data")
            if admin_svc:
                sheet_names = admin_svc.list_sheets() or []
                all_data = {}
                for sn in sheet_names:
                    safe = _safe_filename(sn)
                    values = admin_svc.get_sheet_rows(sn)
                    if values is None:
                        continue
                    zipf.writestr(
                        f"sheets_export/admin_{safe}.csv",
                        _csv_bytes(values),
                        compress_type=zipfile.ZIP_DEFLATED,
                    )
                    all_data[sn] = values
                if all_data:
                    zipf.writestr(
                        "sheets_export/admin.json",
                        json.dumps(all_data, ensure_ascii=False, indent=2).encode("utf-8"),
                        compress_type=zipfile.ZIP_DEFLATED,
                    )
            comm = get_community_sheets_service()
            if comm:
                sheet_names = comm.list_sheets() or []
                all_comm = {}
                for sn in sheet_names:
                    safe = _safe_filename(sn)
                    values = comm.get_sheet_rows(sn)
                    if values is None:
                        continue
                    zipf.writestr(
                        f"sheets_export/community_{safe}.csv",
                        _csv_bytes(values),
                        compress_type=zipfile.ZIP_DEFLATED,
                    )
                    all_comm[sn] = values
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
            fname = f"turtle-backup-all-{stamp}.zip"
        elif scope == "sheet":
            sn = (sheet_name or "").strip()
            if not sn:
                raise ValueError("sheet parameter required for scope=sheet")
            if not admin_svc:
                raise RuntimeError("Google Sheets service not configured")
            valid = admin_svc.list_sheets() or []
            if sn not in valid:
                raise ValueError(f"Unknown sheet tab: {sn!r}")
            folder = os.path.join(base_dir, _safe_folder_name(sn))
            _zip_add_tree(zipf, folder, posixpath.join("data", _safe_folder_name(sn)))
            values = admin_svc.get_sheet_rows(sn)
            if values is None:
                raise RuntimeError(f"Could not read sheet tab {sn!r}")
            safe = _safe_filename(sn)
            zipf.writestr(
                f"sheets_export/admin_{safe}.csv",
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
            safe_stub = re.sub(r"[^a-zA-Z0-9._-]+", "_", sn).strip("_") or "sheet"
            fname = f"turtle-backup-sheet-{safe_stub}-{stamp}.zip"
        else:
            raise ValueError("scope must be 'all' or 'sheet'")

    return buf.getvalue(), fname


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

    @app.route("/api/backup/archive", methods=["GET", "OPTIONS"])
    @require_admin_only
    def download_admin_backup_archive():
        if request.method == "OPTIONS":
            return "", 200
        scope = (request.args.get("scope") or "").strip().lower()
        sheet_name = (request.args.get("sheet") or "").strip() or None
        if not scope:
            return jsonify({"error": "Missing query parameter: scope (all or sheet)"}), 400
        try:
            data, filename = _build_backup_zip(scope, sheet_name)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except RuntimeError as e:
            return jsonify({"error": str(e)}), 503
        except Exception as e:
            return jsonify({"error": f"Backup failed: {e}"}), 500

        return Response(
            data,
            mimetype="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(data)),
            },
        )
