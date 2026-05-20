"""Upload size limits: per-file cap vs multipart body cap."""

from config import MAX_CONTENT_LENGTH, MAX_FILE_SIZE, MAX_MULTIPART_IMAGE_PARTS


def test_multipart_body_cap_fits_main_plus_additional():
    """Flask MAX_CONTENT_LENGTH must allow N max-sized files (e.g. main + extras)."""
    assert MAX_CONTENT_LENGTH >= MAX_FILE_SIZE * MAX_MULTIPART_IMAGE_PARTS
    assert MAX_CONTENT_LENGTH >= 2 * MAX_FILE_SIZE
