# PicTur Backup Strategy

This document describes the backup strategy for the PicTur web app: **Google Spreadsheet data** (admin and community) and **backend data** (images and folder structure under `data/`). It also covers what you can **prepare now** and what runs **after deployment** on the server.

---

## 1. What is backed up?

| What                      | Where                                                                      | Notes                               |
| ------------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| **Admin spreadsheet**     | Google Sheets (external)                                                   | Content as snapshot (e.g. CSV/JSON) |
| **Community spreadsheet** | Google Sheets (external)                                                   | Content as snapshot                 |
| **Images & folders**      | Backend `data/` (Review_Queue, Community_Uploads, State/Location/TurtleID) | Full data directory                 |

---

## 2. Google Sheets: daily CSV – is it a good approach?

**Short answer: Yes. A daily CSV export is a solid and common approach.**

- **CSV** is simple, easy to version, and you can store each sheet as its own file (e.g. `admin_2025-03-14_SheetName.csv`), so history per sheet stays traceable.
- **Alternative:** JSON (e.g. one JSON per spreadsheet with all sheets) – same information, slightly better for automation; CSV is often nicer for “open in Excel” and audits.
- **Industry standard:** Regular snapshots (daily/weekly) plus **retention** (e.g. last 7 days daily, 4 weeks weekly, 12 months monthly), optionally **off-site** (second server, S3, etc.). For getting started, daily export plus limited retention on the server is enough.

**Recommendation:** Export all sheets from both spreadsheets as CSV once per day (one CSV per sheet), with the date in the filename. Optionally add one JSON snapshot per spreadsheet for later automation (restore, history API).

---

## 3. Backups and Docker: where to store them?

**Important:** Backups should **not** live only inside the Docker volume.

- Currently: `backend-data:/app/data` is a **named volume**. If the container or volume is removed, that data (and any backups stored there) is gone.
- **Solution:** Store backups on the **host** or on **external storage**:
  - **Host mount:** e.g. `./backups:/app/backups` – backups end up on the server disk outside the container volume.
  - Better: a dedicated directory (e.g. `/srv/pictur/backups`) or another drive, so a failure of the main system does not immediately affect backups.
  - Optionally later: sync to S3/Backblaze/other cloud storage (so backups survive server failure).

**Bottom line:** Store backups **outside** the Docker-only volume (host path or external). That way they are safe if something goes wrong with Docker.

---

## 4. Storage: retention and size

- **Sheets backup:** CSV/JSON are small (typically KB to a few MB per day). Exporting all sheets daily is manageable.
- **Image backup:** Can get large. Options:
  - **Incremental:** Only new/changed files (rsync, robocopy, or a tool with deduplication).
  - **Retention:** e.g. keep only the last 3 days of daily full backups, then one weekly snapshot, then one monthly – depending on space.
  - **Compression:** Archive `data/` as tar.gz/zip – saves space, restore takes a bit longer.

**Pragmatic approach:**

- Sheets: daily, keep e.g. 30 days (or 7 daily + 4 weekly).
- Images: depending on space – e.g. daily rsync into a backup directory with retention (e.g. keep only last 7 days) or one full backup per week with compression.

---

## 5. What can you prepare **now** (without a running server)?

| Task                  | Possible now?      | Description                                                                                                                                                                                                |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backup code**       | ✅ Yes             | Module/script that reads both spreadsheets via API and writes all sheets as CSV (and optional JSON) to a configurable directory.                                                                           |
| **Env/config**        | ✅ Yes             | Variable e.g. `BACKUP_OUTPUT_DIR` (path for backups). Locally e.g. `./backups`; on the server e.g. `/srv/pictur/backups` or host mount.                                                             |
| **Docker**            | ✅ Yes             | Additional volume for backups: host path e.g. `./backups:/app/backups` (or absolute path on the server); backend writes there.                                                                             |
| **Image backup**      | ✅ Can be prepared | Script/instructions: copy `data/` to `BACKUP_OUTPUT_DIR/data/` (rsync/robocopy). The **actual cron job** is set up when the server is running.                                                             |
| **Cron / scheduler**  | ⏳ Later           | Daily run of the backup script (Sheets and optionally data copy) via cron (Linux) or Task Scheduler (Windows). Configure on the server.                                                                    |
| **Restore / history** | ✅ Partially now   | Restore: re-import from CSV/JSON into Sheets (manually or with a small script). Showing history = list backup files and display/download old CSV/JSON when needed – both can be prepared conceptually now. |

---

## 6. Implementation overview

1. **In the repo (already done):**
   - Backup module in the backend: export all sheets (admin + community) as CSV (one file per sheet, date in path) under `BACKUP_OUTPUT_DIR/sheets/`.
   - Optional: one JSON per spreadsheet under `BACKUP_OUTPUT_DIR/sheets/`.
   - CLI/script (`python -m backup.run`) that you can run manually and later via cron.
   - Env: `BACKUP_OUTPUT_DIR` (default e.g. `./backups`).
   - Docker: volume for backups mounted from the host (`BACKUP_OUTPUT_DIR` in the container = mounted host directory).

2. **Images:**
   - Script or instructions: copy contents of `data/` to e.g. `BACKUP_OUTPUT_DIR/data/` (rsync/robocopy), with optional retention.
   - Or: separate cron job on the host that only syncs `data/` to a fixed backup path – independent of the container.

3. **After deployment:**
   - On the server: optional fixed host path for backups (e.g. `/srv/pictur/backups`); with default Compose, `./backups` next to `docker-compose.yml` is enough (e.g. `~/PicTur/backups`).
   - **What lands on the host disk?**
     - **Sheets (CSV/JSON):** `BACKUP_OUTPUT_DIR` inside the container defaults to `/app/backups`, and Compose maps `./backups` there—so these files are **on the host** next to your compose file (not inside the `backend-data` volume).
     - **Images and `data/` tree:** The app stores uploads under `/app/data`, which uses the **named volume** `backend-data` only. That data is **not** on the host filesystem until you copy it out. Use the repo script `scripts/backup-backend-data.sh` (or the combined `scripts/daily-backup.sh`) so each run creates a dated folder `backups/data/YYYY-MM-DD/` on the host with a full copy of `data/`.
   - **Cron (one job for everything):** Prefer **`scripts/daily-backup.sh`**: it runs `python -m backup.run` (Sheets) then `backup-backend-data.sh` (images). Add **one** line with **`crontab -e`**. Do **not** paste the whole line into an interactive shell—the first five fields (`0 3 * * *`) are the schedule; the shell would try to run `0` as a command and print `command not found`.
   - Use an **absolute** path for `COMPOSE_DIR` (`~` often does not expand under cron). Example (adjust paths and log location):
     ```cron
     0 3 * * * COMPOSE_DIR=/home/lukas/PicTur/TurtleTracker BACKUP_OUTPUT_DIR=/home/lukas/PicTur/TurtleTracker/backups /home/lukas/PicTur/TurtleTracker/scripts/daily-backup.sh >> /home/lukas/pictur-backup.log 2>&1
     ```
     Ensure `BACKUP_OUTPUT_DIR` matches the host directory bind-mounted to `/app/backups` in Compose (default: `<compose dir>/backups`). If you only want Sheets (no image copy), keep the older one-liner with `docker compose exec -T backend python -m backup.run` only.
   - **Sheets-only cron** (if you split jobs):
     ```cron
     0 3 * * * cd /home/lukas/PicTur/TurtleTracker && /usr/bin/docker compose exec -T backend python -m backup.run >> /home/lukas/pictur-backup.log 2>&1
     ```
     `-T` avoids TTY errors when cron runs non-interactively. If `docker` is not at `/usr/bin/docker`, use the path from `which docker` on the server.
   - **Test manually** (normal shell):
     ```bash
     cd /home/lukas/PicTur/TurtleTracker && ./scripts/daily-backup.sh
     ```
     Or test image backup alone:
     ```bash
     COMPOSE_DIR=/home/lukas/PicTur/TurtleTracker ./scripts/backup-backend-data.sh
     ```
     If the backend container is stopped, `backup-backend-data.sh` tries to read the `backend-data` Docker volume with a short-lived `alpine` container (image pulled once). You can force the volume name with `BACKEND_DATA_VOLUME=turtleproject_backend-data` if needed.
   - Retention: delete old backup folders/files after X days (small script or `find` + cron).

4. **Restore:**
   - **Sheets:** Re-import rows from the chosen CSV/JSON into the corresponding sheet (manually or with a small import script using the Sheets API).
   - **Images:** Copy the backed-up `data/` back to the real `data/` (or into the volume) and restart the app.

5. **History:**
   - Backups are timestamped (e.g. `admin_2025-03-14_LocationA.csv`). History = list backup files and, on click/download, show or download the corresponding file. This can be added later as an admin feature (“Backup history”).

---

## 7. Summary

- **Sheets:** Daily CSV (one file per sheet) is a good, common approach; optional JSON for automation.
- **Backups outside Docker:** Yes – use a host mount or external drive/cloud so backups are safe if Docker has issues.
- **Storage:** Use retention for sheets (e.g. 30 days) and for images (e.g. 7 days daily) plus optional weekly compressed backups.
- **Now:** Backup module, env, Docker volume, and scripts/instructions are prepared; **later:** set up cron and optionally off-site sync on the server.

The concrete implementation (backup module, script, Docker volume) is in the repo and referenced in the backend README and in this document.
