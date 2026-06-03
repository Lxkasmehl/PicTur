"""
Filesystem helper functions for the turtle data backend.

Pure utility — no brain/VRAM, no Sheets, no lock state.
Imported by turtle_manager.py and the mixin modules.
"""
import os
import re
import time

try:
    from PIL import Image as _PILImage
    from PIL.ExifTags import TAGS as _EXIF_TAGS
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_DATA_DIR = 'data'
_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp')
_FOLDER_NAME_INVALID = r'\/:*?"<>|'
_MAX_TURTLE_DIR_DEPTH = 3

_BIO_ID_RE = re.compile(r'^([FMJUfmju]\d+)')
_CARAPACE_RE = re.compile(r'carapac|carapce|carapae', re.IGNORECASE)
_PRIMARY_ID_RE = re.compile(r'^T\d{10,}$')

# ---------------------------------------------------------------------------
# Flash-drive ingest mappings (kept here so both ingest and manager share them)
# ---------------------------------------------------------------------------

DRIVE_LOCATION_TO_BACKEND_PATH = {
    "Dee Hobelman": "Kansas/Dee Hobelman",
    "Karlyle Woods": "Kansas/Karlyle Woods",
    "Lawrence": "Kansas/Lawrence",
    "North Topeka": "Kansas/North Topeka",
    "Other": "Kansas/Other",
    "West Topeka": "Kansas/West Topeka",
    "CPBS": "NebraskaCPBS/CPBS",
    "Crescent Lake": "NebraskaCL/Crescent Lake",
}

DRIVE_STATE_LEVEL_FOLDERS = {
    "Incidental Places": "Incidental Places",
    "Community": "Community",
}

# Add name-mapping entries here to remap drive folder names to backend names.
DRIVE_STATE_NAME_MAP: dict = {}
LOCATION_NAME_MAP: dict = {}

# ---------------------------------------------------------------------------
# EXIF / date helpers
# ---------------------------------------------------------------------------

def _extract_exif_date(image_path):
    """Read DateTimeOriginal from a JPG's EXIF and return YYYY-MM-DD or None."""
    if not _PIL_AVAILABLE or not image_path or not os.path.isfile(image_path):
        return None
    try:
        with _PILImage.open(image_path) as img:
            exif = img.getexif()
            if not exif:
                return None
            wanted = {'DateTimeOriginal': None, 'DateTimeDigitized': None, 'DateTime': None}
            for tag_id, value in exif.items():
                name = _EXIF_TAGS.get(tag_id)
                if name in wanted and wanted[name] is None:
                    wanted[name] = value
            raw = wanted['DateTimeOriginal'] or wanted['DateTimeDigitized'] or wanted['DateTime']
            if not raw or not isinstance(raw, str):
                return None
            date_part = raw.split(' ')[0].strip()
            if len(date_part) == 10 and date_part[4] == ':' and date_part[7] == ':':
                return date_part.replace(':', '-')
    except Exception:
        return None
    return None


def _date_suffix(epoch_ms=None):
    """Return _YYYY-MM-DD using current time (or given epoch ms) for filename stamping."""
    if epoch_ms is not None:
        try:
            t = epoch_ms / 1000 if epoch_ms > 1_000_000_000_000 else epoch_ms
            return time.strftime('_%Y-%m-%d', time.gmtime(t))
        except (ValueError, OSError):
            pass
    return time.strftime('_%Y-%m-%d', time.gmtime())

# ---------------------------------------------------------------------------
# Image file lookups
# ---------------------------------------------------------------------------

def _find_image_next_to_pt(pt_path):
    """Case-insensitive lookup: return the actual image file next to a .pt path."""
    if not pt_path or not pt_path.endswith('.pt'):
        return None
    base = pt_path[:-3]
    dir_path = os.path.dirname(base) or '.'
    base_name = os.path.basename(base)
    if not os.path.isdir(dir_path):
        return None
    try:
        entries = os.listdir(dir_path)
    except OSError:
        return None
    for fname in entries:
        stem, ext = os.path.splitext(fname)
        if stem == base_name and ext.lower() in _IMAGE_EXTENSIONS:
            return os.path.join(dir_path, fname)
    return None


def _find_image_in_dir(dir_path, stem):
    """Case-insensitive: find ``<stem>.<ext>`` in ``dir_path`` for any image ext."""
    if not os.path.isdir(dir_path):
        return None
    try:
        entries = os.listdir(dir_path)
    except OSError:
        return None
    for fname in entries:
        fstem, ext = os.path.splitext(fname)
        if fstem == stem and ext.lower() in _IMAGE_EXTENSIONS:
            return os.path.join(dir_path, fname)
    return None

# ---------------------------------------------------------------------------
# Folder scoring / classification
# ---------------------------------------------------------------------------

def _ref_data_folder_score(turtle_dir, turtle_id):
    """Strength of reference material under a turtle folder (for disambiguation)."""
    tid = turtle_id or ""
    best = 0
    for sub in ("plastron", "carapace", "ref_data"):
        ref_dir = os.path.join(turtle_dir, sub)
        if not os.path.isdir(ref_dir):
            continue
        if tid and os.path.isfile(os.path.join(ref_dir, f"{tid}.pt")):
            return 3
        score = 0
        if tid and _find_image_in_dir(ref_dir, tid):
            score = 2
        else:
            try:
                for f in sorted(os.listdir(ref_dir)):
                    if f.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
                        score = 2
                        break
                if score == 0 and os.listdir(ref_dir):
                    score = 1
            except OSError:
                pass
        if score > best:
            best = score
    return best


def _is_turtle_data_folder(path):
    """True if ``path`` has any reference folder: plastron/, carapace/, or legacy ref_data/."""
    if not path or not os.path.isdir(path):
        return False
    try:
        return any(
            os.path.isdir(os.path.join(path, sub))
            for sub in ("plastron", "carapace", "ref_data")
        )
    except OSError:
        return False

# ---------------------------------------------------------------------------
# ID / name helpers
# ---------------------------------------------------------------------------

def _basename_matches_turtle_id(basename, tid):
    """Whether a folder basename refers to the turtle identified by ``tid``."""
    if not basename or not tid:
        return False
    if basename == tid:
        return True
    if basename.startswith(tid + "_"):
        return True
    if basename.endswith("_" + tid):
        return True
    return False


def _safe_folder_name(sheet_name):
    """Sanitize sheet name for use as a filesystem folder name."""
    if not sheet_name or not isinstance(sheet_name, str):
        return "_"
    out = sheet_name.strip()
    for c in _FOLDER_NAME_INVALID:
        out = out.replace(c, "_")
    return out or "_"


def _looks_like_primary_id(tid):
    """True if ``tid`` is a globally-unique primary key (``T`` + 10+ digits)."""
    return bool(tid) and bool(_PRIMARY_ID_RE.match(str(tid).strip()))


def canonical_new_turtle_folder_id(bio_id, primary_id, fallback_id):
    """On-disk folder name for a NEW turtle: ``<bio_id>_<primary_id>``."""
    bio_id = (bio_id or '').strip()
    primary_id = (primary_id or '').strip()
    fallback_id = (fallback_id or '').strip()
    if bio_id and primary_id:
        return f"{bio_id}_{primary_id}"
    if bio_id and fallback_id and not fallback_id.startswith(f"{bio_id}_"):
        return f"{bio_id}_{fallback_id}"
    return fallback_id or primary_id or bio_id


def _parse_bio_id(filename):
    """Extract biology ID from a filename like 'F002 Plastron.jpg' -> 'F002'."""
    m = _BIO_ID_RE.match(filename)
    if not m:
        return None
    raw = m.group(1)
    return raw[0].upper() + raw[1:]


def _detect_photo_type(filename):
    """Detect photo type from filename. Returns 'carapace' or 'plastron'."""
    if _CARAPACE_RE.search(filename):
        return 'carapace'
    return 'plastron'

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def _location_dir_from_sheet_name(sheet_name):
    """Turn a sheet/location string (e.g. Kansas/Topeka) into a relative path."""
    if not sheet_name or not isinstance(sheet_name, str):
        return None
    raw = sheet_name.strip().replace("\\", "/")
    parts = []
    for p in raw.split("/"):
        if not str(p).strip():
            continue
        seg = _safe_folder_name(p)
        if seg in (".", ".."):
            continue
        parts.append(seg)
    if not parts:
        return None
    return os.path.join(*parts)


def _resolved_path_under_base(base_dir, *relative_parts):
    """Join and resolve path; return only if result stays under base_dir."""
    if not relative_parts:
        return None
    if any(p is None or p == "" for p in relative_parts):
        return None
    try:
        candidate = os.path.join(base_dir, *relative_parts)
    except (TypeError, ValueError):
        return None
    real_base = os.path.realpath(base_dir)
    real_candidate = os.path.realpath(candidate)
    try:
        if os.path.commonpath([real_candidate, real_base]) != real_base:
            return None
    except ValueError:
        return None
    return real_candidate


def _turtle_dir_depth(base_dir, turtle_dir):
    """Number of path segments of ``turtle_dir`` relative to ``base_dir``."""
    try:
        rel = os.path.relpath(turtle_dir, base_dir)
    except (ValueError, TypeError):
        return None
    return len([p for p in rel.replace("\\", "/").split("/") if p and p not in (".", "..")])


def _clamp_turtle_dir_depth(base_dir, turtle_dir):
    """Clamp a new turtle folder to at most 3 levels under base_dir."""
    if not turtle_dir:
        return turtle_dir
    try:
        rel = os.path.relpath(turtle_dir, base_dir)
    except (ValueError, TypeError):
        return turtle_dir
    parts = [p for p in rel.replace("\\", "/").split("/") if p and p not in (".", "..")]
    if len(parts) <= _MAX_TURTLE_DIR_DEPTH:
        return turtle_dir
    clamped = parts[:_MAX_TURTLE_DIR_DEPTH - 1] + [parts[-1]]
    safe = _resolved_path_under_base(base_dir, *clamped)
    if not safe:
        return turtle_dir
    print(
        "⚠️ Turtle folder would nest below State/Location; clamping "
        f"(no new sub-site folders): {'/'.join(parts)} -> {'/'.join(clamped)}"
    )
    return safe

# ---------------------------------------------------------------------------
# Flash-drive path rewriting
# ---------------------------------------------------------------------------

def _expand_flat_drive_folder_prefix(parts):
    """Rewrite path segments that start with a flash-drive folder key."""
    if not parts:
        return parts
    head = parts[0]
    if head in DRIVE_LOCATION_TO_BACKEND_PATH:
        mapped = DRIVE_LOCATION_TO_BACKEND_PATH[head]
        mapped_parts = [p for p in mapped.split('/') if str(p).strip()]
        if len(parts) == 1:
            return mapped_parts
        return mapped_parts + parts[2:]
    return parts


def _resolve_drive_state_name(drive_state_name):
    """Map flash drive state folder name to backend state name."""
    return DRIVE_STATE_NAME_MAP.get(drive_state_name, drive_state_name)


def _resolve_drive_location_name(drive_location_name):
    """Map flash drive location folder name to backend location name."""
    return LOCATION_NAME_MAP.get(drive_location_name, drive_location_name)
