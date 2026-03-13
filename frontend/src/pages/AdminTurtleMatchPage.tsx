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
  ScrollArea,
  Modal,
} from '@mantine/core';
import { IconPhoto, IconCheck, IconArrowLeft, IconPlus } from '@tabler/icons-react';
import { useEffect, useState, useRef } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { useParams, useNavigate } from 'react-router-dom';
import { useUser } from '../hooks/useUser';
import {
  type TurtleMatch,
  getImageUrl,
  getReviewPacket,
  getTurtleImages,
  approveReview,
  updateTurtleSheetsData,
  createTurtleSheetsData,
  generatePrimaryId,
  getTurtleSheetsData,
  listSheets,
  type TurtleSheetsData,
  type ReviewQueueItem,
  type TurtleImagesResponse,
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
  const [loadingTurtleData, setLoadingTurtleData] = useState(false);
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [selectedMatchTurtleImages, setSelectedMatchTurtleImages] = useState<TurtleImagesResponse | null>(null);
  const formRef = useRef<TurtleSheetsDataFormRef>(null);
  const isMobile = useMediaQuery('(max-width: 576px)');

  const selectedMatchData = selectedMatch && matchData
    ? matchData.matches.find((m) => m.turtle_id === selectedMatch)
    : undefined;

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
  }, [selectedMatch, selectedMatchData?.location]);

  // Load sheets once when admin (avoids each TurtleSheetsDataForm calling listSheets)
  useEffect(() => {
    if (!authChecked || role !== 'admin') return;
    listSheets()
      .then((res) => {
        if (res.success && res.sheets?.length) setAvailableSheets(res.sheets);
      })
      .catch(() => setAvailableSheets([]));
  }, [authChecked, role]);

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'admin') {
      navigate('/');
      return;
    }

    const loadMatchData = async () => {
      setLoading(true);
      try {
        if (imageId) {
          const stored = localStorage.getItem(`match_${imageId}`);
          if (stored) {
            const data: MatchData = JSON.parse(stored);
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
    setSelectedMatch(turtleId);
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

    const locationParts = match.location.split('/');
    const state = locationParts.length >= 1 ? locationParts[0] : '';
    const location = locationParts.length >= 2 ? locationParts.slice(1).join('/') : '';
    const currentPrimaryId = primaryId || selectedMatch;

    await updateTurtleSheetsData(currentPrimaryId, {
      sheet_name: sheetName,
      state,
      location,
      turtle_data: data,
    });

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

      // Then, confirm the match
      await approveReview(imageId, {
        match_turtle_id: selectedMatch,
        uploaded_image_path: matchData.uploaded_image_path,
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
    // Open modal for creating new turtle
    setShowNewTurtleModal(true);
    setNewTurtlePrimaryId(null);
    setNewTurtleSheetsData(null);
    setNewTurtleSheetName('');
  };

  const handleSaveNewTurtleSheetsData = async (
    data: TurtleSheetsData,
    sheetName: string,
  ) => {
    // Save the sheets data to state (for UI display)
    setNewTurtleSheetsData(data);
    setNewTurtleSheetName(sheetName);

    // Extract state and location from form data
    const state = data.general_location || '';
    const location = data.location || '';

    // Generate primary ID if not already generated
    let primaryId = newTurtlePrimaryId;
    if (!primaryId) {
      try {
        const primaryIdResponse = await generatePrimaryId({
          state,
          location,
        });
        if (primaryIdResponse.success && primaryIdResponse.primary_id) {
          primaryId = primaryIdResponse.primary_id;
          setNewTurtlePrimaryId(primaryId);
        }
      } catch (error) {
        console.error('Error generating primary ID:', error);
      }
    }

    // Automatically confirm and create the turtle after saving the form data
    // Pass data and sheetName directly to avoid React state update timing issues
    // This avoids having two buttons (one in form, one outside)
    await handleConfirmNewTurtle(sheetName, data);
  };

  const handleConfirmNewTurtle = async (
    sheetNameOverride?: string,
    sheetsDataOverride?: TurtleSheetsData,
  ) => {
    // Use provided values or fall back to state
    const effectiveSheetName = sheetNameOverride || newTurtleSheetName;
    const effectiveSheetsData = sheetsDataOverride || newTurtleSheetsData;

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
    try {
      // Backend path: always use sheet name only (never general_location/location from form).
      // general_location and location are only for the Google Sheet row data.
      const backendPathLocation = effectiveSheetName;

      const formState = effectiveSheetsData?.general_location || '';
      const formLocation = effectiveSheetsData?.location || '';
      const turtleState = formState || '';
      const turtleLocation = formLocation || '';

      // Generate primary ID if not already generated
      let finalPrimaryId = newTurtlePrimaryId;
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

      // Create turtle in Google Sheets first (before approveReview)
      // This ensures the data is created exactly as the user entered it
      let sheetsDataCreated = false;
      if (effectiveSheetsData && finalPrimaryId && effectiveSheetName) {
        try {
          const result = await createTurtleSheetsData({
            sheet_name: effectiveSheetName,
            state: turtleState,
            location: turtleLocation,
            turtle_data: {
              ...effectiveSheetsData,
              primary_id: finalPrimaryId,
              general_location: effectiveSheetsData?.general_location ?? '',
              location: effectiveSheetsData?.location ?? '',
            },
          });
          if (result.success) {
            sheetsDataCreated = true;
          } else {
            sheetsDataCreated = false;
          }
        } catch (sheetsError) {
          console.error('Error creating turtle in sheets:', sheetsError);
          // Show error to user but continue - backend will create it as fallback
          notifications.show({
            title: 'Warning',
            message:
              'Failed to create turtle in Google Sheets. Backend will create it as fallback.',
            color: 'yellow',
          });
          sheetsDataCreated = false;
        }
      }

      // Approve review with new turtle
      // Note: We already created the Sheets entry above, so approveReview should skip creating it
      // Use primary ID as turtle ID, or fallback to generated ID
      const turtleIdForReview = finalPrimaryId || `T${Date.now()}`;

      await approveReview(imageId, {
        new_location: backendPathLocation,
        new_turtle_id: turtleIdForReview,
        uploaded_image_path: matchData.uploaded_image_path,
        sheets_data: effectiveSheetsData
          ? {
              ...effectiveSheetsData,
              sheet_name: effectiveSheetName, // Use the effective sheet name
              // Only include primary_id if sheets data was successfully created by frontend
              // Otherwise, let backend create it in fallback mode
              primary_id: sheetsDataCreated
                ? ((finalPrimaryId ?? undefined) as string | undefined)
                : undefined,
            }
          : undefined,
      });

      localStorage.removeItem(`match_${imageId}`);

      notifications.show({
        title: 'Success!',
        message: 'New turtle created successfully',
        color: 'green',
        icon: <IconCheck size={18} />,
      });

      // Close the modal after successful creation
      setShowNewTurtleModal(false);

      navigate('/');
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create new turtle',
        color: 'red',
      });
    } finally {
      setProcessing(false);
    }
  };

  if (!authChecked) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }

  if (role !== 'admin') {
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
        ) : (
          <Grid gutter='lg'>
            {/* Left Column: Uploaded Image & Matches */}
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack gap='md'>
                {/* Uploaded Image */}
                <Paper shadow='sm' p='md' radius='md' withBorder>
                  <Stack gap='sm'>
                    <Text fw={500} size='lg'>
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
                  </Stack>
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

                {/* Matches List */}
                <Paper shadow='sm' p='md' radius='md' withBorder>
                  <Stack gap='md'>
                    <Text fw={500} size='lg'>
                      Top 5 Matches
                    </Text>
                    <ScrollArea h={320}>
                      <Stack gap='sm'>
                        {matchData.matches.map((match, index) => (
                          <Card
                            key={`${match.turtle_id}-${index}`}
                            shadow='sm'
                            padding='md'
                            radius='md'
                            withBorder
                            style={{
                              cursor: 'pointer',
                              border:
                                selectedMatch === match.turtle_id
                                  ? '2px solid #228be6'
                                  : '1px solid #dee2e6',
                              backgroundColor:
                                selectedMatch === match.turtle_id ? '#e7f5ff' : 'white',
                            }}
                            onClick={() => handleSelectMatch(match.turtle_id)}
                          >
                            <Stack gap='xs'>
                              <Group justify='space-between'>
                                <Badge
                                  color={
                                    selectedMatch === match.turtle_id ? 'blue' : 'gray'
                                  }
                                  size='lg'
                                >
                                  Rank {index + 1}
                                </Badge>
                                {selectedMatch === match.turtle_id && (
                                  <IconCheck size={20} color='#228be6' />
                                )}
                              </Group>
                              <Text fw={500}>Turtle ID: {match.turtle_id}</Text>
                              <Text size='sm' c='dimmed'>
                                Location: {match.location}
                              </Text>
                              <Text size='sm' c='dimmed'>
                                Matches: {typeof match.score === 'number' ? match.score : 0}
                              </Text>
                              <Text size='sm' c='dimmed'>
                                Confidence:{' '}
                                {typeof match.confidence === 'number'
                                  ? match.confidence.toFixed(2)
                                  : '0.00'}
                              </Text>
                              {match.file_path && (
                                <Image
                                  src={getImageUrl(match.file_path)}
                                  alt={`Match ${index + 1}`}
                                  radius='md'
                                  style={{ maxHeight: '120px', objectFit: 'contain' }}
                                />
                              )}
                            </Stack>
                          </Card>
                        ))}
                      </Stack>
                    </ScrollArea>
                  </Stack>
                </Paper>
              </Stack>
            </Grid.Col>

            {/* Right Column: Selected Match Details & Sheets Data */}
            <Grid.Col span={{ base: 12, md: 7 }}>
              {selectedMatch && selectedMatchData ? (
                <Stack gap='md' style={{ position: 'relative' }}>
                  {/* Loading overlay while turtle data is being fetched */}
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
                  {/* Selected Match Info */}
                  <Paper shadow='sm' p='md' radius='md' withBorder>
                    <Stack gap='sm'>
                      <Group justify='space-between'>
                        <Text fw={500} size='lg'>
                          Selected Match
                        </Text>
                        <Badge color='blue' size='lg'>
                          {matchData.matches.findIndex(
                            (m) => m.turtle_id === selectedMatch,
                          ) + 1}
                        </Badge>
                      </Group>
                      <Divider />
                      <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Text size='sm' c='dimmed'>
                            Turtle ID
                          </Text>
                          <Text fw={500}>{selectedMatch}</Text>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Text size='sm' c='dimmed'>
                            Location
                          </Text>
                          <Text fw={500}>{selectedMatchData.location}</Text>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Text size='sm' c='dimmed'>
                            Matches
                          </Text>
                          <Text fw={500}>
                            {typeof selectedMatchData.score === 'number'
                              ? selectedMatchData.score
                              : 0}
                          </Text>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Text size='sm' c='dimmed'>
                            Confidence
                          </Text>
                          <Text fw={500}>
                            {typeof selectedMatchData.confidence === 'number'
                              ? selectedMatchData.confidence.toFixed(2)
                              : '0.00'}
                          </Text>
                        </Grid.Col>
                        {primaryId && (
                          <Grid.Col span={{ base: 12, sm: 6 }}>
                            <Text size='sm' c='dimmed'>
                              Primary ID
                            </Text>
                            <Text fw={500}>{primaryId}</Text>
                          </Grid.Col>
                        )}
                      </Grid>
                    </Stack>
                  </Paper>

                  {/* Google Sheets Data Form */}
                  <Paper shadow='sm' p='md' radius='md' withBorder>
                    <ScrollArea h={600}>
                      <TurtleSheetsDataForm
                        ref={formRef}
                        initialData={sheetsData || undefined}
                        sheetName={sheetsData?.sheet_name}
                        primaryId={primaryId || undefined}
                        mode={sheetsData ? 'edit' : 'create'}
                        onSave={handleSaveSheetsData}
                        hideSubmitButton={true}
                        onCombinedSubmit={handleSaveAndConfirm}
                        addOnlyMode={true}
                        initialAvailableSheets={availableSheets.length > 0 ? availableSheets : undefined}
                      />
                    </ScrollArea>
                  </Paper>

                  {/* Action Buttons */}
                  <Paper shadow='sm' p='md' radius='md' withBorder>
                    <Group justify='space-between' gap='md'>
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
                  </Paper>
                </Stack>
              ) : (
                <Paper shadow='sm' p='xl' radius='md' withBorder>
                  <Center py='xl'>
                    <Stack gap='md' align='center'>
                      <IconPhoto size={64} stroke={1.5} style={{ opacity: 0.3 }} />
                      <Text size='lg' c='dimmed' ta='center'>
                        Select a match to view details
                      </Text>
                      <Text size='sm' c='dimmed' ta='center'>
                        Click on any match from the list to see turtle data and Google
                        Sheets information
                      </Text>
                      <Text size='sm' c='dimmed' ta='center' mt='md'>
                        Or create a new turtle entry if none of the matches are suitable
                      </Text>
                      <Button
                        leftSection={<IconPlus size={16} />}
                        onClick={handleCreateNewTurtle}
                        variant='light'
                      >
                        Create New Turtle
                      </Button>
                    </Stack>
                  </Center>
                </Paper>
              )}
            </Grid.Col>
          </Grid>
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
            initialAvailableSheets={availableSheets.length > 0 ? availableSheets : undefined}
          />
        </Stack>
      </Modal>
    </Container>
  );
}
