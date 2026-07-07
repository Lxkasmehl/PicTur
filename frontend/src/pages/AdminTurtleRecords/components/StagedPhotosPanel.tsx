import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Image,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import { additionalPhotoKindLabel } from '../../../constants/additionalPhotoKinds';
import { isReferenceType, type ReferenceType, type StagedPhoto } from '../hooks/useStagedPhotos';

interface StagedPhotosPanelProps {
  photos: StagedPhoto[];
  replaceWinnerIds: Record<ReferenceType, string | null>;
  committing: boolean;
  onRemovePhoto: (id: string) => void;
  onCommitImagesOnly: () => Promise<void>;
}

export function StagedPhotosPanel({
  photos,
  replaceWinnerIds,
  committing,
  onRemovePhoto,
  onCommitImagesOnly,
}: StagedPhotosPanelProps) {
  if (photos.length === 0) return null;

  const collidingTypes = (['plastron', 'carapace'] as ReferenceType[]).filter((t) => {
    const count = photos.filter(
      (s) => isReferenceType(s.photoType) && s.replaceReference && s.photoType === t,
    ).length;
    return count > 1;
  });

  return (
    <Paper shadow='sm' p='md' radius='md' withBorder>
      <Stack gap='sm'>
        <Group justify='space-between' align='center'>
          <Text fw={600} size='sm'>
            Pending photos (uncommitted)
          </Text>
          <Badge color='yellow' variant='light'>
            Apply on Update Turtle
          </Badge>
        </Group>
        <Group gap='sm' wrap='wrap' align='flex-start'>
          {photos.map((s) => {
            const isRef = isReferenceType(s.photoType);
            const isWinner =
              isRef && s.replaceReference && replaceWinnerIds[s.photoType as ReferenceType] === s.id;
            const isSuperseded =
              isRef && s.replaceReference && replaceWinnerIds[s.photoType as ReferenceType] !== s.id;
            const prettyType = additionalPhotoKindLabel(s.photoType);
            const badgeLabel = (() => {
              if (isWinner) return `${prettyType} · will replace`;
              if (isSuperseded) return `${prettyType} · superseded → Other`;
              if (isRef && !s.replaceReference) return `${prettyType} · Other`;
              return prettyType;
            })();
            const badgeColor = isWinner ? 'red' : isSuperseded ? 'orange' : 'blue';
            return (
              <Stack key={s.id} gap={4} align='center' maw={120}>
                <Box pos='relative'>
                  <Box
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: isWinner
                        ? '2px solid var(--mantine-color-red-6)'
                        : '1px solid var(--mantine-color-default-border)',
                    }}
                  >
                    <Image src={s.previewUrl} alt={s.photoType} w={96} h={96} fit='cover' />
                  </Box>
                  <Button
                    size='xs'
                    variant='filled'
                    color='red'
                    p={4}
                    onClick={() => onRemovePhoto(s.id)}
                    style={{ position: 'absolute', top: 2, right: 2, minWidth: 24, height: 24 }}
                    disabled={committing}
                  >
                    <IconTrash size={12} />
                  </Button>
                </Box>
                <Badge size='xs' variant='light' color={badgeColor}>
                  {badgeLabel}
                </Badge>
              </Stack>
            );
          })}
        </Group>
        {collidingTypes.length > 0 && (
          <Alert color='orange' icon={<IconAlertTriangle size={16} />} p='xs'>
            <Text size='xs'>
              Multiple replacements staged for {collidingTypes.join(' and ')} — only the last one
              of each type will become the new reference. Earlier ones will be saved to the Other
              folder instead.
            </Text>
          </Alert>
        )}
        <Divider />
        <Group justify='space-between' align='center' wrap='wrap' gap='xs'>
          <Text size='xs' c='dimmed'>
            Staged photos haven't been saved yet. This button saves images only — to update the
            turtle's record fields, use the Update button in the turtle info section below.
          </Text>
          <Button
            color='blue'
            size='xs'
            onClick={onCommitImagesOnly}
            loading={committing}
            disabled={committing || photos.length === 0}
          >
            Update Turtle Images
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
