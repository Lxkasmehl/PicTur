import os
from django.core.management.base import BaseCommand
from django.conf import settings
from identification.models import TurtleImage
from turtles import image_processing


class Command(BaseCommand):
    help = (
        "Deprecated command kept for compatibility. "
        "Re-extracts SuperPoint tensors for legacy Django identification images."
    )

    def handle(self, *args, **options):
        # 1. Check for images
        images = TurtleImage.objects.all()
        if not images.exists():
            self.stdout.write(self.style.ERROR("No images found. Upload images via the Admin panel first."))
            return

        self.stdout.write(
            self.style.WARNING(
                "Deprecated: train_vocabulary now runs SuperPoint extraction only. "
                "VLAD/FAISS vocabulary training is no longer part of default runtime."
            )
        )
        self.stdout.write(f"Found {images.count()} images. Checking for feature tensors...")

        processed_count = 0

        # 2. Generate feature tensors for any image that lacks them
        for img_obj in images:
            if not img_obj.image:
                continue

            image_path = img_obj.image.path
            base_dir = os.path.dirname(image_path)
            # Use the TurtleImage ID for unique filenames
            pt_path = os.path.join(base_dir, f"img_{img_obj.id}_orig.pt")

            if not os.path.exists(pt_path):
                self.stdout.write(f"  Generating features for Image {img_obj.id} (Turtle {img_obj.turtle_id})...")
                success, _ = image_processing.extract_and_store_features(image_path, pt_path)
                if success:
                    processed_count += 1
                else:
                    self.stdout.write(self.style.WARNING(f"  Failed to process {image_path}"))
            else:
                processed_count += 1

        if processed_count == 0:
            self.stdout.write(self.style.ERROR("No valid feature tensors could be generated."))
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Extracted/verified tensors for {processed_count} images under {settings.MEDIA_ROOT}."
            )
        )