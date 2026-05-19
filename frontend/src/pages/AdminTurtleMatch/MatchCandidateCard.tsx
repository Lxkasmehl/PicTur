import { Badge, Card, Center, Group, Image, Text } from '@mantine/core';
import { IconPhoto } from '@tabler/icons-react';
import { getImageUrl } from '../../services/api';
import type { CandidateSummary } from './utils';

const cardHoverStyle = {
  border: '1px solid #dee2e6',
  transition: 'transform 0.1s, box-shadow 0.1s',
} as const;

type MatchCandidateCardProps = {
  rank: number;
  turtleId: string;
  location: string;
  confidence: number;
  imagePath?: string | null;
  summary?: CandidateSummary;
  badgeColor?: 'blue' | 'teal';
  onSelect?: () => void;
};

export function MatchCandidateCard({
  rank,
  turtleId,
  location,
  confidence,
  imagePath,
  summary,
  badgeColor = 'blue',
  onSelect,
}: MatchCandidateCardProps) {
  const showSecondaryId = summary?.primary_id && summary.primary_id !== turtleId;
  const confidenceLabel =
    confidence <= 1 ? `${(confidence * 100).toFixed(1)}%` : `${Math.round(confidence)}%`;

  return (
    <Card
      shadow='sm'
      padding='sm'
      radius='md'
      withBorder
      style={{
        ...cardHoverStyle,
        cursor: onSelect ? 'pointer' : undefined,
      }}
      onMouseEnter={
        onSelect
          ? (e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            }
          : undefined
      }
      onMouseLeave={
        onSelect
          ? (e) => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.boxShadow = '';
            }
          : undefined
      }
      onClick={onSelect}
    >
      {imagePath ? (
        <Image
          src={getImageUrl(imagePath)}
          alt={`Match ${rank}`}
          radius='md'
          style={{ aspectRatio: '1', objectFit: 'cover', width: '100%' }}
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

      <Group justify='space-between' mb={4} wrap='nowrap' gap='xs'>
        <Group gap={6} wrap='nowrap' style={{ minWidth: 0, flex: 1 }}>
          <Badge color={badgeColor} size='sm' variant='filled' style={{ flexShrink: 0 }}>
            #{rank}
          </Badge>
          {summary?.name && (
            <Text size='xs' fw={500} c='dark' truncate>
              {summary.name}
            </Text>
          )}
        </Group>
        <Badge color='gray' size='sm' variant='light' style={{ flexShrink: 0 }}>
          {confidenceLabel}
        </Badge>
      </Group>
      <Text fw={500} size='sm' truncate>
        {turtleId}
      </Text>
      {showSecondaryId && (
        <Text size='xs' c='dimmed' truncate>
          {summary!.primary_id}
        </Text>
      )}
      <Text size='xs' c='dimmed' truncate>
        {location}
      </Text>
    </Card>
  );
}
