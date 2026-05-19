import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Grid,
  Group,
  Image,
  Loader,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle, IconArrowLeft, IconCheck, IconPlus } from '@tabler/icons-react';
import { getImageUrl } from '../../services/api';
import { TurtleSheetsDataForm } from '../../components/TurtleSheetsDataForm';
import { AdditionalImagesSection } from '../../components/AdditionalImagesSection';
import { candidateSummaryKey, dataPathHintFromMatchLocation } from './utils';
import { useAdminTurtleMatchContext } from './AdminTurtleMatchContext';

export function MatchDetailView() {
  const {
    imageId,
    matchData,
    packetItem,
    selectedMatch,
    selectedMatchData,
    selectedMatchTurtleImages,
    loadingTurtleData,
    processing,
    sheetsData,
    primaryId,
    availableSheets,
    formRef,
    candidateSummaries,
    replaceReference,
    setReplaceReference,
    replaceCarapaceReference,
    setReplaceCarapaceReference,
    isMatchFromCommunity,
    navigate,
    handleSelectMatch,
    handleSaveSheetsData,
    handleSaveAndConfirm,
    handleCombinedButtonClick,
    handleCreateNewTurtle,
    refreshPacketItem,
    refreshSelectedMatchImages,
  } = useAdminTurtleMatchContext();

  if (!matchData || !selectedMatch || !selectedMatchData) return null;

  const summary =
    candidateSummaries[candidateSummaryKey(selectedMatch, selectedMatchData.location || '')];
  const displayBioId = summary?.bio_id || selectedMatch;
  const displayName = summary?.name || '';
  const uploadedCarapace = packetItem?.additional_images?.find((a) => a.type === 'carapace');
  const matchCarapacePath = selectedMatchTurtleImages?.primary_carapace ?? null;
  const rank =
    matchData.matches.findIndex((m) => m.turtle_id === selectedMatch) + 1;

  return (
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
            <Button
              variant='light'
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => handleSelectMatch('')}
            >
              Back to matches
            </Button>
            <Badge color='blue' size='lg'>
              Rank {rank}
            </Badge>
          </Group>
          <Divider />

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

          {uploadedCarapace && (
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
          )}

          <Grid mt='xs'>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <Text size='sm' c='dimmed'>
                Bio ID
              </Text>
              <Text fw={500}>{displayBioId}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <Text size='sm' c='dimmed'>
                Name
              </Text>
              <Text fw={500}>{displayName || '—'}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 2 }}>
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
            {(summary?.primary_id || primaryId) && (
              <Grid.Col span={{ base: 6, sm: 2 }}>
                <Text size='sm' c='dimmed'>
                  Primary ID
                </Text>
                <Text fw={500}>{summary?.primary_id || primaryId}</Text>
              </Grid.Col>
            )}
          </Grid>
        </Stack>
      </Paper>

      <Paper shadow='sm' p='md' radius='md' withBorder>
        <Stack gap='md'>
          <div>
            <Text fw={600} size='sm' mb={4}>
              Additional photos
            </Text>
            <Text size='xs' c='dimmed' mb='sm'>
              From this upload and already stored for this turtle.
            </Text>
          </div>
          {imageId && (
            <AdditionalImagesSection
              title='From this upload'
              embedded
              images={(packetItem?.additional_images ?? []).map((a) => ({
                imagePath: a.image_path,
                filename: a.filename,
                type: a.type,
                labels: a.labels,
              }))}
              requestId={imageId}
              onRefresh={refreshPacketItem}
              disabled={!!processing}
            />
          )}
          {selectedMatch && (
            <AdditionalImagesSection
              title='Already in system for this turtle'
              embedded
              hideAddButtons
              images={(selectedMatchTurtleImages?.additional ?? []).map((a) => ({
                imagePath: a.path,
                filename: a.path.split(/[/\\]/).pop() ?? a.path,
                type: a.type,
                labels: a.labels,
              }))}
              turtleId={selectedMatch}
              sheetName={dataPathHintFromMatchLocation(selectedMatchData.location)}
              onRefresh={refreshSelectedMatchImages}
              disabled={!!processing}
            />
          )}
        </Stack>
      </Paper>

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
            <Alert icon={<IconAlertTriangle size={16} />} color='orange' radius='md'>
              The current plastron reference image will be replaced with this upload. The old
              image will be archived.
            </Alert>
          )}
          {packetItem?.additional_images?.some((img) => img.type === 'carapace') && (
            <Checkbox
              label='Replace carapace reference (first carapace photo)'
              description='The current carapace reference will be archived'
              checked={replaceCarapaceReference}
              onChange={(e) => setReplaceCarapaceReference(e.currentTarget.checked)}
              disabled={!!processing}
            />
          )}
          {replaceCarapaceReference && (
            <Alert icon={<IconAlertTriangle size={16} />} color='orange' radius='md'>
              The current carapace reference image will be replaced with the first carapace
              additional photo. The old image will be archived.
            </Alert>
          )}
        </Stack>
      </Paper>

      <Paper shadow='sm' p='md' radius='md' withBorder>
        <TurtleSheetsDataForm
          ref={formRef}
          initialData={sheetsData || undefined}
          sheetName={isMatchFromCommunity ? '' : sheetsData?.sheet_name}
          primaryId={primaryId || undefined}
          mode='edit'
          onSave={handleSaveSheetsData}
          hideSubmitButton
          onCombinedSubmit={handleSaveAndConfirm}
          addOnlyMode
          initialAvailableSheets={availableSheets.length > 0 ? availableSheets : undefined}
          sheetSource='admin'
          requireNewSheetForCommunityMatch={isMatchFromCommunity}
          matchPageColumnLayout
        />
      </Paper>

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
            <Button variant='light' onClick={() => navigate('/')} disabled={processing}>
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
  );
}
