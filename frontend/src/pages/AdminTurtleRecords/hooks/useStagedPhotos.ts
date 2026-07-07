import { useMemo, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import {
  getTurtleImages,
  getTurtlePrimariesBatch,
  uploadTurtleAdditionalImages,
  uploadTurtleReplaceReference,
} from '../../../services/api';
import type { TurtleImagesResponse } from '../../../services/api';
import { turtleDataFolderHint, turtleDiskFolderId } from '../../../services/api/sheets';
import type { TurtleSheetsData } from '../../../services/api/sheets';
import type { AdditionalPhotoKind } from '../../../constants/additionalPhotoKinds';
import { type PrimaryImageEntry, turtleKey } from './usePrimaryImagesBatch';

export type StagedType = AdditionalPhotoKind;
export type ReferenceType = 'plastron' | 'carapace';

export const isReferenceType = (t: StagedType): t is ReferenceType =>
  t === 'plastron' || t === 'carapace';

export interface StagedPhoto {
  id: string;
  photoType: StagedType;
  file: File;
  replaceReference: boolean;
  previewUrl: string;
}

interface CommitCtx {
  turtleId?: string;
  sheetHint?: string | null;
  primaryId?: string | null;
  bioId?: string | null;
}

interface UseStagedPhotosOptions {
  diskTurtleId: string;
  dataPathHint: string | null;
  selectedPrimaryId: string | null;
  selectedTurtle: TurtleSheetsData | null;
  setTurtleImages: (images: TurtleImagesResponse | null) => void;
  setPrimaryImages: (fn: (prev: Record<string, PrimaryImageEntry>) => Record<string, PrimaryImageEntry>) => void;
  onSaveTurtle: (data: TurtleSheetsData, sheetName: string) => Promise<unknown>;
}

export function useStagedPhotos({
  diskTurtleId,
  dataPathHint,
  selectedPrimaryId,
  selectedTurtle,
  setTurtleImages,
  setPrimaryImages,
  onSaveTurtle,
}: UseStagedPhotosOptions) {
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<StagedPhoto | null>(null);
  const [committing, setCommitting] = useState(false);
  const previewCleanupRef = useRef<string[]>([]);

  const replaceWinnerIds = useMemo(() => {
    const winners: Record<ReferenceType, string | null> = { plastron: null, carapace: null };
    for (const s of stagedPhotos) {
      if (isReferenceType(s.photoType) && s.replaceReference) {
        winners[s.photoType] = s.id;
      }
    }
    return winners;
  }, [stagedPhotos]);

  const handleStagePhoto = (photoType: StagedType, file: File) => {
    const id = `${photoType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const previewUrl = URL.createObjectURL(file);
    previewCleanupRef.current.push(previewUrl);
    const base: StagedPhoto = { id, photoType, file, replaceReference: false, previewUrl };
    if (isReferenceType(photoType)) {
      setPendingPrompt(base);
    } else {
      setStagedPhotos((prev) => [...prev, base]);
    }
  };

  const confirmPendingPrompt = (replaceReference: boolean) => {
    if (!pendingPrompt) return;
    setStagedPhotos((prev) => [...prev, { ...pendingPrompt, replaceReference }]);
    setPendingPrompt(null);
  };

  const cancelPendingPrompt = () => {
    if (pendingPrompt) {
      URL.revokeObjectURL(pendingPrompt.previewUrl);
      previewCleanupRef.current = previewCleanupRef.current.filter(
        (u) => u !== pendingPrompt.previewUrl,
      );
    }
    setPendingPrompt(null);
  };

  const removeStagedPhoto = (id: string) => {
    setStagedPhotos((prev) => {
      const toRemove = prev.find((s) => s.id === id);
      if (toRemove) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  };

  const commitStagedPhotos = async (ctx?: CommitCtx): Promise<boolean> => {
    const uTurtleId = ctx?.turtleId || diskTurtleId;
    const uSheetHint = ctx?.sheetHint !== undefined ? ctx.sheetHint : dataPathHint;
    const uPrimaryId = ctx?.primaryId !== undefined ? ctx.primaryId : selectedPrimaryId;
    const uBioId =
      ctx?.bioId !== undefined ? ctx.bioId : (selectedTurtle?.id || '').trim() || null;
    if (!uTurtleId || stagedPhotos.length === 0) return true;
    setCommitting(true);
    try {
      const replaceWinners = stagedPhotos.filter(
        (s) =>
          isReferenceType(s.photoType) &&
          s.replaceReference &&
          replaceWinnerIds[s.photoType] === s.id,
      );
      const nonReplace = stagedPhotos.filter((s) => !replaceWinners.includes(s));

      if (nonReplace.length > 0) {
        await uploadTurtleAdditionalImages(
          uTurtleId,
          nonReplace.map((s) => ({ type: s.photoType, file: s.file })),
          uSheetHint,
          uPrimaryId,
          { bioId: uBioId },
        );
      }
      for (const s of replaceWinners) {
        await uploadTurtleReplaceReference(
          uTurtleId,
          s.file,
          s.photoType as ReferenceType,
          uSheetHint,
          uPrimaryId,
          { createIfMissing: true, bioId: uBioId },
        );
      }

      for (const s of stagedPhotos) URL.revokeObjectURL(s.previewUrl);
      setStagedPhotos([]);

      if (selectedTurtle) {
        try {
          const pr = await getTurtlePrimariesBatch([
            { turtle_id: uTurtleId, sheet_name: uSheetHint, primary_id: uPrimaryId },
          ]);
          const img0 = pr.images[0];
          setPrimaryImages((prev) => ({
            ...prev,
            [turtleKey(selectedTurtle)]: {
              path: img0?.primary ?? null,
              ts: img0?.primary_ts ?? null,
              hasCarapace: img0?.has_carapace ?? false,
              folderStatus: img0?.folder_status ?? 'no_folder',
            },
          }));
        } catch {
          /* sidebar refresh is cosmetic */
        }
      }
      return true;
    } catch (e) {
      notifications.show({
        title: 'Failed to commit photos',
        message: e instanceof Error ? e.message : 'Unknown error',
        color: 'red',
      });
      return false;
    } finally {
      setCommitting(false);
    }
  };

  // Signature matches TurtleSheetsDataFormProps['onSave'] exactly so it can be
  // passed directly as the onSave prop without a wrapper.
  const handleSaveWithStagedPhotos = async (
    formData: TurtleSheetsData,
    formSheetName: string,
    _backendLocationPath?: string,
  ): Promise<void> => {
    const uploadCtx: CommitCtx = {
      turtleId: turtleDiskFolderId(formData),
      sheetHint: turtleDataFolderHint({
        sheet_name: formSheetName,
        general_location: formData.general_location,
        location: formData.location,
      }),
      primaryId: (formData.primary_id || '').trim() || null,
      bioId: (formData.id || '').trim() || null,
    };
    const committed = await commitStagedPhotos(uploadCtx);
    if (!committed) throw new Error('Photo commit failed — aborting sheet save');
    await onSaveTurtle(formData, formSheetName);
    if (uploadCtx.turtleId) {
      try {
        const res = await getTurtleImages(
          uploadCtx.turtleId,
          uploadCtx.sheetHint ?? null,
          uploadCtx.primaryId ?? null,
        );
        setTurtleImages(res);
      } catch {
        /* ignore */
      }
    }
  };

  const handleCommitImagesOnly = async (onAfterCommit?: () => Promise<void>) => {
    const committed = await commitStagedPhotos();
    if (!committed) return;
    if (onAfterCommit) await onAfterCommit();
    notifications.show({
      title: 'Images updated',
      message: 'Staged photos committed. The turtle record was not modified.',
      color: 'green',
    });
  };

  const clearStagedPhotos = () => {
    setStagedPhotos((prev) => {
      for (const s of prev) URL.revokeObjectURL(s.previewUrl);
      return [];
    });
  };

  const revokeAllPreviewUrls = () => {
    for (const url of previewCleanupRef.current) URL.revokeObjectURL(url);
    previewCleanupRef.current = [];
  };

  return {
    stagedPhotos,
    setStagedPhotos,
    pendingPrompt,
    setPendingPrompt,
    committing,
    replaceWinnerIds,
    previewCleanupRef,
    handleStagePhoto,
    confirmPendingPrompt,
    cancelPendingPrompt,
    removeStagedPhoto,
    commitStagedPhotos,
    handleSaveWithStagedPhotos,
    handleCommitImagesOnly,
    clearStagedPhotos,
    revokeAllPreviewUrls,
  };
}
