import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Grid,
  Group,
  Image,
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
import { notifications } from '@mantine/notifications';
import {
  IconDatabase,
  IconDownload,
  IconMapPin,
  IconPhoto,
  IconSearch,
  IconSkull,
  IconTags,
  IconZoomIn,
} from '@tabler/icons-react';
import {
  downloadAdminBackupArchive,
  getImageUrl,
  getTurtleImages,
  getTurtlePrimariesBatch,
  isAdminRole,
  uploadTurtleIdentifierPlastron,
  searchTurtleImagesByLabel,
  type TurtleAdditionalLabelSearchMatch,
  type TurtleImageAdditional,
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
import { formatSingleDateTokenToUs } from '../../utils/usDateFormat';
import { validateFile } from '../../utils/fileValidation';
import { useAdminTurtleRecordsContext } from './AdminTurtleRecordsContext';
import {
  ADDITIONAL_PHOTO_KIND_OPTIONS,
  additionalPhotoKindLabel,
} from '../../constants/additionalPhotoKinds';

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

function groupAdditionalByDateFolder(images: TurtleImageAdditional[]): { label: string; items: TurtleImageAdditional[] }[] {
  const map = new Map<string, TurtleImageAdditional[]>();
  const dateRegex = /(\d{4}-\d{2}-\d{2})[/\\]/;
  for (const img of images) {
    const m = img.path.match(dateRegex);
    const key = m ? m[1] : 'Other / legacy';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(img);
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (a === 'Other / legacy') return 1;
    if (b === 'Other / legacy') return -1;
    return b.localeCompare(a);
  });
  return keys.map((label) => ({ label, items: map.get(label)! }));
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
  const [primaryImages, setPrimaryImages] = useState<Record<string, string | null>>({});
  const [listMode, setListMode] = useState<'records' | 'tags'>('records');
  const [tagQuery, setTagQuery] = useState('');
  const [photoTypeFilter, setPhotoTypeFilter] = useState<string | null>('');
  const [photoMatches, setPhotoMatches] = useState<TurtleAdditionalLabelSearchMatch[]>([]);
  const [photoSearchLoading, setPhotoSearchLoading] = useState(false);
  const [selectedMatchPath, setSelectedMatchPath] = useState<string | null>(null);
  const [tagSearchLightbox, setTagSearchLightbox] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [identifierSubmitting, setIdentifierSubmitting] = useState(false);
  const identifierFileInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!diskTurtleId) {
      setTurtleImages(null);
      return;
    }
    getTurtleImages(diskTurtleId, dataPathHint)
      .then(setTurtleImages)
      .catch(() => setTurtleImages(null));
  }, [diskTurtleId, dataPathHint]);

  useEffect(() => {
    if (filteredTurtles.length === 0) {
      setPrimaryImages({});
      return;
    }
    const rows = filteredTurtles
      .map((t) => ({
        key: turtleKey(t),
        turtle_id: turtleDiskFolderId(t),
        sheet_name: turtleDataFolderHint(t) ?? t.sheet_name ?? null,
      }))
      .filter((r) => r.turtle_id);
    if (rows.length === 0) {
      setPrimaryImages({});
      return;
    }
    getTurtlePrimariesBatch(rows.map((r) => ({ turtle_id: r.turtle_id, sheet_name: r.sheet_name })))
      .then((res) => {
        const map: Record<string, string | null> = {};
        res.images.forEach((img, i) => {
          const key = rows[i]?.key;
          if (key) map[key] = img.primary ?? null;
        });
        setPrimaryImages(map);
      })
      .catch(() => setPrimaryImages({}));
  }, [filteredTurtles]);

  const additionalGroups = useMemo(() => {
    const all = turtleImages?.additional ?? [];
    return groupAdditionalByDateFolder(all);
  }, [turtleImages?.additional]);

  const latestDate = useMemo(() => {
    const all = turtleImages?.additional ?? [];
    let latest = '';
    const dr = /(\d{4}-\d{2}-\d{2})[/\\]/;
    for (const img of all) {
      const m = img.path.match(dr);
      if (m && m[1] > latest) latest = m[1];
    }
    return latest;
  }, [turtleImages?.additional]);

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
                            {primaryImages[turtleKey(turtle)] ? (
                              <Image
                                src={getImageUrl(primaryImages[turtleKey(turtle)]!, { maxDim: 240 })}
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
            {diskTurtleId && (
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Stack gap='sm'>
                  <Text fw={600} size='sm'>
                    Identifier plastron (SuperPoint reference)
                  </Text>
                  <Text size='xs' c='dimmed'>
                    Matching uses ref_data with this turtle id (image plus .pt tensor). Replace archives the
                    previous master into loose_images. A second underside photo only: use Plastron (extra) under
                    additional photos below. For multi-site tabs, set <strong>General location</strong> and{' '}
                    <strong>Location</strong> in the sheet so paths match{' '}
                    <code>{'data/<general>/<site>/'}</code>{' '}
                    on disk (same as review uploads); the backend also searches under each site when only the state
                    segment is given as the path hint.
                  </Text>
                  <Group align='flex-start' wrap='wrap' gap='md'>
                    <Box
                      style={{
                        width: 160,
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid var(--mantine-color-default-border)',
                        minHeight: 100,
                        backgroundColor: 'var(--mantine-color-gray-0)',
                      }}
                    >
                      {turtleImages?.primary ? (
                        <Image
                          src={getImageUrl(turtleImages.primary, { maxDim: 320 })}
                          alt='Identifier plastron'
                          fit='contain'
                          loading='lazy'
                          decoding='async'
                          style={{ width: '100%', height: 'auto', display: 'block' }}
                        />
                      ) : (
                        <Center p='md' style={{ minHeight: 100 }}>
                          <Text size='xs' c='dimmed' ta='center'>
                            No identifier image yet — typical for a new sheet-only row.
                          </Text>
                        </Center>
                      )}
                    </Box>
                    <Stack gap='xs' style={{ flex: '1 1 12rem' }}>
                      <input
                        ref={identifierFileInputRef}
                        type='file'
                        accept='image/*'
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.currentTarget.value = '';
                          if (!file || !diskTurtleId) return;
                          const check = validateFile(file);
                          if (!check.isValid) {
                            if (check.error) {
                              notifications.show({
                                title: 'Invalid file',
                                message: check.error,
                                color: 'red',
                              });
                            }
                            return;
                          }
                          void (async () => {
                            setIdentifierSubmitting(true);
                            try {
                              await uploadTurtleIdentifierPlastron(
                                diskTurtleId,
                                file,
                                dataPathHint,
                                turtleImages?.primary ? 'replace' : 'set_if_missing',
                              );
                              notifications.show({
                                title: 'Saved',
                                message: turtleImages?.primary
                                  ? 'Identifier plastron replaced; search index updated.'
                                  : 'Identifier plastron set; search index updated.',
                                color: 'green',
                              });
                              const res = await getTurtleImages(diskTurtleId, dataPathHint);
                              setTurtleImages(res);
                              if (selectedTurtle) {
                                const pr = await getTurtlePrimariesBatch([
                                  { turtle_id: diskTurtleId, sheet_name: dataPathHint },
                                ]);
                                const p = pr.images[0]?.primary ?? null;
                                setPrimaryImages((prev) => ({
                                  ...prev,
                                  [turtleKey(selectedTurtle)]: p,
                                }));
                              }
                            } catch (err) {
                              notifications.show({
                                title: 'Error',
                                message: err instanceof Error ? err.message : 'Upload failed',
                                color: 'red',
                              });
                            } finally {
                              setIdentifierSubmitting(false);
                            }
                          })();
                        }}
                      />
                      <Button
                        size='sm'
                        variant='light'
                        leftSection={<IconPhoto size={16} />}
                        loading={identifierSubmitting}
                        disabled={!diskTurtleId || (!dataPathHint && !turtleImages?.primary)}
                        onClick={() => identifierFileInputRef.current?.click()}
                      >
                        {turtleImages?.primary ? 'Replace identifier…' : 'Set identifier…'}
                      </Button>
                    </Stack>
                  </Group>
                </Stack>
              </Paper>
            )}
            {diskTurtleId &&
              additionalGroups.map(({ label, items }) => (
                <AdditionalImagesSection
                  key={label}
                  title={`Additional photos — ${label}`}
                  images={items.map((a) => ({
                    imagePath: a.path,
                    filename: a.path.split(/[/\\]/).pop() ?? a.path,
                    type: a.type,
                    labels: a.labels,
                  }))}
                  turtleId={diskTurtleId}
                  sheetName={dataPathHint}
                  onRefresh={async () => {
                    if (!diskTurtleId) return;
                    const res = await getTurtleImages(diskTurtleId, dataPathHint);
                    setTurtleImages(res);
                  }}
                />
              ))}
            {diskTurtleId && additionalGroups.length === 0 && (
              <AdditionalImagesSection
                title={`Turtle photos (Microhabitat / Condition)${latestDate ? ` - ${formatSingleDateTokenToUs(latestDate)}` : ''}`}
                images={[]}
                turtleId={diskTurtleId}
                sheetName={dataPathHint}
                onRefresh={async () => {
                  if (!diskTurtleId) return;
                  const res = await getTurtleImages(diskTurtleId, dataPathHint);
                  setTurtleImages(res);
                }}
              />
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
                  onSave={onSaveTurtle}
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
    </Grid>
  );
}
