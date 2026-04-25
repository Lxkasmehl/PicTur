import {
  Card,
  Stack,
  Group,
  Image,
  Badge,
  Button,
  Divider,
  Collapse,
  Text,
} from '@mantine/core';
import {
  IconFile,
  IconClock,
  IconMapPin,
  IconChevronDown,
  IconChevronUp,
  IconRecycle,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import type { UploadedPhoto } from '../types/photo';
import type { PhotoGroup } from '../hooks/usePhotoGroups';
import { formatFileSize, formatLocation } from '../utils/photoHelpers';

interface PhotoGroupCardProps {
  group: PhotoGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onPhotoClick: (photo: UploadedPhoto) => void;
}

export function PhotoGroupCard({
  group,
  isExpanded,
  onToggle,
  onPhotoClick,
}: PhotoGroupCardProps) {
  const navigate = useNavigate();

  return (
    <Card shadow='sm' padding='md' radius='md' withBorder>
      <Stack gap='md'>
        {/* Main Photo with Info */}
        <Group gap='md' align='flex-start' wrap='nowrap'>
          <Image
            src={group.representative.preview}
            alt={group.representative.fileName}
            width={120}
            height={120}
            fit='cover'
            radius='md'
            style={{ cursor: 'pointer', flexShrink: 0 }}
            onClick={() => onPhotoClick(group.representative)}
          />
          <Stack gap='xs' style={{ flex: 1, minWidth: 0 }}>
            <Group justify='space-between' align='flex-start' wrap='nowrap'>
              <Text
                size='sm'
                fw={500}
                lineClamp={2}
                title={group.representative.fileName}
                style={{ flex: 1 }}
              >
                {group.representative.fileName}
              </Text>
              {group.isDuplicate && (
                <Badge
                  color='green'
                  variant='light'
                  size='sm'
                  leftSection={<IconRecycle size={12} />}
                >
                  {group.photos.length}×
                </Badge>
              )}
            </Group>
            <Group gap='xs' wrap='wrap'>
              <Badge
                size='xs'
                variant='light'
                color='gray'
                leftSection={<IconFile size={10} />}
              >
                {formatFileSize(group.representative.fileSize)}
              </Badge>
              <Badge
                size='xs'
                variant='light'
                color='blue'
                leftSection={<IconClock size={10} />}
              >
                {group.representative.uploadDate}
              </Badge>
              {group.representative.location && (
                <Badge
                  size='xs'
                  variant='light'
                  color='teal'
                  leftSection={<IconMapPin size={10} />}
                >
                  Location
                </Badge>
              )}
            </Group>
            {group.representative.location && (
              <Text size='xs' c='dimmed' lineClamp={1}>
                {formatLocation(group.representative)}
              </Text>
            )}
          </Stack>
        </Group>

        {/* Duplicate Photos */}
        {group.isDuplicate && (
          <>
            <Divider />
            <Stack gap='xs'>
              <Button
                variant='light'
                size='xs'
                leftSection={
                  isExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />
                }
                onClick={onToggle}
                fullWidth
              >
                <Group gap='xs' justify='space-between' style={{ width: '100%' }}>
                  <Text size='xs' fw={500}>
                    {group.photos.length - 1} Additional Sighting
                    {group.photos.length - 1 > 1 ? 's' : ''}
                  </Text>
                  <Badge color='green' variant='light' size='xs'>
                    {group.photos.length} Total
                  </Badge>
                </Group>
              </Button>

              <Collapse in={isExpanded}>
                <Stack gap='xs' mt='xs'>
                  {group.photos.slice(1).map((photo) => (
                    <Card
                      key={photo.imageId}
                      shadow='xs'
                      padding='xs'
                      radius='md'
                      withBorder
                      style={{ cursor: 'pointer' }}
                      onClick={() => onPhotoClick(photo)}
                    >
                      <Group gap='sm' align='flex-start' wrap='nowrap'>
                        <Image
                          src={photo.preview}
                          alt={photo.fileName}
                          width={60}
                          height={60}
                          fit='cover'
                          radius='md'
                          style={{ flexShrink: 0 }}
                        />
                        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                          <Text size='xs' fw={500} lineClamp={1}>
                            {photo.fileName}
                          </Text>
                          <Group gap='xs' wrap='wrap'>
                            <Badge size='xs' variant='light' color='blue'>
                              {photo.uploadDate}
                            </Badge>
                            {photo.location && (
                              <Badge
                                size='xs'
                                variant='light'
                                color='teal'
                                leftSection={<IconMapPin size={8} />}
                              >
                                {photo.location.address ? 'Loc' : 'Coords'}
                              </Badge>
                            )}
                          </Group>
                          {photo.location && (
                            <Text size='xs' c='dimmed' lineClamp={1}>
                              {formatLocation(photo)}
                            </Text>
                          )}
                        </Stack>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              </Collapse>

              <Button
                variant='subtle'
                size='xs'
                leftSection={<IconRecycle size={12} />}
                onClick={() =>
                  navigate(`/admin/turtle-match/${group.representative.imageId}`)
                }
                fullWidth
              >
                View All {group.photos.length} Sightings
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Card>
  );
}

