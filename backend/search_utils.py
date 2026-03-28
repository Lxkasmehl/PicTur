import numpy as np
from scipy.spatial.distance import cdist
from sklearn.cluster import DBSCAN
from sklearn.neighbors import NearestNeighbors
from typing import Tuple, List, Optional
import warnings

try:
    import faiss
except ImportError:  # pragma: no cover - optional legacy dependency
    faiss = None

warnings.warn(
    "backend.search_utils is a deprecated VLAD/FAISS compatibility module. "
    "Default runtime matching uses SuperPoint/LightGlue.",
    DeprecationWarning,
    stacklevel=2,
)

def run_initial_dbscan(vlad_vectors: np.ndarray, eps: float, min_samples: int) -> np.ndarray:
    """
        Performs DBSCAN clustering on all VLAD vectors to determine initial Site IDs.

        Args:
            vlad_vectors: The (N, D) array of all VLAD vectors.
            eps: The maximum distance between two samples for one to be considered as
                 in the neighborhood of the other (the clustering radius).
            min_samples: The number of samples (or total weight) in a neighborhood
                         for a point to be considered as a core point.

        Returns:
            A 1D numpy array of cluster labels. Noise points are labeled as -1.
    """
    print(f"Running initial DBSCAN: eps={eps}, min_samples={min_samples}")
    dbscan = DBSCAN(eps=eps, min_samples=min_samples)

    labels = dbscan.fit_predict(vlad_vectors)

    n_sites = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = np.sum(labels == -1)

    print(f"DBSCAN complete.  Found {n_sites} sites with {n_noise} noise.")
    return labels


# --- 2. Global Search (FAISS HNSW) ---

def add_new_turtle_image_to_index(faiss_index: 'faiss.Index', new_vlad_vector: np.ndarray) -> bool:
    if faiss is None:
        raise RuntimeError("FAISS is not installed. Deprecated VLAD/FAISS path is unavailable.")
    """
    Adds a new VLAD vector (representing a new or verified turtle) to the live FAISS index.
    This function is called by register_new_turtle (or similar confirmation endpoint).
    """
    if new_vlad_vector.ndim == 1:
        # Ensure it's a 2D array (1, D) as FAISS expects this format
        new_vlad_vector = new_vlad_vector.reshape(1, -1)

    distances, indices = faiss_search_k_neighbors(faiss_index, new_vlad_vector, k=1)
        # If the distance to the closest match is near zero (e.g., < 1e-9), it is a duplicate.
    if indices.size > 0 and distances[0] < 1e-9:
        print("WARNING: Identical or near-duplicate vector detected. Skipping addition to FAISS.")
        return False

    # FAISS requires float32 and C-contiguous arrays
    vector_to_add = np.ascontiguousarray(new_vlad_vector.astype('float32'))

    # The IndexHNSWFlat index supports the .add() method natively
    faiss_index.add(vector_to_add)
    print(f"FAISS index updated. Total vectors: {faiss_index.ntotal}")
    return True


def initialize_faiss_index(database_vectors: np.ndarray) -> 'faiss.Index':
    if faiss is None:
        raise RuntimeError("FAISS is not installed. Deprecated VLAD/FAISS path is unavailable.")
    database_vectors = np.ascontiguousarray(database_vectors.astype('float32'))
    dim = database_vectors.shape[1]
    # HNSW parameters for speed/accuracy balance
    M = 32
    index = faiss.IndexHNSWFlat(dim, M, faiss.METRIC_L2)
    index.hnsw.efConstruction = 80

    index.add(database_vectors)
    print(f"FAISS HNSW Index created with {index.ntotal} vectors.")
    return index


def faiss_search_k_neighbors(faiss_index: 'faiss.Index', query_vector: np.ndarray, k: int = 5) -> Tuple[
    np.ndarray, np.ndarray]:
    if faiss is None:
        raise RuntimeError("FAISS is not installed. Deprecated VLAD/FAISS path is unavailable.")
    query_vector = np.ascontiguousarray(query_vector.reshape(1, -1).astype('float32'))
    if hasattr(faiss_index, 'hnsw'):
        faiss_index.hnsw.efSearch = 64
    distances, indices = faiss_index.search(query_vector, k)
    return distances.flatten(), indices.flatten()


# --- 3. Filtered Search (Location Specific) ---
def filtered_faiss_search(query_vector: np.ndarray, subset_vectors: np.ndarray,
                          subset_indices: np.ndarray, n_results: int = 5) -> Tuple[List[int], np.ndarray]:
    if faiss is None:
        raise RuntimeError("FAISS is not installed. Deprecated VLAD/FAISS path is unavailable.")
    if subset_vectors.shape[0] == 0: return [], np.array([])

    subset_vectors = np.ascontiguousarray(subset_vectors.astype('float32'))
    dim = subset_vectors.shape[1]
    local_index = faiss.IndexFlatL2(dim)
    local_index.add(subset_vectors)

    distances, indices_in_subset = faiss_search_k_neighbors(local_index, query_vector, k=n_results)

    # Filter query itself if present
    is_query = distances < 1e-6
    filtered_indices = indices_in_subset[~is_query]
    filtered_dists = distances[~is_query]

    global_indices = subset_indices[filtered_indices]
    return global_indices.tolist(), filtered_dists




"""
def initialize_neighbor_search(database_vectors: np.ndarray) -> NearestNeighbors:
    # Use brute-force for simplicity or 'auto' for efficiency on large datasets.
    # We fit it to the entire database of VLAD vectors once.
    nn_model = NearestNeighbors(algorithm='auto', metric='euclidean')
    nn_model.fit(database_vectors)
    return nn_model

def find_neighbors_in_radius(nn_model: NearestNeighbors, query_vector: np.ndarray, eps: float, n_results: int = 5) -> Tuple[List[int], np.ndarray]:
    distances_in_radius, indices_in_radius = nn_model.radius_neighbors(
        query_vector.reshape(1, -1), # Ensure the query is 2D (1, D)
        radius=eps,
        return_distance=True,
        sort_results=True # Sort by distance
    )

    #extract and limit results to the top N
    # We only care about the first query point ([0])

    # Exclude the query image itself if it's in the database (distance of 0)
    # The sort_results=True ensures the closest matches are first

    # Filter out the indices that correspond to the query itself (distance near 0)
    valid_indices = indices_in_radius[0][distances_in_radius[0] > 1e-6]
    valid_distances = distances_in_radius[0][distances_in_radius[0] > 1e-6]

    # Limit to the top N results (e.g., 3 to 5 matches)
    top_indices = valid_indices[:n_results]
    top_distances = valid_distances[:n_results]

    return top_indices.tolist(), top_distances
"""
"""
def brute_force_filtered_search(query_vector: np.ndarray, subset_vectors: np.ndarray,
                                subset_indices: np.ndarray, n_results: int = 5) -> Tuple[List[int], np.ndarray]:
    if subset_vectors.shape[0] == 0:
        return [], np.array([])

        # 1. Calculate the Euclidean distance from the query to every vector in the subset.
        # cdist is highly optimized and much faster than manual Python loops.
    distances = cdist(query_vector.reshape(1, -1), subset_vectors, metric='euclidean').flatten()

    # 2. Find the indices that sort the distances (closest match first).
    sorted_indices_in_subset = np.argsort(distances)

    # 3. Take the top N results.
    # We slice to ensure we only get up to the maximum number of available results.
    top_n_subset_indices = sorted_indices_in_subset[:n_results]

    # 4. Map the subset indices back to the original global database indices.
    global_indices = subset_indices[top_n_subset_indices]

    # 5. Get the actual distances for the top results.
    top_distances = distances[top_n_subset_indices]

    return global_indices.tolist(), top_distances
"""