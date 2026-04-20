import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Flex,
  Grid,
  Group,
  Image,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import {
  IconAlertCircle,
  IconCheck,
  IconList,
  IconMapPin,
  IconPhoto,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { getImageUrl, getTurtleImages, type TurtleImagesResponse } from '../../services/api';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { MapDisplay } from '../../components/MapDisplay';
import { DeleteQueueItemModal } from './DeleteQueueItemModal';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { useAdminTurtleRecordsContext } from './AdminTurtleRecordsContext';

export function ReviewQueueTab() {
  const ctx = useAdminTurtleRecordsContext();
  const [selectedCandidateTurtleImages, setSelectedCandidateTurtleImages] = useState<TurtleImagesResponse | null>(null);
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

  // Load selected candidate turtle's existing additional images when a match is selected (must run before any early return)
  useEffect(() => {
    if (!selectedCandidate || !selectedItem?.request_id) {
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

          <Paper shadow='sm' p='md' radius='md' withBorder>
            <Grid gutter='lg'>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Stack gap='xs'>
                  <Text fw={600} size='sm' c='dimmed'>
                    Uploaded Photo
                  </Text>
                  {selectedItem.uploaded_image && (
                    <Image
                      src={getImageUrl(selectedItem.uploaded_image)}
                      alt='Uploaded photo'
                      radius='md'
                      style={{
                        maxHeight: '320px',
                        objectFit: 'contain',
                        width: '100%',
                      }}
                    />
                  )}
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 8 }}>
                <Stack gap='xs'>
                  <Group gap='xs'>
                    <Text fw={600} size='sm' c='dimmed'>
                      Top 5 Matches
                    </Text>
                    {loadingCandidateNames && <Loader size='xs' />}
                  </Group>
                  {selectedItem.match_search_pending === true ? (
                    <Center py='xl'>
                      <Stack align='center' gap='md'>
                        <Loader size='md' />
                        <Text size='sm' c='dimmed' ta='center' maw={440}>
                          Still running photo matching in the background. This can take a few
                          minutes. The list refreshes automatically; you can leave and come back.
                        </Text>
                      </Stack>
                    </Center>
                  ) : selectedItem.match_search_failed === true ? (
                    <Stack gap='md'>
                      <Alert
                        icon={<IconAlertCircle size={18} />}
                        title='Automatic matching failed'
                        color='red'
                        variant='light'
                      >
                        <Text size='sm'>
                          {selectedItem.match_search_error?.trim() ||
                            'The server could not run match search for this upload. You can still create a new turtle or remove this item from the queue.'}
                        </Text>
                      </Alert>
                      <Text size='sm' c='dimmed' ta='center' maw={440}>
                        No suggested matches are available. Use{' '}
                        <Text span fw={600}>
                          Create New Turtle
                        </Text>{' '}
                        below if this is a new individual.
                      </Text>
                    </Stack>
                  ) : (
                  <Flex gap='sm' wrap='wrap' align='stretch'>
                    {selectedItem.candidates.map((candidate) => (
                      <Card
                        key={candidate.turtle_id}
                        shadow='sm'
                        padding='sm'
                        radius='md'
                        withBorder
                        style={{
                          flex: '1 1 0',
                          minWidth: 140,
                          maxWidth: 220,
                          cursor: 'pointer',
                          border:
                            selectedCandidate === candidate.turtle_id
                              ? '2px solid #228be6'
                              : '1px solid #dee2e6',
                          backgroundColor:
                            selectedCandidate === candidate.turtle_id
                              ? '#e7f5ff'
                              : 'white',
                        }}
                        onClick={() => onItemSelect(selectedItem, candidate.turtle_id)}
                      >
                        <Stack gap={6}>
                          {candidate.image_path ? (
                            <Image
                              src={getImageUrl(candidate.image_path)}
                              alt={`Match ${candidate.rank}`}
                              radius='sm'
                              style={{
                                height: 200,
                                objectFit: 'cover',
                                width: '100%',
                              }}
                            />
                          ) : (
                            <Center style={{ height: 200 }} c='dimmed'>
                              <IconPhoto size={48} />
                            </Center>
                          )}
                          <Text
                            fw={600}
                            size='sm'
                            lineClamp={1}
                            title={
                              candidateNames[candidate.turtle_id] || candidate.turtle_id
                            }
                          >
                            {candidateNames[candidate.turtle_id] || candidate.turtle_id}
                          </Text>
                          <Text size='xs' c='dimmed'>
                            ID:{' '}
                            {candidateOriginalIds[candidate.turtle_id] ??
                              candidate.turtle_id}{' '}
                            · Confidence: {candidate.confidence}%
                          </Text>
                          <Badge size='sm' variant='light' color='blue'>
                            #{candidate.rank}
                          </Badge>
                          {selectedCandidate === candidate.turtle_id && (
                            <IconCheck
                              size={18}
                              color='#228be6'
                              style={{ alignSelf: 'center' }}
                            />
                          )}
                        </Stack>
                      </Card>
                    ))}
                  </Flex>
                  )}
                </Stack>
              </Grid.Col>
            </Grid>
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
                  labels: a.labels,
                }))}
                requestId={selectedItem.request_id}
                onRefresh={() => refreshQueueItem(selectedItem.request_id)}
                disabled={!!processing || selectedItem.match_search_pending === true}
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
                    labels: a.labels,
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
                <ScrollArea h={520} type='auto'>
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
                </ScrollArea>
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
          ) : selectedItem.match_search_pending === true ? (
            <Paper shadow='sm' p='xl' radius='md' withBorder>
              <Center py='xl'>
                <Text size='sm' c='dimmed' ta='center' maw={420}>
                  Match suggestions are not ready yet. You can review photos above, or wait until
                  matching finishes to choose a match or create a new turtle.
                </Text>
              </Center>
            </Paper>
          ) : selectedItem.match_search_failed === true ? (
            <Paper shadow='sm' p='xl' radius='md' withBorder>
              <Center py='xl'>
                <Stack gap='md' align='center'>
                  <Text size='sm' c='dimmed' ta='center' maw={420}>
                    Matching did not complete, so there are no suggested turtles to pick from. You
                    can still add this find as a new turtle.
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
                            <Badge color='orange' variant='light' size='sm'>
                              Pending
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
                        {item.match_search_pending === true ? (
                          <Group gap='xs' wrap='nowrap'>
                            <Loader size='xs' />
                            <Text size='sm' c='dimmed'>
                              Finding matches…
                            </Text>
                          </Group>
                        ) : item.match_search_failed === true ? (
                          <Group gap='xs' wrap='nowrap'>
                            <IconAlertCircle size={16} color='var(--mantine-color-red-6)' />
                            <Text size='sm' c='red'>
                              Match search failed
                            </Text>
                          </Group>
                        ) : (
                          <Text size='sm' c='dimmed'>
                            {item.candidates.length} matches
                          </Text>
                        )}
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
