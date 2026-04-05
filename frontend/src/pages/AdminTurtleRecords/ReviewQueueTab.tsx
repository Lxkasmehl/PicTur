import {
  Badge,
  Button,
  Card,
  Center,
  Grid,
  Group,
  Image,
  Loader,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';
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
  const [classifyLoading, setClassifyLoading] = useState<'plastron' | 'carapace' | null>(null);
  const [classifyConfirm, setClassifyConfirm] = useState<'plastron' | 'carapace' | 'trash' | null>(null);
  const [trashLoading, setTrashLoading] = useState(false);
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
    setClassifyConfirm(null);
  }, [selectedItem?.request_id]);

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
                color={selectedItem.photo_type === 'carapace' ? 'teal' : selectedItem.photo_type === 'unclassified' ? 'yellow' : 'grape'}
                data-testid='review-photo-type-badge'
              >
                {selectedItem.photo_type === 'carapace' ? 'Carapace' : selectedItem.photo_type === 'unclassified' ? 'Unclassified' : 'Plastron'}
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

          {/* Classify control (community/unclassified) or cross-check button (admin/plastron) */}
          {selectedItem.photo_type === 'unclassified' ? (
            <Paper shadow='sm' p='md' radius='md' withBorder>
              {classifyLoading ? (
                <Group gap='md' align='center'>
                  <Loader size='sm' />
                  <Text fw={500} size='sm'>
                    Classified as {classifyLoading === 'carapace' ? 'Carapace' : 'Plastron'} — matching in progress...
                  </Text>
                </Group>
              ) : trashLoading ? (
                <Group gap='md' align='center'>
                  <Loader size='sm' color='red' />
                  <Text fw={500} size='sm'>Deleting upload...</Text>
                </Group>
              ) : classifyConfirm ? (
                <Stack gap='xs'>
                  <Text fw={500} size='sm'>
                    {classifyConfirm === 'trash'
                      ? 'Delete this upload from the queue?'
                      : `Classify as ${classifyConfirm === 'carapace' ? 'Carapace' : 'Plastron'} and run matching?`}
                  </Text>
                  <Group gap='sm'>
                    <Button
                      size='sm'
                      variant='filled'
                      color={classifyConfirm === 'trash' ? 'red' : classifyConfirm === 'carapace' ? 'teal' : 'grape'}
                      onClick={async () => {
                        const action = classifyConfirm;
                        setClassifyConfirm(null);
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
                          setClassifyLoading(action);
                          try {
                            await classifyReviewPacket(selectedItem.request_id, action);
                            await refreshQueueItem(selectedItem.request_id);
                            notifications.show({
                              title: `Classified as ${action === 'carapace' ? 'Carapace' : 'Plastron'}`,
                              message: `Matching against ${action} dataset complete`,
                              color: action === 'carapace' ? 'teal' : 'grape',
                            });
                          } catch (err) {
                            notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Classification failed', color: 'red' });
                          } finally {
                            setClassifyLoading(null);
                          }
                        }
                      }}
                    >
                      Yes
                    </Button>
                    <Button size='sm' variant='default' onClick={() => setClassifyConfirm(null)}>
                      No
                    </Button>
                  </Group>
                </Stack>
              ) : (
                <Stack gap='xs'>
                  <Text fw={500} size='sm'>This photo needs classification before matching can run.</Text>
                  <Text size='xs' c='dimmed'>Select the photo type to match against the correct dataset:</Text>
                  <Group gap='sm'>
                    <Button size='sm' variant='filled' color='grape' onClick={() => setClassifyConfirm('plastron')}>
                      Plastron (belly)
                    </Button>
                    <Button size='sm' variant='filled' color='teal' onClick={() => setClassifyConfirm('carapace')}>
                      Carapace (top of shell)
                    </Button>
                    <Button size='sm' variant='filled' color='red' leftSection={<IconTrash size={14} />} onClick={() => setClassifyConfirm('trash')}>
                      Trash
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
                <Button
                  size='sm'
                  variant='light'
                  color='teal'
                  loading={crossCheckLoading}
                  onClick={async () => {
                    setCrossCheckLoading(true);
                    const otherType = selectedItem.photo_type === 'carapace' ? 'plastron' : 'carapace';
                    try {
                      const result = await crossCheckReviewPacket(selectedItem.request_id, otherType as PhotoType);
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
                  Cross-check {selectedItem.photo_type === 'carapace' ? 'Plastron' : 'Carapace'}
                </Button>
                {crossCheckResults !== null && (
                  <Badge size='lg' variant='light' color={crossCheckResults.length > 0 ? 'teal' : 'gray'}>
                    {crossCheckResults.length} {selectedItem.photo_type === 'carapace' ? 'plastron' : 'carapace'} match(es)
                  </Badge>
                )}
              </Group>
              {crossCheckResults && crossCheckResults.length > 0 && (
                <Stack gap='xs' mt='sm'>
                  <Text size='xs' c='dimmed'>
                    Top {selectedItem.photo_type === 'carapace' ? 'plastron' : 'carapace'} match: <b>{crossCheckResults[0].turtle_id}</b> ({Math.round(crossCheckResults[0].confidence * 100)}% confidence)
                    {selectedItem.candidates.length > 0 && crossCheckResults[0].turtle_id !== selectedItem.candidates[0].turtle_id && (
                      <Badge size='sm' variant='light' color='red' ml='xs'>Differs from top {selectedItem.photo_type} match</Badge>
                    )}
                  </Text>
                </Stack>
              )}
            </Paper>
          )}

          {/* Top 5 Matches — responsive grid with large cards */}
          <Paper shadow='sm' p='md' radius='md' withBorder>
            <Group justify='space-between' mb='md'>
              <Group gap='xs'>
                <Text fw={500} size='lg'>
                  Top 5 Matches
                </Text>
                {loadingCandidateNames && <Loader size='xs' />}
              </Group>
            </Group>

            <Text size='sm' c='dimmed' mb='md'>
              Select a match to view details
            </Text>

            <SimpleGrid
              cols={{ base: 1, xs: 2, md: 3, lg: 5 }}
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
          </Paper>

          <Paper shadow='sm' p='md' radius='md' withBorder>
            <Stack gap='md'>
              <div>
                <Text fw={600} size='sm' mb={4}>
                  Microhabitat / Condition photos
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
            <Text fw={600} size='lg'>
              Pending Reviews
            </Text>
            <Text size='sm' c='dimmed'>
              Click an item to review matches and approve.
            </Text>
            <ScrollArea h={560} type='auto' scrollbars='y'>
              <Grid gutter='md' style={{ minWidth: 0 }}>
                {queueItems.map((item) => (
                  <Grid.Col key={item.request_id} span={{ base: 12, sm: 6, md: 4 }}>
                    <Card
                      shadow='sm'
                      padding='md'
                      radius='md'
                      withBorder
                      style={{
                        cursor: 'pointer',
                        border: '1px solid #dee2e6',
                        height: '100%',
                      }}
                      onClick={() => onItemSelect(item)}
                    >
                      <Stack gap='sm'>
                        <Group justify='space-between' wrap='wrap' gap='xs'>
                          <Group gap='xs'>
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
                ))}
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
    </>
  );
}
