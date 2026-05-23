import { TURTLE_API_BASE_URL } from '../config';
import { authHeaders, throwJsonError } from './http';
import type { FindMetadata } from './types';

export const getTurtlesWithFlags = async (): Promise<{
  success: boolean;
  items: Array<{
    turtle_id: string;
    location: string;
    path: string;
    find_metadata: FindMetadata & Record<string, unknown>;
  }>;
}> => {
  const response = await fetch(`${TURTLE_API_BASE_URL}/flags`, {
    method: 'GET',
    headers: authHeaders(),
  });
  if (!response.ok) {
    await throwJsonError(response, 'Failed to load turtles with flags');
  }
  return await response.json();
};

export const clearReleaseFlag = async (
  turtleId: string,
  location?: string | null,
): Promise<void> => {
  const response = await fetch(`${TURTLE_API_BASE_URL}/flags/release`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ turtle_id: turtleId, location: location || undefined }),
  });
  if (!response.ok) {
    await throwJsonError(response, 'Failed to clear release flag');
  }
};
