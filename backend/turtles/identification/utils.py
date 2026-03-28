import os
import sys
import warnings
from django.conf import settings
from .models import Turtle

# Fix import path to find image_processing in parent directory
try:
    import turtles.image_processing as image_processing
except ImportError:
    sys.path.append(str(settings.BASE_DIR))
    import image_processing


def get_abs_path(django_file_field):
    return os.path.join(settings.MEDIA_ROOT, django_file_field.name)


def process_turtle_image(turtle_image_instance):
    """
    Deprecated Django compatibility path.
    Generates SuperPoint .pt feature tensors for uploaded image fields.
    """
    try:
        warnings.warn(
            "identification.utils.process_turtle_image is deprecated. "
            "Use Flask /api/upload and review endpoints for production flows.",
            DeprecationWarning,
            stacklevel=2,
        )

        original_path = get_abs_path(turtle_image_instance.image)
        pt_path = os.path.splitext(original_path)[0] + ".pt"
        os.makedirs(os.path.dirname(pt_path), exist_ok=True)

        success, _ = image_processing.extract_and_store_features(original_path, pt_path)

        if turtle_image_instance.mirror_image:
            mirror_path = get_abs_path(turtle_image_instance.mirror_image)
            mirror_pt_path = os.path.splitext(mirror_path)[0] + ".pt"
            os.makedirs(os.path.dirname(mirror_pt_path), exist_ok=True)
            image_processing.extract_and_store_features(mirror_path, mirror_pt_path)

        if success:
            turtle_image_instance.is_processed = True
            turtle_image_instance.save()
        return success
    except Exception as e:
        print(f"Processing Error: {e}")
        return False


def find_near_matches(turtle_image_instance, top_k=5):
    """
    Deprecated Django compatibility path.
    Returns top matches using SuperPoint/LightGlue score+confidence payloads.
    """
    warnings.warn(
        "identification.utils.find_near_matches is deprecated. "
        "Use Flask /api/upload and review endpoints for production flows.",
        DeprecationWarning,
        stacklevel=2,
    )
    query_path = get_abs_path(turtle_image_instance.image)
    results = image_processing.brain.match_query_robust(query_path, _build_db_index())
    return _format_results(results[:top_k])


def _build_db_index():
    """Build (pt_path, turtle_id, location) entries from Django model records."""
    db_index = []
    for turtle in Turtle.objects.all():
        turtle_id = turtle.biology_id
        location = "/".join(
            part for part in [turtle.location_state or "", turtle.location_specific or ""] if part
        ) or "Unknown"
        for image in turtle.images.all():
            if not image.image:
                continue
            image_path = get_abs_path(image.image)
            pt_path = os.path.splitext(image_path)[0] + ".pt"
            if os.path.exists(pt_path):
                db_index.append((pt_path, turtle_id, location))
    return db_index


def _format_results(results_list, is_mirrored=False):
    formatted = []
    for res in results_list:
        raw_id = res.get('site_id', 'Unknown')

        # Look up details in SQL DB
        turtle_obj = None
        try:
            if raw_id and raw_id[0].isalpha():
                g = raw_id[0].upper()
                n = int(raw_id[1:])
                turtle_obj = Turtle.objects.filter(gender=g, turtle_number=n).first()
        except:
            pass

        # Build URL
        abs_path = res.get('file_path', '')
        img_url = ""
        if settings.MEDIA_ROOT in abs_path:
            rel = os.path.relpath(abs_path, settings.MEDIA_ROOT).replace("\\", "/")
            img_url = settings.MEDIA_URL + rel

        formatted.append({
            "turtle_id": turtle_obj.id if turtle_obj else 0,
            "biology_id": raw_id,
            "gender": turtle_obj.gender if turtle_obj else "?",
            "location": res.get('location', 'Unknown'),
            "score": res.get('score', 0),
            "confidence": res.get('confidence', 0.0),
            "image_url": img_url,
            "preview_image": img_url,
            "is_mirrored_match": is_mirrored
        })
    return formatted