from django.test import TestCase, Client
from django.core.files.uploadedfile import SimpleUploadedFile
from unittest.mock import patch

# Use explicit absolute import for the models
from identification.models import Turtle, TurtleImage


class IdentificationQueueTests(TestCase):
    def setUp(self):
        self.client = Client()

        # Create a dummy "Existing" turtle to test matching against
        self.existing_turtle = Turtle.objects.create(
            gender='F',
            turtle_number=1,
            location_state='Kansas',
            location_specific='Lawrence'
        )

    def test_biology_id_generation(self):
        """Test that the biology_id property combines Gender + Number correctly."""
        t = Turtle(gender='M', turtle_number=5)
        self.assertEqual(t.biology_id, "M5")

    @patch('identification.views.process_turtle_image')
    @patch('identification.views.find_near_matches')
    def test_step_1_upload_and_queue(self, mock_find_matches, mock_process):
        """
        Test Step 1: Uploading an image should create a 'Pending Review' turtle
        and return a list of matches.
        """
        # 1. Setup Mocks
        mock_process.return_value = True
        mock_find_matches.return_value = [
            {
                'turtle_id': self.existing_turtle.id,
                'biology_id': 'F1',
                'gender': 'F',
                'location': 'Lawrence, Kansas',
                'score': 42,
                'confidence': 0.91,
                'image_url': '/media/test.jpg'
            }
        ]

        # 2. Create a dummy image file in memory
        img_content = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR...'  # minimal fake header
        img = SimpleUploadedFile("test_turtle.png", img_content, content_type="image/png")

        # 3. Perform POST request
        response = self.client.post('/api/identify/upload/', {'image': img})

        # 4. Assertions
        self.assertEqual(response.status_code, 200)
        self.assertIn('uploaded_image_id', response.data)
        self.assertEqual(len(response.data['matches']), 1)

        # Verify Database State
        self.assertEqual(Turtle.objects.count(), 2)

        # Verify the new turtle is temporary
        new_img_id = response.data['uploaded_image_id']
        new_img = TurtleImage.objects.get(id=new_img_id)
        self.assertEqual(new_img.turtle.location_specific, 'Pending_Review')

    def test_step_2a_confirm_match(self):
        """
        Test Step 2 (Option A): User confirms the image matches an existing turtle.
        """
        # FIX: Added turtle_number=0 to satisfy the NOT NULL constraint
        temp_turtle = Turtle.objects.create(
            location_specific='Pending_Review',
            turtle_number=0
        )
        img_file = SimpleUploadedFile("test.jpg", b"data", content_type="image/jpeg")
        t_img = TurtleImage.objects.create(turtle=temp_turtle, image=img_file)

        # User sends "It's a match!"
        data = {
            'uploaded_image_id': t_img.id,
            'action': 'match',
            'matched_turtle_id': self.existing_turtle.id
        }

        response = self.client.post('/api/identify/review/', data, content_type='application/json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'matched')

        # Verify DB: Image should now belong to Existing Turtle (F1)
        t_img.refresh_from_db()
        self.assertEqual(t_img.turtle.id, self.existing_turtle.id)

        # Verify DB: Temp turtle should be deleted
        self.assertFalse(Turtle.objects.filter(id=temp_turtle.id).exists())

    def test_step_2b_create_new(self):
        """
        Test Step 2 (Option B): User says it's a new turtle.
        """
        # FIX: Added turtle_number=0 to satisfy the NOT NULL constraint
        temp_turtle = Turtle.objects.create(
            location_specific='Pending_Review',
            gender='U',
            turtle_number=0
        )
        img_file = SimpleUploadedFile("test.jpg", b"data", content_type="image/jpeg")
        t_img = TurtleImage.objects.create(turtle=temp_turtle, image=img_file)

        # User sends "New Turtle Details"
        data = {
            'uploaded_image_id': t_img.id,
            'action': 'new',
            'gender': 'F',
            'location_state': 'Kansas',
            'location_specific': 'Topeka',
            'turtle_number': 99
        }

        response = self.client.post('/api/identify/review/', data, content_type='application/json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['biology_id'], 'F99')

        # Verify DB: Temp turtle is UPDATED, not deleted
        temp_turtle.refresh_from_db()
        self.assertEqual(temp_turtle.biology_id, 'F99')
        self.assertEqual(temp_turtle.location_specific, 'Topeka')

        # Image should still belong to this turtle
        t_img.refresh_from_db()
        self.assertEqual(t_img.turtle.id, temp_turtle.id)