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

  return (
    <Container size='xl' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
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
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack gap='md'>
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
                                selectedMatch === match.turtle_id
                                  ? '#e7f5ff'
                                  : 'white',
                            }}
                            onClick={() => handleSelectMatch(match.turtle_id)}
                          >
                            <Stack gap='xs'>
                              <Group justify='space-between'>
                                <Badge
                                  color={
                                    selectedMatch === match.turtle_id
                                      ? 'blue'
                                      : 'gray'
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

            <Grid.Col span={{ base: 12, md: 7 }}>
              {selectedMatch && selectedMatchData ? (
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

                  <Paper shadow='sm' p='md' radius='md' withBorder>
                    <ScrollArea h={600}>
                      <TurtleSheetsDataForm
                        ref={formRef}
                        initialData={sheetsData || undefined}
                        sheetName={sheetsData?.sheet_name}
                        state={state}
                        location={location}
                        primaryId={primaryId || undefined}
                        mode={sheetsData ? 'edit' : 'create'}
                        onSave={handleSaveSheetsData}
                        hideSubmitButton
                        onCombinedSubmit={handleSaveAndConfirm}
                        addOnlyMode
                        initialAvailableSheets={
                          availableSheets.length > 0 ? availableSheets : undefined
                        }
                      />
                    </ScrollArea>
                  </Paper>

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
                        Click on any match from the list to see turtle data and
                        Google Sheets information
                      </Text>
                      <Text size='sm' c='dimmed' ta='center' mt='md'>
                        Or create a new turtle entry if none of the matches are
                        suitable
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
            initialAvailableSheets={
              availableSheets.length > 0 ? availableSheets : undefined
            }
          />
        </Stack>
      </Modal>
    </Container>
  );
}
