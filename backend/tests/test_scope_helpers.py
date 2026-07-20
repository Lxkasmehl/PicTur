"""
Unit tests for the pure scope primitives in ``scope.py`` (PR-2).

No Flask app / auth service needed — every function is a pure transform of a
context dict plus data. Covers ``area_covers`` edge cases, the write vs list
gates, ``filter_locations``, every ``effective_match_filter`` branch, fail-closed
behavior on None/empty locations, and the packet-scope resolver.
"""

import pytest

import scope
from tests.scope_test_utils import (
    global_admin_ctx,
    global_staff_ctx,
    scoped_ctx,
    community_ctx,
)


# ------------------------------------------------------------------- is_global

def test_is_global_none_is_global():
    assert scope.is_global(None) is True


def test_is_global_admin_and_global_group():
    assert scope.is_global(global_admin_ctx()) is True
    assert scope.is_global(global_staff_ctx()) is True


def test_is_global_scoped_is_not_global():
    assert scope.is_global(scoped_ctx(areas=['Kansas'])) is False
    assert scope.is_global(scoped_ctx(areas=[])) is False


# ------------------------------------------------------------------ area_covers

@pytest.mark.parametrize("area,loc,expected", [
    ("Kansas", "Kansas", True),
    ("Kansas", "Kansas/Topeka", True),
    ("Kansas", "Kansas/Topeka/East Geo", True),
    ("Kansas", "KansasCPBS", False),           # prefix-not-at-boundary must NOT match
    ("Kansas/Topeka", "Kansas", False),         # parent is not covered by child
    ("Kansas/Topeka", "Kansas/Topeka", True),
    ("Kansas/Topeka", "Kansas/TopekaWest", False),
    ("", "Kansas", False),
    ("Kansas", "", False),
])
def test_area_covers(area, loc, expected):
    assert scope.area_covers(area, loc) is expected


def test_top_level_of():
    assert scope.top_level_of("Kansas/Topeka/East") == "Kansas"
    assert scope.top_level_of("NebraskaCPBS") == "NebraskaCPBS"
    assert scope.top_level_of("") == ""
    assert scope.top_level_of(None) == ""


# --------------------------------------------------------- scope_allows_location

def test_scope_allows_location_global_always_true():
    assert scope.scope_allows_location(global_admin_ctx(), None) is True
    assert scope.scope_allows_location(None, "") is True


def test_scope_allows_location_fail_closed_on_empty():
    ctx = scoped_ctx(areas=['Kansas'])
    assert scope.scope_allows_location(ctx, None) is False
    assert scope.scope_allows_location(ctx, "") is False
    assert scope.scope_allows_location(ctx, "   ") is False


def test_scope_allows_location_matches_area():
    ctx = scoped_ctx(areas=['Kansas/Topeka'])
    assert scope.scope_allows_location(ctx, "Kansas/Topeka") is True
    assert scope.scope_allows_location(ctx, "Kansas/Topeka/East Geo") is True
    assert scope.scope_allows_location(ctx, "Kansas") is False        # parent sheet, not writable
    assert scope.scope_allows_location(ctx, "Kansas/Lawrence") is False


def test_scope_allows_location_zero_areas_writes_nothing():
    ctx = scoped_ctx(areas=[])
    assert scope.scope_allows_location(ctx, "Kansas/Topeka") is False


# ------------------------------------------------------------ scope_allows_sheet

def test_scope_allows_sheet_owning_subarea_sees_sheet():
    ctx = scoped_ctx(areas=['Kansas/Lawrence'])
    assert scope.scope_allows_sheet(ctx, "Kansas") is True          # can SEE the tab
    assert scope.scope_allows_sheet(ctx, "Nebraska") is False
    assert scope.scope_allows_sheet(ctx, "") is False


def test_scope_allows_sheet_owning_whole_sheet():
    ctx = scoped_ctx(areas=['Kansas'])
    assert scope.scope_allows_sheet(ctx, "Kansas") is True
    assert scope.scope_allows_sheet(ctx, "KansasCPBS") is False


# ------------------------------------------------------------- filter_locations

def test_filter_locations_global_unchanged():
    locs = ["Community_Uploads", "Kansas", "Kansas/Lawrence", "Nebraska"]
    assert scope.filter_locations(global_admin_ctx(), locs) == locs


def test_filter_locations_scoped_subarea():
    locs = ["Community_Uploads", "Kansas", "Kansas/Lawrence", "Kansas/Topeka", "Nebraska"]
    ctx = scoped_ctx(areas=['Kansas/Topeka'])
    out = scope.filter_locations(ctx, locs)
    assert "Community_Uploads" in out         # shared pool always kept
    assert "Kansas" in out                     # sheet visible (owns Topeka under it)
    assert "Kansas/Topeka" in out              # owned area
    assert "Kansas/Lawrence" not in out        # sibling sub-site hidden
    assert "Nebraska" not in out


def test_filter_locations_scoped_whole_state_keeps_all_subsites():
    locs = ["Community_Uploads", "Kansas", "Kansas/Lawrence", "Kansas/Topeka"]
    ctx = scoped_ctx(areas=['Kansas'])
    out = scope.filter_locations(ctx, locs)
    assert set(out) == {"Community_Uploads", "Kansas", "Kansas/Lawrence", "Kansas/Topeka"}


def test_filter_locations_zero_areas_keeps_only_community():
    locs = ["Community_Uploads", "Kansas", "Kansas/Topeka"]
    assert scope.filter_locations(scoped_ctx(areas=[]), locs) == ["Community_Uploads"]


# -------------------------------------------------------- effective_match_filter

def test_effective_match_filter_global_passthrough():
    ctx = global_admin_ctx()
    assert scope.effective_match_filter(ctx, "Kansas") == ("Kansas", False)
    assert scope.effective_match_filter(ctx, None) == (None, False)
    assert scope.effective_match_filter(ctx, "__all__") == ("__all__", False)


@pytest.mark.parametrize("requested", [None, "", "All Locations", "__all__"])
def test_effective_match_filter_scoped_all_forces_areas(requested):
    ctx = scoped_ctx(areas=['Kansas/Topeka', 'Kansas/Lawrence'])
    flt, forced = scope.effective_match_filter(ctx, requested)
    assert forced is True
    assert set(flt) == {'Kansas/Topeka', 'Kansas/Lawrence'}


def test_effective_match_filter_scoped_community_uploads():
    ctx = scoped_ctx(areas=['Kansas/Topeka'])
    assert scope.effective_match_filter(ctx, "Community_Uploads") == ("Community_Uploads", False)


def test_effective_match_filter_scoped_sheet_narrows_to_owned_subareas():
    ctx = scoped_ctx(areas=['Kansas/Topeka'])
    flt, forced = scope.effective_match_filter(ctx, "Kansas")
    assert forced is False
    assert flt == ['Kansas/Topeka']


def test_effective_match_filter_scoped_exact_area():
    ctx = scoped_ctx(areas=['Kansas/Topeka'])
    flt, forced = scope.effective_match_filter(ctx, "Kansas/Topeka")
    assert forced is False
    assert flt == ['Kansas/Topeka']


def test_effective_match_filter_scoped_out_of_scope_forces_areas():
    ctx = scoped_ctx(areas=['Kansas/Topeka'])
    flt, forced = scope.effective_match_filter(ctx, "Nebraska")
    assert forced is True
    assert flt == ['Kansas/Topeka']


# ------------------------------------------------------------- annotate_in_scope

def test_annotate_in_scope_global_all_true():
    matches = [{'location': 'Kansas/Topeka'}, {'location': 'Nebraska'}]
    expanded = scope.annotate_in_scope(global_admin_ctx(), matches)
    assert expanded is False
    assert all(m['in_scope'] for m in matches)


def test_annotate_in_scope_scoped_flags_out_of_area():
    matches = [{'location': 'Kansas/Topeka'}, {'location': 'Nebraska'}, {'location': None}]
    ctx = scoped_ctx(areas=['Kansas/Topeka'])
    expanded = scope.annotate_in_scope(ctx, matches)
    assert expanded is True
    assert matches[0]['in_scope'] is True
    assert matches[1]['in_scope'] is False
    assert matches[2]['in_scope'] is False   # unresolved location fails closed


# ------------------------------------------------------------- packet_scope

def test_packet_scope_locations_precedence():
    assert scope.packet_scope_locations({'match_sheet': 'Kansas'}) == ['Kansas']
    assert scope.packet_scope_locations({'scope_filter': ['Kansas/Topeka', '']}) == ['Kansas/Topeka']
    assert scope.packet_scope_locations({'state': 'Kansas', 'location': 'Topeka'}) == ['Kansas/Topeka']
    assert scope.packet_scope_locations({'state': 'Kansas'}) == ['Kansas']
    assert scope.packet_scope_locations({}) == []
    assert scope.packet_scope_locations({'photo_type': 'plastron'}) == []


def test_packet_scope_allows_global_and_no_location():
    assert scope.packet_scope_allows(global_admin_ctx(), {}) is True
    # no location info => a scoped user cannot see/act (fail closed)
    assert scope.packet_scope_allows(scoped_ctx(areas=['Kansas/Topeka']), {}) is False


def test_packet_scope_allows_scoped_matches_sheet_or_location():
    ctx = scoped_ctx(areas=['Kansas/Topeka'])
    # admin packet whose match_sheet is the whole Kansas tab: visible (owns a sub-area)
    assert scope.packet_scope_allows(ctx, {'match_sheet': 'Kansas'}) is True
    # community packet in another state: hidden
    assert scope.packet_scope_allows(ctx, {'state': 'Nebraska', 'location': 'CPBS'}) is False
    # persisted scoped-upload filter that overlaps: visible
    assert scope.packet_scope_allows(ctx, {'scope_filter': ['Kansas/Topeka']}) is True


# ---------------------------------------------------- resolve_turtle_location

class _FakeManager:
    def __init__(self, base_dir, mapping):
        self.base_dir = base_dir
        self._mapping = mapping  # (turtle_id, hint) -> dir | id -> dir

    def _get_turtle_folder(self, turtle_id, location_hint=None):
        return self._mapping.get(turtle_id)


def test_resolve_turtle_location_from_folder(tmp_path):
    tdir = tmp_path / "Kansas" / "Topeka" / "F102_T1770000001"
    tdir.mkdir(parents=True)
    mgr = _FakeManager(str(tmp_path), {"T1770000001": str(tdir), "F102": str(tdir)})
    assert scope.resolve_turtle_location(mgr, "F102", "Kansas") == "Kansas/Topeka"
    # primary-first still resolves the same folder
    assert scope.resolve_turtle_location(mgr, "F102", "Kansas", primary_id="T1770000001") == "Kansas/Topeka"


def test_resolve_turtle_location_unresolvable_returns_none(tmp_path):
    mgr = _FakeManager(str(tmp_path), {})
    assert scope.resolve_turtle_location(mgr, "F999", "Kansas") is None
    assert scope.resolve_turtle_location(None, "F999", "Kansas") is None


def test_resolve_turtle_location_combo_sheet(tmp_path):
    tdir = tmp_path / "NebraskaCPBS" / "F050_T1770000009"
    tdir.mkdir(parents=True)
    mgr = _FakeManager(str(tmp_path), {"F050": str(tdir)})
    assert scope.resolve_turtle_location(mgr, "F050", "NebraskaCPBS") == "NebraskaCPBS"


# -------------------------------------------- auth._build_scope_ctx (is_global)

def _body(role, group=Ellipsis, areas=None):
    user = {'id': 1, 'email': 'u@test.com', 'role': role, 'group_role': 'member'}
    if group is not Ellipsis:          # Ellipsis => omit the group key entirely
        user['group'] = group
    if areas is not None:
        user['areas'] = areas
    return {'valid': True, 'user': user}


def test_build_ctx_global_group_is_global():
    import auth
    ctx = auth._build_scope_ctx(_body('staff', group={'id': 2, 'name': 'Primary',
                                                       'scope': 'global', 'system_key': 'primary'}))
    assert ctx['is_global'] is True
    assert ctx['areas'] == []


def test_build_ctx_scoped_group_staff_not_global():
    import auth
    ctx = auth._build_scope_ctx(_body('staff', group={'id': 3, 'name': 'KansasTeam',
                                                       'scope': 'scoped', 'system_key': None},
                                       areas=['Kansas/Topeka', '', '  Kansas ']))
    assert ctx['is_global'] is False
    assert ctx['areas'] == ['Kansas/Topeka', 'Kansas']   # cleaned/trimmed, blanks dropped


def test_build_ctx_admin_always_global_even_in_scoped_group():
    import auth
    ctx = auth._build_scope_ctx(_body('admin', group={'id': 3, 'name': 'KansasTeam',
                                                       'scope': 'scoped', 'system_key': None},
                                       areas=['Kansas/Topeka']))
    assert ctx['is_global'] is True


def test_build_ctx_null_group_unassigned_staff_scoped():
    import auth
    ctx = auth._build_scope_ctx(_body('staff', group=None))
    assert ctx['is_global'] is False      # unassigned staff: zero reach
    assert ctx['areas'] == []


def test_build_ctx_missing_group_key_is_global_mixed_version():
    import auth
    # group key entirely absent (old auth-backend) => treat staff as global too
    ctx = auth._build_scope_ctx(_body('staff'))
    assert ctx['is_global'] is True
