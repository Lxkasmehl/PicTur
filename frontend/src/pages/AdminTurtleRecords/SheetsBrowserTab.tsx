import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Chip,
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
import {
  IconAlertTriangle,
  IconDatabase,
  IconDownload,
  IconMapPin,
  IconPhoto,
  IconSearch,
  IconSkull,
  IconTags,
  IconZoomIn,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import {
  downloadAdminBackupArchive,
  getImageUrl,
  getTurtleImages,
  isAdminRole,
  searchTurtleImagesByLabel,
  setTurtleImageLabels,
  type TurtleAdditionalLabelSearchMatch,
  type TurtleImagesResponse,
} from '../../services/api';
import {
  turtleDataFolderHint,
  turtleDiskFolderId,
  type TurtleSheetsData,
} from '../../services/api/sheets';
import { useUser } from '../../hooks/useUser';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { OldTurtlePhotosSection } from '../../components/OldTurtlePhotosSection';
import { ConfirmDeletePhotoModal } from '../../components/ConfirmDeletePhotoModal';
import { useAdminTurtleRecordsContext } from './AdminTurtleRecordsContext';
import { MergeTurtlesModal } from './MergeTurtlesModal';
import { StagedPhotosPanel } from './components/StagedPhotosPanel';
import {
  ADDITIONAL_PHOTO_KIND_OPTIONS,
  additionalPhotoKindLabel,
} from '../../constants/additionalPhotoKinds';
import {
  usePrimaryImagesBatch,
  turtleKey,
  type PrimaryImageEntry,
} from './hooks/usePrimaryImagesBatch';
import { usePhotoDelete } from './hooks/usePhotoDelete';
import { useStagedPhotos } from './hooks/useStagedPhotos';

// StagedType, ReferenceType, isReferenceType → hooks/useStagedPhotos.ts
// PrimaryImageEntry, turtleKey → hooks/usePrimaryImagesBatch.ts

/** "Null" sub-state: which kind of reference gap a sheet turtle has, or null
 *  when it is not Null (has a plastron ref, or lacks the Primary ID + Bio ID
 *  that make it eligible). */
type NullSubState = 'no-disk' | 'no-plastron-no-carapace' | 'no-plastron' | null;

function computeNullSubState(
  turtle: TurtleSheetsData,
  entry: PrimaryImageEntry | undefined,
): NullSubState {
  const hasPrimaryId = (turtle.primary_id || '').trim().length > 0;
  const hasBioId = (turtle.id || '').trim().length > 0;
  if (!hasPrimaryId || !hasBioId) return null;
  if (!entry) return null; // not loaded yet — callers guard on primaryImagesLoading
  if (entry.folderStatus === 'no_folder' || entry.folderStatus === 'empty_folder') {
    return 'no-disk';
  }
  if (entry.path) return null; // has a plastron reference — not Null
  return entry.hasCarapace ? 'no-plastron' : 'no-plastron-no-carapace';
}

const NULL_BADGE = {
  'no-disk': { color: 'red', label: 'No photos on disk' },
  'no-plastron-no-carapace': { color: 'orange', label: 'No plastron or carapace' },
  'no-plastron': { color: 'yellow', label: 'No plastron ref' },
} as const;

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
  const [listMode, setListMode] = useState<'records' | 'tags'>('records');
  const [tagQuery, setTagQuery] = useState('');
  const [photoTypeFilter, setPhotoTypeFilter] = useState<string | null>('');
  const [photoMatches, setPhotoMatches] = useState<TurtleAdditionalLabelSearchMatch[]>(
    [],
  );
  const [photoSearchLoading, setPhotoSearchLoading] = useState(false);
  const [selectedMatchPath, setSelectedMatchPath] = useState<string | null>(null);
  const [tagSearchLightbox, setTagSearchLightbox] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [mergeTurtlesModalOpen, setMergeTurtlesModalOpen] = useState(false);
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
    nullFilterActive,
    setNullFilterActive,
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

  // --- Hooks ---
  const { primaryImages, setPrimaryImages, primaryImagesLoading } =
    usePrimaryImagesBatch(filteredTurtles);

  const {
    stagedPhotos,
    pendingPrompt,
    setPendingPrompt,
    committing,
    replaceWinnerIds,
    handleStagePhoto,
    confirmPendingPrompt,
    cancelPendingPrompt,
    removeStagedPhoto,
    handleSaveWithStagedPhotos,
    handleCommitImagesOnly,
    clearStagedPhotos,
    revokeAllPreviewUrls,
  } = useStagedPhotos({
    diskTurtleId,
    dataPathHint,
    selectedPrimaryId,
    selectedTurtle,
    setTurtleImages,
    setPrimaryImages,
    onSaveTurtle,
  });

  const {
    pendingDelete,
    setPendingDelete,
    deleteBusy,
    refetchImages,
    handlePhotoDelete,
    handleScratchpadDelete,
    confirmPendingDelete,
    handleRestore,
  } = usePhotoDelete({
    diskTurtleId,
    dataPathHint,
    selectedPrimaryId,
    turtleImages,
    setTurtleImages,
  });

  // Clear staged photos when turtle changes
  useEffect(() => {
    clearStagedPhotos();
    setPendingPrompt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diskTurtleId, dataPathHint]);

  // Revoke preview URLs on unmount
  useEffect(() => {
    return () => revokeAllPreviewUrls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  type ScratchpadImage = {
    path: string;
    type: string;
    labels?: string[];
    uploadTs?: number | null;
  };

  const todaysAdditionalImages: ScratchpadImage[] = (() => {
    const out: ScratchpadImage[] = [];

    for (const img of turtleImages?.additional ?? []) {
      const match = img.path.match(folderDateRegex);
      if (match?.[1] === todayIso) {
        out.push({
          path: img.path,
          type: img.type,
          labels: img.labels,
          uploadTs: img.upload_ts,
        });
      }
    }

    // Pass the loose ``source`` straight through as the type so the section
    // header reflects the photo's role: 'plastron_old_ref' / 'plastron_other'
    // / 'carapace_old_ref' / 'carapace_other'. Previously these all collapsed
    // to 'plastron' / 'carapace' and merged with active references into a
    // single misleading "Plastron (additional)" pile.
    for (const img of turtleImages?.loose ?? []) {
      if (img.upload_date === todayIso) {
        out.push({
          path: img.path,
          type: img.source,
          labels: img.labels,
          uploadTs: img.upload_ts,
        });
      }
    }

    // Active references uploaded today get their own dedicated section so
    // admins can see at a glance "this is the new SuperPoint reference."
    const primaryInfo = turtleImages?.primary_info;
    if (primaryInfo && primaryInfo.upload_date === todayIso) {
      out.push({
        path: primaryInfo.path,
        type: 'plastron_active',
        labels: primaryInfo.labels,
        uploadTs: primaryInfo.upload_ts,
      });
    }
    const primaryCarapaceInfo = turtleImages?.primary_carapace_info;
    if (primaryCarapaceInfo && primaryCarapaceInfo.upload_date === todayIso) {
      out.push({
        path: primaryCarapaceInfo.path,
        type: 'carapace_active',
        labels: primaryCarapaceInfo.labels,
        uploadTs: primaryCarapaceInfo.upload_ts,
      });
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

  // When the "Null" filter is on, narrow to turtles that actually have a
  // reference gap once the disk-status batch has loaded. While it's still
  // loading, show all eligible rows (filteredTurtles is already pre-filtered to
  // Primary-ID + Bio-ID holders) so the list doesn't flicker empty.
  const listForRecords =
    nullFilterActive && !primaryImagesLoading
      ? filteredTurtles.filter(
          (t) => computeNullSubState(t, primaryImages[turtleKey(t)]) !== null,
        )
      : filteredTurtles;

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
                <Group gap='xs' wrap='nowrap'>
                  <Chip
                    checked={nullFilterActive}
                    onChange={setNullFilterActive}
                    color='orange'
                    variant='outline'
                    size='sm'
                  >
                    Null — missing reference photos
                  </Chip>
                  {nullFilterActive && primaryImagesLoading && (
                    <Loader size='xs' aria-label='Checking on-disk photo status' />
                  )}
                </Group>
                <Button
                  onClick={() => loadAllTurtles()}
                  loading={turtlesLoading}
                  fullWidth
                >
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
                                message:
                                  'Save the ZIP from your browser downloads folder.',
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
                      Admin only. ZIP includes on-disk data and CSV/JSON sheet snapshots
                      for disaster recovery.
                    </Text>
                  </>
                )}
                <Divider />
                <Text size='sm' c='dimmed'>
                  {listForRecords.length} of {allTurtles.length} turtles
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
                        <Group
                          justify='space-between'
                          align='flex-start'
                          wrap='nowrap'
                          gap='sm'
                        >
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
                              {!primaryImagesLoading &&
                                (() => {
                                  const sub = computeNullSubState(
                                    turtle,
                                    primaryImages[turtleKey(turtle)],
                                  );
                                  if (!sub) return null;
                                  const cfg = NULL_BADGE[sub];
                                  return (
                                    <Badge
                                      size='sm'
                                      color={cfg.color}
                                      variant='filled'
                                      leftSection={<IconAlertTriangle size={12} />}
                                    >
                                      {cfg.label}
                                    </Badge>
                                  );
                                })()}
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
                                <Loader
                                  size='sm'
                                  color='gray'
                                  aria-label='Loading plastron preview'
                                />
                              </Center>
                            ) : primaryImages[turtleKey(turtle)]?.path ? (
                              <Image
                                src={getImageUrl(
                                  primaryImages[turtleKey(turtle)]!.path!,
                                  {
                                    version: primaryImages[turtleKey(turtle)]!.ts,
                                    maxDim: 240,
                                  },
                                )}
                                alt='Plastron'
                                fit='contain'
                                loading='lazy'
                                decoding='async'
                                style={{
                                  width: '100%',
                                  height: 'auto',
                                  display: 'block',
                                }}
                              />
                            ) : (
                              <Center w='100%' h='100%' style={{ minHeight: 84 }}>
                                <IconPhoto
                                  size={28}
                                  stroke={1.2}
                                  style={{ opacity: 0.4 }}
                                />
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
                  Find additional photos by tag, category, or both. Results respect the
                  location filter above.
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
                  data={[
                    { value: '', label: 'Any category' },
                    ...ADDITIONAL_PHOTO_KIND_OPTIONS,
                  ]}
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
                  {filteredPhotoMatches.length} photo match
                  {filteredPhotoMatches.length === 1 ? '' : 'es'} ·{' '}
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
                            borderColor: activeGroup
                              ? 'var(--mantine-color-blue-filled)'
                              : undefined,
                            borderWidth: activeGroup ? 2 : undefined,
                          }}
                        >
                          <Stack gap='md'>
                            <Stack gap='xs'>
                              <Group
                                justify='space-between'
                                align='flex-start'
                                wrap='wrap'
                                gap='sm'
                              >
                                <Stack gap={4} style={{ flex: '1 1 12rem', minWidth: 0 }}>
                                  <Text fw={600} size='md' lineClamp={2}>
                                    {row?.name?.trim() || m0.turtle_id}
                                  </Text>
                                  <Text size='xs' c='dimmed' lineClamp={2}>
                                    {sheetPath} · {group.length} photo
                                    {group.length === 1 ? '' : 's'} matching this search
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
                                            <Badge
                                              key={`${m.path}-lab-${i}`}
                                              size='xs'
                                              variant='light'
                                            >
                                              {lab}
                                            </Badge>
                                          ))}
                                        </Group>
                                        <Badge
                                          size='xs'
                                          variant='outline'
                                          tt={
                                            m.type === 'other' ? undefined : 'capitalize'
                                          }
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
                    {!photoSearchLoading &&
                      filteredPhotoMatches.length === 0 &&
                      tagQuery.trim() && (
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
            {diskTurtleId &&
              turtleImages &&
              (turtleImages.history_dates.length > 0 ||
                (turtleImages.deleted?.length ?? 0) > 0) && (
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
                  const res = await getTurtleImages(
                    diskTurtleId,
                    dataPathHint,
                    selectedPrimaryId,
                  );
                  setTurtleImages(res);
                }}
              />
            )}
            <StagedPhotosPanel
              photos={stagedPhotos}
              replaceWinnerIds={replaceWinnerIds}
              committing={committing}
              onRemovePhoto={removeStagedPhoto}
              onCommitImagesOnly={() => handleCommitImagesOnly(refetchImages)}
            />
            <Paper shadow='sm' p='md' radius='md' withBorder>
              <Group justify='flex-end' mb='sm'>
                <Button
                  variant='outline'
                  color='orange'
                  size='xs'
                  onClick={() => setMergeTurtlesModalOpen(true)}
                >
                  Merge Duplicate…
                </Button>
              </Group>
              <ScrollArea h={700}>
                <TurtleSheetsDataForm
                  initialData={selectedTurtle}
                  sheetName={selectedTurtle.sheet_name}
                  initialAvailableSheets={
                    availableSheets.length > 0 ? availableSheets : undefined
                  }
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
                  Choose a turtle from the list, or search by photo tag and open a turtle
                  from a match.
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
              <Image
                src={pendingPrompt.previewUrl}
                alt='pending'
                w={200}
                h={200}
                fit='cover'
              />
            </Box>
          )}
          <Text size='sm'>
            Do you want this photo to become the new {pendingPrompt?.photoType} reference
            image? The old one will be archived to{' '}
            <strong>{pendingPrompt?.photoType}/Old References</strong>. Saying <em>No</em>{' '}
            saves the photo to{' '}
            <strong>
              Other {pendingPrompt?.photoType === 'plastron' ? 'Plastrons' : 'Carapaces'}
            </strong>{' '}
            instead. Either choice is pending until you press{' '}
            <strong>Update Turtle</strong>.
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
        onCancel={() => {
          if (!deleteBusy) setPendingDelete(null);
        }}
        onConfirm={confirmPendingDelete}
        busy={deleteBusy}
      />

      {selectedTurtle && mergeTurtlesModalOpen && (
        <MergeTurtlesModal
          opened={mergeTurtlesModalOpen}
          onClose={() => setMergeTurtlesModalOpen(false)}
          primaryTurtle={selectedTurtle}
          onMergeComplete={() => {
            setMergeTurtlesModalOpen(false);
            setSelectedTurtle(null);
            loadAllTurtles();
          }}
        />
      )}
    </Grid>
  );
}
