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
} from '@mantine/core';
import { IconPhoto, IconCheck, IconArrowLeft, IconPlus } from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { getImageUrl } from '../../services/api';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { useAdminTurtleMatchContext } from './AdminTurtleMatchContext';

export function AdminTurtleMatchView() {
  const isMobile = useMediaQuery('(max-width: 576px)');
  const ctx = useAdminTurtleMatchContext();
  const {
    matchData,
    loading,
    selectedMatch,
    selectedMatchData,
    processing,
    sheetsData,
    primaryId,
    showNewTurtleModal,
    setShowNewTurtleModal,
    newTurtlePrimaryId,
    newTurtleSheetsData,
    newTurtleSheetName,
    loadingTurtleData,
    availableSheets,
    formRef,
    state,
    location,
    navigate,
    handleSelectMatch,
    handleSaveSheetsData,
    handleSaveAndConfirm,
    handleCombinedButtonClick,
    handleCreateNewTurtle,
    handleSaveNewTurtleSheetsData,
  } = ctx;

  // Whether to show the detail view (match selected) vs the match grid
  const showDetail = !!(selectedMatch && selectedMatchData);

  return (
    <Container size='xl' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        {/* ── Header ── */}
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

        {/* ── Loading state ── */}
        {loading ? (
          <Center py='xl'>
            <Loader size='lg' />
          </Center>
        ) : !matchData || !matchData.matches || matchData.matches.length === 0 ? (
          /* ── No matches ── */
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
                    {selectedMatchData.file_path && (
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
                    <Text fw={500}>{selectedMatchData.location}</Text>
                  </Grid.Col>
                  <Grid.Col span={{ base: 6, sm: 2 }}>
                    <Text size='sm' c='dimmed'>
                      Confidence
                    </Text>
                    <Text fw={500}>
                      {typeof selectedMatchData.confidence === 'number'
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

            {/* Google Sheets form */}
            <Paper shadow='sm' p='md' radius='md' withBorder>
              <TurtleSheetsDataForm
                ref={formRef}
                initialData={sheetsData || undefined}
                sheetName={sheetsData?.sheet_name}
                state={state}
                location={location}
                primaryId={primaryId || undefined}
                mode='edit'
                onSave={handleSaveSheetsData}
                hideSubmitButton
                onCombinedSubmit={handleSaveAndConfirm}
                addOnlyMode
                initialAvailableSheets={
                  availableSheets.length > 0 ? availableSheets : undefined
                }
                matchPageColumnLayout
              />
            </Paper>

            {/* Action buttons */}
            <Paper shadow='sm' p='md' radius='md' withBorder>
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
            </Paper>
          </Stack>
        ) : (
          /* ══════════════════════════════════════════════
             MATCH GRID — uploaded photo + large match cards
             ══════════════════════════════════════════════ */
          <Stack gap='md'>
            {/* Uploaded photo — full width */}
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
                    maxHeight: 'min(500px, 60vh)',
                    objectFit: 'contain',
                    width: '100%',
                  }}
                />
              </Stack>
            </Paper>

            {/* Top 5 Matches heading + Create New Turtle */}
            <Paper shadow='sm' p='md' radius='md' withBorder>
              <Group justify='space-between' mb='md'>
                <Text fw={500} size='lg'>
                  Top 5 Matches
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

              {/* Responsive grid of match cards */}
              <SimpleGrid
                cols={{ base: 1, xs: 2, md: 3, lg: 5 }}
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
                    {/* Large match image */}
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
            </Paper>
          </Stack>
        )}
      </Stack>

      {/* ── Create New Turtle Modal ── */}
      <Modal
        opened={showNewTurtleModal}
        onClose={() => setShowNewTurtleModal(false)}
        title='Create New Turtle'
        size={isMobile ? '100%' : 'xl'}
        centered
      >
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Create a new turtle entry for this uploaded image. Select a sheet and
            fill in the turtle data below. Primary ID will be automatically
            generated. ID and ID2 can be entered manually if needed.
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
            useBackendLocations
            sheetSource='admin'
            addOnlyMode
            matchPageColumnLayout
            initialAvailableSheets={
              availableSheets.length > 0 ? availableSheets : undefined
            }
          />
        </Stack>
      </Modal>
    </Container>
  );
}
