import cv2 as cv
import os
import joblib
import numpy as np
import faiss
import time
from sklearn.cluster import MiniBatchKMeans
'''
# --- OPENCL CONFIGURATION ---
try:
    cv.ocl.setUseOpenCL(True)
    if cv.ocl.useOpenCL():
        print(f"✅ OpenCL Enabled! Using Device: {cv.ocl.Device.getDefault().name()}")
    else:
        print("⚠️ OpenCL not available - using CPU.")
except Exception as e:
    print(f"⚠️ OpenCL Init Error: {e}")
'''

# --- CONFIGURATION ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_VOCAB_PATH = os.path.join(BASE_DIR, 'vlad_vocab.pkl')
DEFAULT_INDEX_PATH = os.path.join(BASE_DIR, 'turtles.index')
DEFAULT_METADATA_PATH = os.path.join(BASE_DIR, 'metadata.pkl')
DEFAULT_VLAD_ARRAY_PATH = os.path.join(BASE_DIR, 'global_vlad_array.npy')

GLOBAL_RESOURCES = {
    'faiss_index': None,
    'vocab': None,
    'metadata': None,
    'vlad_array': None,
}

# --- OPTIMIZED CV PARAMETERS ---
SIFT_NFEATURES = 10000
SIFT_NOCTAVE_LAYERS = 3
SIFT_CONTRAST_THRESHOLD = 0.03
SIFT_EDGE_THRESHOLD = 10
SIFT_SIGMA = 1.6
CLAHE_CLIP_LIMIT = 1.0
CLAHE_TILE_GRID_SIZE = (16, 16)
MAX_IMAGE_DIMENSION = 1200


def get_SIFT():
    return cv.SIFT_create(
        nfeatures=SIFT_NFEATURES,
        nOctaveLayers=SIFT_NOCTAVE_LAYERS,
        contrastThreshold=SIFT_CONTRAST_THRESHOLD,
        edgeThreshold=SIFT_EDGE_THRESHOLD,
        sigma=SIFT_SIGMA)


def get_CLAHE():
    return cv.createCLAHE(clipLimit=CLAHE_CLIP_LIMIT, tileGridSize=CLAHE_TILE_GRID_SIZE)


# --- HELPERS ---

def extract_features_from_image(image_path):
    """Reads, Resizes, CLAHEs, and Extracts SIFT."""
    sift = get_SIFT()
    img = cv.imread(image_path, cv.IMREAD_GRAYSCALE)
    if img is None: return None, None

    h, w = img.shape
    if max(h, w) > MAX_IMAGE_DIMENSION:
        scale = MAX_IMAGE_DIMENSION / max(h, w)
        new_w, new_h = int(w * scale), int(h * scale)
        img = cv.resize(img, (new_w, new_h), interpolation=cv.INTER_AREA)

    clahe = get_CLAHE()
    img = clahe.apply(img)

    #Umat = GPU memory
    #img_umat = cv.UMat(img)
    kps, des = sift.detectAndCompute(img, None)
    if des is None or len(des) == 0: return None, None

    return kps, des


def SIFT_from_file(file_path):
    """Safe loader for .npz files."""
    try:
        data = np.load(file_path, allow_pickle=True)
        kp_array = data['keypoints']
        descriptors = data['descriptors']

        # Safety downsample for legacy files
        if len(descriptors) > 15000:
            indices = np.random.choice(len(descriptors), 15000, replace=False)
            descriptors = descriptors[indices]
            kp_array = kp_array[indices]

        keypoints = [
            cv.KeyPoint(p[0][0], p[0][1], p[1], p[2], p[3], p[4], p[5])
            for p in kp_array
        ]
        return None, keypoints, descriptors, os.path.basename(file_path)
    except Exception:
        return None, [], None, ""


# --- CORE OPS ---

def process_new_image(image_path, kmeans_vocab):
    _, des = extract_features_from_image(image_path)
    if des is None: return None
    return compute_vlad(des, kmeans_vocab).reshape(1, -1).astype('float32')


def process_image_through_SIFT(image_path, output_path):
    #TIMER HERE
    t_start = time.time()
    kps, des = extract_features_from_image(image_path)
    if des is None: return False, None

    kp_array = np.array([(p.pt, p.size, p.angle, p.response, p.octave, p.class_id) for p in kps], dtype=object)
    try:
        np.savez(output_path, keypoints=kp_array, descriptors=des)

        # --- TIMER ENDS HERE ---
        t_total = time.time() - t_start
        print(f"⚡ SIFT Processed in {t_total:.4f}s")

        return True, des
    except Exception as e:
        print(f"Error saving NPZ: {e}")
        return False, None


def compute_vlad(descriptors, kmeans):
    # Inline VLAD to remove dependency on vlad_utils.py
    num_clusters = kmeans.n_clusters
    dim = descriptors.shape[1]
    vlad = np.zeros((num_clusters, dim), dtype=np.float32)
    assignments = kmeans.predict(descriptors)
    centers = kmeans.cluster_centers_
    for i in range(num_clusters):
        if np.sum(assignments == i) > 0:
            vlad[i] = np.sum(descriptors[assignments == i] - centers[i], axis=0)
    vlad = vlad.flatten()
    vlad = np.sign(vlad) * np.sqrt(np.abs(vlad))
    vlad = vlad / (np.linalg.norm(vlad) + 1e-7)
    return vlad


def initialize_faiss_index(vlad_matrix):
    # Inline Index Init to remove dependency on search_utils.py
    d = vlad_matrix.shape[1]
    index = faiss.IndexFlatL2(d)
    index.add(vlad_matrix)
    return index


# --- SEARCH & VERIFICATION ---

def smart_search(image_path, location_filter=None, k_results=20):
    t_start = time.time()

    vocab = GLOBAL_RESOURCES['vocab']
    index = GLOBAL_RESOURCES['faiss_index']
    metadata = GLOBAL_RESOURCES['metadata']

    # Require valid vocab and index; skip search if vocab is not fitted (stale/corrupt file)
    if not vocab or not index:
        return []
    centers = getattr(vocab, 'cluster_centers_', None)
    if centers is None or (hasattr(centers, 'size') and centers.size == 0):
        return []
    # Empty index (e.g. no turtles yet): avoid FAISS search and return no matches
    if hasattr(index, 'ntotal') and index.ntotal == 0:
        return []

    query_vector = process_new_image(image_path, vocab)
    if query_vector is None:
        return []

    # When filtering by location, request more candidates so we have enough after filtering
    search_k = (k_results * 10) if location_filter else (k_results * 5)
    dists, idxs = index.search(query_vector, search_k)
    results = []
    seen_sites = set()

    for i, idx in enumerate(idxs[0]):
        # Use int() so we never use numpy scalar in list index; -1 means no match from FAISS
        idx_int = int(idx)
        if idx_int < 0 or idx_int >= len(metadata):
            continue
        meta = metadata[idx_int]
        # Restrict to given sheet (tab name) when filter is set. location_filter can be str or list (e.g. [state, "Community_Uploads"]).
        if location_filter:
            state_val = str(meta.get('state') or '')
            loc_val = str(meta.get('location') or '')
            if isinstance(location_filter, (list, tuple)):
                allowed = [str(x) for x in location_filter]
                if state_val not in allowed and loc_val not in allowed:
                    continue
            else:
                if state_val != str(location_filter) and loc_val != str(location_filter):
                    continue
        site_id = meta.get('site_id', 'Unknown')
        if site_id not in seen_sites:
            seen_sites.add(site_id)
            # Full path (state/location) so frontend can detect e.g. Community_Uploads/SheetName
            loc_part = meta.get('location', '') or ''
            state_part = meta.get('state', '') or ''
            full_location = f"{state_part}/{loc_part}".strip('/') if (state_part or loc_part) else 'Unknown'
            results.append({
                'filename': meta.get('filename'),
                'file_path': meta.get('file_path'),
                'site_id': site_id,
                'location': full_location,
                'state': state_part,
                'distance': float(dists[0][i])
            })
        if len(results) >= k_results: break

    # --- TIMER END ---
    # Timer code moved outside the loop to correctly measure total search time
    # and print once after the loop completes, regardless of break condition
    t_total = time.time() - t_start
    print(f"⚡ Search Processed in {t_total:.4f}s")

    return results


def rerank_results_with_spatial_verification(query_image_path, initial_results):
    if not initial_results: return []
    print(f"🔍 Spatial Verification: Checking top {len(initial_results)} candidates...")

    kp_query, des_query = extract_features_from_image(query_image_path)
    if des_query is None: return initial_results

    bf = cv.BFMatcher()
    verified_results = []

    for res in initial_results:
        candidate_path = res.get('file_path')
        if not candidate_path or not os.path.exists(candidate_path): continue

        try:
            _, kp_candidate, des_candidate, _ = SIFT_from_file(candidate_path)
            if des_candidate is None:
                continue
            # knnMatch with k=2 requires at least 2 train descriptors (e.g. single-turtle edge case)
            n_train = des_candidate.shape[0] if hasattr(des_candidate, 'shape') else len(des_candidate)
            if n_train < 2:
                res['spatial_score'] = 0
                verified_results.append(res)
                continue

            matches = bf.knnMatch(des_query, des_candidate, k=2)
            good = [m for m, n in matches if m.distance < 0.75 * n.distance]

            inliers = 0
            if len(good) >= 4:
                src_pts = np.float32([kp_query[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
                dst_pts = np.float32([kp_candidate[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)

                try:
                    M, mask = cv.findHomography(src_pts, dst_pts, cv.USAC_MAGSAC, 5.0)
                except AttributeError:
                    M, mask = cv.findHomography(src_pts, dst_pts, cv.RANSAC, 8.0)  # Fallback

                if mask is not None:
                    inliers = int(np.sum(mask))

            res['spatial_score'] = int(inliers)
            verified_results.append(res)
        except Exception as e:
            print(f"Error: {e}")

    verified_results.sort(key=lambda x: x.get('spatial_score', 0), reverse=True)
    return verified_results


# --- SYSTEM MANAGEMENT ---

def load_or_generate_persistent_data(data_directory):
    global GLOBAL_RESOURCES
    GLOBAL_RESOURCES['vocab'] = load_vocabulary(DEFAULT_VOCAB_PATH)
    GLOBAL_RESOURCES['faiss_index'] = load_faiss_index(DEFAULT_INDEX_PATH)
    GLOBAL_RESOURCES['metadata'] = load_metadata(DEFAULT_METADATA_PATH)
    GLOBAL_RESOURCES['vlad_array'] = load_vlad_array(DEFAULT_VLAD_ARRAY_PATH)

    if GLOBAL_RESOURCES['vocab'] and GLOBAL_RESOURCES['faiss_index']:
        print("✅ Resources Loaded.")
        return True

    print("⚠️ Rebuilding Index/Vocab...")
    rebuild_faiss_index_from_folders(data_directory)

    # Reload after rebuild
    GLOBAL_RESOURCES['vocab'] = load_vocabulary(DEFAULT_VOCAB_PATH)
    GLOBAL_RESOURCES['faiss_index'] = load_faiss_index(DEFAULT_INDEX_PATH)
    GLOBAL_RESOURCES['metadata'] = load_metadata(DEFAULT_METADATA_PATH)
    return True


def rebuild_index_and_reload(data_directory):
    """
    Rebuild FAISS index and vocab from data_directory and reload GLOBAL_RESOURCES.
    Call this after adding new reference data (e.g. new turtle) so the next search sees it.
    """
    global GLOBAL_RESOURCES
    rebuild_faiss_index_from_folders(data_directory)
    GLOBAL_RESOURCES['vocab'] = load_vocabulary(DEFAULT_VOCAB_PATH)
    GLOBAL_RESOURCES['faiss_index'] = load_faiss_index(DEFAULT_INDEX_PATH)
    GLOBAL_RESOURCES['metadata'] = load_metadata(DEFAULT_METADATA_PATH)
    GLOBAL_RESOURCES['vlad_array'] = load_vlad_array(DEFAULT_VLAD_ARRAY_PATH)


# Helper loaders
def load_vocabulary(p): return joblib.load(p) if os.path.exists(p) else None


def load_faiss_index(p): return faiss.read_index(p) if os.path.exists(p) else None


def load_metadata(p): return joblib.load(p) if os.path.exists(p) else []


def load_vlad_array(p): return np.load(p) if os.path.exists(p) else None


def rebuild_faiss_index_from_folders(data_directory, vocab_save_path=DEFAULT_VOCAB_PATH,
                                     index_save_path=DEFAULT_INDEX_PATH, metadata_save_path=DEFAULT_METADATA_PATH,
                                     vlad_array_save_path=DEFAULT_VLAD_ARRAY_PATH, num_clusters=64):
    start_time = time.time()
    print("♻️  STARTING MASTER REBUILD...")

    # 1. Regenerate Missing NPZ
    print("   Scanning for missing NPZ files...")
    for root, dirs, files in os.walk(data_directory):
        for f in files:
            if f.lower().endswith(('.jpg', '.png', '.jpeg')) and 'ref_data' in root:
                npz = os.path.join(root, os.path.splitext(f)[0] + ".npz")
                if not os.path.exists(npz):
                    process_image_through_SIFT(os.path.join(root, f), npz)

    # 2. Train Vocab
    kmeans_vocab = None
    if os.path.exists(vocab_save_path):
        try:
            kmeans_vocab = joblib.load(vocab_save_path)
            if not hasattr(kmeans_vocab, 'cluster_centers_'): kmeans_vocab = None
        except:
            kmeans_vocab = None

    if kmeans_vocab is None:
        print(f"📉 Incremental Training (k={num_clusters})...")
        kmeans_vocab = MiniBatchKMeans(n_clusters=num_clusters, random_state=42, batch_size=10000, n_init=3)

        all_npz = []
        for root, dirs, files in os.walk(data_directory):
            for f in files:
                if f.endswith(".npz"): all_npz.append(os.path.join(root, f))

        batch = []
        vocab_was_fitted = False
        for i, fpath in enumerate(all_npz):
            try:
                d = np.load(fpath, allow_pickle=True)
                if 'descriptors' in d and d['descriptors'] is not None:
                    des = d['descriptors']
                    if len(des) > 10000:
                        indices = np.random.choice(len(des), 10000, replace=False)
                        des = des[indices]
                    batch.append(des)
            except Exception:
                pass

            if len(batch) >= 100 or i == len(all_npz) - 1:
                if batch:
                    kmeans_vocab.partial_fit(np.vstack(batch).astype('float32'))
                    vocab_was_fitted = True
                    print(f"   Processed batch... ({i + 1}/{len(all_npz)})")
                    batch = []
        # Only save vocab if it was actually fitted. Otherwise an unfitted KMeans would
        # cause 500 on first upload when predict() is called (e.g. empty data folder).
        if vocab_was_fitted:
            joblib.dump(kmeans_vocab, vocab_save_path)
        else:
            print("   No NPZ data in data/ - skipping vocab save. Add turtle reference data for matching.")
            kmeans_vocab = None

    # 3. Build Index (only if we have a fitted vocab)
    if kmeans_vocab is None:
        print("   No vocabulary available - skipping index build. Add turtle reference data under data/ and restart.")
        return None
    print("   Generating Index...")
    all_vlad = []
    final_meta = []
    for root, dirs, files in os.walk(data_directory):
        for f in files:
            if f.endswith(".npz"):
                path = os.path.join(root, f)
                try:
                    parts = path.split(os.sep)
                    if 'ref_data' in parts:
                        idx = parts.index('ref_data')
                        tid = parts[idx - 1]
                        loc = parts[idx - 2]   # folder name (Location in State/Location)
                        state = parts[idx - 3] if idx >= 3 else loc  # state name (sheet name in UI)
                    else:
                        tid, loc, state = "Unknown", "Unknown", "Unknown"

                    d = np.load(path, allow_pickle=True)
                    des = d.get('descriptors')
                    if des is not None and len(des) > 15000:
                        indices = np.random.choice(len(des), 15000, replace=False)
                        des = des[indices]

                    if des is not None and len(des) > 0:
                        vlad = compute_vlad(des, kmeans_vocab)
                        all_vlad.append(vlad)
                        # sheet_name_filter: value to match UI sheet (tab) name; use state (matches backend folders), never the "Location" column from the sheet
                        final_meta.append({'filename': f, 'file_path': path, 'site_id': tid, 'location': loc, 'state': state})
                except:
                    pass

    if all_vlad:
        vlad_arr = np.array(all_vlad).astype('float32')
        np.save(vlad_array_save_path, vlad_arr)
        joblib.dump(final_meta, metadata_save_path)

        index = initialize_faiss_index(vlad_arr)
        faiss.write_index(index, index_save_path)
        print(f"✅ Rebuild Complete ({time.time() - start_time:.2f}s).")
        return kmeans_vocab
    return None