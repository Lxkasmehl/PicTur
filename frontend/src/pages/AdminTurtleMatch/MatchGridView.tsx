import {
  Badge,
  Button,
  Grid,
  Group,
  Image,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { getImageUrl } from '../../services/api';
import { candidateSummaryKey } from './utils';
import { MatchCandidateCard } from './MatchCandidateCard';
import { useAdminTurtleMatchContext } from './AdminTurtleMatchContext';

export function MatchGridView() {
  const {
    imageId,
    matchData,
    packetItem,
    crossCheckResults,
    crossCheckLoading,
    candidateSummaries,
    handleSelectMatch,
    handleCreateNewTurtle,
    handleCrossCheckCarapace,
  } = useAdminTurtleMatchContext();

  if (!matchData) return null;

  const uploadedCarapaceGrid = packetItem?.additional_images?.find(
    (a) => a.type === 'carapace',
  );
  const hasCarapaceCrossCheck =
    crossCheckResults !== null && crossCheckResults.length > 0;
  const hasCarapaceAdditional = packetItem?.additional_images?.some(
    (img) => img.type === 'carapace',
  );

  return (
    <Stack gap='md'>
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

      {imageId && hasCarapaceAdditional && (
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
                onClick={handleCrossCheckCarapace}
              >
                Cross-check Carapace
              </Button>
            )}
            {crossCheckResults !== null && (
              <Badge
                size='lg'
                variant='light'
                color={crossCheckResults.length > 0 ? 'teal' : 'gray'}
              >
                {crossCheckResults.length} carapace match(es)
              </Badge>
            )}
          </Group>
        </Paper>
      )}

      <Paper shadow='sm' p='md' radius='md' withBorder>
        <Group justify='flex-end' mb='md'>
          <Button
            variant='light'
            leftSection={<IconPlus size={16} />}
            onClick={handleCreateNewTurtle}
          >
            Create New Turtle
          </Button>
        </Group>

        <Grid gutter='lg'>
          <Grid.Col span={hasCarapaceCrossCheck ? { base: 12, md: 6 } : 12}>
            <Text fw={500} size='lg' mb='md'>
              {hasCarapaceCrossCheck ? 'Plastron Matches' : 'Top 5 Matches'}
            </Text>
            <Text size='sm' c='dimmed' mb='md'>
              Select a match to view details
            </Text>
            <SimpleGrid
              cols={
                hasCarapaceCrossCheck
                  ? { base: 1, xs: 2 }
                  : { base: 1, xs: 2, md: 3, lg: 5 }
              }
              spacing='md'
            >
              {matchData.matches.map((match, index) => (
                <MatchCandidateCard
                  key={`${match.turtle_id}-${index}`}
                  rank={index + 1}
                  turtleId={match.turtle_id}
                  location={match.location || ''}
                  confidence={match.confidence}
                  imagePath={match.file_path}
                  summary={candidateSummaries[candidateSummaryKey(match.turtle_id, match.location || '')]}
                  onSelect={() => handleSelectMatch(match.turtle_id)}
                />
              ))}
            </SimpleGrid>
          </Grid.Col>

          {hasCarapaceCrossCheck && crossCheckResults && (
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Group gap='xs' mb='md'>
                <Text fw={500} size='lg'>
                  Carapace Matches
                </Text>
                {matchData.matches.length > 0 &&
                  crossCheckResults[0].turtle_id !== matchData.matches[0].turtle_id && (
                    <Badge color='orange' variant='light'>
                      Top match differs
                    </Badge>
                  )}
              </Group>
              <Text size='sm' c='dimmed' mb='md'>
                Cross-check results from carapace image
              </Text>
              <SimpleGrid cols={{ base: 1, xs: 2 }} spacing='md'>
                {crossCheckResults.map((match, index) => (
                  <MatchCandidateCard
                    key={`${match.turtle_id}-xcheck-${index}`}
                    rank={index + 1}
                    turtleId={match.turtle_id}
                    location={match.location || ''}
                    confidence={match.confidence}
                    imagePath={match.image_path}
                    summary={
                      candidateSummaries[
                        candidateSummaryKey(match.turtle_id, match.location || '')
                      ]
                    }
                    badgeColor='teal'
                  />
                ))}
              </SimpleGrid>
            </Grid.Col>
          )}
        </Grid>
      </Paper>
    </Stack>
  );
}
