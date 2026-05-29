"""Shared upload ingest helpers: logging and JSON error payloads."""

import logging
import os

from image_utils import UploadImageError, process_uploaded_image

logger = logging.getLogger(__name__)


def upload_error_response(error: UploadImageError, status: int = 400):
    """Structured JSON body for upload rejection."""
    from flask import jsonify

    return jsonify({
        'error': error.message,
        'code': error.code,
    }), status


def log_upload_rejection(
    *,
    context: str,
    path: str | None,
    code: str,
    message: str,
    filename: str | None = None,
    exc: BaseException | None = None,
) -> None:
    logger.warning(
        '[upload:%s] rejected code=%s file=%s path=%s msg=%s%s',
        context,
        code,
        filename or '-',
        path or '-',
        message,
        f' exc={exc!r}' if exc else '',
    )


def ingest_saved_upload(path: str, *, context: str = 'upload', filename: str | None = None) -> str:
    """Run HEIC normalization, repair, and ingest resize. Raises UploadImageError."""
    if not path or not os.path.isfile(path):
        err = UploadImageError('file_missing', 'Uploaded file could not be read.')
        log_upload_rejection(
            context=context, path=path, code=err.code, message=err.message, filename=filename,
        )
        raise err
    try:
        return process_uploaded_image(path)
    except UploadImageError as e:
        log_upload_rejection(
            context=context,
            path=path,
            code=e.code,
            message=e.message,
            filename=filename,
        )
        raise
