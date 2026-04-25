import {
  Container,
  Title,
  Text,
  Stack,
  Grid,
  Group,
  Badge,
  Paper,
  Center,
  Loader,
  Button,
  Image,
  Card,
  Divider,
  Modal,
  SimpleGrid,
  Checkbox,
  Alert,
} from '@mantine/core';
import { IconPhoto, IconCheck, IconArrowLeft, IconPlus, IconAlertTriangle } from '@tabler/icons-react';
import { useEffect, useState, useRef } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { useParams, useNavigate } from 'react-router-dom';
import { useUser } from '../hooks/useUser';
import { isStaffRole } from '../services/api/auth';
import {
  type TurtleMatch,
  getImageUrl,
  getReviewPacket,
  getTurtleImages,
  approveReview,
  createTurtleSheetsData,
  updateTurtleSheetsData,
  generatePrimaryId,
  getTurtleSheetsData,
  listSheets,
  crossCheckReviewPacket,
  type TurtleSheetsData,
  type FindMetadata,
  type ReviewQueueItem,
  type TurtleImagesResponse,
  type PhotoType,
} from '../services/api';
import { notifications } from '@mantine/notifications';
import {
  TurtleSheetsDataForm,
  type TurtleSheetsDataFormRef,
} from '../components/TurtleSheetsDataForm';
import { AdditionalImagesSection } from '../components/AdditionalImagesSection';

interface MatchData {
  request_id: string;
  uploaded_image_path: string;
  matches: TurtleMatch[];
  photo_type?: PhotoType;
}

export default function AdminTurtleMatchPage() {
  const { role, authChecked } = useUser();
  const { imageId } = useParams<{ imageId: string }>();
  const navigate = useNavigate();
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [packetItem, setPacketItem] = useState<ReviewQueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [sheetsData, setSheetsData] = useState<TurtleSheetsData | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [showNewTurtleModal, setShowNewTurtleModal] = useState(false);
  const [newTurtlePrimaryId, setNewTurtlePrimaryId] = useState<string | null>(null);
  const [newTurtleSheetsData, setNewTurtleSheetsData] = useState<TurtleSheetsData | null>(
    null,
  );
  const [newTurtleSheetName, setNewTurtleSheetName] = useState('');
  const [newTurtleBackendPath, setNewTurtleBackendPath] = useState<string | undefined>(undefined);
  const [loadingTurtleData, setLoadingTurtleData] = useState(false);
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [findMetadata] = useState<FindMetadata | null>(null);
  const [selectedMatchTurtleImages, setSelectedMatchTurtleImages] = useState<TurtleImagesResponse | null>(null);
  const [crossCheckResults, setCrossCheckResults] = useState<Array<{ turtle_id: string; location: string; confidence: number; score: number; image_path: string }> | null>(null);
  const [crossCheckLoading, setCrossCheckLoading] = useState(false);
  const [replaceReference, setReplaceReference] = useState(false);
  const [replaceCarapaceReference, setReplaceCarapaceReference] = useState(false);
  const formRef = useRef<TurtleSheetsDataFormRef>(null);
  const isMobile = useMediaQuery('(max-width: 576px)');

  const selectedMatchData = selectedMatch && matchData
    ? matchData.matches.find((m) => m.turtle_id === selectedMatch)
    : undefined;

  /** True when the selected match is from the community spreadsheet (admin re-found a community turtle). */
  const isMatchFromCommunity =
    (selectedMatchData?.location?.startsWith('Community_Uploads') ?? false);

  // Load selected match turtle's existing additional images (microhabitat/condition)
  useEffect(() => {
    if (!selectedMatch || !selectedMatchData) {
      setSelectedMatchTurtleImages(null);
      return;
    }
    const sheetNameHint = selectedMatchData.location?.split('/')[0]?.trim() || null;
    getTurtleImages(selectedMatch, sheetNameHint)
      .then(setSelectedMatchTurtleImages)
      .catch(() => setSelectedMatchTurtleImages(null));
  }, [selectedMatch, selectedMatchData]);

  // Load sheets once when staff/admin (avoids each TurtleSheetsDataForm calling listSheets)
  useEffect(() => {
    if (!authChecked || !isStaffRole(role)) return;
    listSheets()
      .then((res) => {
        if (res.success && res.sheets?.length) setAvailableSheets(res.sheets);
      })
      .catch(() => setAvailableSheets([]));
  }, [authChecked, role]);

  useEffect(() => {
    if (!authChecked) return;
    if (!isStaffRole(role)) {
      navigate('/');
      return;
    }

    const loadMatchData = async () => {
      setLoading(true);
      try {
        if (imageId) {
          const stored = localStorage.getItem(`match_${imageId}`);
          if (stored) {
            let data: MatchData;
            try {
              data = JSON.parse(stored);
            } catch {
              console.error('Corrupted match data in localStorage, removing');
              localStorage.removeItem(`match_${imageId}`);
              setMatchData(null);
              setPacketItem(null);
              setLoading(false);
              return;
            }
            setMatchData(data);
            try {
              const { item } = await getReviewPacket(imageId);
              setPacketItem(item);
            } catch {
              setPacketItem(null);
            }
          } else {
            setMatchData(null);
            setPacketItem(null);
          }
        } else {
          setMatchData(null);
          setPacketItem(null);
        }
      } catch (error) {
        console.error('Error loading match data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMatchData();
  }, [imageId, authChecked, role, navigate]);

  const handleSelectMatch = async (turtleId: string) => {
    // Empty string clears the selection (used by "Back to matches" button)
    if (!turtleId) {
      setSelectedMatch(null);
      return;
    }
    setSelectedMatch(turtleId);
    setCrossCheckResults(null);
    setReplaceReference(false);
    setReplaceCarapaceReference(false);
    setLoadingTurtleData(true);

    const match = matchData?.matches.find((m) => m.turtle_id === turtleId);
    const matchLocation = match?.location || '';
    const locationParts = matchLocation.split('/');
    const matchState = locationParts[0] || '';
    const matchLocationSpecific = locationParts.slice(1).join('/') || '';

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 35000);

    try {
      // Prefer request WITH sheet name when we have it from the match – backend then skips
      // slow find_turtle_sheet (searching all sheets) and loads data directly. Much faster.
      let response: Awaited<ReturnType<typeof getTurtleSheetsData>>;
      if (matchState) {
        try {
          response = await getTurtleSheetsData(
            turtleId,
            matchState,
            matchState,
            matchLocationSpecific,
            abortController.signal,
          );
        } catch {
          response = await getTurtleSheetsData(turtleId, undefined, undefined, undefined, abortController.signal);
        }
      } else {
        response = await getTurtleSheetsData(turtleId, undefined, undefined, undefined, abortController.signal);
      }

      if (response.success && response.data) {
        if (response.exists) {
          setSheetsData(response.data);
          setPrimaryId(response.data.primary_id || turtleId);
        } else {
          setPrimaryId(turtleId);
          setSheetsData({
            primary_id: turtleId,
          });
        }
      } else {
        setPrimaryId(turtleId);
        setSheetsData({ primary_id: turtleId });
      }
    } catch {
      setPrimaryId(turtleId);
      setSheetsData({ primary_id: turtleId });
    } finally {
      window.clearTimeout(timeoutId);
      setLoadingTurtleData(false);
    }
  };

  const handleSaveSheetsData = async (data: TurtleSheetsData, sheetName: string) => {
    if (!selectedMatch) {
      throw new Error('No turtle selected');
    }

    const match = matchData?.matches.find((m) => m.turtle_id === selectedMatch);
    if (!match) {
      throw new Error('Match not found');
    }

    const currentPrimaryId = primaryId || selectedMatch;

    if (isMatchFromCommunity) {
      // Turtle is from community spreadsheet; create a new row in the research spreadsheet.
      await createTurtleSheetsData({
        sheet_name: sheetName,
        state: data.general_location ?? '',
        location: data.location ?? '',
        turtle_data: { ...data, primary_id: currentPrimaryId },
        target_spreadsheet: 'research',
      });
    } else {
      const locationParts = match.location.split('/');
      const state = locationParts.length >= 1 ? locationParts[0] : '';
      const location = locationParts.length >= 2 ? locationParts.slice(1).join('/') : '';
      await updateTurtleSheetsData(currentPrimaryId, {
        sheet_name: sheetName,
        state,
        location,
        turtle_data: data,
      });
    }

    setSheetsData(data);
  };

  // Combined handler: save to sheets AND confirm match
  const handleSaveAndConfirm = async (data: TurtleSheetsData, sheetName: string) => {
    if (!selectedMatch || !imageId) {
      throw new Error('Please select a match first');
    }

    if (!matchData?.uploaded_image_path) {
      throw new Error('Missing image path');
    }

    setProcessing(true);
    try {
      // First, save to Google Sheets
      await handleSaveSheetsData(data, sheetName);

      // Then, confirm the match (full sheets_data so backend can move folder and remove from community sheet)
      const currentPrimaryId = primaryId || selectedMatch;
      const communitySheetName = isMatchFromCommunity
        ? (selectedMatchData?.location?.split('/')[1]?.trim() || 'Unknown')
        : '';
      await approveReview(imageId, {
        match_turtle_id: selectedMatch,
        uploaded_image_path: matchData.uploaded_image_path,
        find_metadata: findMetadata ?? undefined,
        sheets_data: {
          ...data,
          primary_id: currentPrimaryId,
          sheet_name: sheetName,
          general_location: data.general_location ?? '',
        },
        match_from_community: isMatchFromCommunity,
        community_sheet_name: isMatchFromCommunity ? communitySheetName : undefined,
        photo_type: matchData.photo_type ?? 'plastron',
        replace_reference: replaceReference || undefined,
        replace_carapace_reference: replaceCarapaceReference || undefined,
      });

      localStorage.removeItem(`match_${imageId}`);

      notifications.show({
        title: 'Success!',
        message: 'Turtle data saved and match confirmed successfully',
        color: 'green',
        icon: <IconCheck size={18} />,
      });

      navigate('/');
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to save and confirm',
        color: 'red',
      });
      throw error; // Re-throw so form can handle it
    } finally {
      setProcessing(false);
    }
  };

  // Handler for the combined button that triggers form submit
  const handleCombinedButtonClick = async () => {
    if (formRef.current) {
      await formRef.current.submit();
    }
  };

  const handleCreateNewTurtle = async () => {
    setShowNewTurtleModal(true);
    setNewTurtlePrimaryId(null);
    setNewTurtleSheetsData(null);
    setNewTurtleSheetName('');
    setNewTurtleBackendPath(undefined);
  };

  const handleSaveNewTurtleSheetsData = async (
    data: TurtleSheetsData,
    sheetName: string,
    backendLocationPath?: string,
  ) => {
    setNewTurtleSheetsData(data);
    setNewTurtleSheetName(sheetName);
    setNewTurtleBackendPath(backendLocationPath);

    const state = data.general_location || '';
    const location = data.location || '';

    let generatedPrimaryId = newTurtlePrimaryId;
    if (!generatedPrimaryId) {
      try {
        const primaryIdResponse = await generatePrimaryId({
          state,
          location,
        });
        if (primaryIdResponse.success && primaryIdResponse.primary_id) {
          generatedPrimaryId = primaryIdResponse.primary_id;
          setNewTurtlePrimaryId(generatedPrimaryId);
        }
      } catch (error) {
        console.error('Error generating primary ID:', error);
      }
    }

    await handleConfirmNewTurtle(
      sheetName,
      data,
      backendLocationPath,
      generatedPrimaryId || undefined,
    );
  };

  const handleConfirmNewTurtle = async (
    sheetNameOverride?: string,
    sheetsDataOverride?: TurtleSheetsData,
    backendPathOverride?: string,
    primaryIdOverride?: string,
  ) => {
    const effectiveSheetName = sheetNameOverride || newTurtleSheetName;
    const effectiveSheetsData = sheetsDataOverride || newTurtleSheetsData;
    const effectiveBackendPath = backendPathOverride ?? newTurtleBackendPath;

    if (!effectiveSheetName) {
      notifications.show({
        title: 'Error',
        message: 'Please select a sheet for the new turtle',
        color: 'red',
      });
      return;
    }

    if (!imageId) {
      notifications.show({
        title: 'Error',
        message: 'Missing image ID',
        color: 'red',
      });
      return;
    }

    if (!matchData?.uploaded_image_path) {
      notifications.show({
        title: 'Error',
        message: 'Missing image path',
        color: 'red',
      });
      return;
    }

    setProcessing(true);
    const progressNotificationId = `new-turtle-${imageId}`;
    notifications.show({
      id: progressNotificationId,
      title: 'Creating turtle...',
      message: 'Saving to Google Sheets and rebuilding search index.',
      color: 'blue',
      loading: true,
      autoClose: false,
      withCloseButton: false,
    });
    try {
      // Backend path: State/Location (e.g. Kansas/Wichita) when useBackendLocations, else sheet name
      const backendPathLocation = effectiveBackendPath ?? effectiveSheetName;

      const formState = effectiveSheetsData?.general_location || '';
      const formLocation = effectiveSheetsData?.location || '';
      const turtleState = formState || '';
      const turtleLocation = formLocation || '';

      // Generate primary ID if not already generated
      let finalPrimaryId = primaryIdOverride || newTurtlePrimaryId;
      if (!finalPrimaryId) {
        try {
          const primaryIdResponse = await generatePrimaryId({
            state: turtleState,
            location: turtleLocation,
          });
          if (primaryIdResponse.success && primaryIdResponse.primary_id) {
            finalPrimaryId = primaryIdResponse.primary_id;
            setNewTurtlePrimaryId(finalPrimaryId);
          }
        } catch (error) {
          console.error('Error generating primary ID:', error);
        }
      }

      const turtleIdForReview = finalPrimaryId || `T${Date.now()}`;
      const isAdminUpload = imageId.startsWith('admin_');

      // Admin upload + new turtle: create row in research (admin) spreadsheet first; backend does not sync to community.
      if (isAdminUpload && effectiveSheetsData) {
        await createTurtleSheetsData({
          sheet_name: effectiveSheetName,
          state: effectiveSheetsData.general_location || undefined,
          location: effectiveSheetsData.location || undefined,
          turtle_data: {
            ...effectiveSheetsData,
            primary_id: finalPrimaryId ?? undefined,
          },
        });
      }

      await approveReview(imageId, {
        new_location: backendPathLocation,
        new_turtle_id: turtleIdForReview,
        uploaded_image_path: matchData.uploaded_image_path,
        sheets_data: effectiveSheetsData
          ? {
              ...effectiveSheetsData,
              sheet_name: effectiveSheetName,
              primary_id: finalPrimaryId ?? undefined,
            }
          : undefined,
        photo_type: matchData?.photo_type ?? 'plastron',
      });

      localStorage.removeItem(`match_${imageId}`);

      notifications.update({
        id: progressNotificationId,
        title: 'Success!',
        message: 'New turtle created successfully',
        color: 'green',
        icon: <IconCheck size={18} />,
        loading: false,
        autoClose: 1800,
        withCloseButton: true,
      });

      // Close the modal after successful creation
      setShowNewTurtleModal(false);

      // Small delay so success state is visible before navigation.
      window.setTimeout(() => navigate('/'), 500);
    } catch (error) {
      notifications.update({
        id: progressNotificationId,
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create new turtle',
        color: 'red',
        loading: false,
        autoClose: 5000,
        withCloseButton: true,
      });
    } finally {
      setProcessing(false);
    }
  };

  // Whether to show the detail view (match selected) vs the match grid
  const showDetail = !!(selectedMatch && selectedMatchData);

  if (!authChecked) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }

  if (!isStaffRole(role)) {
    return null;
  }

  return (
    <Container size='xl' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        {/* Header - stacks on mobile */}
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Group justify='space-between' align='flex-start' wrap='wrap' gap='md'>
            <Group gap='md' wrap='wrap'>
              <Button
                variant='light'
                leftSection={<IconArrowLeft size={16} />}
                onClick={() => navigate('/')}
              >
                Back
              </Button>
              <div>
                <Title order={1}>Turtle Match Review 🐢</Title>
                <Text size='sm' c='dimmed' mt='xs'>
                  Select a match and review/edit turtle data
                </Text>
              </div>
            </Group>
            <Badge size='lg' variant='light' color='blue'>
              {matchData?.matches.length || 0} Matches
            </Badge>
          </Group>
        </Paper>

        {loading ? (
          <Center py='xl'>
            <Loader size='lg' />
          </Center>
        ) : !matchData || !matchData.matches || matchData.matches.length === 0 ? (
          <Paper shadow='sm' p='xl' radius='md' withBorder>
            <Center py='xl'>
              <Stack gap='md' align='center'>
                <IconPhoto size={64} stroke={1.5} style={{ opacity: 0.3 }} />
                <Text size='lg' c='dimmed' ta='center'>
                  No matches found
                </Text>
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={handleCreateNewTurtle}
                >
                  Create New Turtle
                </Button>
              </Stack>
            </Center>
          </Paper>
        ) : showDetail ? (
            /* ══════════════════════════════════════════════
               DETAIL VIEW — selected match fills the page
               ══════════════════════════════════════════════ */
            <Stack gap='md' style={{ position: 'relative' }}>
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

              {/* Back to matches + match summary */}
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Stack gap='sm'>
                  <Group justify='space-between'>
                    <Button
                      variant='subtle'
                      leftSection={<IconArrowLeft size={16} />}
                      onClick={() => handleSelectMatch('')}
                    >
                      Back to matches
                    </Button>
                    <Badge color='blue' size='lg'>
                      Rank{' '}
                      {matchData.matches.findIndex(
                        (m) => m.turtle_id === selectedMatch,
                      ) + 1}
                    </Badge>
                  </Group>
                  <Divider />

                  {/* Side-by-side: uploaded photo vs match photo */}
                  <Grid gutter='md'>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Text size='sm' c='dimmed' mb={4}>
                        Uploaded Photo
                      </Text>
                      <Image
                        src={
                          matchData.uploaded_image_path
                            ? getImageUrl(matchData.uploaded_image_path)
                            : ''
                        }
                        alt='Uploaded photo'
                        radius='md'
                        style={{
                          maxHeight: 'min(400px, 50vh)',
                          objectFit: 'contain',
                          width: '100%',
                        }}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Text size='sm' c='dimmed' mb={4}>
                        Match: {selectedMatch}
                      </Text>
                      {selectedMatchData?.file_path && (
                        <Image
                          src={getImageUrl(selectedMatchData.file_path)}
                          alt={`Match ${selectedMatch}`}
                          radius='md'
                          style={{
                            maxHeight: 'min(400px, 50vh)',
                            objectFit: 'contain',
                            width: '100%',
                          }}
                        />
                      )}
                    </Grid.Col>
                  </Grid>

                  {(() => {
                    const uploadedCarapace = packetItem?.additional_images?.find(
                      (a) => a.type === 'carapace',
                    );
                    if (!uploadedCarapace) return null;
                    const matchCarapacePath =
                      selectedMatchTurtleImages?.primary_carapace ?? null;
                    return (
                      <>
                        <Divider variant='dashed' />
                        <Grid gutter='md'>
                          <Grid.Col span={{ base: 12, sm: 6 }}>
                            <Text size='sm' c='dimmed' mb={4}>
                              Uploaded Carapace
                            </Text>
                            <Image
                              src={getImageUrl(uploadedCarapace.image_path)}
                              alt='Uploaded carapace'
                              radius='md'
                              style={{
                                maxHeight: 'min(400px, 50vh)',
                                objectFit: 'contain',
                                width: '100%',
                              }}
                            />
                          </Grid.Col>
                          <Grid.Col span={{ base: 12, sm: 6 }}>
                            <Text size='sm' c='dimmed' mb={4}>
                              Match Carapace: {selectedMatch}
                            </Text>
                            {matchCarapacePath ? (
                              <Image
                                src={getImageUrl(matchCarapacePath)}
                                alt={`Match carapace ${selectedMatch}`}
                                radius='md'
                                style={{
                                  maxHeight: 'min(400px, 50vh)',
                                  objectFit: 'contain',
                                  width: '100%',
                                }}
                              />
                            ) : (
                              <Text size='xs' c='dimmed' mt='sm'>
                                No carapace reference on file for this turtle.
                              </Text>
                            )}
                          </Grid.Col>
                        </Grid>
                      </>
                    );
                  })()}

                  {/* Match metadata */}
                  <Grid mt='xs'>
                    <Grid.Col span={{ base: 12, sm: 4 }}>
                      <Text size='sm' c='dimmed'>
                        Turtle ID
                      </Text>
                      <Text fw={500}>{selectedMatch}</Text>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 4 }}>
                      <Text size='sm' c='dimmed'>
                        Location
                      </Text>
                      <Text fw={500}>{selectedMatchData?.location}</Text>
                    </Grid.Col>
                    <Grid.Col span={{ base: 6, sm: 2 }}>
                      <Text size='sm' c='dimmed'>
                        Confidence
                      </Text>
                      <Text fw={500}>
                        {typeof selectedMatchData?.confidence === 'number'
                          ? `${(selectedMatchData.confidence * 100).toFixed(1)}%`
                          : '0.0%'}
                      </Text>
                    </Grid.Col>
                    {primaryId && (
                      <Grid.Col span={{ base: 6, sm: 2 }}>
                        <Text size='sm' c='dimmed'>
                          Primary ID
                        </Text>
                        <Text fw={500}>{primaryId}</Text>
                      </Grid.Col>
                    )}
                  </Grid>
                </Stack>
              </Paper>

              {/* Microhabitat / Condition photos */}
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Stack gap='md'>
                  <div>
                    <Text fw={600} size='sm' mb={4}>
                      Additional Photos
                    </Text>
                    <Text size='xs' c='dimmed' mb='sm'>
                      From this upload and already stored for this turtle.
                    </Text>
                  </div>
                  {imageId && (
                    <AdditionalImagesSection
                      title="From this upload"
                      embedded
                      images={(packetItem?.additional_images ?? []).map((a) => ({
                        imagePath: a.image_path,
                        filename: a.filename,
                        type: a.type,
                      }))}
                      requestId={imageId}
                      onRefresh={async () => {
                        try {
                          const { item } = await getReviewPacket(imageId);
                          setPacketItem(item);
                        } catch {
                          // ignore
                        }
                      }}
                      disabled={!!processing}
                    />
                  )}
                  {selectedMatch && (
                    <AdditionalImagesSection
                      title="Already in system for this turtle"
                      embedded
                      hideAddButtons
                      images={(selectedMatchTurtleImages?.additional ?? []).map((a) => ({
                        imagePath: a.path,
                        filename: a.path.split(/[/\\]/).pop() ?? a.path,
                        type: a.type,
                      }))}
                      turtleId={selectedMatch}
                      sheetName={selectedMatchData?.location?.split('/')[0]?.trim() ?? null}
                      onRefresh={async () => {
                        if (!selectedMatch || !selectedMatchData) return;
                        const sheetNameHint = selectedMatchData.location?.split('/')[0]?.trim() || null;
                        const res = await getTurtleImages(selectedMatch, sheetNameHint);
                        setSelectedMatchTurtleImages(res);
                      }}
                      disabled={!!processing}
                    />
                  )}
                </Stack>
              </Paper>

              {/* Reference replacement controls */}
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Stack gap='sm'>
                  <Checkbox
                    label='Replace plastron reference with this upload'
                    description='The current plastron reference will be archived to loose_images'
                    checked={replaceReference}
                    onChange={(e) => setReplaceReference(e.currentTarget.checked)}
                    disabled={!!processing}
                  />
                  {replaceReference && (
                    <Alert
                      icon={<IconAlertTriangle size={16} />}
                      color='orange'
                      radius='md'
                    >
                      The current plastron reference image will be replaced with this upload. The old image will be archived.
                    </Alert>
                  )}
                  {packetItem?.additional_images?.some(img => img.type === 'carapace') && (
                    <Checkbox
                      label='Replace carapace reference (first carapace photo)'
                      description='The current carapace reference will be archived'
                      checked={replaceCarapaceReference}
                      onChange={(e) => setReplaceCarapaceReference(e.currentTarget.checked)}
                      disabled={!!processing}
                    />
                  )}
                  {replaceCarapaceReference && (
                    <Alert
                      icon={<IconAlertTriangle size={16} />}
                      color='orange'
                      radius='md'
                    >
                      The current carapace reference image will be replaced with the first carapace additional photo. The old image will be archived.
                    </Alert>
                  )}
                </Stack>
              </Paper>

              {/* Google Sheets Data Form */}
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <TurtleSheetsDataForm
                  ref={formRef}
                  initialData={sheetsData || undefined}
                  sheetName={isMatchFromCommunity ? '' : (sheetsData?.sheet_name)}
                  primaryId={primaryId || undefined}
                  mode={sheetsData ? 'edit' : 'create'}
                  onSave={handleSaveSheetsData}
                  hideSubmitButton={true}
                  onCombinedSubmit={handleSaveAndConfirm}
                  addOnlyMode={true}
                  initialAvailableSheets={availableSheets.length > 0 ? availableSheets : undefined}
                  sheetSource="admin"
                  requireNewSheetForCommunityMatch={isMatchFromCommunity}
                />
              </Paper>

              {/* Action Buttons */}
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Stack gap='md'>
                  <Group justify='space-between' gap='md' wrap='wrap'>
                    <Button
                      variant='subtle'
                      leftSection={<IconPlus size={16} />}
                      onClick={handleCreateNewTurtle}
                      disabled={processing}
                    >
                      Create New Turtle Instead
                    </Button>
                    <Group gap='md'>
                      <Button
                        variant='light'
                        onClick={() => navigate('/')}
                        disabled={processing}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleCombinedButtonClick}
                        disabled={!selectedMatch || processing}
                        loading={processing}
                        leftSection={<IconCheck size={16} />}
                      >
                        Save to Sheets & Confirm Match
                      </Button>
                    </Group>
                  </Group>
                </Stack>
              </Paper>
            </Stack>
          ) : (
            /* ══════════════════════════════════════════════
               MATCH GRID — uploaded photo + large match cards
               ══════════════════════════════════════════════ */
            <Stack gap='md'>
              {/* Uploaded photo — full width, with carapace alongside when present */}
              {(() => {
                const uploadedCarapaceGrid = packetItem?.additional_images?.find(
                  (a) => a.type === 'carapace',
                );
                return (
                  <Paper shadow='sm' p='md' radius='md' withBorder>
                    <Stack gap='sm'>
                      <Text fw={500} size='lg'>
                        Uploaded Photo
                      </Text>
                      <Grid gutter='md'>
                        <Grid.Col span={uploadedCarapaceGrid ? { base: 12, sm: 6 } : 12}>
                          <Text size='sm' c='dimmed' mb={4}>
                            Plastron
                          </Text>
                          <Image
                            src={
                              matchData.uploaded_image_path
                                ? getImageUrl(matchData.uploaded_image_path)
                                : ''
                            }
                            alt='Uploaded plastron'
                            radius='md'
                            style={{
                              maxHeight: 'min(500px, 60vh)',
                              objectFit: 'contain',
                              width: '100%',
                            }}
                          />
                        </Grid.Col>
                        {uploadedCarapaceGrid && (
                          <Grid.Col span={{ base: 12, sm: 6 }}>
                            <Text size='sm' c='dimmed' mb={4}>
                              Carapace
                            </Text>
                            <Image
                              src={getImageUrl(uploadedCarapaceGrid.image_path)}
                              alt='Uploaded carapace'
                              radius='md'
                              style={{
                                maxHeight: 'min(500px, 60vh)',
                                objectFit: 'contain',
                                width: '100%',
                              }}
                            />
                          </Grid.Col>
                        )}
                      </Grid>
                    </Stack>
                  </Paper>
                );
              })()}

              {/* Cross-check carapace — only when a carapace additional image exists */}
              {imageId && packetItem?.additional_images?.some(img => img.type === 'carapace') && (
                <Paper shadow='sm' p='md' radius='md' withBorder>
                  <Group gap='md' align='center'>
                    <Text fw={500} size='sm'>
                      Carapace additional image available
                    </Text>
                    {!crossCheckResults && (
                      <Button
                        size='sm'
                        variant='light'
                        loading={crossCheckLoading}
                        onClick={async () => {
                          setCrossCheckLoading(true);
                          const carapaceImg = packetItem?.additional_images?.find(img => img.type === 'carapace');
                          try {
                            const result = await crossCheckReviewPacket(
                              imageId,
                              'carapace' as PhotoType,
                              carapaceImg?.image_path,
                            );
                            setCrossCheckResults(result.matches);
                            if (result.matches.length === 0) {
                              notifications.show({ title: 'Cross-check', message: 'No carapace matches found', color: 'yellow' });
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
                        Cross-check Carapace
                      </Button>
                    )}
                    {crossCheckResults !== null && (
                      <Badge size='lg' variant='light' color={crossCheckResults.length > 0 ? 'teal' : 'gray'}>
                        {crossCheckResults.length} carapace match(es)
                      </Badge>
                    )}
                  </Group>
                </Paper>
              )}

              {/* Matches — side-by-side when cross-check results exist */}
              <Paper shadow='sm' p='md' radius='md' withBorder>
                <Group justify='space-between' mb='md'>
                  <Text fw={500} size='lg'>
                    {crossCheckResults && crossCheckResults.length > 0 ? 'Plastron Matches' : 'Top 5 Matches'}
                  </Text>
                  <Button
                    variant='light'
                    leftSection={<IconPlus size={16} />}
                    onClick={handleCreateNewTurtle}
                  >
                    Create New Turtle
                  </Button>
                </Group>

                <Text size='sm' c='dimmed' mb='md'>
                  Select a match to view details
                </Text>

                <Grid gutter='lg'>
                  <Grid.Col span={crossCheckResults && crossCheckResults.length > 0 ? { base: 12, md: 6 } : 12}>
                    {/* Plastron match cards */}
                    <SimpleGrid
                      cols={crossCheckResults && crossCheckResults.length > 0 ? { base: 1, xs: 2 } : { base: 1, xs: 2, md: 3, lg: 5 }}
                      spacing='md'
                    >
                      {matchData.matches.map((match, index) => (
                        <Card
                          key={`${match.turtle_id}-${index}`}
                          shadow='sm'
                          padding='sm'
                          radius='md'
                          withBorder
                          style={{
                            cursor: 'pointer',
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
                          onClick={() => handleSelectMatch(match.turtle_id)}
                        >
                          {match.file_path ? (
                            <Image
                              src={getImageUrl(match.file_path)}
                              alt={`Match ${index + 1}`}
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
                              #{index + 1}
                            </Badge>
                            <Badge color='gray' size='sm' variant='light'>
                              {typeof match.confidence === 'number'
                                ? `${(match.confidence * 100).toFixed(1)}%`
                                : '0.0%'}
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

                  {crossCheckResults && crossCheckResults.length > 0 && (
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Group gap='xs' mb='md'>
                        <Text fw={500} size='lg'>
                          Carapace Matches
                        </Text>
                        {matchData.matches.length > 0 && crossCheckResults[0].turtle_id !== matchData.matches[0].turtle_id && (
                          <Badge color='orange' variant='light'>Top match differs</Badge>
                        )}
                      </Group>
                      <Text size='sm' c='dimmed' mb='md'>
                        Cross-check results from carapace image
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
                                alt={`Carapace match ${index + 1}`}
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
                              <Badge color='teal' size='sm' variant='filled'>
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
            </Stack>
          )}
      </Stack>

      {/* New Turtle Creation Modal - full width on mobile */}
      <Modal
        opened={showNewTurtleModal}
        onClose={() => setShowNewTurtleModal(false)}
        title='Create New Turtle'
        size={isMobile ? '100%' : 'xl'}
        centered
      >
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Create a new turtle entry for this uploaded image. Select a sheet and fill in
            the turtle data below. Primary ID will be automatically generated. ID and ID2
            can be entered manually if needed.
          </Text>

          {newTurtlePrimaryId && (
            <Paper p='sm' withBorder>
              <Text size='sm' c='dimmed'>
                Primary ID
              </Text>
              <Text fw={500}>{newTurtlePrimaryId}</Text>
            </Paper>
          )}

          {imageId && (
            <Paper p='sm' withBorder radius='md'>
              <AdditionalImagesSection
                title='Photos for this upload'
                embedded
                images={(packetItem?.additional_images ?? []).map((a) => ({
                  imagePath: a.image_path,
                  filename: a.filename,
                  type: a.type,
                }))}
                requestId={imageId}
                onRefresh={async () => {
                  try {
                    const { item } = await getReviewPacket(imageId);
                    setPacketItem(item);
                  } catch {
                    // ignore
                  }
                }}
              />
            </Paper>
          )}

          <Divider label='Google Sheets Data' labelPosition='center' />

          <TurtleSheetsDataForm
            initialData={newTurtleSheetsData || undefined}
            sheetName={newTurtleSheetName}
            state={newTurtleSheetsData?.general_location || ''}
            location={newTurtleSheetsData?.location || ''}
            primaryId={newTurtlePrimaryId || undefined}
            mode='create'
            onSave={handleSaveNewTurtleSheetsData}
            onCancel={() => setShowNewTurtleModal(false)}
            useBackendLocations
          />
        </Stack>
      </Modal>
    </Container>
  );
}
