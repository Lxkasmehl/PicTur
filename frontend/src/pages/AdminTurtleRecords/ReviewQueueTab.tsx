import {
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Grid,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import {
  IconCheck,
  IconList,
  IconMapPin,
  IconPhoto,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { getImageUrl, getTurtleImages, classifyReviewPacket, crossCheckReviewPacket, type TurtleImagesResponse, type PhotoType } from '../../services/api';
import { notifications } from '@mantine/notifications';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { MapDisplay } from '../../components/MapDisplay';
import { DeleteQueueItemModal } from './DeleteQueueItemModal';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { useAdminTurtleRecordsContext } from './AdminTurtleRecordsContext';

export function ReviewQueueTab() {
  const ctx = useAdminTurtleRecordsContext();
  const [selectedCandidateTurtleImages, setSelectedCandidateTurtleImages] = useState<TurtleImagesResponse | null>(null);
  const [crossCheckResults, setCrossCheckResults] = useState<Array<{ turtle_id: string; location: string; confidence: number; score: number; image_path: string }> | null>(null);
  const [crossCheckLoading, setCrossCheckLoading] = useState(false);
  const [matchingLoading, setMatchingLoading] = useState<false | 'match' | 'crosscheck'>(false);
  const [matchingConfirm, setMatchingConfirm] = useState<'match' | 'crosscheck' | 'trash' | null>(null);
  const [trashLoading, setTrashLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const {
    queueLoading,
    queueItems,
    selectedItem,
    selectedCandidate,
    processing,
    sheetsData,
    primaryId,
    loadingTurtleData,
    candidateNames,
    candidateOriginalIds,
    loadingCandidateNames,
    deleteModalOpen,
    deleting,
    availableSheets,
    sheetsFormRef,
    clearSelectedItem: onBackToList,
    handleOpenDeleteModal: onOpenDeleteModal,
    closeDeleteModal: onCloseDeleteModal,
    handleConfirmDelete: onConfirmDelete,
    handleItemSelect: onItemSelect,
    handleSaveSheetsData: onSaveSheetsData,
    handleSaveAndApprove: onSaveAndApprove,
    handleCombinedButtonClick: onCombinedButtonClick,
    handleCreateNewTurtle: onCreateNewTurtle,
    refreshQueueItem,
    deleteQueueItemDirect,
  } = ctx;

  const state = selectedItem?.metadata.state || '';
  const location = selectedItem?.metadata.location || '';
  const fullSheetName =
    state && location ? `${state}/${location}` : state || location || null;

  const isAdminUpload = (requestId: string | undefined) =>
    Boolean(requestId?.startsWith('admin_'));
  const uploadSourceLabel = (requestId: string | undefined) =>
    isAdminUpload(requestId) ? 'Admin upload' : 'Community upload';
  const uploadSourceBadgeColor = (requestId: string | undefined) =>
    isAdminUpload(requestId) ? 'blue' : 'teal';

  // Clear cross-check and confirm state when item changes
  useEffect(() => {
    setCrossCheckResults(null);
    setMatchingConfirm(null);
  }, [selectedItem?.request_id]);

  // Drop selections that no longer exist (e.g. after a delete refresh).
  useEffect(() => {
    setSelectedIds((prev) => {
      const present = new Set(queueItems.map((q) => q.request_id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (present.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [queueItems]);

  const toggleSelected = (requestId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  };

  const allSelected = useMemo(
    () => queueItems.length > 0 && queueItems.every((q) => selectedIds.has(q.request_id)),
    [queueItems, selectedIds],
  );

  const someSelected = selectedIds.size > 0 && !allSelected;

  const handleSelectAllToggle = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(queueItems.map((q) => q.request_id)));
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    setBulkProgress({ done: 0, total: ids.length });
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteQueueItemDirect(id);
        succeeded++;
      } catch {
        failed++;
      }
      setBulkProgress((p) => ({ done: p.done + 1, total: p.total }));
    }
    setBulkDeleting(false);
    setBulkConfirmOpen(false);
    setSelectedIds(new Set());
    setBulkProgress({ done: 0, total: 0 });
    notifications.show({
      title: failed === 0 ? 'Deleted' : 'Partially deleted',
      message:
        failed === 0
          ? `${succeeded} upload${succeeded === 1 ? '' : 's'} removed from queue.`
          : `${succeeded} removed, ${failed} failed.`,
      color: failed === 0 ? 'green' : 'orange',
    });
  };

  // Load selected candidate turtle's existing additional images when a match is selected (must run before any early return)
  useEffect(() => {
    if (!selectedCandidate || !selectedItem) {
      setSelectedCandidateTurtleImages(null);
      return;
    }
    getTurtleImages(selectedCandidate, fullSheetName)
      .then(setSelectedCandidateTurtleImages)
      .catch(() => setSelectedCandidateTurtleImages(null));
  }, [selectedCandidate, selectedItem?.request_id, fullSheetName]);

  if (queueLoading) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }

  if (queueItems.length === 0) {
    return (
      <Paper shadow='sm' p='xl' radius='md' withBorder>
        <Center py='xl'>
          <Stack gap='md' align='center'>
            <IconPhoto size={64} stroke={1.5} style={{ opacity: 0.3 }} />
            <Text size='lg' c='dimmed' ta='center'>
              No pending reviews
            </Text>
          </Stack>
        </Center>
      </Paper>
    );
  }

  return (
    <>
      {selectedItem ? (
        <Stack gap='lg' style={{ position: 'relative' }}>
          <Group justify='space-between' wrap='wrap' gap='xs'>
            <Group gap='sm'>
              <Button
                variant='subtle'
                leftSection={<IconList size={16} />}
                size='sm'
                onClick={onBackToList}
              >
                ← Back to list ({queueItems.length} pending)
              </Button>
              <Badge
                size='lg'
                variant='light'
                color={uploadSourceBadgeColor(selectedItem.request_id)}
                data-testid='review-upload-source-badge'
              >
                {uploadSourceLabel(selectedItem.request_id)}
              </Badge>
              <Badge
                size='lg'
                variant='light'
                color={selectedItem.photo_type === 'plastron' ? 'grape' : 'teal'}
                data-testid='review-photo-type-badge'
              >
                {selectedItem.photo_type === 'plastron' ? 'Plastron' : 'Carapace'}
              </Badge>
            </Group>
            <Button
              variant='subtle'
              color='red'
              size='sm'
              leftSection={<IconTrash size={16} />}
              onClick={(e) => onOpenDeleteModal(selectedItem, e)}
            >
              Delete this upload
            </Button>
          </Group>

          {loadingTurtleData && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                borderRadius: 'var(--mantine-radius-md)',
              }}
            >
              <Stack align='center' gap='md'>
                <Loader size='xl' />
                <Text size='lg' fw={500}>
                  Loading turtle data…
                </Text>
              </Stack>
            </div>
          )}

          {/* Uploaded photo — full width */}
          <Paper shadow='sm' p='md' radius='md' withBorder>
            <Stack gap='sm'>
              <Text fw={500} size='lg'>
                Uploaded Photo
              </Text>
              {selectedItem.uploaded_image && (
                <Image
                  src={getImageUrl(selectedItem.uploaded_image)}
                  alt='Uploaded photo'
                  radius='md'
                  style={{
                    maxHeight: 'min(500px, 60vh)',
                    objectFit: 'contain',
                    width: '100%',
                  }}
                />
              )}
            </Stack>
          </Paper>

          {/* Matching control: proceed / cross-check / delete (unclassified) or status (already matched) */}
          {selectedItem.photo_type === 'unclassified' ? (
            <Paper shadow='sm' p='md' radius='md' withBorder>
              {matchingLoading ? (
                <Group gap='md' align='center'>
                  <Loader size='sm' />
                  <Text fw={500} size='sm'>
                    Running carapace matching{matchingLoading === 'crosscheck' ? ' + plastron cross-check' : ''}...
                  </Text>
                </Group>
              ) : trashLoading ? (
                <Group gap='md' align='center'>
                  <Loader size='sm' color='red' />
                  <Text fw={500} size='sm'>Deleting upload...</Text>
                </Group>
              ) : matchingConfirm ? (
                <Stack gap='xs'>
                  <Text fw={500} size='sm'>
                    {matchingConfirm === 'trash'
                      ? 'Delete this upload from the queue?'
                      : matchingConfirm === 'crosscheck'
                        ? 'Run carapace matching and cross-check against the uploaded plastron?'
                        : 'Run carapace matching on this upload?'}
                  </Text>
                  <Group gap='sm'>
                    <Button
                      size='sm'
                      variant='filled'
                      color={matchingConfirm === 'trash' ? 'red' : 'blue'}
                      onClick={async () => {
                        const action = matchingConfirm;
                        setMatchingConfirm(null);
                        if (action === 'trash') {
                          setTrashLoading(true);
                          try {
                            await deleteQueueItemDirect(selectedItem.request_id);
                            notifications.show({ title: 'Deleted', message: 'Upload removed from review queue', color: 'green' });
                          } catch (err) {
                            notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Delete failed', color: 'red' });
                          } finally {
                            setTrashLoading(false);
                          }
                        } else {
                          setMatchingLoading(action);
                          try {
                            await classifyReviewPacket(selectedItem.request_id, 'carapace');
                            if (action === 'crosscheck') {
                              const plastronImg = selectedItem.additional_images?.find(img => img.type === 'plastron');
                              if (plastronImg) {
                                const result = await crossCheckReviewPacket(selectedItem.request_id, 'plastron', plastronImg.image_path);
                                setCrossCheckResults(result.matches);
                              }
                            }
                            await refreshQueueItem(selectedItem.request_id);
                            notifications.show({
                              title: 'Matching complete',
                              message: action === 'crosscheck'
                                ? 'Carapace matching and plastron cross-check complete'
                                : 'Carapace matching complete',
                              color: 'green',
                            });
                          } catch (err) {
                            notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Matching failed', color: 'red' });
                          } finally {
                            setMatchingLoading(false);
                          }
                        }
                      }}
                    >
                      Yes
                    </Button>
                    <Button size='sm' variant='default' onClick={() => setMatchingConfirm(null)}>
                      No
                    </Button>
                  </Group>
                </Stack>
              ) : (
                <Stack gap='xs'>
                  <Text fw={500} size='sm'>Community upload — review the photo and proceed when ready.</Text>
                  <Group gap='sm'>
                    <Button size='sm' variant='filled' onClick={() => setMatchingConfirm('match')}>
                      Proceed with matching
                    </Button>
                    {selectedItem.additional_images?.some(img => img.type === 'plastron') && (
                      <Button size='sm' variant='filled' color='grape' onClick={() => setMatchingConfirm('crosscheck')}>
                        Cross-check with plastron
                      </Button>
                    )}
                    <Button size='sm' variant='filled' color='red' leftSection={<IconTrash size={14} />} onClick={() => setMatchingConfirm('trash')}>
                      Delete
                    </Button>
                  </Group>
                </Stack>
              )}
            </Paper>
          ) : (
            <Paper shadow='sm' p='md' radius='md' withBorder>
              <Group gap='md' align='center'>
                <Text fw={500} size='sm'>
                  Matched against: {selectedItem.photo_type === 'carapace' ? 'Carapace' : 'Plastron'}
                </Text>
                {(() => {
                  const isAdmin = selectedItem.request_id?.startsWith('admin_');
                  const plastronImg = selectedItem.additional_images?.find(img => img.type === 'plastron');
                  const canCrossCheck = isAdmin || !!plastronImg;
                  const otherType = selectedItem.photo_type === 'carapace' ? 'plastron' : 'carapace';
                  if (!canCrossCheck || crossCheckResults) return null;
                  return (
                    <Button
                      size='sm'
                      variant='light'
                      loading={crossCheckLoading}
                      onClick={async () => {
                        setCrossCheckLoading(true);
                        try {
                          const result = await crossCheckReviewPacket(
                            selectedItem.request_id,
                            otherType as PhotoType,
                            !isAdmin && plastronImg ? plastronImg.image_path : undefined,
                          );
                          setCrossCheckResults(result.matches);
                          if (result.matches.length === 0) {
                            notifications.show({ title: 'Cross-check', message: `No ${otherType} matches found`, color: 'yellow' });
                          }
                        } catch (err) {
                          notifications.show({
                            title: 'Error',
                            message: err instanceof Error ? err.message : 'Cross-check failed',
                            color: 'red',
                          });
                        } finally {
                          setCrossCheckLoading(false);
                        }
                      }}
                    >
                      Cross-check {otherType === 'carapace' ? 'Carapace' : 'Plastron'}
                    </Button>
                  );
                })()}
                {crossCheckResults !== null && (
                  <Badge size='lg' variant='light' color={crossCheckResults.length > 0 ? 'teal' : 'gray'}>
                    {crossCheckResults.length} {selectedItem.photo_type === 'carapace' ? 'plastron' : 'carapace'} match(es)
                  </Badge>
                )}
              </Group>
            </Paper>
          )}

          {/* Matches — side-by-side when cross-check results exist */}
          <Paper shadow='sm' p='md' radius='md' withBorder>
            <Grid gutter='lg'>
              <Grid.Col span={crossCheckResults && crossCheckResults.length > 0 ? { base: 12, md: 6 } : 12}>
                <Group justify='space-between' mb='md'>
                  <Group gap='xs'>
                    <Text fw={500} size='lg'>
                      {crossCheckResults && crossCheckResults.length > 0 ? 'Carapace Matches' : 'Top 5 Matches'}
                    </Text>
                    {loadingCandidateNames && <Loader size='xs' />}
                  </Group>
                </Group>

                <Text size='sm' c='dimmed' mb='md'>
                  Select a match to view details
                </Text>

                <SimpleGrid
                  cols={crossCheckResults && crossCheckResults.length > 0 ? { base: 1, xs: 2 } : { base: 1, xs: 2, md: 3, lg: 5 }}
                  spacing='md'
                >
                  {selectedItem.candidates.map((candidate) => (
                    <Card
                      key={candidate.turtle_id}
                      shadow='sm'
                      padding='sm'
                      radius='md'
                      withBorder
                      style={{
                        cursor: 'pointer',
                        border:
                          selectedCandidate === candidate.turtle_id
                            ? '2px solid #228be6'
                            : '1px solid #dee2e6',
                        backgroundColor:
                          selectedCandidate === candidate.turtle_id
                            ? '#e7f5ff'
                            : 'white',
                        transition: 'transform 0.1s, box-shadow 0.1s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = '';
                        e.currentTarget.style.boxShadow = '';
                      }}
                      onClick={() => onItemSelect(selectedItem, candidate.turtle_id)}
                    >
                      {candidate.image_path ? (
                        <Image
                          src={getImageUrl(candidate.image_path)}
                          alt={`Match ${candidate.rank}`}
                          radius='md'
                          style={{
                            aspectRatio: '1',
                            objectFit: 'cover',
                            width: '100%',
                          }}
                          mb='sm'
                        />
                      ) : (
                        <Center
                          style={{
                            aspectRatio: '1',
                            backgroundColor: '#f8f9fa',
                            borderRadius: 'var(--mantine-radius-md)',
                          }}
                          mb='sm'
                        >
                          <IconPhoto size={48} stroke={1.5} style={{ opacity: 0.3 }} />
                        </Center>
                      )}

                      <Group justify='space-between' mb={4}>
                        <Badge color='blue' size='sm' variant='filled'>
                          #{candidate.rank}
                        </Badge>
                        <Badge color='gray' size='sm' variant='light'>
                          {candidate.confidence}%
                        </Badge>
                      </Group>
                      <Text
                        fw={500}
                        size='sm'
                        truncate
                        title={
                          candidateNames[candidate.turtle_id] || candidate.turtle_id
                        }
                      >
                        {candidateNames[candidate.turtle_id] || candidate.turtle_id}
                      </Text>
                      <Text size='xs' c='dimmed' truncate>
                        ID:{' '}
                        {candidateOriginalIds[candidate.turtle_id] ??
                          candidate.turtle_id}
                      </Text>
                      {selectedCandidate === candidate.turtle_id && (
                        <IconCheck
                          size={18}
                          color='#228be6'
                          style={{ alignSelf: 'center', marginTop: 4 }}
                        />
                      )}
                    </Card>
                  ))}
                </SimpleGrid>
              </Grid.Col>

              {crossCheckResults && crossCheckResults.length > 0 && (
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <Group gap='xs' mb='md'>
                    <Text fw={500} size='lg'>
                      Plastron Matches
                    </Text>
                    {selectedItem.candidates.length > 0 && crossCheckResults[0].turtle_id !== selectedItem.candidates[0].turtle_id && (
                      <Badge color='orange' variant='light'>Top match differs</Badge>
                    )}
                  </Group>

                  <Text size='sm' c='dimmed' mb='md'>
                    Cross-check results from plastron image
                  </Text>

                  <SimpleGrid cols={{ base: 1, xs: 2 }} spacing='md'>
                    {crossCheckResults.map((match, index) => (
                      <Card
                        key={`${match.turtle_id}-xcheck-${index}`}
                        shadow='sm'
                        padding='sm'
                        radius='md'
                        withBorder
                        style={{
                          border: '1px solid #dee2e6',
                          transition: 'transform 0.1s, box-shadow 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = '';
                          e.currentTarget.style.boxShadow = '';
                        }}
                      >
                        {match.image_path ? (
                          <Image
                            src={getImageUrl(match.image_path)}
                            alt={`Plastron match ${index + 1}`}
                            radius='md'
                            style={{
                              aspectRatio: '1',
                              objectFit: 'cover',
                              width: '100%',
                            }}
                            mb='sm'
                          />
                        ) : (
                          <Center
                            style={{
                              aspectRatio: '1',
                              backgroundColor: '#f8f9fa',
                              borderRadius: 'var(--mantine-radius-md)',
                            }}
                            mb='sm'
                          >
                            <IconPhoto size={48} stroke={1.5} style={{ opacity: 0.3 }} />
                          </Center>
                        )}
                        <Group justify='space-between' mb={4}>
                          <Badge color='grape' size='sm' variant='filled'>
                            #{index + 1}
                          </Badge>
                          <Badge color='gray' size='sm' variant='light'>
                            {Math.round(match.confidence * 100)}%
                          </Badge>
                        </Group>
                        <Text fw={500} size='sm' truncate>
                          {match.turtle_id}
                        </Text>
                        <Text size='xs' c='dimmed' truncate>
                          {match.location}
                        </Text>
                      </Card>
                    ))}
                  </SimpleGrid>
                </Grid.Col>
              )}
            </Grid>
          </Paper>

          <Paper shadow='sm' p='md' radius='md' withBorder>
            <Stack gap='md'>
              <div>
                <Text fw={600} size='sm' mb={4}>
                  Additional Photos
                </Text>
                <Text size='xs' c='dimmed' mb='sm'>
                  From this upload and, when a match is selected, already stored for that turtle.
                </Text>
              </div>
              <AdditionalImagesSection
                title="From this upload"
                embedded
                images={(selectedItem.additional_images ?? []).map((a) => ({
                  imagePath: a.image_path,
                  filename: a.filename,
                  type: a.type,
                }))}
                requestId={selectedItem.request_id}
                onRefresh={() => refreshQueueItem(selectedItem.request_id)}
                disabled={!!processing}
              />
              {selectedCandidate && (
                <AdditionalImagesSection
                  title="Already in system for this turtle"
                  embedded
                  hideAddButtons
                  images={(selectedCandidateTurtleImages?.additional ?? []).map((a) => ({
                    imagePath: a.path,
                    filename: a.path.split(/[/\\]/).pop() ?? a.path,
                    type: a.type,
                  }))}
                  turtleId={selectedCandidate}
                  sheetName={fullSheetName}
                  onRefresh={async () => {
                    if (!selectedCandidate) return;
                    const res = await getTurtleImages(selectedCandidate, fullSheetName);
                    setSelectedCandidateTurtleImages(res);
                  }}
                  disabled={!!processing}
                />
              )}
            </Stack>
          </Paper>

          {selectedItem.metadata.location_hint_lat != null &&
            selectedItem.metadata.location_hint_lon != null && (
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Stack gap='sm'>
                  <Group gap='xs'>
                    <IconMapPin size={18} />
                    <Text fw={600} size='sm'>
                      Location hint from uploader
                    </Text>
                    {selectedItem.metadata.location_hint_source && (
                      <Badge size='sm' variant='light' color='blue'>
                        {selectedItem.metadata.location_hint_source}
                      </Badge>
                    )}
                  </Group>
                  <Text size='xs' c='dimmed'>
                    {selectedItem.metadata.location_hint_lat.toFixed(5)},{' '}
                    {selectedItem.metadata.location_hint_lon.toFixed(5)}
                  </Text>
                  <MapDisplay
                    latitude={selectedItem.metadata.location_hint_lat}
                    longitude={selectedItem.metadata.location_hint_lon}
                    height={220}
                    zoom={15}
                  />
                </Stack>
              </Paper>
            )}

          {selectedCandidate ? (
            <>
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Text fw={600} size='md' mb='sm'>
                  Google Sheets – selected match
                </Text>
                <TurtleSheetsDataForm
                  ref={sheetsFormRef}
                  initialData={sheetsData || undefined}
                  sheetName={sheetsData?.sheet_name}
                  initialAvailableSheets={
                    availableSheets.length > 0 ? availableSheets : undefined
                  }
                  sheetSource={
                    selectedItem.request_id?.startsWith('admin_') ? 'admin' : 'community'
                  }
                  state={state}
                  location={location}
                  hintLocationFromCommunity={
                    state && location ? `${state} / ${location}` : state || location || undefined
                  }
                  hintCoordinates={
                    selectedItem?.metadata?.location_hint_lat != null &&
                    selectedItem?.metadata?.location_hint_lon != null
                      ? {
                          latitude: selectedItem.metadata.location_hint_lat,
                          longitude: selectedItem.metadata.location_hint_lon,
                          source: selectedItem.metadata.location_hint_source,
                        }
                      : undefined
                  }
                  primaryId={primaryId || undefined}
                  mode={sheetsData ? 'edit' : 'create'}
                  onSave={onSaveSheetsData}
                  hideSubmitButton
                  onCombinedSubmit={onSaveAndApprove}
                />
                <Group justify='space-between' gap='md' mt='md'>
                  <Button
                    variant='subtle'
                    leftSection={<IconPlus size={16} />}
                    onClick={onCreateNewTurtle}
                    disabled={!!processing}
                  >
                    Create New Turtle Instead
                  </Button>
                  <Button
                    onClick={onCombinedButtonClick}
                    loading={processing === selectedItem.request_id}
                    disabled={processing === selectedItem.request_id}
                    leftSection={<IconCheck size={16} />}
                  >
                    Save to Sheets & Approve Match
                  </Button>
                </Group>
              </Paper>
            </>
          ) : (
            <Paper shadow='sm' p='xl' radius='md' withBorder>
              <Center py='xl'>
                <Stack gap='md' align='center'>
                  <Text size='sm' c='dimmed' ta='center'>
                    Select one of the top 5 matches above to view and edit its Google
                    Sheets data
                  </Text>
                  <Text size='sm' c='dimmed' ta='center'>
                    Or create a new turtle entry if none of the matches are suitable
                  </Text>
                  <Button
                    leftSection={<IconPlus size={16} />}
                    onClick={onCreateNewTurtle}
                    variant='light'
                  >
                    Create New Turtle
                  </Button>
                </Stack>
              </Center>
            </Paper>
          )}
        </Stack>
      ) : (
        <Paper
          shadow='sm'
          p='lg'
          radius='md'
          withBorder
          style={{ overflow: 'hidden' }}
        >
          <Stack gap='md' style={{ minWidth: 0 }}>
            <Group justify='space-between' wrap='wrap' gap='sm'>
              <Stack gap={2}>
                <Text fw={600} size='lg'>
                  Pending Reviews
                </Text>
                <Text size='sm' c='dimmed'>
                  Click a card to review. Use the checkbox to select multiple for deletion.
                </Text>
              </Stack>
              <Group gap='xs' wrap='nowrap'>
                <Checkbox
                  size='sm'
                  label={allSelected ? 'Deselect all' : 'Select all'}
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={handleSelectAllToggle}
                />
                {selectedIds.size > 0 && (
                  <Button
                    color='red'
                    size='sm'
                    leftSection={<IconTrash size={16} />}
                    onClick={() => setBulkConfirmOpen(true)}
                  >
                    Delete {selectedIds.size} selected
                  </Button>
                )}
              </Group>
            </Group>
            <ScrollArea h={560} type='auto' scrollbars='y'>
              <Grid gutter='md' style={{ minWidth: 0 }}>
                {queueItems.map((item) => {
                  const isSelected = selectedIds.has(item.request_id);
                  return (
                  <Grid.Col key={item.request_id} span={{ base: 12, sm: 6, md: 4 }}>
                    <Card
                      shadow='sm'
                      padding='md'
                      radius='md'
                      withBorder
                      style={{
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #fa5252' : '1px solid #dee2e6',
                        backgroundColor: isSelected ? '#fff5f5' : undefined,
                        height: '100%',
                      }}
                      onClick={() => onItemSelect(item)}
                    >
                      <Stack gap='sm'>
                        <Group justify='space-between' wrap='wrap' gap='xs'>
                          <Group gap='xs'>
                            <Checkbox
                              size='sm'
                              checked={isSelected}
                              onChange={() => toggleSelected(item.request_id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label='Select this upload'
                            />
                            <Badge
                              color={item.status === 'matched' ? 'green' : 'orange'}
                              variant='light'
                              size='sm'
                            >
                              {item.status === 'matched' ? 'Matched' : 'Pending'}
                            </Badge>
                            <Badge
                              color={uploadSourceBadgeColor(item.request_id)}
                              variant='light'
                              size='sm'
                              data-testid='review-upload-source-badge'
                            >
                              {uploadSourceLabel(item.request_id)}
                            </Badge>
                          </Group>
                          <Group gap='xs'>
                            <Text size='xs' c='dimmed'>
                              {item.metadata.finder || 'Anonymous'}
                            </Text>
                            <Button
                              variant='subtle'
                              color='red'
                              size='compact-xs'
                              leftSection={<IconTrash size={14} />}
                              onClick={(e) => onOpenDeleteModal(item, e)}
                              title='Remove from queue (e.g. junk)'
                            >
                              Delete
                            </Button>
                          </Group>
                        </Group>
                        {item.uploaded_image && (
                          <Image
                            src={getImageUrl(item.uploaded_image)}
                            alt='Uploaded'
                            radius='md'
                            style={{ maxHeight: 180, objectFit: 'contain' }}
                          />
                        )}
                        <Text size='sm' c='dimmed'>
                          {item.candidates.length} matches
                        </Text>
                        {item.metadata.state && item.metadata.location && (
                          <Text size='xs' c='dimmed'>
                            {item.metadata.state} / {item.metadata.location}
                          </Text>
                        )}
                        {item.metadata.location_hint_lat != null &&
                          item.metadata.location_hint_lon != null && (
                            <Text size='xs' c='dimmed'>
                              📍 Hint:{' '}
                              {item.metadata.location_hint_lat.toFixed(5)},{' '}
                              {item.metadata.location_hint_lon.toFixed(5)}
                              {item.metadata.location_hint_source
                                ? ` (${item.metadata.location_hint_source})`
                                : ''}
                            </Text>
                          )}
                      </Stack>
                    </Card>
                  </Grid.Col>
                  );
                })}
              </Grid>
            </ScrollArea>
          </Stack>
        </Paper>
      )}

      <DeleteQueueItemModal
        opened={deleteModalOpen}
        onClose={onCloseDeleteModal}
        deleting={deleting}
        onConfirm={onConfirmDelete}
      />

      <Modal
        opened={bulkConfirmOpen}
        onClose={() => !bulkDeleting && setBulkConfirmOpen(false)}
        title={`Delete ${selectedIds.size} upload${selectedIds.size === 1 ? '' : 's'}?`}
        centered
        closeOnClickOutside={!bulkDeleting}
        closeOnEscape={!bulkDeleting}
        withCloseButton={!bulkDeleting}
      >
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            This will permanently remove the selected uploads from the review queue. They
            will not be processed or added to any turtle. Use this for junk or spam only.
          </Text>
          <Text size='sm' fw={500}>
            This cannot be undone.
          </Text>
          {bulkDeleting && (
            <Stack gap={4}>
              <Text size='xs' c='dimmed'>
                Deleting {bulkProgress.done} of {bulkProgress.total}…
              </Text>
              <Progress
                value={bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}
                animated
              />
            </Stack>
          )}
          <Group justify='flex-end' gap='sm'>
            <Button
              variant='default'
              onClick={() => setBulkConfirmOpen(false)}
              disabled={bulkDeleting}
            >
              Cancel
            </Button>
            <Button
              color='red'
              leftSection={<IconTrash size={16} />}
              loading={bulkDeleting}
              onClick={handleBulkDelete}
            >
              Delete {selectedIds.size} from queue
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
