from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from .models import Turtle, TurtleImage
from .utils import process_turtle_image, find_near_matches
from rest_framework.generics import GenericAPIView
from .serializers import TurtleImageUploadSerializer


class UploadAndIdentifyView(GenericAPIView):
    """
    Step 1: User uploads an image.
    - Image is saved to a temporary/unidentified turtle.
    - Image is processed (Original + Mirror) using SuperPoint features.
    - Returns top 5 near matches to the frontend.
    """
    parser_classes = (MultiPartParser, FormParser)

    # Add this line so the API knows to show an upload button
    serializer_class = TurtleImageUploadSerializer

    def post(self, request, *args, **kwargs):
        # Use the serializer to validate (optional, but good practice)
        serializer = self.get_serializer(data=request.data)

        # We handle the file manually as before, but now the form will appear
        file_obj = request.FILES.get('image')
        if not file_obj:
            return Response({"error": "No image provided"}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Create a TEMPORARY placeholder Turtle
        temp_turtle = Turtle.objects.create(
            gender='U',
            location_state='Unknown',
            location_specific='Pending_Review',
            turtle_number=0
        )

        # 2. Create the Image linked to this temp turtle
        turtle_image = TurtleImage.objects.create(
            turtle=temp_turtle,
            image=file_obj
        )

        # 3. Process the Image (SuperPoint feature extraction + Mirror Generation)
        success = process_turtle_image(turtle_image)
        if not success:
            return Response({"message": "Processing failed"}, status=500)

        # 4. Find Top 5 Near Matches
        near_matches = find_near_matches(turtle_image, top_k=5)

        return Response({
            "message": "Processed successfully",
            "uploaded_image_id": turtle_image.id,
            "matches": near_matches
        })

class ReviewMatchView(APIView):
    """
    Step 2: Frontend replies with a decision.
    - Action 'match': Link uploaded image to existing turtle.
    - Action 'new': Update the placeholder turtle with real details (creating a new identity).
    """

    def post(self, request, *args, **kwargs):
        upload_id = request.data.get('uploaded_image_id')
        action = request.data.get('action')  # 'match' or 'new'

        try:
            turtle_image = TurtleImage.objects.get(id=upload_id)
            current_temp_turtle = turtle_image.turtle
        except TurtleImage.DoesNotExist:
            return Response({"error": "Image not found"}, status=404)

        if action == 'match':
            # User selected an existing turtle
            matched_id = request.data.get('matched_turtle_id')
            try:
                existing_turtle = Turtle.objects.get(id=matched_id)

                # Move image to the existing turtle
                turtle_image.turtle = existing_turtle
                turtle_image.save()

                # Cleanup: Delete the temporary turtle we made in Step 1
                if current_temp_turtle:
                    current_temp_turtle.delete()

                return Response({
                    "status": "matched",
                    "final_turtle_id": existing_turtle.id,
                    "biology_id": existing_turtle.biology_id
                })

            except Turtle.DoesNotExist:
                return Response({"error": "Matched turtle ID not found"}, status=404)

        elif action == 'new':
            # User says it's a new turtle, verify we have the required data
            # Data needed: gender, location_state, location_specific, turtle_number

            current_temp_turtle.gender = request.data.get('gender', 'U')
            current_temp_turtle.location_state = request.data.get('location_state', 'Unknown')
            current_temp_turtle.location_specific = request.data.get('location_specific', 'Unknown')
            current_temp_turtle.turtle_number = request.data.get('turtle_number', 0)

            # Saving updates the DB. The ID (primary key) stays the same (it was generated on create).
            # The 'biology_id' property will now return the correct string (e.g., "F1")
            current_temp_turtle.save()

            # Note: The file paths won't auto-update on disk immediately unless you write extra logic,
            # but the database record is now correct.

            return Response({
                "status": "created_new",
                "final_turtle_id": current_temp_turtle.id,
                "biology_id": current_temp_turtle.biology_id
            })

        return Response({"error": "Invalid action"}, status=400)