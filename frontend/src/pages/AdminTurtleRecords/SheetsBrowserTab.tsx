import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertTriangle, IconDatabase, IconMapPin, IconPhoto, IconSearch, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import {
  getImageUrl,
  getTurtleImages,
  getTurtlePrimariesBatch,
  uploadTurtleAdditionalImages,
  uploadTurtleReplaceReference,
  type TurtleImagesResponse,
} from '../../services/api';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { OldTurtlePhotosSection } from '../../components/OldTurtlePhotosSection';
import { useAdminTurtleRecordsContext } from './AdminTurtleRecordsContext';

type StagedType = 'microhabitat' | 'condition' | 'carapace' | 'plastron' | 'additional';
type ReferenceType = 'plastron' | 'carapace';

interface StagedPhoto {
  id: string;
  photoType: StagedType;
  file: File;
  /** Only meaningful for plastron/carapace; always false for other types. */
  replaceReference: boolean;
  previewUrl: string;
  /** Placeholder for the tag assigned by the tagging system (pending main merge).
   *  Once tagging is wired up, the commit step will use this to rename the file. */
  tag?: string;
}

const isReferenceType = (t: StagedType): t is ReferenceType =>
  t === 'plastron' || t === 'carapace';

function turtleKey(turtle: { primary_id?: string | null; id?: string | null; sheet_name?: string | null }) {
  const id = turtle.primary_id || turtle.id || '';
  const sheet = turtle.sheet_name ?? '';
  return `${id}|${sheet}`;
}

export function SheetsBrowserTab() {
  const ctx = useAdminTurtleRecordsContext();
  const [turtleImages, setTurtleImages] = useState<TurtleImagesResponse | null>(null);
  const [primaryImages, setPrimaryImages] = useState<Record<string, string | null>>({});
  // Staged photos awaiting commit on "Update Turtle" save — any type.
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<StagedPhoto | null>(null);
  const [committing, setCommitting] = useState(false);
  const previewCleanupRef = useRef<string[]>([]);
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

  const turtleId = selectedTurtle?.primary_id || selectedTurtle?.id;
  const sheetName = selectedTurtle?.sheet_name ?? null;

  useEffect(() => {
    if (!turtleId) {
      setTurtleImages(null);
      return;
    }
    getTurtleImages(turtleId, sheetName)
      .then(setTurtleImages)
      .catch(() => setTurtleImages(null));
  }, [turtleId, sheetName]);

  // Clear staged photos whenever the selected turtle changes (they apply to a specific turtle).
  useEffect(() => {
    setStagedPhotos((prev) => {
      for (const s of prev) URL.revokeObjectURL(s.previewUrl);
      return [];
    });
    setPendingPrompt(null);
  }, [turtleId, sheetName]);

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
    if (!turtleId || stagedPhotos.length === 0) return true;
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
          turtleId,
          nonReplace.map((s) => ({ type: s.photoType, file: s.file })),
          sheetName,
        );
      }

      // Replace-reference calls are sequential: each archives the current reference first.
      for (const s of replaceWinners) {
        await uploadTurtleReplaceReference(
          turtleId,
          s.file,
          s.photoType as ReferenceType,
          sheetName,
        );
      }

      for (const s of stagedPhotos) URL.revokeObjectURL(s.previewUrl);
      setStagedPhotos([]);
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
    if (turtleId) {
      try {
        const res = await getTurtleImages(turtleId, sheetName);
        setTurtleImages(res);
      } catch {
        /* ignore */
      }
    }
    return result;
  };

  // Load primary (plastron) images for the turtle list so we can show them in cards
  useEffect(() => {
    if (filteredTurtles.length === 0) {
      setPrimaryImages({});
      return;
    }
    const turtles = filteredTurtles.map((t) => ({
      turtle_id: t.primary_id || t.id || '',
      sheet_name: t.sheet_name ?? null,
    })).filter((t) => t.turtle_id);
    if (turtles.length === 0) {
      setPrimaryImages({});
      return;
    }
    getTurtlePrimariesBatch(turtles)
      .then((res) => {
        const map: Record<string, string | null> = {};
        res.images.forEach((img) => {
          const key = `${img.turtle_id}|${img.sheet_name ?? ''}`;
          map[key] = img.primary;
        });
        setPrimaryImages(map);
      })
      .catch(() => setPrimaryImages({}));
  }, [filteredTurtles]);

  // Show only images uploaded *today* in the Additional Turtle Photos pane.
  // Older uploads remain accessible via the "View Old Turtle Photos" date picker.
  // Matches the backend's local-date folder naming in add_additional_images_to_turtle.
  const allAdditionalImages = turtleImages?.additional ?? [];
  const todayIso = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const folderDateRegex = /[\\/](\d{4}-\d{2}-\d{2})[\\/]/;
  const todaysAdditionalImages = allAdditionalImages.filter((img) => {
    const match = img.path.match(folderDateRegex);
    return match?.[1] === todayIso;
  });

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
            <TextInput
              placeholder='Search by ID, name, species, location...'
              leftSection={<IconSearch size={16} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button onClick={() => loadAllTurtles()} loading={turtlesLoading} fullWidth>
              Refresh
            </Button>
            <Divider />
            <Text size='sm' c='dimmed'>
              {filteredTurtles.length} of {allTurtles.length} turtles
            </Text>
            <ScrollArea h={600}>
              <Stack gap='xs'>
                {filteredTurtles.map((turtle, index) => (
                  <Card
                    key={`${turtle.primary_id || turtle.id || 'turtle'}-${index}-${turtle.sheet_name || ''}`}
                    shadow='sm'
                    padding='sm'
                    radius='md'
                    withBorder
                    style={{
                      cursor: 'pointer',
                      border:
                        selectedTurtle?.primary_id ===
                        (turtle.primary_id || turtle.id)
                          ? '2px solid #228be6'
                          : '1px solid #dee2e6',
                      backgroundColor:
                        selectedTurtle?.primary_id ===
                        (turtle.primary_id || turtle.id)
                          ? '#e7f5ff'
                          : 'white',
                    }}
                    onClick={() => setSelectedTurtle(turtle)}
                  >
                    <Group justify='space-between' align='flex-start' wrap='nowrap' gap='sm'>
                      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                        {turtle.name ? (
                          <Text fw={600} size='md' c='blue'>
                            {turtle.name}
                          </Text>
                        ) : (
                          <Text fw={500} size='sm' c='dimmed' fs='italic'>
                            No name
                          </Text>
                        )}

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
                            src={getImageUrl(primaryImages[turtleKey(turtle)]!)}
                            alt='Plastron'
                            fit='contain'
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
          </Stack>
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 8 }}>
        {selectedTurtle ? (
          <Stack gap='md'>
            {turtleId && turtleImages && turtleImages.history_dates.length > 0 && (
              <OldTurtlePhotosSection
                historyDates={turtleImages.history_dates}
                additional={turtleImages.additional}
                loose={turtleImages.loose}
                primaryInfo={turtleImages.primary_info}
                primaryCarapaceInfo={turtleImages.primary_carapace_info}
              />
            )}
            {turtleId && (
              <AdditionalImagesSection
                title='Additional Turtle Photos'
                images={todaysAdditionalImages.map((a) => ({
                  imagePath: a.path,
                  filename: a.path.split(/[/\\]/).pop() ?? a.path,
                  type: a.type,
                }))}
                turtleId={turtleId}
                sheetName={sheetName}
                onStagePhoto={handleStagePhoto}
                disabled={committing}
                onRefresh={async () => {
                  if (!turtleId) return;
                  const res = await getTurtleImages(turtleId, sheetName);
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
                      const badgeLabel = (() => {
                        if (isWinner) return `${s.photoType} · will replace`;
                        if (isSuperseded) return `${s.photoType} · superseded → Other`;
                        if (isRef && !s.replaceReference) return `${s.photoType} · Other`;
                        return s.photoType;
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
                  {(replaceWinnerIds.plastron || replaceWinnerIds.carapace) &&
                    stagedPhotos.filter((s) => isReferenceType(s.photoType) && s.replaceReference).length > 1 && (
                      <Alert color='orange' icon={<IconAlertTriangle size={16} />} p='xs'>
                        <Text size='xs'>
                          Multiple replacements staged for the same type — only the last one of each
                          type will become the new reference. Earlier ones will be saved to the
                          Other folder instead.
                        </Text>
                      </Alert>
                    )}
                </Stack>
              </Paper>
            )}
            <Paper shadow='sm' p='md' radius='md' withBorder>
              <ScrollArea h={700}>
                <TurtleSheetsDataForm
                  initialData={selectedTurtle}
                  sheetName={selectedTurtle.sheet_name}
                  initialAvailableSheets={
                    availableSheets.length > 0 ? availableSheets : undefined
                  }
                  state={selectedTurtle.general_location || ''}
                  location={selectedTurtle.location || ''}
                  primaryId={
                    selectedTurtle.primary_id || selectedTurtle.id || undefined
                  }
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
                  Choose a turtle from the list to view and edit its Google Sheets
                  data
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
    </Grid>
  );
}