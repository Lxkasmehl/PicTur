import threading

import torch
from lightglue import LightGlue, SuperPoint, utils
import cv2
import numpy as np
import logging
import os

# --- ADD THIS LINE TO ENABLE TF32 CORES ---
torch.set_float32_matmul_precision('high')

# --- LOGGING SETUP ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TurtleBrain")


class TurtleDeepMatcher:
    def __init__(self):
        # 1. Hardware Check & Device Routing
        self.device_str = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(self.device_str)
        self.use_amp = (self.device_str == "cuda")

        if self.device_str == "cuda":
            logger.info(f"✅ GPU DETECTED: {torch.cuda.get_device_name(0)}")
        else:
            cuda_build = getattr(torch.version, "cuda", None)
            logger.warning(
                "⚠️ GPU NOT DETECTED. Running in CPU slow mode. "
                "torch=%s torch.version.cuda=%r (if None, image has CPU-only PyTorch; "
                "if set but still CPU, check nvidia-container-toolkit / docker --gpus; "
                "do not set CUDA_VISIBLE_DEVICES=all — use unset or e.g. 0).",
                torch.__version__,
                cuda_build,
            )

        # 2. SuperPoint: Tunable Detection Parameters
        self.extractor = SuperPoint(max_num_keypoints=4096, nms_radius=3).eval().to(self.device)

        # 3. LightGlue: Tunable Match Confidences
        self.matcher = LightGlue(features='superpoint', depth_confidence=0.9, width_confidence=0.95).eval().to(
            self.device)

        # PyTorch 2.x Optimization: Compile ONLY the CNN
        if hasattr(torch, 'compile'):
            logger.info("⚡ Compiling SuperPoint CNN for optimized inference...")
            self.extractor = torch.compile(self.extractor, dynamic=True)

        self.feature_cache = {}
        self.vram_cache_plastron = []
        self.vram_cache_carapace = []
        # Serializes all GPU operations — prevents crashes from concurrent
        # community upload threads hitting CUDA simultaneously.
        self._gpu_lock = threading.Lock()

    def set_device(self, device_mode):
        """Switches device dynamically based on GUI selection."""
        with self._gpu_lock:
            return self._set_device_unlocked(device_mode)

    def _set_device_unlocked(self, device_mode):
        self.device_str = "cuda" if device_mode == "GPU" and torch.cuda.is_available() else "cpu"
        self.device = torch.device(self.device_str)
        self.use_amp = (self.device_str == "cuda")

        self.extractor = self.extractor.to(self.device)
        self.matcher = self.matcher.to(self.device)

        # Migrate both caches to the new hardware
        total_migrated = 0
        for cache in (self.vram_cache_plastron, self.vram_cache_carapace):
            for cand in cache:
                cand['feats'] = {k: v.to(self.device) for k, v in cand['feats'].items()}
            total_migrated += len(cache)
        if total_migrated:
            logger.info(f"🔄 Migrated {total_migrated} cached tensors to {self.device_str.upper()}.")

        logger.info(f"🔄 Switched compute device to: {self.device_str.upper()}")

    def set_feature_cache(self, cache_dict):
        self.feature_cache = cache_dict
        logger.info(f"🧠 Brain: Feature cache synchronized ({len(cache_dict)} items).")

    # --- VRAM CACHE METHODS ---
    def load_database_to_vram(self, db_index_list):
        with self._gpu_lock:
            return self._load_database_to_vram_unlocked(db_index_list)

    def _load_database_to_vram_unlocked(self, db_index_list):
        """Pre-loads the entire database into GPU VRAM for instant access.

        Each entry in db_index_list is a tuple of:
          (pt_path, turtle_id, location)              — legacy 3-tuple, defaults to plastron
          (pt_path, turtle_id, location, photo_type)  — 4-tuple with explicit type
        """
        logger.info(f"⚡ Loading {len(db_index_list)} turtles into memory cache ({self.device_str})...")
        self.vram_cache_plastron = []
        self.vram_cache_carapace = []

        for entry in db_index_list:
            if len(entry) == 4:
                db_pt_path, turtle_id, location, photo_type = entry
            else:
                db_pt_path, turtle_id, location = entry
                photo_type = 'plastron'

            if not os.path.exists(db_pt_path):
                continue
            try:
                cand_data = torch.load(db_pt_path, map_location=self.device, weights_only=True)
                cand_feats = {k: v.unsqueeze(0).to(self.device) for k, v in cand_data.items()}

                item = {
                    'site_id': turtle_id,
                    'location': location,
                    'file_path': db_pt_path,
                    'feats': cand_feats
                }
                if photo_type == 'carapace':
                    self.vram_cache_carapace.append(item)
                else:
                    self.vram_cache_plastron.append(item)
            except Exception as e:
                logger.error(f"Failed to cache {turtle_id}: {e}")

        total = len(self.vram_cache_plastron) + len(self.vram_cache_carapace)
        logger.info(f"✅ Cached {total} turtles ({len(self.vram_cache_plastron)} plastron, {len(self.vram_cache_carapace)} carapace).")

    def preprocess_image_robust(self, img):
        h, w = img.shape
        max_dim = 1200
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        return clahe.apply(img)

    def process_and_save(self, image_path, output_pt_path):
        with self._gpu_lock:
            return self._process_and_save_unlocked(image_path, output_pt_path)

    def _process_and_save_unlocked(self, image_path, output_pt_path):
        try:
            img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
            if img is None: return False

            img = self.preprocess_image_robust(img)
            tensor_img = utils.numpy_image_to_torch(img).to(self.device)

            with torch.inference_mode(), torch.autocast(device_type=self.device.type, dtype=torch.float16,
                                                        enabled=self.use_amp):
                feats = self.extractor.extract(tensor_img)

            feats_cpu = {k: v[0].cpu() for k, v in feats.items()}
            torch.save(feats_cpu, output_pt_path)
            return True
        except Exception as e:
            logger.error(f"❌ Extraction failed: {e}")
            return False

    def match_query_robust(self, query_path, db_index_list):
        """Standard disk-based search (kept as fallback)."""
        with self._gpu_lock:
            return self._match_query_robust_unlocked(query_path, db_index_list)

    def _match_query_robust_unlocked(self, query_path, db_index_list):
        img_raw = cv2.imread(query_path, cv2.IMREAD_GRAYSCALE)
        if img_raw is None: return []

        img_base = self.preprocess_image_robust(img_raw)

        rotations = [
            img_base,
            cv2.rotate(img_base, cv2.ROTATE_90_CLOCKWISE),
            cv2.rotate(img_base, cv2.ROTATE_180),
            cv2.rotate(img_base, cv2.ROTATE_90_COUNTERCLOCKWISE)
        ]

        query_feats_list = []
        with torch.inference_mode(), torch.autocast(device_type=self.device.type, dtype=torch.float16,
                                                    enabled=self.use_amp):
            for rot_img in rotations:
                t_img = utils.numpy_image_to_torch(rot_img).to(self.device)
                query_feats_list.append(self.extractor.extract(t_img))

        results = []

        for db_pt_path, turtle_id, location in db_index_list:
            if not os.path.exists(db_pt_path): continue
            try:
                cand_data = torch.load(db_pt_path, map_location=self.device, weights_only=True)
                cand_feats = {k: v.unsqueeze(0).to(self.device) for k, v in cand_data.items()}

                best_score_for_turtle = 0
                best_conf_for_turtle = 0

                for q_feats in query_feats_list:
                    score, match_count = self._run_glue(q_feats, cand_feats)
                    if match_count > best_score_for_turtle:
                        best_score_for_turtle = match_count
                        best_conf_for_turtle = score

                if best_score_for_turtle > 15:
                    results.append({
                        'site_id': turtle_id,
                        'location': location,
                        'file_path': db_pt_path,
                        'score': best_score_for_turtle,
                        'confidence': best_conf_for_turtle
                    })
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        if self.device_str == "cuda":
            torch.cuda.empty_cache()
        return results

    def extract_query_features(self, query_path):
        """Extract SuperPoint features for 4 rotations of a query image.
        Returns list of 4 feature dicts, or None if image can't be read."""
        with self._gpu_lock:
            return self._extract_query_features_unlocked(query_path)

    def _extract_query_features_unlocked(self, query_path):
        img_raw = cv2.imread(query_path, cv2.IMREAD_GRAYSCALE)
        if img_raw is None:
            return None

        img_base = self.preprocess_image_robust(img_raw)
        rotations = [
            img_base,
            cv2.rotate(img_base, cv2.ROTATE_90_CLOCKWISE),
            cv2.rotate(img_base, cv2.ROTATE_180),
            cv2.rotate(img_base, cv2.ROTATE_90_COUNTERCLOCKWISE)
        ]

        query_feats_list = []
        with torch.inference_mode(), torch.autocast(
            device_type=self.device.type, dtype=torch.float16, enabled=self.use_amp
        ):
            for rot_img in rotations:
                t_img = utils.numpy_image_to_torch(rot_img).to(self.device)
                query_feats_list.append(self.extractor.extract(t_img))

        return query_feats_list

    def match_against_cache(self, query_feats_list, location_filter="All Locations", photo_type="plastron"):
        """Run LightGlue matching of pre-extracted query features against the VRAM cache.

        Args:
            photo_type: 'plastron' (default) or 'carapace' — selects which cache to search.
        """
        with self._gpu_lock:
            return self._match_against_cache_unlocked(query_feats_list, location_filter, photo_type)

    def _match_against_cache_unlocked(self, query_feats_list, location_filter="All Locations", photo_type="plastron"):
        cache = self.vram_cache_carapace if photo_type == 'carapace' else self.vram_cache_plastron
        if not cache:
            logger.warning(f"⚠️ VRAM cache empty for {photo_type}! Returning no matches.")
            return []

        results = []

        for cand in cache:
            # Apply location filter early to skip unnecessary math.
            # Uses prefix matching so a state like "Kansas" matches
            # "Kansas/Lawrence", "Kansas/North Topeka", etc.
            if location_filter and location_filter != "All Locations":
                allowed = list(location_filter) if isinstance(location_filter, list) else [location_filter]
                if not any(cand['location'] == a or cand['location'].startswith(a + '/') for a in allowed):
                    continue

            cand_feats_safe = {k: v.to(self.device) for k, v in cand['feats'].items()}

            best_score = 0
            best_conf = 0

            for q_feats in query_feats_list:
                score, match_count = self._run_glue(q_feats, cand_feats_safe)
                if match_count > best_score:
                    best_score = match_count
                    best_conf = score

            if best_score > 15:
                results.append({
                    'site_id': cand['site_id'],
                    'location': cand['location'],
                    'file_path': cand['file_path'],
                    'score': best_score,
                    'confidence': best_conf
                })

        results.sort(key=lambda x: x['score'], reverse=True)
        if self.device_str == "cuda":
            torch.cuda.empty_cache()
        return results

    def add_single_to_vram(self, pt_path, turtle_id, location, photo_type="plastron"):
        """Incrementally add one turtle to the VRAM cache without full reload."""
        with self._gpu_lock:
            return self._add_single_to_vram_unlocked(pt_path, turtle_id, location, photo_type)

    def _add_single_to_vram_unlocked(self, pt_path, turtle_id, location, photo_type="plastron"):
        if not os.path.exists(pt_path):
            logger.warning(f"⚠️ Cannot add to cache — file not found: {pt_path}")
            return False
        try:
            cand_data = torch.load(pt_path, map_location=self.device, weights_only=True)
            cand_feats = {k: v.unsqueeze(0).to(self.device) for k, v in cand_data.items()}
            item = {
                'site_id': turtle_id,
                'location': location,
                'file_path': pt_path,
                'feats': cand_feats
            }
            cache = self.vram_cache_carapace if photo_type == 'carapace' else self.vram_cache_plastron
            cache.append(item)
            logger.info(f"✅ Incrementally cached {turtle_id} ({location}, {photo_type})")
            return True
        except Exception as e:
            logger.error(f"Failed to incrementally cache {turtle_id}: {e}")
            return False

    def match_query_robust_vram(self, query_path, location_filter="All Locations", photo_type="plastron"):
        """Convenience wrapper: extract + match in one call."""
        query_feats = self.extract_query_features(query_path)
        if query_feats is None:
            return []
        return self.match_against_cache(query_feats, location_filter, photo_type=photo_type)

    def _run_glue(self, feats0, feats1):
        with torch.inference_mode(), torch.autocast(device_type=self.device.type, dtype=torch.float16,
                                                    enabled=self.use_amp):
            data = {'image0': feats0, 'image1': feats1}
            pred = self.matcher(data)
            matches = pred['matches0'][0]
            scores = pred['matching_scores0'][0]
            valid = matches > -1
            match_count = int(valid.sum().item())
            avg_conf = float(scores[valid].mean().item()) if match_count > 0 else 0.0
            return avg_conf, match_count


brain = TurtleDeepMatcher()


def load_or_generate_persistent_data(_data_dir):
    """
    Deprecated VLAD/FAISS compatibility shim.
    """
    logger.warning(
        "load_or_generate_persistent_data() is deprecated in SuperPoint mode and should not be used."
    )
    return False


def extract_and_store_features(image_path, output_path):
    """
    Extract and persist SuperPoint features.
    If a legacy .npz path is provided, convert it to the equivalent .pt path.
    """
    pt_path = output_path.replace(".npz", ".pt") if output_path.endswith(".npz") else output_path
    success = brain.process_and_save(image_path, pt_path)
    return success, None