import { useEffect, useState } from 'react';
import { getTurtlePrimariesBatch } from '../../../services/api';
import { turtleDataFolderHint, turtleDiskFolderId } from '../../../services/api/sheets';
import type { TurtleSheetsData } from '../../../services/api/sheets';

export type FolderStatus = 'has_images' | 'empty_folder' | 'no_folder';

export interface PrimaryImageEntry {
  path: string | null;
  ts: number | null;
  hasCarapace: boolean;
  folderStatus: FolderStatus;
}

export function turtleKey(turtle: TurtleSheetsData): string {
  const id = turtleDiskFolderId(turtle);
  const hint = turtleDataFolderHint(turtle) ?? '';
  const row = typeof turtle.row_index === 'number' ? `|r${turtle.row_index}` : '';
  return `${id}|${hint}${row}`;
}

export function usePrimaryImagesBatch(filteredTurtles: TurtleSheetsData[]) {
  const [primaryImages, setPrimaryImages] = useState<Record<string, PrimaryImageEntry>>({});
  const [primaryImagesLoading, setPrimaryImagesLoading] = useState(false);

  useEffect(() => {
    if (filteredTurtles.length === 0) {
      setPrimaryImages({});
      setPrimaryImagesLoading(false);
      return;
    }
    const rows = filteredTurtles
      .map((t) => ({
        key: turtleKey(t),
        turtle_id: turtleDiskFolderId(t),
        sheet_name: turtleDataFolderHint(t) ?? t.sheet_name ?? null,
        primary_id: (t.primary_id || '').trim() || null,
      }))
      .filter((r) => r.turtle_id);
    if (rows.length === 0) {
      setPrimaryImages({});
      setPrimaryImagesLoading(false);
      return;
    }
    let cancelled = false;
    setPrimaryImagesLoading(true);
    setPrimaryImages({});
    getTurtlePrimariesBatch(
      rows.map((r) => ({ turtle_id: r.turtle_id, sheet_name: r.sheet_name, primary_id: r.primary_id })),
    )
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, PrimaryImageEntry> = {};
        res.images.forEach((img, i) => {
          const key = rows[i]?.key;
          if (key) {
            map[key] = {
              path: img.primary ?? null,
              ts: img.primary_ts ?? null,
              hasCarapace: img.has_carapace ?? false,
              folderStatus: img.folder_status ?? 'no_folder',
            };
          }
        });
        setPrimaryImages(map);
      })
      .catch(() => { if (!cancelled) setPrimaryImages({}); })
      .finally(() => { if (!cancelled) setPrimaryImagesLoading(false); });
    return () => { cancelled = true; };
  }, [filteredTurtles]);

  return { primaryImages, setPrimaryImages, primaryImagesLoading };
}
