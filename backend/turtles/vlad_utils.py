import numpy as np
from sklearn.cluster import KMeans

# Deprecated compatibility module: retained for optional VLAD/FAISS experiments.
def build_vocabulary(all_descriptors, num_clusters=64):
    kmeans = KMeans(n_clusters=num_clusters,random_state=2)
    kmeans.fit(all_descriptors)
    return kmeans
def compute_vlad(descriptors, kmeans):
    num_clusters = kmeans.n_clusters
    dim = descriptors.shape[1]
    vlad = np.zeros((num_clusters, dim), dtype=np.float32)

    assignments = kmeans.predict(descriptors)
    centers = kmeans.cluster_centers_

    for i in range(num_clusters):
            if np.sum(assignments == i) == 0:
                continue
            residuals = descriptors[assignments == i] - centers[i]
            vlad[i] = np.sum(residuals, axis=0)

    vlad = vlad.flatten()
    vlad = np.sign(vlad) * np.sqrt(np.abs(vlad))
    vlad = vlad / np.linalg.norm(vlad)
    return vlad
