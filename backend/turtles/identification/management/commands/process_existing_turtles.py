from django.core.management.base import BaseCommand
from identification.models import TurtleImage
from identification.utils import process_turtle_image


class Command(BaseCommand):
    help = (
        "Reprocesses all images in the legacy Django database "
        "(generates SuperPoint .pt feature tensors)."
    )

    def handle(self, *args, **options):
        images = TurtleImage.objects.all()
        count = images.count()
        self.stdout.write(f"Found {count} images. Starting processing...")

        processed_count = 0
        failed_count = 0

        for img_obj in images:
            self.stdout.write(f"Processing Image {img_obj.id} (Turtle {img_obj.turtle_id})...")

            # Use the updated single-image processing function
            success = process_turtle_image(img_obj)

            if success:
                self.stdout.write(self.style.SUCCESS(f"  > Success"))
                processed_count += 1
            else:
                self.stdout.write(self.style.ERROR(f"  > Failed (Check vocabulary or image path)"))
                failed_count += 1

        self.stdout.write(self.style.SUCCESS(f"\nDone! Processed: {processed_count}, Failed: {failed_count}"))