import {
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { IconArrowLeft, IconEyeCheck, IconAlertCircle } from '@tabler/icons-react';
import { MatchCandidateCard } from '../pages/AdminTurtleMatch/MatchCandidateCard';
import { TurtleImageComparePair } from './TurtleImageComparePair';
import { ScopeAlert } from './ScopeAlert';
import { getImageUrl } from '../services/api';
import type { QuickCheckMatch } from '../services/api';
import type { QuickCheckStatus } from '../hooks/useCarapaceQuickCheck';

interface CarapaceQuickCheckResultsProps {
  status: Exclude<QuickCheckStatus, 'idle'>;
  error: string | null;
  /** Local preview data URL of the uploaded photo — rendered raw, never persisted. */
  queryPreviewUrl: string;
  matches: QuickCheckMatch[];
  elapsed: number | null;
  selectedIndex: number | null;
  /** PR-4: results include carapace refs outside the caller's assigned areas. */
  scopeExpanded?: boolean;
  onSelect: (index: number | null) => void;
  onBack: () => void;
}

/** True when the backend found no sibling image for the reference tensor. */
function hasNoImage(match: QuickCheckMatch): boolean {
  return !match.image_path || match.image_path.endsWith('.pt');
}

/** PR-4: absent `in_scope` means in scope (global users / legacy). */
function isOutOfScope(match: QuickCheckMatch): boolean {
  return match.in_scope === false;
}

/**
 * Read-only results for the carapace quick check. Reuses the live match-page
 * components (MatchCandidateCard, TurtleImageComparePair) but exposes no
 * write affordance: view and click-to-compare only.
 */
export function CarapaceQuickCheckResults({
  status,
  error,
  queryPreviewUrl,
  matches,
  elapsed,
  selectedIndex,
  scopeExpanded = false,
  onSelect,
  onBack,
}: CarapaceQuickCheckResultsProps) {
  if (status === 'running') {
    return (
      <Paper shadow='sm' p='xl' radius='md' withBorder>
        <Center>
          <Stack align='center' gap='sm'>
            <Loader size='lg' color='orange' />
            <Text c='dimmed'>Running carapace quick check…</Text>
          </Stack>
        </Center>
      </Paper>
    );
  }

  if (status === 'error') {
    return (
      <Paper shadow='sm' p='md' radius='md' withBorder>
        <Stack gap='md'>
          <Alert icon={<IconAlertCircle size={18} />} color='red' radius='md'>
            {error ?? 'Quick check failed.'}
          </Alert>
          <Button
            variant='light'
            leftSection={<IconArrowLeft size={16} />}
            onClick={onBack}
          >
            Back to upload
          </Button>
        </Stack>
      </Paper>
    );
  }

  const selected = selectedIndex != null ? matches[selectedIndex] : null;

  if (selected) {
    return (
      <Paper shadow='sm' p='md' radius='md' withBorder>
        <Stack gap='sm'>
          {scopeExpanded && <ScopeAlert message='This carapace match includes references outside your assigned areas. The quick check is read-only.' />}
          <Group justify='space-between'>
            <Button
              variant='light'
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => onSelect(null)}
            >
              Back to matches
            </Button>
            <Badge color='teal' size='lg'>
              Rank {selectedIndex! + 1}
            </Badge>
          </Group>
          <Divider />
          <TurtleImageComparePair
            leftLabel='Your photo (not saved)'
            leftSrc={queryPreviewUrl}
            rightLabel={`Carapace ref: ${selected.turtle_id}`}
            rightSrc={hasNoImage(selected) ? null : getImageUrl(selected.image_path)}
            rightPlaceholder={
              <Text size='xs' c='dimmed' mt='sm'>
                No carapace reference image on file for this turtle.
              </Text>
            }
          />
          <Group gap='xl'>
            <div>
              <Text size='xs' c='dimmed'>
                Turtle ID
              </Text>
              <Text size='sm' fw={500}>
                {selected.turtle_id}
              </Text>
            </div>
            <div>
              <Text size='xs' c='dimmed'>
                Location
              </Text>
              <Text size='sm' fw={500}>
                {selected.location}
              </Text>
            </div>
            <div>
              <Text size='xs' c='dimmed'>
                Confidence
              </Text>
              <Text size='sm' fw={500}>
                {selected.confidence <= 1
                  ? `${(selected.confidence * 100).toFixed(1)}%`
                  : `${Math.round(selected.confidence)}%`}
              </Text>
            </div>
          </Group>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper shadow='sm' p='md' radius='md' withBorder>
      <Stack gap='md'>
        {scopeExpanded && (
          <ScopeAlert message='These carapace matches include references outside your assigned areas. The quick check is read-only.' />
        )}
        <Alert icon={<IconEyeCheck size={18} />} color='orange' radius='md'>
          Read-only result — nothing was saved. Click a match to compare side by
          side.
        </Alert>

        {matches.length === 0 ? (
          <Text c='dimmed' ta='center' py='lg'>
            No carapace matches found. The selected scope may have no carapace
            references on file.
          </Text>
        ) : (
          <>
            <Text fw={500} size='lg'>
              Top Carapace Matches
            </Text>
            <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 5 }} spacing='md'>
              {matches.map((match, index) => (
                <MatchCandidateCard
                  key={`${match.turtle_id}-${index}`}
                  rank={index + 1}
                  turtleId={match.turtle_id}
                  location={match.location || ''}
                  confidence={match.confidence}
                  imagePath={hasNoImage(match) ? null : match.image_path}
                  badgeColor='teal'
                  outOfScope={isOutOfScope(match)}
                  onSelect={() => onSelect(index)}
                />
              ))}
            </SimpleGrid>
          </>
        )}

        <Group justify='space-between'>
          <Button
            variant='light'
            leftSection={<IconArrowLeft size={16} />}
            onClick={onBack}
          >
            Back to upload
          </Button>
          {elapsed != null && (
            <Text size='xs' c='dimmed'>
              Matched in {elapsed.toFixed(2)}s
            </Text>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
