"""
Unit tests for ingest missing turtle report.

Tests that _generate_missing_turtle_report correctly identifies turtles
in Google Sheets that are missing from the flash drive, excluding dead turtles,
and writes CSV reports.
"""

import csv
import json
import os
from unittest.mock import MagicMock, patch, PropertyMock

import pytest


def _make_mock_brain():
    mock = MagicMock()
    mock.vram_cache_plastron = []
    mock.vram_cache_carapace = []
    mock.process_and_save = MagicMock(return_value=True)
    mock.add_single_to_vram = MagicMock(return_value=True)
    mock.load_database_to_vram = MagicMock()
    mock.extract_query_features = MagicMock(return_value=["fake_feats"])
    mock.match_against_cache = MagicMock(return_value=[])
    return mock


@pytest.fixture()
def mock_brain():
    return _make_mock_brain()


# Import and patch turtle_manager once at module level to avoid numpy reload crashes
_tm_module = None
_original_brain = None

def _get_turtle_manager():
    global _tm_module, _original_brain
    if _tm_module is None:
        import turtle_manager
        _tm_module = turtle_manager
        _original_brain = turtle_manager.brain
    return _tm_module


@pytest.fixture()
def manager(tmp_path, mock_brain):
    tm = _get_turtle_manager()
    tm.brain = mock_brain
    try:
        mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        mgr._mock_brain = mock_brain
        yield mgr
    finally:
        tm.brain = _original_brain


def _make_mock_sheets_service(sheet_data):
    """Create a mock Google Sheets service that returns given data.

    sheet_data: dict of { sheet_name: { 'headers': [...], 'rows': [[...], ...] } }
    """
    mock_service = MagicMock()

    def fake_get(spreadsheetId, range):
        # Parse sheet name from range like "'Kansas'!A:Z" or "Kansas!A:Z"
        sheet_name = range.split('!')[0].strip("'")
        if sheet_name in sheet_data:
            data = sheet_data[sheet_name]
            values = [data['headers']] + data['rows']
            result = MagicMock()
            result.execute.return_value = {'values': values}
            return result
        result = MagicMock()
        result.execute.return_value = {'values': []}
        return result

    mock_service.service.spreadsheets.return_value.values.return_value.get = fake_get
    mock_service.spreadsheet_id = 'test_id'
    return mock_service


class TestMissingTurtleReport:
    """Tests for _generate_missing_turtle_report."""

    def test_identifies_missing_turtles(self, manager, tmp_path):
        """Turtles in sheets but not on drive are reported as missing."""
        sheets_data = {
            'Kansas': {
                'headers': ['Primary ID', 'ID', 'Name', 'Health Status', 'General Location'],
                'rows': [
                    ['T001', 'F001', 'Alice', 'Healthy', 'Lawrence'],
                    ['T002', 'F002', 'Bob', 'Healthy', 'Topeka'],
                    ['T003', 'M001', 'Charlie', 'Healthy', 'Lawrence'],
                ],
            }
        }
        mock_service = _make_mock_sheets_service(sheets_data)

        # Drive only has F001 — F002 and M001 are missing
        drive_ids = {'Kansas': {'F001'}}

        with patch('services.manager_service.get_sheets_service', return_value=mock_service):
            from turtle_manager import TurtleManager
            manager._generate_missing_turtle_report(drive_ids)

        # Check CSV was written
        benchmarks = os.path.join(str(tmp_path), 'benchmarks')
        csv_files = [f for f in os.listdir(benchmarks) if f.endswith('_missing_turtles.csv')]
        assert len(csv_files) == 1

        with open(os.path.join(benchmarks, csv_files[0]), 'r') as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 2
        missing_ids = {r['biology_id'] for r in rows}
        assert missing_ids == {'F002', 'M001'}

    def test_excludes_dead_turtles(self, manager, tmp_path):
        """Turtles with dead health status are excluded from missing report."""
        sheets_data = {
            'Kansas': {
                'headers': ['Primary ID', 'ID', 'Name', 'Health Status', 'General Location'],
                'rows': [
                    ['T001', 'F001', 'Alice', 'Healthy', 'Lawrence'],
                    ['T002', 'F002', 'Bob', 'Dead', 'Topeka'],
                    ['T003', 'M001', 'Charlie', 'Deceased', 'Lawrence'],
                    ['T004', 'M002', 'Dave', 'Healthy', 'Lawrence'],
                ],
            }
        }
        mock_service = _make_mock_sheets_service(sheets_data)

        # Drive has F001 — F002 (dead) and M001 (deceased) should be excluded
        drive_ids = {'Kansas': {'F001'}}

        with patch('services.manager_service.get_sheets_service', return_value=mock_service):
            manager._generate_missing_turtle_report(drive_ids)

        benchmarks = os.path.join(str(tmp_path), 'benchmarks')
        csv_files = [f for f in os.listdir(benchmarks) if f.endswith('_missing_turtles.csv')]
        assert len(csv_files) == 1

        with open(os.path.join(benchmarks, csv_files[0]), 'r') as f:
            rows = list(csv.DictReader(f))
        # Only M002 should be missing (alive, not on drive)
        assert len(rows) == 1
        assert rows[0]['biology_id'] == 'M002'

    def test_no_csv_when_all_present(self, manager, tmp_path):
        """No CSV is written when all living turtles are on the drive."""
        sheets_data = {
            'Kansas': {
                'headers': ['Primary ID', 'ID', 'Name', 'Health Status', 'General Location'],
                'rows': [
                    ['T001', 'F001', 'Alice', 'Healthy', 'Lawrence'],
                    ['T002', 'F002', 'Bob', 'Dead', 'Topeka'],
                ],
            }
        }
        mock_service = _make_mock_sheets_service(sheets_data)

        drive_ids = {'Kansas': {'F001'}}

        with patch('services.manager_service.get_sheets_service', return_value=mock_service):
            manager._generate_missing_turtle_report(drive_ids)

        benchmarks = os.path.join(str(tmp_path), 'benchmarks')
        csv_files = [f for f in os.listdir(benchmarks) if f.endswith('_missing_turtles.csv')]
        assert len(csv_files) == 0

    def test_carapace_missing_report(self, manager, tmp_path):
        """Turtles missing from drive AND missing carapace are in the carapace CSV."""
        sheets_data = {
            'Kansas': {
                'headers': ['Primary ID', 'ID', 'Name', 'Health Status', 'General Location'],
                'rows': [
                    ['T001', 'F001', 'Alice', 'Healthy', 'Lawrence'],
                    ['T002', 'F002', 'Bob', 'Healthy', 'Topeka'],
                ],
            }
        }
        mock_service = _make_mock_sheets_service(sheets_data)

        # F002 is missing from drive and has no carapace on disk
        drive_ids = {'Kansas': {'F001'}}

        with patch('services.manager_service.get_sheets_service', return_value=mock_service):
            manager._generate_missing_turtle_report(drive_ids)

        benchmarks = os.path.join(str(tmp_path), 'benchmarks')
        carapace_csvs = [f for f in os.listdir(benchmarks) if f.endswith('_missing_carapace.csv')]
        assert len(carapace_csvs) == 1

        with open(os.path.join(benchmarks, carapace_csvs[0]), 'r') as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 1
        assert rows[0]['biology_id'] == 'F002'

    def test_turtle_with_carapace_excluded_from_carapace_report(self, manager, tmp_path):
        """Turtles that have a carapace .pt on disk are excluded from carapace missing report."""
        sheets_data = {
            'Kansas': {
                'headers': ['Primary ID', 'ID', 'Name', 'Health Status', 'General Location'],
                'rows': [
                    ['T002', 'F002', 'Bob', 'Healthy', 'Topeka'],
                ],
            }
        }
        mock_service = _make_mock_sheets_service(sheets_data)

        # F002 is missing from drive but HAS a carapace on disk
        turtle_dir = tmp_path / "Kansas" / "Topeka" / "F002" / "carapace"
        turtle_dir.mkdir(parents=True)
        (turtle_dir / "F002.pt").write_bytes(b"fake")

        drive_ids = {'Kansas': set()}  # nothing on drive

        with patch('services.manager_service.get_sheets_service', return_value=mock_service):
            manager._generate_missing_turtle_report(drive_ids)

        benchmarks = os.path.join(str(tmp_path), 'benchmarks')
        # Missing turtles CSV should exist (F002 not on drive)
        missing_csvs = [f for f in os.listdir(benchmarks) if f.endswith('_missing_turtles.csv')]
        assert len(missing_csvs) == 1

        # But carapace missing CSV should NOT exist (F002 has carapace)
        carapace_csvs = [f for f in os.listdir(benchmarks) if f.endswith('_missing_carapace.csv')]
        assert len(carapace_csvs) == 0

    def test_no_sheets_service_gracefully_skips(self, manager, tmp_path):
        """If Google Sheets is not configured, report is skipped without error."""
        drive_ids = {'Kansas': {'F001'}}

        with patch('services.manager_service.get_sheets_service', return_value=None):
            # Should not raise
            manager._generate_missing_turtle_report(drive_ids)

        benchmarks = os.path.join(str(tmp_path), 'benchmarks')
        assert not os.path.exists(benchmarks) or len(os.listdir(benchmarks)) == 0
