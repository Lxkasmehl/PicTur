import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Grid,
  Group,
  Image,
  Loader,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertTriangle, IconDatabase, IconDownload, IconMapPin, IconPhoto, IconSearch, IconSkull, IconTags, IconTrash, IconZoomIn } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import {
  downloadAdminBackupArchive,
  getImageUrl,
  getTurtleImages,
  getTurtlePrimariesBatch,
  isAdminRole,
  uploadTurtleAdditionalImages,
  uploadTurtleReplaceReference,
  searchTurtleImagesByLabel,
  setTurtleImageLabels,
  deleteTurtleImage,
  restoreTurtleImage,
  RestoreCollisionError,
  type TurtleAdditionalLabelSearchMatch,
  type TurtleImagesResponse,
  type TurtleDeletedImage,
} from '../../services/api';
import {
  turtleDataFolderHint,
  turtleDiskFolderId,
  type TurtleSheetsData,
} from '../../services/api/sheets';
import { useUser } from '../../hooks/useUser';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { OldTurtlePhotosSection, type HistoryPhotoExternal } from '../../components/OldTurtlePhotosSection';
import { ConfirmDeletePhotoModal, type DeleteModalContext } from '../../components/ConfirmDeletePhotoModal';
import { validateFile } from '../../utils/fileValidation';
import { useAdminTurtleRecordsContext } from './AdminTurtleRecordsContext';
import {
  ADDITIONAL_PHOTO_KIND_OPTIONS,
  additionalPhotoKindLabel,
  type AdditionalPhotoKind,
} from '../../constants/additionalPhotoKinds';

// Staged photos can be any of the canonical category buttons that
// AdditionalImagesSection renders (the eleven AdditionalPhotoKind values).
// Pre-merge this was a narrow five-element union and tsc only let
// handleStagePhoto take the new categories ('anterior' / 'posterior' /
// 'left-side' / 'right-side' / 'people' / 'injury') because of function-
// parameter bivariance. Widening to AdditionalPhotoKind makes the
// assignment provably correct under strictFunctionTypes too.
type StagedType = AdditionalPhotoKind;
type ReferenceType = 'plastron' | 'carapace';

interface StagedPhoto {
  id: string;
  photoType: StagedType;
  file: File;
  /** Only meaningful for plastron/carapace; always false for other types. */
  replaceReference: boolean;
  previewUrl: string;
  /** Tag(s) attached by the AdditionalImagesSection tagging system (per-photo labels).
   *  Used by the commit step to rename / annotate the file on upload. */
  tag?: string;
  labels?: string[];
}

const isReferenceType = (t: StagedType): t is ReferenceType =>
  t === 'plastron' || t === 'carapace';

function turtleKey(turtle: TurtleSheetsData) {
  const id = turtleDiskFolderId(turtle);
  const hint = turtleDataFolderHint(turtle) ?? '';
  const row = typeof turtle.row_index === 'number' ? `|r${turtle.row_index}` : '';
  return `${id}|${hint}${row}`;
}

function sheetRowsSame(a: TurtleSheetsData | null, b: TurtleSheetsData): boolean {
  if (!a) return false;
  if (
    a.sheet_name &&
    b.sheet_name === a.sheet_name &&
    typeof a.row_index === 'number' &&
    typeof b.row_index === 'number'
  ) {
    return a.row_index === b.row_index;
  }
  return (
    (a.primary_id || a.id) === (b.primary_id || b.id) &&
    (a.sheet_name || '') === (b.sheet_name || '')
  );
}

function isSheetsDeceasedYes(v?: string | null): boolean {
  const s = (v || '').trim().toLowerCase();
  return ['yes', 'y', 'true', '1', 'deceased', 'dead'].includes(s);
}

function matchPassesSheetFilter(matchSheet: string, filter: string): boolean {
  if (!filter) return true;
  const s = matchSheet.replace(/\\/g, '/');
  return s === filter || s.startsWith(`${filter}/`);
}

function findTurtleForMatch(
  turtles: TurtleSheetsData[],
  m: TurtleAdditionalLabelSearchMatch,
): TurtleSheetsData | undefined {
  const firstSeg = (m.sheet_name || '').split('/')[0] || '';
  return turtles.find((t) => {
    if (m.turtle_id !== t.id && m.turtle_id !== t.primary_id) return false;
    if (firstSeg && t.sheet_name && t.sheet_name !== firstSeg) return false;
    return true;
  });
}

export function SheetsBrowserTab() {
  const { role } = useUser();
  const ctx = useAdminTurtleRecordsContext();
  const [turtleImages, setTurtleImages] = useState<TurtleImagesResponse | null>(null);
  // path + epoch-ms ts so the sidebar thumbnail can cache-bust on replace —
  // active reference paths are stable across uploads, so without ts the
  // browser keeps serving the previously-cached bytes.
  const [primaryImages, setPrimaryImages] = useState<Record<string, { path: string; ts: number | null } | null>>({});
  /** True while `getTurtlePrimariesBatch` is in flight for the current filter list (distinct from "no plastron"). */
  const [primaryImagesLoading, setPrimaryImagesLoading] = useState(false);
  // Staged photos awaiting commit on "Update Turtle" save — any type.
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<StagedPhoto | null>(null);
  const [committing, setCommitting] = useState(false);
  const previewCleanupRef = useRef<string[]>([]);
  // Photo-tag search mode (main): filter the left column by tag instead of records.
  const [listMode, setListMode] = useState<'records' | 'tags'>('records');
  const [tagQuery, setTagQuery] = useState('');
  const [photoTypeFilter, setPhotoTypeFilter] = useState<string | null>('');
  const [photoMatches, setPhotoMatches] = useState<TurtleAdditionalLabelSearchMatch[]>([]);
  const [photoSearchLoading, setPhotoSearchLoading] = useState(false);
  const [selectedMatchPath, setSelectedMatchPath] = useState<string | null>(null);
  const [tagSearchLightbox, setTagSearchLightbox] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const {
    selectedSheetFilter,
    sheetsListLoading,
    availableSheets,
    searchQuery,
    setSearchQuery,
    loadAllTurtles,
    turtlesLoading,
    filteredTurtles,
    allTurtles,
    selectedTurtle,
    setSelectedTurtle,
    handleSaveTurtleFromBrowser: onSaveTurtle,
    setSelectedSheetFilterAndLoad: onSheetFilterChange,
  } = ctx;

  /** Biology ID when present — matches on-disk folder names (e.g. F439); else primary id. */
  const diskTurtleId = selectedTurtle ? turtleDiskFolderId(selectedTurtle) : '';
  /** Matches `data/<path>/` on disk (not the Google tab name alone). */
  const dataPathHint = selectedTurtle ? turtleDataFolderHint(selectedTurtle) : null;
  /** Fallback id used when the on-disk folder still carries the original Primary ID
   *  after the sheet's biology ID was changed (folder-rename chronodrop pending). */
  const selectedPrimaryId = (selectedTurtle?.primary_id || '').trim() || null;

  useEffect(() => {
    if (!diskTurtleId) {
      setTurtleImages(null);
      return;
    }
    getTurtleImages(diskTurtleId, dataPathHint, selectedPrimaryId)
      .then(setTurtleImages)
      .catch(() => setTurtleImages(null));
  }, [diskTurtleId, dataPathHint, selectedPrimaryId]);

  // Clear staged photos whenever the selected turtle changes (they apply to a specific turtle).
  useEffect(() => {
    setStagedPhotos((prev) => {
      for (const s of prev) URL.revokeObjectURL(s.previewUrl);
      return [];
    });
    setPendingPrompt(null);
  }, [diskTurtleId, dataPathHint]);

  // Revoke any lingering object URLs on unmount
  useEffect(() => {
    const cleanup = previewCleanupRef.current;
    return () => {
      for (const url of cleanup) URL.revokeObjectURL(url);
    };
  }, []);

  // Track which plastron/carapace will actually become the reference (last flagged one of its type wins)
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
      // Plastron/carapace go through the "Replace reference?" prompt
      setPendingPrompt(base);
    } else {
      // Microhabitat/condition/additional stage directly
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
      previewCleanupRef.current = previewCleanupRef.current.filter((u) => u !== pendingPrompt.previewUrl);
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

  const commitStagedPhotos = async (): Promise<boolean> => {
    if (!diskTurtleId || stagedPhotos.length === 0) return true;
    setCommitting(true);
    try {
      // Winners: plastron/carapace flagged replaceReference AND the last such staged of their type.
      // Everything else (non-ref types, non-replace refs, superseded refs) → additional-images endpoint.
      const replaceWinners = stagedPhotos.filter(
        (s) =>
          isReferenceType(s.photoType) &&
          s.replaceReference &&
          replaceWinnerIds[s.photoType] === s.id,
      );
      const nonReplace = stagedPhotos.filter((s) => !replaceWinners.includes(s));

      if (nonReplace.length > 0) {
        await uploadTurtleAdditionalImages(
          diskTurtleId,
          nonReplace.map((s) => ({ type: s.photoType, file: s.file })),
          dataPathHint,
          selectedPrimaryId,
        );
      }

      // Replace-reference calls are sequential: each archives the current reference first.
      for (const s of replaceWinners) {
        await uploadTurtleReplaceReference(
          diskTurtleId,
          s.file,
          s.photoType as ReferenceType,
          dataPathHint,
          selectedPrimaryId,
        );
      }

      for (const s of stagedPhotos) URL.revokeObjectURL(s.previewUrl);
      setStagedPhotos([]);

      // Refresh the sidebar thumbnail too — when a replace-reference fires we
      // just changed which file is the active plastron/carapace, so the
      // primaries cache for THIS turtle is now stale. The full-list refresh
      // happens elsewhere on selection change; here we update just the one
      // entry so the user sees their new reference appear immediately on the
      // left side without having to deselect+reselect the row.
      if (selectedTurtle) {
        try {
          const pr = await getTurtlePrimariesBatch([
            { turtle_id: diskTurtleId, sheet_name: dataPathHint, primary_id: selectedPrimaryId },
          ]);
          const p = pr.images[0]?.primary ?? null;
          const ts = pr.images[0]?.primary_ts ?? null;
          setPrimaryImages((prev) => ({
            ...prev,
            [turtleKey(selectedTurtle)]: p ? { path: p, ts } : null,
          }));
        } catch {
          /* sidebar refresh is cosmetic — don't fail the whole commit if it errors */
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

  const handleSaveWithStagedPhotos: typeof onSaveTurtle = async (...args) => {
    const committed = await commitStagedPhotos();
    if (!committed) throw new Error('Photo commit failed — aborting sheet save');
    // Run the original sheet save
    const result = await onSaveTurtle(...(args as Parameters<typeof onSaveTurtle>));
    // Refetch images so UI reflects new references/loose/history
    if (diskTurtleId) {
      try {
        const res = await getTurtleImages(diskTurtleId, dataPathHint, selectedPrimaryId);
        setTurtleImages(res);
      } catch {
        /* ignore */
      }
    }
    return result;
  };

  // Images-only commit triggered by the second Update Turtle Images button
  // inside the pending-photos box. Does NOT save the sheet record.
  const handleCommitImagesOnly = async () => {
    const committed = await commitStagedPhotos();
    if (!committed) return;
    if (diskTurtleId) {
      try {
        const res = await getTurtleImages(diskTurtleId, dataPathHint, selectedPrimaryId);
        setTurtleImages(res);
      } catch {
        /* ignore */
      }
    }
    notifications.show({
      title: 'Images updated',
      message: 'Staged photos committed. The turtle record was not modified.',
      color: 'green',
    });
  };

  // --- Soft-delete + restore flow ---------------------------------------
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
    // Look for an Old Ref that would auto-promote if this is deleted.
    const oldRefSource = photoType === 'plastron' ? 'plastron_old_ref' : 'carapace_old_ref';
    const oldRefs = (turtleImages?.loose ?? []).filter((l) => l.source === oldRefSource);
    let revertHint: string | undefined;
    if (oldRefs.length > 0) {
      const sorted = [...oldRefs].sort((a, b) => {
        const ad = (a.upload_date || a.timestamp || '') as string;
        const bd = (b.upload_date || b.timestamp || '') as string;
        return ad < bd ? 1 : ad > bd ? -1 : 0;
      });
      const first = sorted[0];
      revertHint = first.upload_date || first.timestamp || undefined;
    }
    setPendingDelete({
      path: photoPath,
      label: photoLabel,
      context: oldRefs.length > 0
        ? { kind: 'active_ref_with_revert', photoType, revertHint: revertHint || undefined }
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

  // Scratchpad uses the same flow, just shaped from AdditionalImagesSection's item type.
  const handleScratchpadDelete = async (item: { imagePath: string; filename: string; type: string }) => {
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
          ? `Reference restored; feature tensor regenerated.`
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

  // Load primary (plastron) images for the turtle list so we can show them in cards
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
    getTurtlePrimariesBatch(rows.map((r) => ({
      turtle_id: r.turtle_id,
      sheet_name: r.sheet_name,
      primary_id: r.primary_id,
    })))
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, { path: string; ts: number | null } | null> = {};
        res.images.forEach((img, i) => {
          const key = rows[i]?.key;
          if (key) map[key] = img.primary ? { path: img.primary, ts: img.primary_ts ?? null } : null;
        });
        setPrimaryImages(map);
      })
      .catch(() => {
        if (!cancelled) setPrimaryImages({});
      })
      .finally(() => {
        if (!cancelled) setPrimaryImagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filteredTurtles]);

  // Show only images uploaded *today* in the Additional Turtle Photos pane.
  // Older uploads remain accessible via the "View Old Turtle Photos" date picker.
  // Photos land in several disk locations depending on upload path:
  //   - microhabitat/condition/additional (and any new future additional-style
  //     buttons main adds) -> additional_images/YYYY-MM-DD/... -> turtleImages.additional
  //   - plastron/carapace replacement refs  -> plastron/ or carapace/ -> primary_info
  //   - demoted/other plastron & carapace   -> plastron/Other Plastrons/, etc. -> loose
  //   - old refs archived on replacement    -> plastron/Old References/, etc. -> loose
  // All of these should appear in today's scratchpad; we use upload_date (not
  // timestamp, which prefers EXIF) so a photo captured years ago but uploaded
  // today still shows up. Filter is type-agnostic for forward compatibility
  // with any new additional-type buttons that land in main.
  const todayIso = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const folderDateRegex = /[\\/](\d{4}-\d{2}-\d{2})[\\/]/;

  type ScratchpadImage = { path: string; type: string; labels?: string[]; uploadTs?: number | null };

  const todaysAdditionalImages: ScratchpadImage[] = (() => {
    const out: ScratchpadImage[] = [];

    for (const img of turtleImages?.additional ?? []) {
      const match = img.path.match(folderDateRegex);
      if (match?.[1] === todayIso) {
        out.push({ path: img.path, type: img.type, labels: img.labels, uploadTs: img.upload_ts });
      }
    }

    // Pass the loose ``source`` straight through as the type so the section
    // header reflects the photo's role: 'plastron_old_ref' / 'plastron_other'
    // / 'carapace_old_ref' / 'carapace_other'. Previously these all collapsed
    // to 'plastron' / 'carapace' and merged with active references into a
    // single misleading "Plastron (additional)" pile.
    for (const img of turtleImages?.loose ?? []) {
      if (img.upload_date === todayIso) {
        out.push({ path: img.path, type: img.source, labels: img.labels, uploadTs: img.upload_ts });
      }
    }

    // Active references uploaded today get their own dedicated section so
    // admins can see at a glance "this is the new SuperPoint reference."
    const primaryInfo = turtleImages?.primary_info;
    if (primaryInfo && primaryInfo.upload_date === todayIso) {
      out.push({ path: primaryInfo.path, type: 'plastron_active', labels: primaryInfo.labels, uploadTs: primaryInfo.upload_ts });
    }
    const primaryCarapaceInfo = turtleImages?.primary_carapace_info;
    if (primaryCarapaceInfo && primaryCarapaceInfo.upload_date === todayIso) {
      out.push({ path: primaryCarapaceInfo.path, type: 'carapace_active', labels: primaryCarapaceInfo.labels, uploadTs: primaryCarapaceInfo.upload_ts });
    }

    // De-duplicate by path (a primary ref and a loose entry can occasionally
    // point at the same path during the brief window before the backend
    // response reflects a replacement).
    const seen = new Set<string>();
    return out.filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true)));
  })();

  const filteredPhotoMatches = useMemo(() => {
    return photoMatches.filter((m) =>
      matchPassesSheetFilter(m.sheet_name, selectedSheetFilter),
    );
  }, [photoMatches, selectedSheetFilter]);

  /** Group tag hits by turtle + folder so multiple matching photos show together. */
  const photoTagGroups = useMemo(() => {
    const map = new Map<string, TurtleAdditionalLabelSearchMatch[]>();
    for (const m of filteredPhotoMatches) {
      const key = `${m.turtle_id}|${m.sheet_name.replace(/\\/g, '/')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    const groups = [...map.values()].map((matches) =>
      [...matches].sort((a, b) => a.path.localeCompare(b.path)),
    );
    groups.sort((a, b) => {
      const ta = a[0]?.turtle_id ?? '';
      const tb = b[0]?.turtle_id ?? '';
      return ta.localeCompare(tb);
    });
    return groups;
  }, [filteredPhotoMatches]);

  const runPhotoSearch = async () => {
    const q = tagQuery.trim();
    const typeFilter = (photoTypeFilter || '').trim();
    if (!q && !typeFilter) return;
    setPhotoSearchLoading(true);
    setSelectedMatchPath(null);
    try {
      const res = await searchTurtleImagesByLabel(q, typeFilter || undefined);
      setPhotoMatches(res.matches ?? []);
    } catch {
      setPhotoMatches([]);
    } finally {
      setPhotoSearchLoading(false);
    }
  };

  const openTurtleFromMatch = (m: TurtleAdditionalLabelSearchMatch) => {
    const row = findTurtleForMatch(allTurtles, m);
    if (row) {
      setSelectedTurtle(row);
      setSelectedMatchPath(m.path);
    }
  };

  const listForRecords = filteredTurtles;

  return (
    <Grid gutter='lg'>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <Paper shadow='sm' p='md' radius='md' withBorder>
          <Stack gap='md'>
            <Text fw={500} size='lg'>
              Search & Filter
            </Text>
            <Select
              label='Location (Spreadsheet)'
              description={
                sheetsListLoading
                  ? 'Loading locations…'
                  : selectedSheetFilter
                    ? 'Only turtles from this sheet'
                    : 'All sheets'
              }
              placeholder='All locations'
              leftSection={<IconMapPin size={16} />}
              value={selectedSheetFilter}
              onChange={(value) => onSheetFilterChange(value ?? '')}
              data={[
                { value: '', label: 'All locations' },
                ...availableSheets.map((s) => ({ value: s, label: s })),
              ]}
              allowDeselect={false}
              searchable
              clearable={false}
              disabled={sheetsListLoading}
            />
            <SegmentedControl
              value={listMode}
              onChange={(v) => setListMode(v as 'records' | 'tags')}
              data={[
                { label: 'Records', value: 'records' },
                { label: 'Photo tags', value: 'tags' },
              ]}
              fullWidth
            />
            {listMode === 'records' ? (
              <>
                <TextInput
                  placeholder='Search by ID, name, species, location...'
                  leftSection={<IconSearch size={16} />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Button onClick={() => loadAllTurtles()} loading={turtlesLoading} fullWidth>
                  Refresh
                </Button>
                {isAdminRole(role) && (
                  <>
                    <Menu shadow='md' width={320} withinPortal>
                      <Menu.Target>
                        <Button
                          variant='light'
                          color='teal'
                          fullWidth
                          leftSection={<IconDownload size={16} />}
                          loading={backupLoading}
                        >
                          Offline backup (ZIP)
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>Server data folder + Google Sheets</Menu.Label>
                        <Menu.Item
                          onClick={async () => {
                            setBackupLoading(true);
                            try {
                              await downloadAdminBackupArchive({ scope: 'all' });
                              notifications.show({
                                title: 'Download started',
                                message: 'Save the ZIP from your browser downloads folder.',
                                color: 'teal',
                              });
                            } catch (e) {
                              notifications.show({
                                title: 'Backup failed',
                                message: e instanceof Error ? e.message : 'Unknown error',
                                color: 'red',
                              });
                            } finally {
                              setBackupLoading(false);
                            }
                          }}
                        >
                          Full archive — entire data directory and all sheet tabs
                        </Menu.Item>
                        <Menu.Item
                          disabled={!selectedSheetFilter}
                          onClick={async () => {
                            const sheet = selectedSheetFilter;
                            if (!sheet) return;
                            setBackupLoading(true);
                            try {
                              await downloadAdminBackupArchive({ scope: 'sheet', sheet });
                              notifications.show({
                                title: 'Download started',
                                message: `Backup for tab "${sheet}" is saving to your downloads folder.`,
                                color: 'teal',
                              });
                            } catch (e) {
                              notifications.show({
                                title: 'Backup failed',
                                message: e instanceof Error ? e.message : 'Unknown error',
                                color: 'red',
                              });
                            } finally {
                              setBackupLoading(false);
                            }
                          }}
                        >
                          Current location tab only
                          {selectedSheetFilter
                            ? ` (${selectedSheetFilter})`
                            : ' — pick a location above'}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                    <Text size='xs' c='dimmed'>
                      Admin only. ZIP includes on-disk data and CSV/JSON sheet snapshots for disaster recovery.
                    </Text>
                  </>
                )}
                <Divider />
                <Text size='sm' c='dimmed'>
                  {filteredTurtles.length} of {allTurtles.length} turtles
                </Text>
                <ScrollArea h={560}>
                  <Stack gap='xs'>
                    {listForRecords.map((turtle, index) => (
                      <Card
                        key={
                          typeof turtle.row_index === 'number' && turtle.sheet_name
                            ? `${turtle.sheet_name}-r${turtle.row_index}`
                            : `${turtle.primary_id || turtle.id || 'turtle'}-${index}-${turtle.sheet_name || ''}`
                        }
                        shadow='sm'
                        padding='sm'
                        radius='md'
                        withBorder
                        style={{
                          cursor: 'pointer',
                          border: sheetRowsSame(selectedTurtle, turtle)
                            ? '2px solid var(--mantine-color-blue-filled)'
                            : '1px solid var(--mantine-color-default-border)',
                          backgroundColor: sheetRowsSame(selectedTurtle, turtle)
                            ? 'var(--mantine-color-blue-light)'
                            : isSheetsDeceasedYes(turtle.deceased)
                              ? 'var(--mantine-color-default-hover)'
                              : undefined,
                        }}
                        onClick={() => {
                          setSelectedMatchPath(null);
                          setSelectedTurtle(turtle);
                        }}
                      >
                        <Group justify='space-between' align='flex-start' wrap='nowrap' gap='sm'>
                          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                            <Group gap='xs' wrap='wrap'>
                              {turtle.name ? (
                                <Text fw={600} size='md' c='blue'>
                                  {turtle.name}
                                </Text>
                              ) : null}
                              {isSheetsDeceasedYes(turtle.deceased) && (
                                <Badge
                                  size='sm'
                                  color='gray'
                                  variant='filled'
                                  leftSection={<IconSkull size={12} />}
                                >
                                  Deceased
                                </Badge>
                              )}
                            </Group>
                            {!turtle.name ? (
                              <Text fw={500} size='sm' c='dimmed' fs='italic'>
                                No name
                              </Text>
                            ) : null}

                            <Stack gap={2}>
                              {turtle.location && (
                                <Text size='sm' fw={500}>
                                  📍 {turtle.location}
                                </Text>
                              )}
                              {turtle.species && (
                                <Text size='sm' c='dimmed'>
                                  🐢 {turtle.species}
                                </Text>
                              )}
                            </Stack>

                            <Stack gap={2} mt='xs'>
                              {turtle.primary_id && (
                                <Text size='xs' c='dimmed'>
                                  Primary ID: <strong>{turtle.primary_id}</strong>
                                </Text>
                              )}
                              {turtle.id && turtle.id !== turtle.primary_id && (
                                <Text size='xs' c='dimmed'>
                                  ID: {turtle.id}
                                </Text>
                              )}
                              {!turtle.primary_id && !turtle.id && (
                                <Text size='xs' c='red' fs='italic'>
                                  No ID
                                </Text>
                              )}
                            </Stack>
                          </Stack>
                          <Box
                            style={{
                              width: 112,
                              flexShrink: 0,
                              borderRadius: 6,
                              overflow: 'hidden',
                              backgroundColor: 'var(--mantine-color-gray-1)',
                              minHeight: 84,
                            }}
                          >
                            {primaryImagesLoading ? (
                              <Center w='100%' h='100%' style={{ minHeight: 84 }}>
                                <Loader size='sm' color='gray' aria-label='Loading plastron preview' />
                              </Center>
                            ) : primaryImages[turtleKey(turtle)] ? (
                              <Image
                                src={getImageUrl(
                                  primaryImages[turtleKey(turtle)]!.path,
                                  { version: primaryImages[turtleKey(turtle)]!.ts, maxDim: 240 },
                                )}
                                alt='Plastron'
                                fit='contain'
                                loading='lazy'
                                decoding='async'
                                style={{ width: '100%', height: 'auto', display: 'block' }}
                              />
                            ) : (
                              <Center w='100%' h='100%' style={{ minHeight: 84 }}>
                                <IconPhoto size={28} stroke={1.2} style={{ opacity: 0.4 }} />
                              </Center>
                            )}
                          </Box>
                        </Group>
                      </Card>
                    ))}
                  </Stack>
                </ScrollArea>
              </>
            ) : (
              <>
                <Text size='xs' c='dimmed'>
                  Find additional photos by tag, category, or both. Results respect the location
                  filter above.
                </Text>
                <TextInput
                  placeholder='e.g. burned, shell crack'
                  leftSection={<IconTags size={16} />}
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runPhotoSearch();
                  }}
                />
                <Select
                  label='Photo category'
                  placeholder='Any category'
                  value={photoTypeFilter}
                  onChange={(value) => setPhotoTypeFilter(value ?? '')}
                  data={[{ value: '', label: 'Any category' }, ...ADDITIONAL_PHOTO_KIND_OPTIONS]}
                  searchable
                  clearable={false}
                />
                <Button
                  onClick={() => void runPhotoSearch()}
                  loading={photoSearchLoading}
                  fullWidth
                  leftSection={<IconSearch size={16} />}
                >
                  Search photos
                </Button>
                <Divider />
                <Text size='sm' c='dimmed'>
                  {filteredPhotoMatches.length} photo match{filteredPhotoMatches.length === 1 ? '' : 'es'} ·{' '}
                  {photoTagGroups.length} turtle{photoTagGroups.length === 1 ? '' : 's'}
                  {selectedSheetFilter ? ' · location filter on' : ''}
                </Text>
                <ScrollArea h={520}>
                  <Stack gap='md'>
                    {photoTagGroups.map((group) => {
                      const m0 = group[0];
                      const row = findTurtleForMatch(allTurtles, m0);
                      const sheetPath = m0.sheet_name.replace(/\\/g, '/');
                      const groupKey = `${m0.turtle_id}|${sheetPath}`;
                      const activeGroup = group.some((m) => m.path === selectedMatchPath);
                      return (
                        <Card
                          key={groupKey}
                          shadow='sm'
                          padding='md'
                          radius='md'
                          withBorder
                          bg={activeGroup ? 'var(--mantine-color-blue-light)' : undefined}
                          style={{
                            borderColor: activeGroup ? 'var(--mantine-color-blue-filled)' : undefined,
                            borderWidth: activeGroup ? 2 : undefined,
                          }}
                        >
                          <Stack gap='md'>
                            <Stack gap='xs'>
                              <Group justify='space-between' align='flex-start' wrap='wrap' gap='sm'>
                                <Stack gap={4} style={{ flex: '1 1 12rem', minWidth: 0 }}>
                                  <Text fw={600} size='md' lineClamp={2}>
                                    {row?.name?.trim() || m0.turtle_id}
                                  </Text>
                                  <Text size='xs' c='dimmed' lineClamp={2}>
                                    {sheetPath} · {group.length} photo{group.length === 1 ? '' : 's'} matching this
                                    search
                                  </Text>
                                  {row?.species ? (
                                    <Text size='xs' c='dimmed' lineClamp={1}>
                                      {row.species}
                                    </Text>
                                  ) : null}
                                </Stack>
                                <Button
                                  size='sm'
                                  variant='light'
                                  disabled={!row}
                                  style={{ flexShrink: 0 }}
                                  onClick={() => {
                                    setSelectedMatchPath(group[0]?.path ?? null);
                                    openTurtleFromMatch(group[0]);
                                  }}
                                >
                                  {row ? 'Open turtle' : 'Not in sheets'}
                                </Button>
                              </Group>
                            </Stack>
                            <ScrollArea type='scroll' scrollbars='x' offsetScrollbars>
                              <Group gap='md' wrap='nowrap' pb='xs' align='flex-start'>
                                {group.map((m) => {
                                  const previewSrc = getImageUrl(m.path, { maxDim: 360 });
                                  const fullSrc = getImageUrl(m.path);
                                  const oneActive = selectedMatchPath === m.path;
                                  return (
                                    <Box
                                      key={m.path}
                                      style={{
                                        width: 168,
                                        minWidth: 168,
                                        flexShrink: 0,
                                      }}
                                    >
                                      <Stack gap={8} align='stretch'>
                                        <Box
                                          pos='relative'
                                          style={{
                                            width: '100%',
                                            aspectRatio: '1',
                                            maxWidth: 160,
                                            marginInline: 'auto',
                                          }}
                                        >
                                          <Box
                                            style={{
                                              width: '100%',
                                              height: '100%',
                                              borderRadius: 'var(--mantine-radius-md)',
                                              overflow: 'hidden',
                                              cursor: 'pointer',
                                              border: oneActive
                                                ? '3px solid var(--mantine-color-blue-filled)'
                                                : '1px solid var(--mantine-color-default-border)',
                                              boxShadow: 'var(--mantine-shadow-sm)',
                                            }}
                                            onClick={() => {
                                              setSelectedMatchPath(m.path);
                                              setTagSearchLightbox(fullSrc);
                                            }}
                                          >
                                            <Image
                                              src={previewSrc}
                                              alt={m.filename}
                                              h='100%'
                                              w='100%'
                                              fit='cover'
                                              loading='lazy'
                                              decoding='async'
                                            />
                                          </Box>
                                          <ActionIcon
                                            pos='absolute'
                                            top={6}
                                            right={6}
                                            variant='filled'
                                            size='sm'
                                            radius='xl'
                                            aria-label='View full size'
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedMatchPath(m.path);
                                              setTagSearchLightbox(fullSrc);
                                            }}
                                          >
                                            <IconZoomIn size={14} />
                                          </ActionIcon>
                                        </Box>
                                        <Group gap={6} justify='center' wrap='wrap'>
                                          {(m.labels ?? []).map((lab, i) => (
                                            <Badge key={`${m.path}-lab-${i}`} size='xs' variant='light'>
                                              {lab}
                                            </Badge>
                                          ))}
                                        </Group>
                                        <Badge
                                          size='xs'
                                          variant='outline'
                                          tt={m.type === 'other' ? undefined : 'capitalize'}
                                          style={{ alignSelf: 'center' }}
                                        >
                                          {additionalPhotoKindLabel(m.type)}
                                        </Badge>
                                      </Stack>
                                    </Box>
                                  );
                                })}
                              </Group>
                            </ScrollArea>
                          </Stack>
                        </Card>
                      );
                    })}
                    {!photoSearchLoading && filteredPhotoMatches.length === 0 && tagQuery.trim() && (
                      <Text size='sm' c='dimmed' ta='center' py='md'>
                        No matches. Try another tag or adjust the location filter.
                      </Text>
                    )}
                  </Stack>
                </ScrollArea>
                <Modal
                  opened={!!tagSearchLightbox}
                  onClose={() => setTagSearchLightbox(null)}
                  title='Photo'
                  size='xl'
                  centered
                >
                  {tagSearchLightbox && (
                    <Image
                      src={tagSearchLightbox}
                      alt=''
                      fit='contain'
                      style={{ maxHeight: '85vh' }}
                    />
                  )}
                </Modal>
              </>
            )}
          </Stack>
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 8 }}>
        {selectedTurtle ? (
          <Stack gap='md'>
            {diskTurtleId && turtleImages && (turtleImages.history_dates.length > 0 || (turtleImages.deleted?.length ?? 0) > 0) && (
              <OldTurtlePhotosSection
                historyDates={turtleImages.history_dates}
                additional={turtleImages.additional}
                loose={turtleImages.loose}
                primaryInfo={turtleImages.primary_info}
                primaryCarapaceInfo={turtleImages.primary_carapace_info}
                deleted={turtleImages.deleted}
                onDelete={handlePhotoDelete}
                onRestore={handleRestore}
                onLabelsChange={async (path, labels) => {
                  if (!diskTurtleId) return;
                  try {
                    await setTurtleImageLabels(
                      diskTurtleId,
                      path,
                      labels,
                      dataPathHint,
                      selectedPrimaryId,
                    );
                    const refreshed = await getTurtleImages(
                      diskTurtleId,
                      dataPathHint,
                      selectedPrimaryId,
                    );
                    setTurtleImages(refreshed);
                    notifications.show({
                      title: 'Tags saved',
                      message: 'Photo tags updated',
                      color: 'green',
                    });
                  } catch (err) {
                    notifications.show({
                      title: 'Failed to save tags',
                      message: err instanceof Error ? err.message : String(err),
                      color: 'red',
                    });
                  }
                }}
              />
            )}
            {diskTurtleId && (
              <AdditionalImagesSection
                title='Additional Turtle Photos'
                images={todaysAdditionalImages.map((a) => ({
                  imagePath: a.path,
                  filename: a.path.split(/[/\\]/).pop() ?? a.path,
                  type: a.type,
                  labels: a.labels,
                  uploadTs: a.uploadTs,
                }))}
                turtleId={diskTurtleId}
                sheetName={dataPathHint}
                primaryId={selectedPrimaryId}
                onStagePhoto={handleStagePhoto}
                disabled={committing}
                onDelete={handleScratchpadDelete}
                onRefresh={async () => {
                  if (!diskTurtleId) return;
                  const res = await getTurtleImages(diskTurtleId, dataPathHint, selectedPrimaryId);
                  setTurtleImages(res);
                }}
              />
            )}
            {stagedPhotos.length > 0 && (
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Stack gap='sm'>
                  <Group justify='space-between' align='center'>
                    <Text fw={600} size='sm'>
                      Pending photos (uncommitted)
                    </Text>
                    <Badge color='yellow' variant='light'>
                      Apply on Update Turtle
                    </Badge>
                  </Group>
                  <Group gap='sm' wrap='wrap' align='flex-start'>
                    {stagedPhotos.map((s) => {
                      const isRef = isReferenceType(s.photoType);
                      const isWinner = isRef && s.replaceReference && replaceWinnerIds[s.photoType as ReferenceType] === s.id;
                      const isSuperseded = isRef && s.replaceReference && replaceWinnerIds[s.photoType as ReferenceType] !== s.id;
                      const prettyType = additionalPhotoKindLabel(s.photoType);
                      const badgeLabel = (() => {
                        if (isWinner) return `${prettyType} · will replace`;
                        if (isSuperseded) return `${prettyType} · superseded → Other`;
                        if (isRef && !s.replaceReference) return `${prettyType} · Other`;
                        return prettyType;
                      })();
                      const badgeColor = isWinner ? 'red' : isSuperseded ? 'orange' : 'blue';
                      return (
                        <Stack key={s.id} gap={4} align='center' maw={120}>
                          <Box pos='relative'>
                            <Box
                              style={{
                                width: 96,
                                height: 96,
                                borderRadius: 8,
                                overflow: 'hidden',
                                border: isWinner
                                  ? '2px solid var(--mantine-color-red-6)'
                                  : '1px solid var(--mantine-color-default-border)',
                              }}
                            >
                              <Image src={s.previewUrl} alt={s.photoType} w={96} h={96} fit='cover' />
                            </Box>
                            <Button
                              size='xs'
                              variant='filled'
                              color='red'
                              p={4}
                              onClick={() => removeStagedPhoto(s.id)}
                              style={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                minWidth: 24,
                                height: 24,
                              }}
                              disabled={committing}
                            >
                              <IconTrash size={12} />
                            </Button>
                          </Box>
                          <Badge size='xs' variant='light' color={badgeColor}>
                            {badgeLabel}
                          </Badge>
                          {/* TAG UI — wire up after main merge. The tagging system renames the
                              file at commit time based on this control's selection; store the
                              chosen tag on s.tag via setStagedPhotos and pass it through
                              commitStagedPhotos to the rename step. */}
                        </Stack>
                      );
                    })}
                  </Group>
                  {(() => {
                    // Fire only when a SINGLE type has more than one replace-flagged
                    // staged entry. One plastron + one carapace (both replace) is fine.
                    const perType: Record<ReferenceType, number> = { plastron: 0, carapace: 0 };
                    for (const s of stagedPhotos) {
                      if (isReferenceType(s.photoType) && s.replaceReference) {
                        perType[s.photoType] += 1;
                      }
                    }
                    const collidingTypes = (['plastron', 'carapace'] as ReferenceType[]).filter(
                      (t) => perType[t] > 1,
                    );
                    if (collidingTypes.length === 0) return null;
                    return (
                      <Alert color='orange' icon={<IconAlertTriangle size={16} />} p='xs'>
                        <Text size='xs'>
                          Multiple replacements staged for {collidingTypes.join(' and ')} —
                          only the last one of each type will become the new reference. Earlier
                          ones will be saved to the Other folder instead.
                        </Text>
                      </Alert>
                    );
                  })()}
                  <Divider />
                  <Stack gap={4}>
                    <Group justify='space-between' align='center' wrap='wrap' gap='xs'>
                      <Text size='xs' c='dimmed'>
                        Staged photos haven't been saved yet. This button saves images only —
                        to update the turtle's record fields, use the Update button in the
                        turtle info section below.
                      </Text>
                      <Button
                        color='blue'
                        size='xs'
                        onClick={handleCommitImagesOnly}
                        loading={committing}
                        disabled={committing || stagedPhotos.length === 0}
                      >
                        Update Turtle Images
                      </Button>
                    </Group>
                  </Stack>
                </Stack>
              </Paper>
            )}
            <Paper shadow='sm' p='md' radius='md' withBorder>
              <ScrollArea h={700}>
                <TurtleSheetsDataForm
                  initialData={selectedTurtle}
                  sheetName={selectedTurtle.sheet_name}
                  initialAvailableSheets={availableSheets.length > 0 ? availableSheets : undefined}
                  state={selectedTurtle.general_location || ''}
                  location={selectedTurtle.location || ''}
                  primaryId={selectedTurtle.primary_id || selectedTurtle.id || undefined}
                  mode='edit'
                  onSave={handleSaveWithStagedPhotos}
                />
              </ScrollArea>
            </Paper>
          </Stack>
        ) : (
          <Paper shadow='sm' p='xl' radius='md' withBorder>
            <Center py='xl'>
              <Stack gap='md' align='center'>
                <IconDatabase size={64} stroke={1.5} style={{ opacity: 0.3 }} />
                <Text size='lg' c='dimmed' ta='center'>
                  Select a turtle to edit
                </Text>
                <Text size='sm' c='dimmed' ta='center'>
                  Choose a turtle from the list, or search by photo tag and open a turtle from a match.
                </Text>
              </Stack>
            </Center>
          </Paper>
        )}
      </Grid.Col>

      <Modal
        opened={!!pendingPrompt}
        onClose={cancelPendingPrompt}
        title={`Replace ${pendingPrompt?.photoType ?? ''} reference?`}
        centered
        size='sm'
      >
        <Stack gap='md'>
          {pendingPrompt && (
            <Box
              style={{
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--mantine-color-default-border)',
                alignSelf: 'center',
              }}
            >
              <Image src={pendingPrompt.previewUrl} alt='pending' w={200} h={200} fit='cover' />
            </Box>
          )}
          <Text size='sm'>
            Do you want this photo to become the new {pendingPrompt?.photoType} reference image?
            The old one will be archived to <strong>{pendingPrompt?.photoType}/Old References</strong>.
            Saying <em>No</em> saves the photo to <strong>Other {pendingPrompt?.photoType === 'plastron' ? 'Plastrons' : 'Carapaces'}</strong> instead.
            Either choice is pending until you press <strong>Update Turtle</strong>.
          </Text>
          <Group justify='flex-end' gap='sm'>
            <Button variant='default' onClick={() => confirmPendingPrompt(false)}>
              No, save as Other
            </Button>
            <Button color='red' onClick={() => confirmPendingPrompt(true)}>
              Yes, replace reference
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ConfirmDeletePhotoModal
        opened={!!pendingDelete}
        previewPath={pendingDelete?.path}
        previewLabel={pendingDelete?.label}
        context={pendingDelete?.context ?? { kind: 'non_ref' }}
        onCancel={() => { if (!deleteBusy) setPendingDelete(null); }}
        onConfirm={confirmPendingDelete}
        busy={deleteBusy}
      />
    </Grid>
  );
}
