"""
Review queue: community upload, approval, rejection, rollback.
"""
import json
import os
import re
import shutil
import time
import uuid

import sys
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    import sys; sys.path.insert(0, _backend_dir)

from .path_utils import (
    _extract_exif_date, _date_suffix, _find_image_next_to_pt, _find_image_in_dir,
    _ref_data_folder_score, _is_turtle_data_folder, _basename_matches_turtle_id,
    _safe_folder_name, _BIO_ID_RE, _CARAPACE_RE, _looks_like_primary_id,
    canonical_new_turtle_folder_id, _parse_bio_id, _detect_photo_type,
    _location_dir_from_sheet_name, _resolved_path_under_base,
    _MAX_TURTLE_DIR_DEPTH, _turtle_dir_depth, _clamp_turtle_dir_depth,
    _expand_flat_drive_folder_prefix, _IMAGE_EXTENSIONS,
    DRIVE_LOCATION_TO_BACKEND_PATH, DRIVE_STATE_LEVEL_FOLDERS,
    DRIVE_STATE_NAME_MAP, LOCATION_NAME_MAP,
    _resolve_drive_state_name, _resolve_drive_location_name,
)
from .safe_fs import archive_turtle_folder, guarded_rmtree

try:
    from turtles.image_processing import brain
except ImportError:
    from image_processing import brain  # type: ignore

from additional_image_labels import (
    label_query_matches, migrate_labels_to_archive, normalize_additional_type,
    normalize_label_list, read_labels_for_file, set_labels_for_file,
)


class TurtleReviewMixin:
    """Review queue: community upload, approval, rejection, rollback.

    Mixin for TurtleManager.
    """
    def handle_community_upload(self, image_path, finder_name="Anonymous"):
        """Saves an image to Community_Uploads and queues it."""
        dest_folder = os.path.join(self.base_dir, "Community_Uploads", finder_name)
        os.makedirs(dest_folder, exist_ok=True)

        filename = os.path.basename(image_path)
        saved_path = os.path.join(dest_folder, filename)
        shutil.copy2(image_path, saved_path)
        print(f"Saved community find by {finder_name}")

        self.create_review_packet(saved_path, user_info={"finder": finder_name})

    # MERGE FIX: Uses your AI candidate generation, but adds partner's 'additional_images' folder.
    def create_review_packet(self, image_path, user_info=None, req_id=None):
        """Creates a pending packet in Review Queue, generates candidates, preps extra dirs.

        photo_type in user_info controls which VRAM cache to search:
        - 'plastron' (default) or 'carapace' runs matching immediately.
        - 'unclassified' skips matching — admin must classify first via the review queue.
        """
        safe_name = os.path.basename(image_path).replace(" ", "_")
        if req_id is None:
            req_id = f"Req_{int(time.time() * 1000)}_{safe_name}_{uuid.uuid4().hex[:6]}"
        packet_dir = os.path.join(self.review_queue_dir, req_id)
        candidates_dir = os.path.join(packet_dir, 'candidate_matches')

        try:
            os.makedirs(packet_dir, exist_ok=True)

            # 1. Copy the raw uploaded image into the packet
            shutil.copy2(image_path, packet_dir)

            # 2. Determine photo_type from user_info
            meta = user_info if user_info else {}
            photo_type = meta.get('photo_type', 'plastron')

            # 3. Run the AI Search to find candidates (skip if unclassified)
            results = []
            if photo_type != 'unclassified':
                print(f"🔍 Generating candidates for Review Packet: {req_id} ({photo_type})...")
                results, _ = self.search_for_matches(image_path, photo_type=photo_type)
            else:
                print(f"⏳ Review Packet {req_id}: photo_type unclassified — skipping matching until admin classifies.")

            # 4. Create candidate directory and populate it
            os.makedirs(candidates_dir, exist_ok=True)

            for rank, match in enumerate(results, start=1):
                turtle_id = match.get('site_id', 'Unknown')
                score = int(match.get('score', 0))
                pt_path = match.get('file_path', '')

                # Resolve original image — case-insensitive so .JPG works on Linux
                ref_img_path = _find_image_next_to_pt(pt_path)

                if ref_img_path:
                    ext = os.path.splitext(ref_img_path)[1]
                    conf_int = int(round(match.get('confidence', 0.0) * 100))
                    cand_filename = f"Rank{rank}_ID{turtle_id}_Conf{conf_int}{ext}"
                    shutil.copy2(ref_img_path, os.path.join(candidates_dir, cand_filename))

            # 5. Dump metadata for the frontend (includes photo_type)
            if 'photo_type' not in meta:
                meta['photo_type'] = photo_type
            with open(os.path.join(packet_dir, 'metadata.json'), 'w') as f:
                json.dump(meta, f)

            # 5. Create additional_images dir (Partner's Dashboard Support)
            additional_dir = os.path.join(packet_dir, 'additional_images')
            os.makedirs(additional_dir, exist_ok=True)

            print(f"📦 Review Packet {req_id} created with {len(results)} candidates.")
            return req_id
        except Exception as e:
            # Background uploads swallow exceptions; without this marker, the API treats
            # a missing candidate_matches dir as "still matching" forever.
            if os.path.isdir(packet_dir) and not os.path.isdir(candidates_dir):
                fail_path = os.path.join(packet_dir, 'match_search_failed.json')
                try:
                    with open(fail_path, 'w', encoding='utf-8') as f:
                        json.dump({'error': str(e)}, f)
                except OSError:
                    pass
            raise

    def get_review_queue(self):
        """Scans the 'Review_Queue' folder and returns the list of pending requests."""
        queue_items = []
        if os.path.exists(self.review_queue_dir):
            for req_id in os.listdir(self.review_queue_dir):
                req_path = os.path.join(self.review_queue_dir, req_id)
                if os.path.isdir(req_path):
                    queue_items.append({'request_id': req_id, 'path': req_path, 'status': 'pending'})
        return queue_items

    def approve_review_packet(self, request_id, match_turtle_id=None, replace_reference=False,
                              new_location=None, new_turtle_id=None, uploaded_image_path=None,
                              find_metadata=None, is_community_upload=False,
                              match_from_community=False, community_sheet_name=None,
                              new_admin_location=None, photo_type="plastron",
                              delete_packet=True, replace_carapace_reference=False):
        """
        Processes approval of a review-queue packet.
        - replace_reference=True: Stages and upgrades the SuperPoint .pt master image safely.
        - replace_carapace_reference=True: Replace carapace reference using the FIRST carapace additional image.
        - is_community_upload: New turtle files go under data/Community_Uploads/<sheet_name>.
        - match_from_community: Matched turtle is in Community_Uploads; move folder to new_admin_location.
        - Merges date-stamped additional_images and updates find_metadata.json.
        - delete_packet=False: leaves the packet in the queue (caller handles deletion after Sheets sync).
        """
        with self._approval_lock:
            return self._approve_review_packet_locked(
                request_id, match_turtle_id=match_turtle_id,
                replace_reference=replace_reference, new_location=new_location,
                new_turtle_id=new_turtle_id, uploaded_image_path=uploaded_image_path,
                find_metadata=find_metadata, is_community_upload=is_community_upload,
                match_from_community=match_from_community,
                community_sheet_name=community_sheet_name,
                new_admin_location=new_admin_location, photo_type=photo_type,
                delete_packet=delete_packet,
                replace_carapace_reference=replace_carapace_reference,
            )

    def _approve_review_packet_locked(self, request_id, match_turtle_id=None, replace_reference=False,
                              new_location=None, new_turtle_id=None, uploaded_image_path=None,
                              find_metadata=None, is_community_upload=False,
                              match_from_community=False, community_sheet_name=None,
                              replace_carapace_reference=False,
                              new_admin_location=None, photo_type="plastron",
                              delete_packet=True):
        query_image = None
        packet_dir = self._resolve_packet_dir(request_id)

        # Early check: if packet was already processed by another admin, fail fast
        if packet_dir and not os.path.exists(packet_dir):
            if not (uploaded_image_path and os.path.exists(uploaded_image_path)):
                return False, "This item has already been processed by another admin"

        if packet_dir and os.path.exists(packet_dir):
            for f in os.listdir(packet_dir):
                if f.lower().endswith(('.jpg', '.png', '.jpeg')) and f != 'metadata.json':
                    query_image = os.path.join(packet_dir, f)
                    break
        elif uploaded_image_path and os.path.exists(uploaded_image_path):
            query_image = uploaded_image_path
        else:
            return False, "Request not found and no image path provided"

        if not query_image or not os.path.exists(query_image):
            return False, "Error: No image found."

        # Scenario A: Adding to an existing turtle
        if match_turtle_id:
            target_dir = self._get_turtle_folder(match_turtle_id)
            if not target_dir:
                return False, f"Could not find folder for {match_turtle_id}"

            # Reference files are named after the FOLDER BASENAME, not the
            # match_turtle_id from the URL. See replace_turtle_reference for
            # the full rationale: a caller passing the bare bio_id (``F004``)
            # against a combined-name folder (``F004_T1771234567``) would
            # otherwise create a parallel ``F004.jpg/.pt`` pair instead of
            # replacing the existing reference.
            ref_stem = os.path.basename(target_dir)

            if photo_type == "carapace":
                ref_dir = os.path.join(target_dir, 'carapace')
                loose_dir = os.path.join(target_dir, 'carapace', 'Other Carapaces')
                archive_dir = os.path.join(target_dir, 'carapace', 'Old References')
            else:
                # Prefer new 'plastron/' layout; fall back to legacy 'ref_data/' for old turtles
                plastron_dir = os.path.join(target_dir, 'plastron')
                ref_data_dir = os.path.join(target_dir, 'ref_data')
                if os.path.isdir(plastron_dir):
                    ref_dir = plastron_dir
                elif os.path.isdir(ref_data_dir):
                    ref_dir = ref_data_dir
                else:
                    ref_dir = plastron_dir
                loose_dir = os.path.join(target_dir, 'plastron', 'Other Plastrons')
                archive_dir = os.path.join(target_dir, 'plastron', 'Old References')
            os.makedirs(ref_dir, exist_ok=True)
            os.makedirs(loose_dir, exist_ok=True)
            os.makedirs(archive_dir, exist_ok=True)

            if replace_reference:
                print(f"✨ UPGRADING REFERENCE for {match_turtle_id}...")
                old_pt_path = os.path.join(ref_dir, f"{ref_stem}.pt")
                # Case-insensitive lookup so .JPG old references are found on Linux
                old_img_path = _find_image_in_dir(ref_dir, ref_stem)

                op_ts = int(time.time() * 1000)
                new_ext = os.path.splitext(query_image)[1]
                staged_master_path = os.path.join(ref_dir, f"{ref_stem}_staged_{op_ts}{new_ext}")
                staged_pt_path = os.path.join(ref_dir, f"{ref_stem}_staged_{op_ts}.pt")

                # Extract features first; only replace old master if staging succeeds.
                shutil.copy2(query_image, staged_master_path)
                try:
                    staged_ok = brain.process_and_save(staged_master_path, staged_pt_path)
                except Exception as e:
                    print(f"   ⚠️ SuperPoint crashed during reference upgrade for {match_turtle_id}: {e}")
                    staged_ok = False
                if not staged_ok:
                    try:
                        if os.path.exists(staged_master_path):
                            os.remove(staged_master_path)
                        if os.path.exists(staged_pt_path):
                            os.remove(staged_pt_path)
                    except OSError:
                        pass
                    return False, f"Failed to extract features for replacement image of {match_turtle_id}"

                # Atomic replacement: promote new files FIRST, then clean up old.
                # This way a crash at any point either leaves the old reference intact
                # or the new reference fully in place — never a gap with no .pt file.
                new_master_path = os.path.join(ref_dir, f"{ref_stem}{new_ext}")
                new_pt_path = os.path.join(ref_dir, f"{ref_stem}.pt")

                # Step 1: Archive old image to Old References (copy, not move — original stays until step 3)
                if old_img_path:
                    archive_date = time.strftime('%Y-%m-%d', time.localtime())
                    archive_name = f"Archived_Master_{op_ts}_{archive_date}{os.path.splitext(old_img_path)[1]}"
                    shutil.copy2(old_img_path, os.path.join(archive_dir, archive_name))
                    # Migrate tags so they follow the photo into Old References
                    # instead of silently sticking to the new reference written
                    # at the same path.
                    migrate_labels_to_archive(
                        ref_dir, os.path.basename(old_img_path),
                        archive_dir, archive_name,
                    )
                    print(f"   📦 Archived old master to {archive_name}")

                # Step 2: Promote staged files to canonical names (overwrites old .pt and image atomically)
                if os.path.exists(new_master_path):
                    os.remove(new_master_path)
                shutil.move(staged_master_path, new_master_path)
                shutil.move(staged_pt_path, new_pt_path)
                # Mark the promoted master as uploaded NOW so the scratchpad's
                # mtime fallback in _extract_upload_date_from_filename returns
                # today. Without this, copy2 preserves the source mtime and
                # the new reference never shows up in today's scratchpad.
                try:
                    os.utime(new_master_path, None)
                except OSError:
                    pass
                # At this point the new reference is live — crash here is safe.

                # Step 3: Clean up old image if it was a different extension.
                # Uses os.path.samefile so a case-only difference between the
                # lookup-loop's lowercase ext and the user's actual ext on a
                # case-insensitive filesystem doesn't make us delete the file
                # we just placed.
                if old_img_path and os.path.exists(old_img_path):
                    try:
                        same_file = (os.path.exists(new_master_path)
                                     and os.path.samefile(old_img_path, new_master_path))
                    except OSError:
                        same_file = False
                    if not same_file:
                        try:
                            os.remove(old_img_path)
                        except OSError:
                            pass

                obs_date = time.strftime('%Y-%m-%d', time.localtime())
                obs_name = f"Obs_{int(time.time())}_{obs_date}_{os.path.basename(query_image)}"
                shutil.copy2(query_image, os.path.join(loose_dir, obs_name))

                # Incremental cache update: remove old entry and add updated
                # one. Use ref_stem (folder basename) as the cached site_id so
                # the incremental insert matches what refresh_database_index
                # would produce on a full reload.
                self._evict_from_vram(old_pt_path, photo_type)
                rel_path = os.path.relpath(ref_dir, self.base_dir)
                loc_parts = rel_path.split(os.sep)[:-2]
                location_name = "/".join(loc_parts)
                brain.add_single_to_vram(new_pt_path, ref_stem, location_name, photo_type=photo_type)
                # Defensive orphan sweep so any stray non-canonical reference
                # gets archived to Old References/.
                self._purge_orphan_refs_in_ref_dir(ref_dir, ref_stem)
                print(f"   ✅ {match_turtle_id} upgraded successfully.")

            else:
                print(f"📸 Adding observation to {match_turtle_id}...")
                obs_date = time.strftime('%Y-%m-%d', time.localtime())
                obs_name = f"Obs_{int(time.time())}_{obs_date}_{os.path.basename(query_image)}"
                shutil.copy2(query_image, os.path.join(loose_dir, obs_name))

        # Scenario B: Creating a new turtle
        elif new_location and new_turtle_id:
            print(f"🐢 Creating new turtle {new_turtle_id} at {new_location}...")
            parts = [p.strip() for p in new_location.split('/') if p.strip()]
            if not is_community_upload:
                parts = _expand_flat_drive_folder_prefix(parts)
            sheet_name = parts[0] if parts else new_location
            if is_community_upload:
                location_dir = os.path.join(self.base_dir, 'Community_Uploads', sheet_name)
            elif len(parts) >= 2:
                location_dir = os.path.join(self.base_dir, parts[0], parts[1])
            else:
                location_dir = os.path.join(self.base_dir, sheet_name)
            os.makedirs(location_dir, exist_ok=True)

            status = self._process_single_turtle(query_image, location_dir, new_turtle_id, photo_type=photo_type)

            if status == 'created':
                print(f"✅ New turtle {new_turtle_id} created successfully at {new_location}")
                # Incremental cache update: add new turtle without full rebuild
                subdir = 'carapace' if photo_type == 'carapace' else 'plastron'
                pt_path = os.path.join(location_dir, new_turtle_id, subdir, f"{new_turtle_id}.pt")
                rel_path = os.path.relpath(location_dir, self.base_dir)
                location_name = rel_path.replace(os.sep, "/")
                brain.add_single_to_vram(pt_path, new_turtle_id, location_name, photo_type=photo_type)
                print("✅ Search index updated.")
            elif status == 'skipped':
                return False, f"Turtle {new_turtle_id} already exists at {new_location}"
            else:
                return False, f"Failed to process image for new turtle {new_turtle_id}"
        else:
            return False, "Either match_turtle_id or both new_location and new_turtle_id must be provided"

        # Post-processing: find metadata, merge additional_images, community move
        target_turtle_id = match_turtle_id if match_turtle_id else new_turtle_id
        if new_location:
            first = (new_location or '').split('/')[0].strip()
            location_hint = f"Community_Uploads/{first}" if is_community_upload else first
        elif match_from_community and community_sheet_name:
            location_hint = f"Community_Uploads/{community_sheet_name}"
        else:
            location_hint = None
        target_dir = self._get_turtle_folder(target_turtle_id, location_hint)

        if target_dir:
            # All reference files inside target_dir use the FOLDER basename as
            # their stem (refresh_database_index derives turtle_id from
            # path_parts[-2]). Using target_turtle_id directly fails when the
            # folder is in canonical combined form (F004_T1771234567) but the
            # caller passed bare bio_id (F004) — produces parallel pairs.
            target_ref_stem = os.path.basename(target_dir)
            # Carry flag / find data forward from the packet's metadata.json
            # whenever the caller didn't supply find_metadata explicitly.
            # Without this fallback the frontend's standard approve calls
            # (which don't include find_metadata in the body) silently drop
            # the digital_flag / physical_flag / collected_to_lab values the
            # user entered at upload time, and the Release page stays empty.
            if not (isinstance(find_metadata, dict) and find_metadata):
                find_metadata = self._extract_find_metadata_from_packet(packet_dir)
            if isinstance(find_metadata, dict) and find_metadata:
                meta_path = os.path.join(target_dir, 'find_metadata.json')
                with open(meta_path, 'w') as f:
                    json.dump(find_metadata, f)

            # Merge additional_images from packet into turtle's additional_images folder by date
            if os.path.isdir(packet_dir):
                src_additional = os.path.join(packet_dir, 'additional_images')
                dest_additional = os.path.join(target_dir, 'additional_images')

                if os.path.isdir(src_additional):
                    os.makedirs(dest_additional, exist_ok=True)
                    for date_folder in os.listdir(src_additional):
                        src_date_dir = os.path.join(src_additional, date_folder)
                        if not os.path.isdir(src_date_dir):
                            continue
                        dest_date_dir = os.path.join(dest_additional, date_folder)
                        os.makedirs(dest_date_dir, exist_ok=True)

                        src_manifest_path = os.path.join(src_date_dir, 'manifest.json')
                        dest_manifest_path = os.path.join(dest_date_dir, 'manifest.json')

                        existing_manifest = []
                        if os.path.isfile(dest_manifest_path):
                            try:
                                with open(dest_manifest_path, 'r') as f:
                                    existing_manifest = json.load(f)
                            except (json.JSONDecodeError, OSError):
                                pass
                        existing_filenames = {e.get('filename') for e in existing_manifest if e.get('filename')}

                        if os.path.isfile(src_manifest_path):
                            try:
                                with open(src_manifest_path, 'r') as f:
                                    packet_manifest = json.load(f)
                            except (json.JSONDecodeError, OSError):
                                packet_manifest = []
                            for entry in packet_manifest:
                                fn = entry.get('filename')
                                if not fn or not os.path.isfile(os.path.join(src_date_dir, fn)):
                                    continue
                                # Skip carapace/plastron — they go to carapace/ or plastron/ folders, not additional_images/
                                if entry.get('type', '') in ('carapace', 'plastron'):
                                    continue
                                shutil.copy2(os.path.join(src_date_dir, fn), os.path.join(dest_date_dir, fn))
                                if fn not in existing_filenames:
                                    existing_manifest.append(entry)
                                    existing_filenames.add(fn)
                            with open(dest_manifest_path, 'w') as f:
                                json.dump(existing_manifest, f, indent=4)

            # Process plastron/carapace additional images: create references or route
            # to Other Plastrons / Other Carapaces folders.
            # First carapace image becomes the reference (or replaces it); extras go to Other Carapaces.
            # Same logic for plastron images.
            _ref_type_to_dir = {'plastron': 'plastron', 'carapace': 'carapace'}
            _other_dir = {'plastron': 'plastron/Other Plastrons', 'carapace': 'carapace/Other Carapaces'}
            _carapace_ref_handled = False  # Only the FIRST carapace can become/replace a reference
            if os.path.isdir(packet_dir):
                src_additional = os.path.join(packet_dir, 'additional_images')
                if os.path.isdir(src_additional):
                    for date_folder in sorted(os.listdir(src_additional)):
                        src_date_dir = os.path.join(src_additional, date_folder)
                        if not os.path.isdir(src_date_dir):
                            continue
                        manifest_path = os.path.join(src_date_dir, 'manifest.json')
                        if not os.path.isfile(manifest_path):
                            continue
                        try:
                            with open(manifest_path, 'r') as f:
                                manifest = json.load(f)
                        except (json.JSONDecodeError, OSError):
                            continue
                        for entry in manifest:
                            img_type = entry.get('type', '')
                            if img_type not in _ref_type_to_dir:
                                continue
                            fn = entry.get('filename')
                            if not fn:
                                continue
                            src_img = os.path.join(src_date_dir, fn)
                            if not os.path.isfile(src_img):
                                continue

                            dest_subdir = os.path.join(target_dir, _ref_type_to_dir[img_type])
                            os.makedirs(dest_subdir, exist_ok=True)
                            ext = os.path.splitext(fn)[1] or '.jpg'
                            dest_img = os.path.join(dest_subdir, f"{target_ref_stem}{ext}")
                            dest_pt = os.path.join(dest_subdir, f"{target_ref_stem}.pt")
                            # Also check legacy ref_data/ for existing plastron references
                            has_ref = os.path.exists(dest_pt)
                            if not has_ref and img_type == 'plastron':
                                has_ref = os.path.exists(os.path.join(target_dir, 'ref_data', f"{target_ref_stem}.pt"))

                            # Decide: create reference, replace reference, or route to Other folder
                            should_replace_carapace = (img_type == 'carapace' and replace_carapace_reference
                                                       and not _carapace_ref_handled)
                            is_first_carapace = (img_type == 'carapace' and not _carapace_ref_handled)

                            if should_replace_carapace and has_ref:
                                # Atomic carapace reference replacement (same pattern as plastron)
                                _carapace_ref_handled = True
                                print(f"✨ UPGRADING CARAPACE REFERENCE for {target_turtle_id}...")
                                archive_dir = os.path.join(target_dir, 'carapace', 'Old References')
                                os.makedirs(archive_dir, exist_ok=True)
                                op_ts = int(time.time() * 1000)
                                old_pt_path = dest_pt
                                # Case-insensitive: existing carapace ref may be .JPG on Linux.
                                old_img_path = _find_image_in_dir(dest_subdir, target_ref_stem)
                                staged_master = os.path.join(dest_subdir, f"{target_ref_stem}_staged_{op_ts}{ext}")
                                staged_pt = os.path.join(dest_subdir, f"{target_ref_stem}_staged_{op_ts}.pt")
                                shutil.copy2(src_img, staged_master)
                                try:
                                    staged_ok = brain.process_and_save(staged_master, staged_pt)
                                except Exception as e:
                                    print(f"   ⚠️ SuperPoint crashed during carapace upgrade for {target_turtle_id}: {e}")
                                    staged_ok = False
                                if not staged_ok:
                                    for p in [staged_master, staged_pt]:
                                        try:
                                            if os.path.exists(p): os.remove(p)
                                        except OSError: pass
                                    print(f"   ⚠️ Carapace reference upgrade failed for {target_turtle_id}")
                                    continue
                                if old_img_path:
                                    archive_date = time.strftime('%Y-%m-%d', time.localtime())
                                    archive_name = f"Archived_Carapace_{op_ts}_{archive_date}{os.path.splitext(old_img_path)[1]}"
                                    shutil.copy2(old_img_path, os.path.join(archive_dir, archive_name))
                                    # Tags follow the archived photo; clear from source so
                                    # the NEW carapace reference (lands at same path) is clean.
                                    migrate_labels_to_archive(
                                        dest_subdir, os.path.basename(old_img_path),
                                        archive_dir, archive_name,
                                    )
                                if os.path.exists(dest_img): os.remove(dest_img)
                                shutil.move(staged_master, dest_img)
                                shutil.move(staged_pt, dest_pt)
                                if old_img_path and os.path.exists(old_img_path) and old_img_path != dest_img:
                                    try: os.remove(old_img_path)
                                    except OSError: pass
                                self._evict_from_vram(old_pt_path, 'carapace')
                                rel = os.path.relpath(target_dir, self.base_dir)
                                loc = os.path.dirname(rel).replace(os.sep, "/")
                                brain.add_single_to_vram(dest_pt, target_ref_stem, loc, photo_type='carapace')
                                self._purge_orphan_refs_in_ref_dir(dest_subdir, target_ref_stem)
                                print(f"   ✅ Carapace reference upgraded for {target_turtle_id}")

                            elif not has_ref and (img_type == 'plastron' or is_first_carapace):
                                # No reference exists yet — create one
                                if img_type == 'carapace':
                                    _carapace_ref_handled = True
                                shutil.copy2(src_img, dest_img)
                                if brain.process_and_save(dest_img, dest_pt):
                                    rel = os.path.relpath(target_dir, self.base_dir)
                                    loc = os.path.dirname(rel).replace(os.sep, "/")
                                    brain.add_single_to_vram(dest_pt, target_ref_stem, loc, photo_type=img_type)
                                    self._purge_orphan_refs_in_ref_dir(dest_subdir, target_ref_stem)
                                    print(f"   ✅ {img_type.capitalize()} reference created for {target_turtle_id}")
                                else:
                                    print(f"   ⚠️ {img_type.capitalize()} SuperPoint extraction failed for {target_turtle_id}")

                            else:
                                # Reference already exists and not replacing — route to Other folder
                                if img_type == 'carapace':
                                    _carapace_ref_handled = True
                                other_dir = os.path.join(target_dir, _other_dir[img_type])
                                os.makedirs(other_dir, exist_ok=True)
                                ts = int(time.time() * 1000)
                                other_name = f"{img_type}_{ts}{ext}"
                                shutil.copy2(src_img, os.path.join(other_dir, other_name))
                                print(f"   📸 {img_type.capitalize()} saved to {_other_dir[img_type]}: {other_name}")

            # Move turtle folder from Community_Uploads to admin location
            if match_from_community and new_admin_location and match_turtle_id and target_dir and os.path.isdir(target_dir):
                parts = [p.strip() for p in new_admin_location.split('/') if p.strip()]
                if parts:
                    dest_dir = os.path.join(self.base_dir, *parts, match_turtle_id)
                    if not os.path.exists(dest_dir):
                        try:
                            os.makedirs(os.path.dirname(dest_dir), exist_ok=True)
                            shutil.move(target_dir, dest_dir)
                            print(f"📁 Moved turtle from Community_Uploads to {new_admin_location}")
                            print("♻️  Rebuilding search index...")
                            self.refresh_database_index()
                            print("✅ Search index updated.")
                        except Exception as move_err:
                            print(f"⚠️ Failed to move turtle folder: {move_err}")
                    else:
                        print(f"⚠️ Destination {dest_dir} already exists; turtle left in place.")

        if delete_packet:
            self._delete_packet(packet_dir, query_image, request_id)

        return True, "Processed successfully"

    def _delete_packet(self, packet_dir, query_image=None, request_id=None):
        """Remove a processed packet directory or temp file."""
        if packet_dir and os.path.exists(packet_dir):
            try:
                # Review_Queue packets carry no turtle folder, so the guard passes;
                # routing through it fails closed if a path bug ever aimed here.
                guarded_rmtree(packet_dir, self.base_dir)
                print(f"🗑️ Queue Item {request_id or 'unknown'} deleted (Processed).")
            except Exception as e:
                print(f"⚠️ Error deleting packet: {e}")
        elif query_image:
            import tempfile
            temp_dir = tempfile.gettempdir()
            if query_image.startswith(temp_dir):
                try:
                    os.remove(query_image)
                    print(f"🗑️ Temp file deleted: {os.path.basename(query_image)}")
                except Exception as e:
                    print(f"⚠️ Error deleting temp file: {e}")

    def rollback_new_turtle(self, turtle_id, location, photo_type="plastron"):
        """Roll back a new turtle creation — archives the folder and evicts it from VRAM.

        The folder is *archived* (moved under ``_Archive/``), never destroyed: a
        transient Sheets outage must not permanently delete a freshly-created —
        possibly already-populated — turtle folder. A pre-existing-folder guard
        ensures we only ever touch a folder this approval created: the target must
        resolve safely under ``base_dir`` and its basename must match
        ``turtle_id``. (A populated pre-existing turtle cannot reach here anyway —
        ``_process_single_turtle`` returns ``'skipped'`` when a reference already
        exists, so the approval aborts before the Sheets sync that triggers this
        rollback.)
        """
        parts = [p.strip() for p in location.split('/') if p.strip()]
        if len(parts) >= 2:
            turtle_dir = _resolved_path_under_base(self.base_dir, parts[0], parts[1], turtle_id)
        elif parts:
            turtle_dir = _resolved_path_under_base(self.base_dir, parts[0], turtle_id)
        else:
            turtle_dir = None

        if (turtle_dir and os.path.isdir(turtle_dir)
                and _basename_matches_turtle_id(os.path.basename(turtle_dir), turtle_id)):
            try:
                archived_to = archive_turtle_folder(turtle_dir, self.base_dir)
                print(f"🔙 Rolled back new turtle → archived to {archived_to}")
            except (OSError, shutil.Error) as e:
                print(f"⚠️ Failed to roll back turtle folder: {e}")
        elif turtle_dir and os.path.exists(turtle_dir):
            print(f"⚠️ Rollback skipped: {turtle_dir} is not a folder this approval created")

        # Evict from VRAM cache (check both new 'plastron' and legacy 'ref_data' paths)
        subdirs_to_check = ['carapace'] if photo_type == 'carapace' else ['plastron', 'ref_data']
        pt_path_fragments = [os.path.join(turtle_id, sd, f"{turtle_id}.pt") for sd in subdirs_to_check]
        for cache_attr, ptype in (('vram_cache_plastron', 'plastron'),
                                  ('vram_cache_carapace', 'carapace')):
            removed = brain.filter_vram_cache(
                lambda c: not any(c['file_path'].endswith(frag) for frag in pt_path_fragments),
                photo_type=ptype,
            )
            if removed:
                print(f"🔙 Evicted {turtle_id} from {cache_attr}")

    def reject_review_packet(self, request_id):
        """Delete a review queue packet without processing (e.g. junk/spam)."""
        with self._approval_lock:
            packet_dir = self._resolve_packet_dir(request_id)
            if not packet_dir or not os.path.exists(packet_dir) or not os.path.isdir(packet_dir):
                return False, "Request not found"
            try:
                guarded_rmtree(packet_dir, self.base_dir)
                print(f"🗑️ Queue Item {request_id} deleted (Rejected/Discarded).")
                return True, "Deleted"
            except Exception as e:
                return False, str(e)

    def _resolve_packet_dir(self, request_id):
        """Safely resolve a review-queue packet directory, preventing path traversal."""
        packet_dir = os.path.realpath(os.path.join(self.review_queue_dir, request_id))
        real_queue = os.path.realpath(self.review_queue_dir)
        try:
            if os.path.commonpath([packet_dir, real_queue]) != real_queue:
                return None
        except ValueError:
            return None
        return packet_dir

    # --- PARTNER'S HELPER AND TRACKING FUNCTIONS (KEPT 100%) ---
