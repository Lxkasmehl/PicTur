# Turtle Project Backend

Flask API Server for the Turtle Identification System.

## Installation

1. Make sure Python 3.8+ is installed.

2. Install dependencies:

```bash
pip install -r requirements.txt
```

## Configuration

1. Create a `.env` file in the `backend` directory (copy from `env.template`):

```bash
# On Windows (PowerShell)
Copy-Item env.template .env

# On Linux/Mac
cp env.template .env
```

2. Update the `.env` file with your configuration:

```env
# Server Port (default: 5000)
PORT=5000

# Flask Debug Mode
FLASK_DEBUG=true

# JWT Secret - MUST match the JWT_SECRET in auth-backend/.env
JWT_SECRET=your-secret-key-change-in-production
```

**Important:** The `JWT_SECRET` must match the `JWT_SECRET` in `auth-backend/.env` so that the Flask backend can verify JWT tokens from the auth-backend.

## Starting the Server

1. Navigate to the backend directory:

```bash
cd backend
```

2. Start the Flask server:

```bash
python app.py
```

The server runs by default on `http://localhost:5000`.

## API Endpoints

### Health Check

- `GET /api/health` - Checks if the server is running

### Photo Upload

- `POST /api/upload` - Uploads a photo

  - **Admin**: Processes immediately and returns top 5 matches
  - **Community**: Saves to review queue with top 5 matches

  Form Data:

  - `file`: The image file
  - `role`: 'admin' or 'community'
  - `email`: User's email address

### Review Queue

- `GET /api/review-queue` - Returns all pending review items (Admin only)

### Approve Review

- `POST /api/review/<request_id>/approve` - Approves a review item (Admin only)

  Body:

  ```json
  {
    "match_turtle_id": "T101" // The selected turtle ID
  }
  ```

### Get Images

- `GET /api/images` - Returns an image from the file system
  - Query parameter: `path=<encoded_image_path>`

## Data Structure

The backend uses the following directory structure:

```
backend/
├── data/                    # Main data directory
│   ├── Review_Queue/        # Community uploads (waiting for review)
│   ├── Community_Uploads/   # Saved community uploads
│   └── [Location]/ or [State]/[Location]/  # Official turtle data
│       └── [TurtleID]/
│           ├── ref_data/     # Reference images
│           └── loose_images/ # Additional observations
├── app.py                   # Flask API Server
├── turtle_manager.py        # Main logic for turtle management
├── turtles/image_processing.py  # SuperPoint/LightGlue matching
└── routes/                  # API route modules
```

## Important Notes

- On startup, the system scans turtle reference `.pt` tensors and warms the in-memory matcher cache.
- Community uploads are saved in `data/Review_Queue/` and wait for admin review.
- Admin uploads are processed immediately and the top 5 matches are returned.

## Clearing Uploaded Data

To clear all uploaded data (Review Queue, Community Uploads, temporary files):

```bash
python clear_uploads.py
```

This will:

- Delete all items in the Review Queue
- Delete all Community Uploads
- Clear temporary uploaded files

**Note:** This does NOT delete:

- Official turtle data (State/Location folders)
- Deprecated VLAD/FAISS fallback indexes and vocabulary
- Existing reference tensors/models

To clear only the Review Queue:

```bash
python clear_uploads.py --review-only
```

## Troubleshooting

### Port Already in Use

If port 5000 is already in use, change the port in your `.env` file:

```env
PORT=5001
```

Or set it as an environment variable before starting:

```bash
PORT=5001 python app.py
```

### Environment Configuration

The backend uses a separate `.env` file that is completely independent from `auth-backend/.env`. The only shared configuration is `JWT_SECRET`, which must match between both backends for authentication to work.

- `backend/.env` - Flask backend configuration (PORT, FLASK_DEBUG, JWT_SECRET)
- `auth-backend/.env` - Auth backend configuration (PORT, JWT_SECRET, etc.)

These are kept separate to avoid configuration conflicts.

### Missing Dependencies

Make sure all packages are installed:

```bash
pip install -r requirements.txt
```

### Docker and CUDA

The default `backend/Dockerfile` is CPU-focused (`python:3.11-slim`) and works without NVIDIA runtime.
If you want GPU acceleration in Docker, use `backend/Dockerfile.cuda` with NVIDIA Container Toolkit.
From repo root:

```powershell
# auto GPU->CPU fallback launcher (Windows/PowerShell)
./scripts/docker-up.ps1
```

```bash
# auto GPU->CPU fallback launcher (Linux/macOS)
chmod +x ./scripts/docker-up.sh
./scripts/docker-up.sh

# explicit GPU compose override
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

### 500 Error on Photo Upload (POST /api/upload)

If the server returns **500** when uploading a photo from the frontend, the cause is often a **missing or empty `data/` folder** or stale optional legacy artifacts. The SuperPoint/LightGlue path does not require VLAD/FAISS.

**Legacy note:**  
Older VLAD/FAISS experiments could fail with mismatched `vlad_vocab.pkl` and `turtles.index` files. Those files are now deprecated compatibility artifacts and are not part of the default runtime match path.

**Typical causes:**

1. **No or empty `backend/data/`**  
   The backend expects turtle reference data under `backend/data/` in the structure `data/<Location>/.../<TurtleID>/ref_data/` with `.jpg/.jpeg/.png` plus generated `.pt` tensors. If data is empty, uploads still work but return no matches.

2. **Corrupted tensors / unreadable images**  
   If `.pt` files are stale or corrupted, matching may fail for specific turtles. Rebuilding tensors from source images resolves this.

3. **Deprecated legacy artifacts mixed in**  
   If experimenting with VLAD/FAISS fallback files, keep them consistent or delete them as a set.

**What to do:**

- **Option A – Use the same data as you:**  
  Copy your `backend/data/` to your colleague’s machine in the same relative path. Then restart the backend.

- **Option B – Empty setup (no matches):**  
  Ensure `backend/data/` exists (e.g. `backend/data/Review_Queue`, `backend/data/Community_Uploads` are created on first run; after a full reset, folder structure is recreated from admin and community sheet names). With the current code, an empty `data/` no longer causes 500; uploads succeed and return **no matches** until reference data (and index) are added. If you had a 500 before, delete **all** index/vocab files in `backend/turtles/` (see Option C) so no stale unfitted vocab remains.

- **Option C – Clear deprecated fallback artifacts together:**  
  If you are experimenting with VLAD/FAISS fallback files in `backend/turtles/` (`vlad_vocab.pkl`, `turtles.index`, `metadata.pkl`, `global_vlad_array.npy`, `trained_kmeans_vocabulary.pkl`), remove them together when resetting. Use `python reset_complete_backend.py` to clean data plus these artifacts.

- **See the real error:**  
  In the backend terminal, the exception and traceback are printed when a 500 occurs. The API response body may also include an `error` (and in debug mode `details`) field with the message. Check both to confirm the cause.

## Google Sheets API Integration

The backend supports integration with Google Sheets for turtle data management. This allows admins to sync turtle data directly to Google Sheets when approving matches or creating new turtles.

### Prerequisites

1. A Google Cloud Project
2. A Google Sheets spreadsheet with the turtle data
3. Service Account credentials

### Setup Instructions

#### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Sheets API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

#### Step 2: Create a Service Account

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in the service account details:
   - Name: `turtle-sheets-service` (or any name you prefer)
   - Description: `Service account for Turtle Project Google Sheets integration`
4. Click "Create and Continue"
5. Skip the optional steps and click "Done"

#### Step 3: Create and Download Service Account Key

1. Click on the service account you just created
2. Go to the "Keys" tab
3. Click "Add Key" > "Create new key"
4. Select "JSON" format
5. Click "Create" - this will download a JSON file
6. Save this file securely (e.g., `backend/credentials/google-sheets-credentials.json`)

#### Step 4: Share Google Sheet with Service Account

1. Open your Google Sheets spreadsheet
2. Click the "Share" button
3. Add the service account email (found in the JSON file as `client_email`)
4. Give it "Editor" permissions
5. Click "Send"

#### Step 5: Get Spreadsheet ID

1. Open your Google Sheets spreadsheet
2. Look at the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
3. Copy the `SPREADSHEET_ID` part

#### Step 6: Configure Environment Variables

Add the following variables to your `backend/.env` file:

```env
# Google Sheets API Configuration
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id-here
GOOGLE_SHEETS_CREDENTIALS_PATH=./credentials/google-sheets-credentials.json
```

Replace `your-spreadsheet-id-here` with your actual spreadsheet ID and update the credentials path if you saved the JSON file in a different location.

#### Step 7: Install Dependencies

The Google Sheets API dependencies are already included in `requirements.txt`. If you haven't installed them yet:

```bash
pip install -r requirements.txt
```

This will install:
- `google-api-python-client`
- `google-auth`
- `google-auth-oauthlib`
- `google-auth-httplib2`

#### Step 8: Verify Setup

1. Start the backend server:
   ```bash
   python app.py
   ```

2. Check the console output - you should see no errors related to Google Sheets
3. If there are errors, check:
   - The credentials file path is correct
   - The spreadsheet ID is correct
   - The service account has access to the spreadsheet
   - The Google Sheets API is enabled

### Google Sheets Structure

The Google Sheets spreadsheet should have:

1. **Multiple sheets (tabs)**: One sheet per region/state
   - Example: "Kansas", "Nebraska", etc.

2. **Header row (Row 1)**: Contains column headers:
   - Transmitter ID
   - ID (Primary ID - this is the key field)
   - ID2 (random sequence)
   - Pit?
   - Pic in 2024 Archive?
   - Adopted?
   - iButton?
   - DNA Extracted?
   - Date 1st found
   - Species
   - Name
   - Sex
   - iButton Last set
   - Dates refound
   - General Location
   - Location
   - Notes
   - Transmitter put on by
   - Transmitter On Date
   - Transmitter type
   - Transmitter lifespan
   - Radio Replace Date
   - OLD Frequencies

3. **Data rows**: Each row represents one turtle

### Important Notes

- **Column headers must match exactly** (case-sensitive)
- **The "ID" column is the primary key** - it should be unique across all sheets
- **Sheet names should match state names** (e.g., "Kansas", "Nebraska")
- The system automatically finds columns by header name, so column order can change
- New columns can be added - just make sure the header name matches the expected format

### Post-confirmation automation (relabeling and community spreadsheet)

Once the turtle team confirms an upload (match to existing turtle or new turtle), the backend automates:

1. **Relabeling photos and records**
   - **Match:** The uploaded image is copied into the confirmed turtle’s folder (`data/<location>/<turtle_id>/loose_images/`) with a timestamped filename (e.g. `Obs_<timestamp>_<original>.jpg`). The review packet is then removed. The correct turtle ID is thus reflected by the folder and filename.
   - **New turtle:** The image is processed into a new turtle folder under the chosen location/sheet.
   - Research Google Sheet is updated by the admin (or frontend) before or during confirm; the backend does not change sheet data for matches beyond optional community sync.

2. **Community-facing spreadsheet (required)**
   - Community uploads are always synced to a **separate** community spreadsheet. Set `GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID` in `.env` (see `env.template`). Use the same service account and share the community spreadsheet with it (Editor).
   - **Match to existing turtle:** The confirmed row is synced from the research spreadsheet to the community spreadsheet (research remains the source of truth for that turtle).
   - **New turtle from community upload:** The turtle is created **only** in the community spreadsheet, not in the research spreadsheet. So community-only turtles exist only in the community sheet.
   - If the community spreadsheet is not configured or sync fails, the approval request fails with a 503 and a clear error message.

### Google Sheets API Endpoints

- `GET /api/sheets/turtle/<primary_id>` - Get turtle data from Google Sheets (Admin only)
- `POST /api/sheets/turtle` - Create new turtle data in Google Sheets (Admin only)
- `PUT /api/sheets/turtle/<primary_id>` - Update turtle data in Google Sheets (Admin only)
- `GET /api/sheets/sheets` - List all available sheets (Admin only)

### Troubleshooting Google Sheets

#### Error: "Google Sheets service not configured"
- Check that `GOOGLE_SHEETS_SPREADSHEET_ID` and `GOOGLE_SHEETS_CREDENTIALS_PATH` are set in `.env`
- Verify the credentials file exists at the specified path

#### Error: "Failed to authenticate with Google Sheets"
- Check that the credentials JSON file is valid
- Verify the service account email has access to the spreadsheet
- Make sure the Google Sheets API is enabled in your Google Cloud project

#### Error: "Turtle not found in Google Sheets"
- Verify the turtle's Primary ID exists in the spreadsheet
- Check that you're looking in the correct sheet (state/region)
- Ensure the "ID" column header is exactly "ID" (case-sensitive)

#### Error: "Failed to create/update turtle data"
- Check that the service account has "Editor" permissions on the spreadsheet
- Verify the sheet name matches the state name
- Check that all required columns exist in the header row

### Backup (Google Sheets export)

The backend can export all sheets from both the admin and community spreadsheets to CSV (and JSON) for backup and history. See **docs/BACKUP.md** for the full strategy (where to store backups, Docker, retention, restore).

- **Run manually** (from `backend` directory):
  ```bash
  python -m backup.run
  ```
- **Output:** `BACKUP_OUTPUT_DIR/sheets/YYYY-MM-DD/` with one CSV per sheet (`admin_SheetName.csv`, `community_SheetName.csv`) and optional `admin.json` / `community.json`.
- **Env:** `BACKUP_OUTPUT_DIR` (default: `./backups`). With Docker, the compose file mounts `./backups` on the host to `/app/backups` so backups are stored outside the container.
- **On the server:** Set `BACKUP_OUTPUT_DIR` to a host path (e.g. `/srv/turtletracker/backups`) and mount that directory into the backend container; run `python -m backup.run` daily via cron (e.g. `docker compose exec backend python -m backup.run`).
