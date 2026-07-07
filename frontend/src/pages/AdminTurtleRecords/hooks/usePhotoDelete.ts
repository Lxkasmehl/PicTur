import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { deleteTurtleImage, restoreTurtleImage, getTurtleImages, RestoreCollisionError } from '../../../services/api';
import type { TurtleImagesResponse, TurtleDeletedImage } from '../../../services/api';
import type { DeleteModalContext } from '../../../components/ConfirmDeletePhotoModal';
import type { HistoryPhotoExternal } from '../../../components/OldTurtlePhotosSection';

export type { HistoryPhotoExternal };

interface UsePhotoDeleteOptions {
  diskTurtleId: string;
  dataPathHint: string | null;
  selectedPrimaryId: string | null;
  turtleImages: TurtleImagesResponse | null;
  setTurtleImages: (images: TurtleImagesResponse | null) => void;
}

export function usePhotoDelete({
  diskTurtleId,
  dataPathHint,
  selectedPrimaryId,
  turtleImages,
  setTurtleImages,
}: UsePhotoDeleteOptions) {
  const [pendingDelete, setPendingDelete] = useState<null | {
    path: string;
    label: string;
    context: DeleteModalContext;
  }>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refetchImages = async () => {
    if (!diskTurtleId) return;
    try {
      const res = await getTurtleImages(diskTurtleId, dataPathHint, selectedPrimaryId);
      setTurtleImages(res);
    } catch {
      /* ignore */
    }
  };

  const openDeleteModalForActiveRef = (
    photoType: 'plastron' | 'carapace',
    photoPath: string,
    photoLabel: string,
  ) => {
    const oldRefSource = photoType === 'plastron' ? 'plastron_old_ref' : 'carapace_old_ref';
    const oldRefs = (turtleImages?.loose ?? []).filter((l) => l.source === oldRefSource);
    let revertHint: string | undefined;
    if (oldRefs.length > 0) {
      const sorted = [...oldRefs].sort((a, b) => {
        const ad = (a.upload_date || a.timestamp || '') as string;
        const bd = (b.upload_date || b.timestamp || '') as string;
        return ad < bd ? 1 : ad > bd ? -1 : 0;
      });
      revertHint = sorted[0].upload_date || sorted[0].timestamp || undefined;
    }
    setPendingDelete({
      path: photoPath,
      label: photoLabel,
      context:
        oldRefs.length > 0
          ? { kind: 'active_ref_with_revert', photoType, revertHint }
          : { kind: 'active_ref_no_revert', photoType },
    });
  };

  const openDeleteModalForNonRef = (path: string, label: string) => {
    setPendingDelete({ path, label, context: { kind: 'non_ref' } });
  };

  const handlePhotoDelete = (photo: HistoryPhotoExternal) => {
    if (!diskTurtleId) return;
    const isActivePlastron = turtleImages?.primary_info?.path === photo.path;
    const isActiveCarapace = turtleImages?.primary_carapace_info?.path === photo.path;
    if (isActivePlastron) {
      openDeleteModalForActiveRef('plastron', photo.path, photo.label);
    } else if (isActiveCarapace) {
      openDeleteModalForActiveRef('carapace', photo.path, photo.label);
    } else {
      openDeleteModalForNonRef(photo.path, photo.label);
    }
  };

  const handleScratchpadDelete = (item: { imagePath: string; filename: string; type: string }) => {
    handlePhotoDelete({ path: item.imagePath, label: item.type, category: item.type });
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete || !diskTurtleId) return;
    setDeleteBusy(true);
    try {
      const res = await deleteTurtleImage(diskTurtleId, pendingDelete.path, dataPathHint);
      setPendingDelete(null);
      notifications.show({
        title: res.reverted ? 'Deleted & reverted' : 'Moved to Deleted',
        message: res.reverted
          ? `Previous ${res.was_reference} reference promoted automatically.`
          : res.was_reference
            ? `No previous ${res.was_reference} reference available; the turtle now has no active ${res.was_reference} reference.`
            : 'Photo moved to the Deleted folder; can be restored later.',
        color: res.reverted ? 'green' : res.was_reference ? 'orange' : 'green',
      });
      await refetchImages();
    } catch (e) {
      notifications.show({
        title: 'Delete failed',
        message: e instanceof Error ? e.message : 'Unknown error',
        color: 'red',
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRestore = async (photo: TurtleDeletedImage) => {
    if (!diskTurtleId) return;
    try {
      const res = await restoreTurtleImage(diskTurtleId, photo.deleted_rel_path, dataPathHint);
      notifications.show({
        title: 'Restored',
        message: res.is_reference
          ? 'Reference restored; feature tensor regenerated.'
          : 'Photo restored to its original location.',
        color: res.warning ? 'orange' : 'green',
      });
      await refetchImages();
    } catch (e) {
      if (e instanceof RestoreCollisionError) {
        notifications.show({
          title: 'Restore blocked',
          message: `${e.message} Delete the occupant first, then restore.`,
          color: 'red',
        });
      } else {
        notifications.show({
          title: 'Restore failed',
          message: e instanceof Error ? e.message : 'Unknown error',
          color: 'red',
        });
      }
    }
  };

  return {
    pendingDelete,
    setPendingDelete,
    deleteBusy,
    refetchImages,
    handlePhotoDelete,
    handleScratchpadDelete,
    confirmPendingDelete,
    handleRestore,
    openDeleteModalForActiveRef,
    openDeleteModalForNonRef,
  };
}
