"""
Backup Google Sheets (admin + community) to CSV (and optional JSON).
Run from backend directory: python -m backup.run
Or: python backup/run.py (from backend dir)

Uses BACKUP_OUTPUT_DIR from environment (default: ./backups).
Writes to BACKUP_OUTPUT_DIR/sheets/YYYY-MM-DD/ with one CSV per sheet
and optional one JSON file per spreadsheet.
"""

import csv
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

# Ensure backend root is on path when run as __main__
_backend_dir = Path(__file__).resolve().parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

# Load env (same as app)
from dotenv import load_dotenv
for p in [_backend_dir / '.env', _backend_dir.parent / '.env']:
    if p.exists():
        load_dotenv(p, override=False)
        break


def _safe_filename(name: str) -> str:
    """Make sheet name safe for use in filenames."""
    s = re.sub(r'[<>:"/\\|?*]', '_', name)
    return s.strip() or 'sheet'


def _write_csv(path: Path, rows: list) -> None:
    """Write list of rows to CSV (UTF-8)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        for row in rows:
            # Ensure row is list of strings
            writer.writerow([str(c) if c is not None else '' for c in row])


def _export_spreadsheet(service, label: str, date_str: str, out_dir: Path, export_json: bool = True) -> dict:
    """
    Export all sheets of one spreadsheet to out_dir/date_str/.
    label: 'admin' or 'community'
    Returns dict: { 'sheets': count, 'errors': list }
    """
    if service is None:
        return {'sheets': 0, 'errors': [f'{label} service not configured']}
    out_date = out_dir / date_str
    out_date.mkdir(parents=True, exist_ok=True)
    all_data = {}
    errors = []
    try:
        sheet_names = service.list_sheets() or []
    except Exception as e:
        errors.append(f"list_sheets: {e}")
        return {'sheets': 0, 'errors': errors}
    for sheet_name in sheet_names:
        safe = _safe_filename(sheet_name)
        prefix = f"{label}_{safe}"
        values = service.get_sheet_rows(sheet_name)
        if values is None:
            errors.append(f"{sheet_name}: read failed")
            continue
        # CSV
        csv_path = out_date / f"{prefix}.csv"
        _write_csv(csv_path, values)
        all_data[sheet_name] = values
    if export_json and all_data:
        json_path = out_date / f"{label}.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(all_data, f, ensure_ascii=False, indent=2)
    return {'sheets': len(all_data), 'errors': errors}


def run_backup(backup_root: str = None, export_json: bool = True) -> bool:
    """
    Export admin and community spreadsheets to backup_root/sheets/YYYY-MM-DD/.
    backup_root defaults to env BACKUP_OUTPUT_DIR or ./backups.
    Returns True if at least one spreadsheet was exported successfully.
    """
    backup_root = backup_root or os.environ.get('BACKUP_OUTPUT_DIR') or os.path.join(_backend_dir, 'backups')
    out_dir = Path(backup_root) / 'sheets'
    date_str = datetime.utcnow().strftime('%Y-%m-%d')
    try:
        from services import manager_service
        admin_svc = manager_service.get_sheets_service()
        community_svc = manager_service.get_community_sheets_service()
    except Exception as e:
        print(f"Backup: could not load services: {e}")
        return False
    ok = False
    r1 = _export_spreadsheet(admin_svc, 'admin', date_str, out_dir, export_json=export_json)
    if r1['sheets'] > 0:
        ok = True
        print(f"Backup: admin -> {r1['sheets']} sheet(s) in {out_dir / date_str}")
    for err in r1['errors']:
        print(f"  Warning: {err}")
    r2 = _export_spreadsheet(community_svc, 'community', date_str, out_dir, export_json=export_json)
    if r2['sheets'] > 0:
        ok = True
        print(f"Backup: community -> {r2['sheets']} sheet(s) in {out_dir / date_str}")
    for err in r2['errors']:
        print(f"  Warning: {err}")
    if not ok:
        print("Backup: no spreadsheets exported (check credentials and env).")
    return ok


if __name__ == '__main__':
    run_backup()
