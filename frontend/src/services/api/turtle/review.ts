import { TURTLE_API_BASE_URL } from '../config';
import { prepareImageForUpload } from '../../../utils/prepareImageForUpload';
import { authHeaders, throwJsonError, throwUploadHttpError } from './http';
import type {
  AdditionalImageType,
  ApproveReviewRequest,
  ApproveReviewResponse,
  PhotoType,
  ReviewQueueItem,
  ReviewQueueResponse,
} from './types';

export const getReviewQueue = async (): Promise<ReviewQueueResponse> => {
  const response = await fetch(`${TURTLE_API_BASE_URL}/review-queue`, {
    method: 'GET',
    headers: authHeaders(),
  });

  if (!response.ok) {
    await throwJsonError(response, 'Failed to load review queue');
  }

  return await response.json();
};

export const uploadReviewPacketAdditionalImages = async (
  requestId: string,
  files: Array<{
    type: AdditionalImageType;
    file: File;
    labels?: string[];
  }>,
): Promise<{ success: boolean; message?: string }> => {
  const prepared = await Promise.all(
    files.map(async (f) => ({ ...f, file: await prepareImageForUpload(f.file) })),
  );
  const formData = new FormData();
  prepared.forEach((f, i) => {
    formData.append(`file_${i}`, f.file);
    formData.append(`type_${i}`, f.type);
    if (f.labels?.length) {
      formData.append(`labels_${i}`, f.labels.join(', '));
    }
  });
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}/additional-images`,
    { method: 'POST', headers: authHeaders(), body: formData },
  );
  if (!response.ok) {
    await throwUploadHttpError(response, 'Failed to add images');
  }
  return await response.json();
};

export const getReviewPacket = async (
  requestId: string,
): Promise<{ success: boolean; item: ReviewQueueItem }> => {
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}`,
    { method: 'GET', headers: authHeaders() },
  );
  if (!response.ok) {
    await throwJsonError(response, 'Failed to load packet');
  }
  return await response.json();
};

export const removeReviewPacketAdditionalImage = async (
  requestId: string,
  filename: string,
): Promise<void> => {
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}/additional-images`,
    {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ filename }),
    },
  );
  if (!response.ok) {
    await throwJsonError(response, 'Failed to remove image');
  }
};

export const approveReview = async (
  requestId: string,
  data: ApproveReviewRequest,
): Promise<ApproveReviewResponse> => {
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review/${requestId}/approve`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    await throwJsonError(response, 'Failed to approve review');
  }

  return await response.json();
};

export const crossCheckReviewPacket = async (
  requestId: string,
  photoType: PhotoType,
  imagePath?: string,
): Promise<{
  success: boolean;
  photo_type: string;
  matches: Array<{ turtle_id: string; location: string; confidence: number; score: number; image_path: string }>;
  elapsed: number;
}> => {
  const body: Record<string, string> = { photo_type: photoType };
  if (imagePath) body.image_path = imagePath;
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}/cross-check`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await throwJsonError(response, 'Failed to cross-check');
  }
  return await response.json();
};

export const classifyReviewPacket = async (
  requestId: string,
  photoType: PhotoType,
): Promise<{ success: boolean; item: ReviewQueueItem; matches_found: number }> => {
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review-queue/${encodeURIComponent(requestId)}/classify`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ photo_type: photoType }),
    },
  );
  if (!response.ok) {
    await throwJsonError(response, 'Failed to classify review packet');
  }
  return await response.json();
};

export const deleteReviewItem = async (
  requestId: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await fetch(
    `${TURTLE_API_BASE_URL}/review/${encodeURIComponent(requestId)}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!response.ok) {
    await throwJsonError(response, 'Failed to delete review item');
  }
  return await response.json();
};
