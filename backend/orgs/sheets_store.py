"""
Google Sheets, backed by the research-group database.

Research groups run the exact same code as the main group (sheets/crud.py, sheet_management,
bulk_ops, migration, lookup, ...). Instead of a Google API client, their GoogleSheetsService gets a
``DbSheetsApi``: an emulation of precisely the Google Sheets v4 surface the app uses —

  spreadsheets().get(spreadsheetId)
  spreadsheets().values().get(spreadsheetId, range)
  spreadsheets().values().update(spreadsheetId, range, valueInputOption, body)
  spreadsheets().values().batchUpdate(spreadsheetId, body)
  spreadsheets().batchUpdate(spreadsheetId, body)  with addSheet, deleteSheet, insertDimension,
      deleteDimension, setDataValidation, repeatCell

— with Google's response semantics (trailing empty cells/rows trimmed, 'values' omitted for empty
ranges, HttpError with resp.status on errors). The same columns, tabs and IDs as in the main
group's spreadsheets therefore apply to every research group.
"""

import re
import threading

import httplib2
from googleapiclient.errors import HttpError
from sqlalchemy import func

from orgs.db import Session
from orgs.models import SheetRow, SheetTab

_book_locks = {}
_book_locks_guard = threading.Lock()


def _book_lock(org_id, book):
    key = (org_id, book)
    with _book_locks_guard:
        lock = _book_locks.get(key)
        if lock is None:
            lock = _book_locks[key] = threading.RLock()
        return lock


def _http_error(status, message):
    resp = httplib2.Response({'status': status})
    resp.reason = message
    return HttpError(resp, message.encode('utf-8'))


# ---------------- A1 notation ----------------

_CELL_RE = re.compile(r'^([A-Za-z]*)(\d*)$')


def _col_to_index(letters):
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _index_to_col(idx):
    s = ''
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def _split_sheet(a1):
    """'Kansas'!A1:B2 -> ("Kansas", "A1:B2"); a bare name -> (name, None)."""
    a1 = a1.strip()
    if a1.startswith("'"):
        i, out = 1, []
        while i < len(a1):
            ch = a1[i]
            if ch == "'":
                if i + 1 < len(a1) and a1[i + 1] == "'":
                    out.append("'")
                    i += 2
                    continue
                rest = a1[i + 1:]
                return ''.join(out), (rest[1:] if rest.startswith('!') else None) or None
            out.append(ch)
            i += 1
        raise _http_error(400, f'Unable to parse range: {a1}')
    if '!' in a1:
        name, rest = a1.split('!', 1)
        return name, rest or None
    return a1, None


def parse_range(a1):
    """
    -> (sheet_title, r1, c1, r2, c2), 0-based and inclusive; r2/c2 None = open-ended.
    Supports A1, A1:C9, A:ZZ, 1:1, A2:X and a bare sheet name (whole sheet).
    """
    title, ref = _split_sheet(a1)
    if ref is None:
        return title, 0, 0, None, None
    parts = ref.split(':')
    if len(parts) > 2:
        raise _http_error(400, f'Unable to parse range: {a1}')
    m1 = _CELL_RE.match(parts[0].strip())
    if not m1 or not (m1.group(1) or m1.group(2)):
        raise _http_error(400, f'Unable to parse range: {a1}')
    c1 = _col_to_index(m1.group(1)) if m1.group(1) else 0
    r1 = int(m1.group(2)) - 1 if m1.group(2) else 0
    if len(parts) == 1:
        # single cell (A1) — or a lone column/row reference
        c2 = c1 if m1.group(1) else None
        r2 = r1 if m1.group(2) else None
        return title, r1, c1, r2, c2
    m2 = _CELL_RE.match(parts[1].strip())
    if not m2 or not (m2.group(1) or m2.group(2)):
        raise _http_error(400, f'Unable to parse range: {a1}')
    c2 = _col_to_index(m2.group(1)) if m2.group(1) else None
    r2 = int(m2.group(2)) - 1 if m2.group(2) else None
    return title, r1, c1, r2, c2


def _cell_str(v):
    """RAW input as Google stores/returns it (formatted value strings)."""
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'TRUE' if v else 'FALSE'
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _trim(cells):
    cells = list(cells)
    while cells and cells[-1] == '':
        cells.pop()
    return cells


# ---------------- request objects ----------------

class _Call:
    def __init__(self, fn):
        self._fn = fn

    def execute(self, **_kwargs):
        return self._fn()


class _Values:
    def __init__(self, api):
        self._api = api

    def get(self, spreadsheetId=None, range=None, **_kwargs):  # noqa: A002 - Google's name
        return _Call(lambda: self._api._get_values(range))

    def update(self, spreadsheetId=None, range=None, body=None, valueInputOption=None, **_kwargs):  # noqa: A002
        return _Call(lambda: self._api._update_values(range, (body or {}).get('values') or []))

    def batchUpdate(self, spreadsheetId=None, body=None, **_kwargs):
        return _Call(lambda: self._api._batch_update_values((body or {}).get('data') or []))


class DbSheetsApi:
    """Drop-in for ``build('sheets', 'v4', ...)`` for one research group's book."""

    def __init__(self, org_id, book):
        self.org_id = int(org_id)
        self.book = book
        self._lock = _book_lock(self.org_id, book)

    # googleapiclient shape: service.spreadsheets().values().get(...)
    def spreadsheets(self):
        return self

    def values(self):
        return _Values(self)

    def get(self, spreadsheetId=None, **_kwargs):
        return _Call(self._metadata)

    def batchUpdate(self, spreadsheetId=None, body=None, **_kwargs):
        return _Call(lambda: self._batch_update((body or {}).get('requests') or []))

    # ---- helpers ----

    def _tabs(self):
        return (
            Session.query(SheetTab)
            .filter(SheetTab.org_id == self.org_id, SheetTab.book == self.book)
            .order_by(SheetTab.position, SheetTab.sheet_id)
            .all()
        )

    def _tab_by_title(self, title):
        tab = (
            Session.query(SheetTab)
            .filter(SheetTab.org_id == self.org_id, SheetTab.book == self.book, SheetTab.title == title)
            .first()
        )
        if tab is None:
            raise _http_error(400, f'Unable to parse range: {title}')
        return tab

    def _tab_by_sheet_id(self, sheet_id):
        tab = (
            Session.query(SheetTab)
            .filter(SheetTab.org_id == self.org_id, SheetTab.book == self.book, SheetTab.sheet_id == int(sheet_id))
            .first()
        )
        if tab is None:
            raise _http_error(400, f'No grid with id: {sheet_id}')
        return tab

    def _rows_query(self, sheet_id):
        return Session.query(SheetRow).filter(
            SheetRow.org_id == self.org_id, SheetRow.book == self.book, SheetRow.sheet_id == sheet_id
        )

    def _run(self, fn, write=False):
        with self._lock:
            try:
                result = fn()
                if write:
                    Session.commit()
                return result
            except Exception:
                Session.rollback()
                raise
            finally:
                if not write:
                    Session.rollback()  # end the read transaction; keep connections short-lived

    # ---- spreadsheets().get ----

    def _metadata(self):
        def run():
            return {
                'spreadsheetId': f'pictur-org-{self.org_id}-{self.book}',
                'properties': {'title': f'PicTur research group {self.org_id} ({self.book})'},
                'sheets': [
                    {'properties': {'sheetId': t.sheet_id, 'title': t.title, 'index': i,
                                    'sheetType': 'GRID'}}
                    for i, t in enumerate(self._tabs())
                ],
            }

        return self._run(run)

    # ---- values().get ----

    def _get_values(self, a1):
        def run():
            title, r1, c1, r2, c2 = parse_range(a1)
            tab = self._tab_by_title(title)
            q = self._rows_query(tab.sheet_id).filter(SheetRow.row_index >= r1)
            if r2 is not None:
                q = q.filter(SheetRow.row_index <= r2)
            rows = {r.row_index: r.cells or [] for r in q.all()}
            values = []
            if rows:
                last = max(rows)
                for idx in range(r1, last + 1):
                    cells = rows.get(idx, [])
                    part = cells[c1:] if c2 is None else cells[c1:c2 + 1]
                    values.append(_trim(part))
            while values and not values[-1]:
                values.pop()
            out = {'range': a1, 'majorDimension': 'ROWS'}
            if values:
                out['values'] = values
            return out

        return self._run(run)

    # ---- values().update / batchUpdate ----

    def _write(self, a1, values):
        title, r1, c1, _r2, _c2 = parse_range(a1)
        tab = self._tab_by_title(title)
        updated = 0
        for offset, row_values in enumerate(values):
            idx = r1 + offset
            row = self._rows_query(tab.sheet_id).filter(SheetRow.row_index == idx).first()
            cells = list(row.cells or []) if row else []
            needed = c1 + len(row_values)
            if len(cells) < needed:
                cells.extend([''] * (needed - len(cells)))
            for j, v in enumerate(row_values):
                cells[c1 + j] = _cell_str(v)
            updated += len(row_values)
            cells = _trim(cells)
            if row is None:
                Session.add(SheetRow(org_id=self.org_id, book=self.book, sheet_id=tab.sheet_id,
                                     row_index=idx, cells=cells))
            else:
                row.cells = cells
        return {'updatedRange': a1, 'updatedRows': len(values), 'updatedCells': updated}

    def _update_values(self, a1, values):
        return self._run(lambda: self._write(a1, values), write=True)

    def _batch_update_values(self, data):
        def run():
            responses = [self._write(entry['range'], entry.get('values') or []) for entry in data]
            return {'totalUpdatedCells': sum(r['updatedCells'] for r in responses), 'responses': responses}

        return self._run(run, write=True)

    # ---- spreadsheets().batchUpdate ----

    def _batch_update(self, requests):
        def run():
            replies = []
            for req in requests:
                if 'addSheet' in req:
                    replies.append(self._add_sheet(req['addSheet']))
                elif 'deleteSheet' in req:
                    self._delete_sheet(req['deleteSheet'])
                    replies.append({})
                elif 'insertDimension' in req:
                    self._insert_dimension(req['insertDimension'])
                    replies.append({})
                elif 'deleteDimension' in req:
                    self._delete_dimension(req['deleteDimension'])
                    replies.append({})
                elif 'setDataValidation' in req or 'repeatCell' in req:
                    # Dropdown rules and row colours only matter in the Google UI; the app enforces
                    # General Location values itself (catalog) and shows "deceased" from the data.
                    replies.append({})
                else:
                    raise _http_error(400, f'Unsupported request: {", ".join(req)}')
            return {'spreadsheetId': f'pictur-org-{self.org_id}-{self.book}', 'replies': replies}

        return self._run(run, write=True)

    def _add_sheet(self, spec):
        props = spec.get('properties') or {}
        title = (props.get('title') or '').strip()
        if not title:
            raise _http_error(400, 'Sheet title must not be empty')
        exists = (
            Session.query(SheetTab.id)
            .filter(SheetTab.org_id == self.org_id, SheetTab.book == self.book,
                    func.lower(SheetTab.title) == title.lower())
            .first()
        )
        if exists:
            raise _http_error(400, f'A sheet with the name "{title}" already exists.')
        max_id, max_pos = (
            Session.query(func.max(SheetTab.sheet_id), func.max(SheetTab.position))
            .filter(SheetTab.org_id == self.org_id, SheetTab.book == self.book)
            .one()
        )
        tab = SheetTab(org_id=self.org_id, book=self.book, sheet_id=(max_id or 0) + 1,
                       title=title, position=(max_pos if max_pos is not None else -1) + 1)
        Session.add(tab)
        Session.flush()
        return {'addSheet': {'properties': {'sheetId': tab.sheet_id, 'title': tab.title,
                                            'index': tab.position, 'sheetType': 'GRID'}}}

    def _delete_sheet(self, spec):
        tab = self._tab_by_sheet_id(spec.get('sheetId'))
        self._rows_query(tab.sheet_id).delete(synchronize_session=False)
        Session.delete(tab)
        Session.flush()

    def _insert_dimension(self, spec):
        rng = spec.get('range') or {}
        tab = self._tab_by_sheet_id(rng.get('sheetId'))
        start, end = int(rng.get('startIndex', 0)), int(rng.get('endIndex', 0))
        count = max(0, end - start)
        if not count:
            return
        if rng.get('dimension') == 'COLUMNS':
            for row in self._rows_query(tab.sheet_id).all():
                cells = list(row.cells or [])
                if len(cells) > start:
                    row.cells = _trim(cells[:start] + [''] * count + cells[start:])
        else:  # ROWS: shift rows at/after start down (highest first to keep the key unique)
            for row in self._rows_query(tab.sheet_id).filter(SheetRow.row_index >= start) \
                    .order_by(SheetRow.row_index.desc()).all():
                self._move_row(row, row.row_index + count)

    def _delete_dimension(self, spec):
        rng = spec.get('range') or {}
        tab = self._tab_by_sheet_id(rng.get('sheetId'))
        start, end = int(rng.get('startIndex', 0)), int(rng.get('endIndex', 0))
        count = max(0, end - start)
        if not count:
            return
        if rng.get('dimension') == 'COLUMNS':
            for row in self._rows_query(tab.sheet_id).all():
                cells = list(row.cells or [])
                row.cells = _trim(cells[:start] + cells[end:])
            return
        self._rows_query(tab.sheet_id).filter(
            SheetRow.row_index >= start, SheetRow.row_index < end
        ).delete(synchronize_session=False)
        Session.flush()
        for row in self._rows_query(tab.sheet_id).filter(SheetRow.row_index >= end) \
                .order_by(SheetRow.row_index.asc()).all():
            self._move_row(row, row.row_index - count)

    def _move_row(self, row, new_index):
        cells = list(row.cells or [])
        Session.delete(row)
        Session.flush()
        Session.add(SheetRow(org_id=self.org_id, book=self.book, sheet_id=row.sheet_id,
                             row_index=new_index, cells=cells))
        Session.flush()


def make_sheets_service(org_id, book):
    """GoogleSheetsService for a research group's book, backed by DbSheetsApi."""
    from services.google_sheets_service import GoogleSheetsService

    class DbSheetsService(GoogleSheetsService):
        """GoogleSheetsService without Google: identical behaviour, data in the group database."""

        def __init__(self):  # noqa: D401 - deliberately skips Google credentials
            self.spreadsheet_id = f'pictur-org-{int(org_id)}-{book}'
            self._api_lock = threading.RLock()
            self._list_sheets_cache = None
            self._list_sheets_cache_time = 0.0
            self._column_indices_cache = {}
            self.COLUMN_INDICES_CACHE_TTL_SEC = 15
            self.service = DbSheetsApi(org_id, book)
            # Dropdown validation is a Google UI feature; the emulation ignores it anyway.
            self.apply_general_location_sheet_validation = False
            self.org_id = int(org_id)
            self.book = book

        def _reinitialize_service(self):
            self._invalidate_list_sheets_cache()

    return DbSheetsService()
