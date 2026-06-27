"""Unit tests: identifier plastron upload + sheet-based folder resolution (brain mocked)."""

import os
from unittest.mock import MagicMock

import pytest

import turtle_manager as tm


def _fake_process_and_save(image_path, pt_path):
    """Real brain writes the tensor file; the mock must create it for file moves to succeed."""
    with open(pt_path, "wb") as f:
        f.write(b"fakept")
    return True


@pytest.fixture
def mgr(tmp_path, monkeypatch):
    monkeypatch.setattr(tm.brain, "process_and_save", _fake_process_and_save)
    if hasattr(tm.brain, "load_database_to_vram"):
        monkeypatch.setattr(tm.brain, "load_database_to_vram", MagicMock())
    if hasattr(tm.brain, "add_single_to_vram"):
        monkeypatch.setattr(tm.brain, "add_single_to_vram", MagicMock())
    return tm.TurtleManager(base_data_dir=str(tmp_path))


def test_resolve_creates_folder_with_sheet(mgr):
    d = mgr.resolve_turtle_dir_for_sheet_upload("TNEW", "Kansas/Topeka")
    expected = os.path.join(mgr.base_dir, "Kansas", "Topeka", "TNEW")
    assert os.path.normpath(d) == os.path.normpath(expected)
    assert os.path.isdir(os.path.join(d, "ref_data"))
    assert os.path.isdir(os.path.join(d, "loose_images"))


def test_resolve_sheet_upload_clamps_deep_location(mgr):
    """A 3-segment sub-site location must NOT create a 4-level turtle folder."""
    d = mgr.resolve_turtle_dir_for_sheet_upload("TNEW", "NebraskaCPBS/CPBS/East Geo 2")
    expected = os.path.join(mgr.base_dir, "NebraskaCPBS", "CPBS", "TNEW")
    assert os.path.normpath(d) == os.path.normpath(expected)
    assert os.path.isdir(os.path.join(d, "ref_data"))
    # The 4-level path must never be created.
    assert not os.path.isdir(
        os.path.join(mgr.base_dir, "NebraskaCPBS", "CPBS", "East Geo 2", "TNEW")
    )


def test_resolve_or_create_canonical_clamps_deep_location(mgr):
    """Canonical new-turtle creation also stays at State/Location/<bio>_<primary>."""
    turtle_dir, created, reason = mgr.resolve_or_create_canonical_turtle_dir(
        "F500", "NebraskaCPBS/CPBS/East Geo 2", primary_id="T1771234500", bio_id="F500"
    )
    assert created is True and reason is None
    expected = os.path.join(mgr.base_dir, "NebraskaCPBS", "CPBS", "F500_T1771234500")
    assert os.path.normpath(turtle_dir) == os.path.normpath(expected)
    assert os.path.isdir(os.path.join(turtle_dir, "plastron"))
    assert not os.path.isdir(
        os.path.join(mgr.base_dir, "NebraskaCPBS", "CPBS", "East Geo 2", "F500_T1771234500")
    )


def test_resolve_or_create_canonical_gate_requires_primary_for_new_folder(mgr):
    """Born-canonical-or-fail-loud: CREATING a new folder with a bio_id but no
    primary_id must fail loud (never a bio-only 'F901' or doubled 'F901_F901'),
    while resolving an EXISTING folder by bare bio_id still works without a
    primary (the gate is create-only)."""
    # No folder yet + bio_id + no primary -> refuse, with a clear reason.
    turtle_dir, created, reason = mgr.resolve_or_create_canonical_turtle_dir(
        "F901", "Kansas/Lawrence", primary_id=None, bio_id="F901"
    )
    assert turtle_dir is None and created is False
    assert reason and "Primary ID" in reason
    assert not os.path.isdir(os.path.join(mgr.base_dir, "Kansas", "Lawrence", "F901"))
    assert not os.path.isdir(os.path.join(mgr.base_dir, "Kansas", "Lawrence", "F901_F901"))

    # With a primary it is born canonical.
    turtle_dir, created, reason = mgr.resolve_or_create_canonical_turtle_dir(
        "F901", "Kansas/Lawrence", primary_id="T1771234901", bio_id="F901"
    )
    assert created is True and reason is None
    expected = os.path.join(mgr.base_dir, "Kansas", "Lawrence", "F901_T1771234901")
    assert os.path.normpath(turtle_dir) == os.path.normpath(expected)

    # An EXISTING folder still resolves by bare bio_id with no primary.
    again, created2, reason2 = mgr.resolve_or_create_canonical_turtle_dir(
        "F901", "Kansas/Lawrence", primary_id=None, bio_id="F901"
    )
    assert created2 is False and reason2 is None
    assert os.path.normpath(again) == os.path.normpath(expected)


def test_set_identifier_first_plastron(mgr, tmp_path):
    src = tmp_path / "in.jpg"
    src.write_bytes(b"\xff\xd8\xff fakejpeg")
    ok, msg = mgr.set_identifier_plastron_from_path("T1", str(src), "SiteA", "set_if_missing")
    assert ok is True
    ref = os.path.join(mgr.base_dir, "SiteA", "T1", "ref_data")
    assert os.path.isfile(os.path.join(ref, "T1.jpg"))
    assert os.path.isfile(os.path.join(ref, "T1.pt"))


def test_set_if_missing_rejects_when_identifier_exists(mgr, tmp_path):
    src = tmp_path / "in.jpg"
    src.write_bytes(b"\xff\xd8\xff fakejpeg")
    mgr.set_identifier_plastron_from_path("T2", str(src), "LocB", "set_if_missing")
    ok, msg = mgr.set_identifier_plastron_from_path("T2", str(src), "LocB", "set_if_missing")
    assert ok is False
    assert "already has" in (msg or "").lower()


def test_replace_archives_old_master(mgr, tmp_path):
    turtle_dir = os.path.join(mgr.base_dir, "LocC", "T3")
    ref_dir = os.path.join(turtle_dir, "ref_data")
    loose_dir = os.path.join(turtle_dir, "loose_images")
    os.makedirs(ref_dir, exist_ok=True)
    os.makedirs(loose_dir, exist_ok=True)
    old_img = os.path.join(ref_dir, "T3.jpg")
    old_pt = os.path.join(ref_dir, "T3.pt")
    with open(old_img, "wb") as f:
        f.write(b"\xff\xd8\xff old")
    with open(old_pt, "wb") as f:
        f.write(b"pt")

    src = tmp_path / "new.jpg"
    src.write_bytes(b"\xff\xd8\xff new")
    ok, _msg = mgr.set_identifier_plastron_from_path("T3", str(src), "LocC", "replace")
    assert ok is True
    loose_files = os.listdir(loose_dir)
    assert any(n.startswith("Archived_Master_") for n in loose_files)
    assert os.path.isfile(os.path.join(ref_dir, "T3.jpg"))


def test_add_additional_creates_folder_when_only_sheet(mgr, tmp_path):
    src = tmp_path / "x.jpg"
    src.write_bytes(b"\xff\xd8\xff x")
    ok, _ = mgr.add_additional_images_to_turtle(
        "T4",
        [
            {
                "path": str(src),
                "type": "microhabitat",
                "timestamp": "2026-01-01T00:00:00Z",
                "original_filename": "x.jpg",
            }
        ],
        "StateX/PlaceY",
    )
    assert ok is True
    add_dir = os.path.join(mgr.base_dir, "StateX", "PlaceY", "T4", "additional_images")
    assert os.path.isdir(add_dir)


def test_get_turtle_folder_scoped_hint_avoids_duplicate_bio_id_across_states(mgr):
    """Same biology id in Kansas vs NebraskaCPBS must not pick the other state's folder."""
    ks = os.path.join(mgr.base_dir, "Kansas", "North Topeka", "F285", "plastron")
    ne = os.path.join(mgr.base_dir, "NebraskaCPBS", "CPBS", "F285", "plastron")
    os.makedirs(ks, exist_ok=True)
    os.makedirs(ne, exist_ok=True)
    for p in (ks, ne):
        with open(os.path.join(p, "F285.jpg"), "wb") as f:
            f.write(b"\xff\xd8\xff x")
        with open(os.path.join(p, "F285.pt"), "wb") as f:
            f.write(b"pt")

    ks_pick = mgr._get_turtle_folder("F285", "Kansas")
    ne_pick = mgr._get_turtle_folder("F285", "NebraskaCPBS/CPBS")
    assert "Kansas" in ks_pick.replace("\\", "/")
    assert "North Topeka" in ks_pick.replace("\\", "/")
    assert "NebraskaCPBS" in ne_pick.replace("\\", "/")
    assert "CPBS" in ne_pick.replace("\\", "/")


def test_get_turtle_folder_prefers_real_ref_data_over_empty_hint(mgr):
    """
    Partial sheet_name can make data/Kansas/T42 exist empty while real turtle is Kansas/Topeka/T42.
    _get_turtle_folder must not stop at the empty hinted path.
    """
    empty = os.path.join(mgr.base_dir, "Kansas", "T99", "ref_data")
    real_ref = os.path.join(mgr.base_dir, "Kansas", "Topeka", "T99", "ref_data")
    os.makedirs(empty, exist_ok=True)
    os.makedirs(real_ref, exist_ok=True)
    with open(os.path.join(real_ref, "T99.jpg"), "wb") as f:
        f.write(b"\xff\xd8\xff x")
    with open(os.path.join(real_ref, "T99.pt"), "wb") as f:
        f.write(b"pt")

    picked = mgr._get_turtle_folder("T99", "Kansas")
    assert os.path.normpath(picked) == os.path.normpath(
        os.path.join(mgr.base_dir, "Kansas", "Topeka", "T99")
    )


def test_resolve_finds_nested_when_hint_is_state_only(mgr):
    ref = os.path.join(mgr.base_dir, "Kansas", "North Topeka", "T88", "ref_data")
    os.makedirs(ref, exist_ok=True)
    with open(os.path.join(ref, "T88.jpg"), "wb") as f:
        f.write(b"\xff\xd8\xff")
    d = mgr.resolve_turtle_dir_for_sheet_upload("T88", "Kansas")
    assert "North Topeka" in d.replace("\\", "/")
    assert d.replace("\\", "/").rstrip("/").endswith("T88")


def test_resolve_no_shallow_folder_when_state_has_site_layout(mgr):
    """Do not create data/Kansas/<newid>/ when Kansas/<Site>/<id>/ is the real layout."""
    ref_other = os.path.join(mgr.base_dir, "Kansas", "North Topeka", "X1", "ref_data")
    os.makedirs(ref_other, exist_ok=True)
    with open(os.path.join(ref_other, "X1.pt"), "wb") as f:
        f.write(b"pt")
    d = mgr.resolve_turtle_dir_for_sheet_upload("BRANDNEW99", "Kansas")
    assert d is None
    assert not os.path.isdir(os.path.join(mgr.base_dir, "Kansas", "BRANDNEW99"))


# --- Cross-sheet biology-ID scoping (incident: same bio_id served wrong photos) ---


def _make_turtle(mgr, *parts):
    """Create data/<parts...>/plastron/<id>.{jpg,pt}; return the turtle dir."""
    tid = parts[-1]
    turtle_dir = os.path.join(mgr.base_dir, *parts)
    ref = os.path.join(turtle_dir, "plastron")
    os.makedirs(ref, exist_ok=True)
    with open(os.path.join(ref, f"{tid}.jpg"), "wb") as f:
        f.write(b"\xff\xd8\xff x")
    with open(os.path.join(ref, f"{tid}.pt"), "wb") as f:
        f.write(b"pt")
    return turtle_dir


def test_get_turtle_folder_bare_general_location_hint_stays_in_sheet(mgr):
    """Real Sheets-Browser hint shape: a bare general_location (no top-level
    folder) still scopes to the correct sheet via drive-key expansion."""
    ks = _make_turtle(mgr, "Kansas", "North Topeka", "F298")
    ne = _make_turtle(mgr, "NebraskaCPBS", "CPBS", "F298")
    assert os.path.normpath(mgr._get_turtle_folder("F298", "North Topeka")) == os.path.normpath(ks)
    assert os.path.normpath(mgr._get_turtle_folder("F298", "CPBS")) == os.path.normpath(ne)
    assert os.path.normpath(mgr._get_turtle_folder("F298", "Kansas/North Topeka")) == os.path.normpath(ks)
    assert os.path.normpath(mgr._get_turtle_folder("F298", "Kansas")) == os.path.normpath(ks)


def test_get_turtle_folder_missing_sheet_folder_returns_none_not_other_sheet(mgr):
    """The reported incident: the requested sheet has no such turtle -> None,
    never the same-bio_id turtle from a different sheet."""
    _make_turtle(mgr, "NebraskaCPBS", "CPBS", "F298")  # only NebraskaCPBS has F298
    assert mgr._get_turtle_folder("F298", "North Topeka") is None
    assert mgr._get_turtle_folder("F298", "Kansas/North Topeka") is None
    assert mgr._get_turtle_folder("F298", "Kansas") is None


def test_get_turtle_folder_unresolvable_hint_returns_none(mgr):
    """A hint that maps to no existing top-level folder fails closed."""
    _make_turtle(mgr, "Kansas", "North Topeka", "F298")
    assert mgr._get_turtle_folder("F298", "Nonexistent Place") is None


def test_get_turtle_folder_no_hint_ambiguous_bio_id_returns_none(mgr):
    """No hint + a bare bio_id matching two sheets is ambiguous -> refuse to guess."""
    _make_turtle(mgr, "Kansas", "North Topeka", "F298")
    _make_turtle(mgr, "NebraskaCPBS", "CPBS", "F298")
    assert mgr._get_turtle_folder("F298", None) is None


def test_get_turtle_folder_no_hint_single_match_still_resolves(mgr):
    """No hint + a bio_id that exists in exactly one place still resolves
    (preserves review-approval Scenario A)."""
    only = _make_turtle(mgr, "Kansas", "North Topeka", "F777")
    assert os.path.normpath(mgr._get_turtle_folder("F777", None)) == os.path.normpath(only)


def test_get_turtle_folder_no_hint_primary_id_resolves_across_tree(mgr):
    """primary_id is globally unique -> an unscoped walk is safe even with
    other turtles present."""
    _make_turtle(mgr, "Kansas", "North Topeka", "F298")
    pj = _make_turtle(mgr, "NebraskaCPBS", "CPBS", "T1771234567")
    assert os.path.normpath(mgr._get_turtle_folder("T1771234567", None)) == os.path.normpath(pj)


def test_get_turtle_folder_primary_recovers_when_sheet_location_is_stale(mgr):
    """Sheet Location names a sub-site the turtle's folder does NOT live under
    (e.g. Location='Shredder' while the folder sits directly under .../CPBS/).
    The scoped walk misses it, but a globally-unique primary_id recovers via the
    unscoped fallback. A bare bio_id must stay scoped (it repeats across sheets)
    and fail closed. Mirrors the live F286 'No photos on disk' incident."""
    target = _make_turtle(mgr, "NebraskaCPBS", "CPBS", "F286_T1771234567")
    # A real sub-site exists but holds a DIFFERENT turtle, so the deepest existing
    # prefix (.../CPBS/Shredder) is walked first and misses F286.
    _make_turtle(mgr, "NebraskaCPBS", "CPBS", "Shredder", "F128_T1770000001")
    stale_hint = "NebraskaCPBS/CPBS/Shredder"
    assert os.path.normpath(mgr._get_turtle_folder("T1771234567", stale_hint)) == os.path.normpath(target)
    assert mgr._get_turtle_folder("F286", stale_hint) is None


def test_get_turtle_folder_genuinely_nested_turtle_still_resolves(mgr):
    """A turtle that really lives in a sub-site is still found by the recursive
    scoped walk, for both its primary id and its bio id (no regression)."""
    nested = _make_turtle(mgr, "NebraskaCPBS", "CPBS", "Shredder", "F128_T1770000001")
    hint = "NebraskaCPBS/CPBS/Shredder"
    assert os.path.normpath(mgr._get_turtle_folder("T1770000001", hint)) == os.path.normpath(nested)
    assert os.path.normpath(mgr._get_turtle_folder("F128", hint)) == os.path.normpath(nested)


def test_get_turtle_folder_primary_fallback_returns_none_when_absent(mgr):
    """The unscoped primary fallback must not invent a match: a primary that
    exists nowhere still resolves to None."""
    _make_turtle(mgr, "NebraskaCPBS", "CPBS", "F286_T1771234567")
    assert mgr._get_turtle_folder("T9999999999", "NebraskaCPBS/CPBS/Shredder") is None


def test_resolve_upload_bare_general_location_stays_in_sheet(mgr):
    """resolve_turtle_dir_for_sheet_upload must not cross sheets when the hint
    is a bare general_location and the same bio_id exists in another sheet."""
    _make_turtle(mgr, "Kansas", "North Topeka", "F298")
    ne = _make_turtle(mgr, "NebraskaCPBS", "CPBS", "F298")
    got = mgr.resolve_turtle_dir_for_sheet_upload("F298", "CPBS")
    assert os.path.normpath(got) == os.path.normpath(ne)
    assert not os.path.isdir(os.path.join(mgr.base_dir, "CPBS"))


# --- Sheet-only ("Null") turtle: canonical folder creation on first upload ---


def test_resolve_or_create_canonical_creates_modern_structure(mgr):
    """No existing folder -> create data/<sheet>/<gl>/<bio_id>_<primary_id>/ with
    the full modern subfolder layout; created flag is True."""
    d, created, _reason = mgr.resolve_or_create_canonical_turtle_dir(
        "F500", "Kansas/North Topeka", primary_id="T1771234500", bio_id="F500",
    )
    assert created is True
    assert os.path.normpath(d) == os.path.normpath(
        os.path.join(mgr.base_dir, "Kansas", "North Topeka", "F500_T1771234500")
    )
    for sub in ("plastron", "plastron/Old References", "plastron/Other Plastrons",
                "carapace", "carapace/Old References", "carapace/Other Carapaces"):
        assert os.path.isdir(os.path.join(d, sub))


def test_resolve_or_create_canonical_other_goes_to_kansas_other(mgr):
    """An 'Other' turtle uses the normal routing -> data/Kansas/Other/<combined>/."""
    d, created, _reason = mgr.resolve_or_create_canonical_turtle_dir(
        "F501", "Kansas/Other", primary_id="T1771234501", bio_id="F501",
    )
    assert created is True
    assert os.path.normpath(d) == os.path.normpath(
        os.path.join(mgr.base_dir, "Kansas", "Other", "F501_T1771234501")
    )


def test_resolve_or_create_canonical_returns_existing_without_duplicating(mgr):
    """An existing folder is returned as-is (created=False); no second folder."""
    existing = _make_turtle(mgr, "Kansas", "North Topeka", "F502_T1771234502")
    d, created, _reason = mgr.resolve_or_create_canonical_turtle_dir(
        "F502", "Kansas/North Topeka", primary_id="T1771234502", bio_id="F502",
    )
    assert created is False
    assert os.path.normpath(d) == os.path.normpath(existing)
    loc = os.path.join(mgr.base_dir, "Kansas", "North Topeka")
    assert sorted(os.listdir(loc)) == ["F502_T1771234502"]


def test_replace_reference_create_if_missing_makes_canonical_folder(mgr, tmp_path):
    """create_if_missing=True + no folder -> canonical folder created with the
    plastron reference written under it."""
    src = tmp_path / "new.jpg"
    src.write_bytes(b"\xff\xd8\xff new")
    ok, msg = mgr.replace_turtle_reference(
        "F503", str(src), photo_type="plastron",
        sheet_name="Kansas/North Topeka", primary_id="T1771234503",
        create_if_missing=True, bio_id="F503",
    )
    assert ok is True, msg
    turtle_dir = os.path.join(mgr.base_dir, "Kansas", "North Topeka", "F503_T1771234503")
    assert os.path.isfile(os.path.join(turtle_dir, "plastron", "F503_T1771234503.jpg"))
    assert os.path.isfile(os.path.join(turtle_dir, "plastron", "F503_T1771234503.pt"))


def test_replace_reference_without_create_flag_still_errors_when_missing(mgr, tmp_path):
    """Default behavior unchanged: no folder + create_if_missing=False -> error."""
    src = tmp_path / "new.jpg"
    src.write_bytes(b"\xff\xd8\xff new")
    ok, msg = mgr.replace_turtle_reference(
        "F504", str(src), photo_type="plastron",
        sheet_name="Kansas/North Topeka", primary_id="T1771234504",
    )
    assert ok is False
    assert "could not find folder" in (msg or "").lower()


def test_resolve_or_create_canonical_no_general_location_gives_clear_reason(mgr):
    """A site-organized sheet (Kansas, with existing site subfolders) and no
    General Location cannot place a folder -- the failure reason must say so,
    not just report a bare 'not found'."""
    _make_turtle(mgr, "Kansas", "North Topeka", "F001_T1771230001")  # Kansas now has a site
    d, created, reason = mgr.resolve_or_create_canonical_turtle_dir(
        "M999", "Kansas", primary_id="T1771239990", bio_id="M999",
    )
    assert d is None and created is False
    assert reason and "general location" in reason.lower()


def test_resolve_or_create_canonical_rejects_colliding_bio_id(mgr):
    """A bare bio_id can collide with a different turtle that shares it. When a
    primary_id is given, a bio_id match carrying a DIFFERENT primary_id must be
    rejected and this turtle's own canonical folder created instead."""
    other = _make_turtle(mgr, "Kansas", "North Topeka", "M999_T1771230000")
    d, created, reason = mgr.resolve_or_create_canonical_turtle_dir(
        "M999", "Kansas/North Topeka", primary_id="T1771239999", bio_id="M999",
    )
    assert created is True
    assert reason is None
    assert os.path.normpath(d) == os.path.normpath(
        os.path.join(mgr.base_dir, "Kansas", "North Topeka", "M999_T1771239999")
    )
    assert os.path.normpath(d) != os.path.normpath(other)


# --- Folder relocate when a turtle's General Location changes in the sheet ---


def test_relocate_moves_folder_to_new_general_location(mgr):
    """Changing general_location moves data/Kansas/<old>/<folder>/ ->
    data/Kansas/<new>/<folder>/ (and auto-creates the destination dir)."""
    src = _make_turtle(mgr, "Kansas", "North Topeka", "F600_T1771230600")
    moved, msg = mgr.relocate_turtle_folder(
        "T1771230600", "Kansas", "Other", bio_id="F600",
    )
    assert moved is True, msg
    assert not os.path.isdir(src)
    new_dir = os.path.join(mgr.base_dir, "Kansas", "Other", "F600_T1771230600")
    assert os.path.isdir(new_dir)
    assert os.path.isfile(os.path.join(new_dir, "plastron", "F600_T1771230600.jpg"))


def test_relocate_same_location_is_noop(mgr):
    """Relocating to the location the folder is already in returns
    (False, 'already at destination') and does not touch disk."""
    existing = _make_turtle(mgr, "Kansas", "North Topeka", "F601_T1771230601")
    moved, msg = mgr.relocate_turtle_folder(
        "T1771230601", "Kansas", "North Topeka", bio_id="F601",
    )
    assert moved is False
    assert msg == "already at destination"
    assert os.path.isdir(existing)


def test_relocate_no_folder_is_noop(mgr):
    """A sheet-only ('Null') turtle has no on-disk folder; relocate returns
    (False, 'no on-disk folder to move') and creates nothing."""
    moved, msg = mgr.relocate_turtle_folder(
        "T1771230602", "Kansas", "Other", bio_id="F602",
    )
    assert moved is False
    assert msg == "no on-disk folder to move"
    assert not os.path.isdir(os.path.join(mgr.base_dir, "Kansas", "Other"))


def test_relocate_destination_collision_fails_soft(mgr):
    """If a folder of the same basename already exists at the destination,
    relocate refuses to overwrite it and leaves both folders intact."""
    src = _make_turtle(mgr, "Kansas", "North Topeka", "F603_T1771230603")
    # A leftover (or unrelated) folder of the same basename at the destination.
    collision = _make_turtle(mgr, "Kansas", "Other", "F603_T1771230603")
    moved, msg = mgr.relocate_turtle_folder(
        "T1771230603", "Kansas", "Other", bio_id="F603",
    )
    assert moved is False
    assert "destination already exists" in msg
    assert os.path.isdir(src)
    assert os.path.isdir(collision)


def test_relocate_cross_sheet_moves_into_new_sheet(mgr):
    """A turtle whose folder lives under one sheet can be relocated under a
    different sheet (e.g. Kansas -> NebraskaCPBS); the destination is computed
    from the new sheet hint + general_location like any other resolution."""
    src = _make_turtle(mgr, "Kansas", "North Topeka", "F604_T1771230604")
    moved, msg = mgr.relocate_turtle_folder(
        "T1771230604", "NebraskaCPBS", "CPBS", bio_id="F604",
    )
    assert moved is True, msg
    assert not os.path.isdir(src)
    new_dir = os.path.join(mgr.base_dir, "NebraskaCPBS", "CPBS", "F604_T1771230604")
    assert os.path.isdir(new_dir)
