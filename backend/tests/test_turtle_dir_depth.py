"""Tests for the turtle-folder depth guardrail.

The app must never create a NEW turtle folder below ``State/Location/<turtle>``
(no 4-level ``State/Location/Sub-site/<turtle>`` nesting). Existing deeper folders
are tolerated and reached via the recursive-walk lookups, so the clamp only applies
at creation time. See ``_clamp_turtle_dir_depth`` in ``turtle_manager``.
"""

import os

from turtle_manager import _clamp_turtle_dir_depth, _turtle_dir_depth


def _rel(base, p):
    return os.path.relpath(p, os.path.realpath(base)).replace(os.sep, "/")


def test_clamp_collapses_four_level_to_state_location(tmp_path):
    base = str(tmp_path)
    deep = os.path.join(base, "NebraskaCPBS", "CPBS", "East Geo 2", "M254_T177517700352688319")
    out = _clamp_turtle_dir_depth(base, deep)
    assert _rel(base, out) == "NebraskaCPBS/CPBS/M254_T177517700352688319"


def test_clamp_collapses_five_level_to_state_location(tmp_path):
    base = str(tmp_path)
    deep = os.path.join(base, "State", "Loc", "Site", "SubSite", "F1_T1234567890")
    out = _clamp_turtle_dir_depth(base, deep)
    assert _rel(base, out) == "State/Loc/F1_T1234567890"


def test_three_level_is_unchanged(tmp_path):
    base = str(tmp_path)
    ok = os.path.join(base, "Kansas", "Lawrence", "F1_T1234567890")
    assert _clamp_turtle_dir_depth(base, ok) == ok


def test_two_level_combo_is_unchanged(tmp_path):
    base = str(tmp_path)
    ok = os.path.join(base, "IowaHawkeye", "F1_T1234567890")
    assert _clamp_turtle_dir_depth(base, ok) == ok


def test_empty_input_is_returned_as_is(tmp_path):
    assert _clamp_turtle_dir_depth(str(tmp_path), "") == ""
    assert _clamp_turtle_dir_depth(str(tmp_path), None) is None


def test_depth_helper_counts_segments(tmp_path):
    base = str(tmp_path)
    assert _turtle_dir_depth(base, os.path.join(base, "A", "B", "C")) == 3
    assert _turtle_dir_depth(base, os.path.join(base, "A", "B", "C", "D")) == 4
    assert _turtle_dir_depth(base, base) == 0
