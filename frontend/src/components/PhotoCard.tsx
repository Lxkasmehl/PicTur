import {
  Card,
  Image,
  Group,
  Badge,
  Text,
  Stack,
  Button,
  Divider,
  Alert,
} from '@mantine/core';
import { IconFile, IconClock, IconMapPin } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import type { UploadedPhoto } from '../types/photo';
import { formatUsDateTimeForDisplay } from '../utils/usDateFormat';
import { formatFileSize, formatLocation, getGoogleMapsUrl } from '../utils/photoHelpers';

interface PhotoCardProps {
  photo: UploadedPhoto;
  showViewAllButton?: boolean;
  totalPhotos?: number;
}

export function PhotoCard({
  photo,
  showViewAllButton,
  totalPhotos,
}: PhotoCardProps) {
  const navigate = useNavigate();

  return (
    <Card shadow='sm' padding='lg' radius='md' withBorder>
      <Stack gap='md'>
        {/* Photo */}
        <Card.Section>
          <Image
            src={photo.preview || undefined}
            alt={photo.fileName}
            height={300}
            fit='cover'
            radius='md'
          />
        </Card.Section>

        {/* Badges */}
        <Group gap='xs'>
          <Badge
            size='xs'
            variant='light'
            color='gray'
            leftSection={<IconFile size={10} />}
          >
            {formatFileSize(photo.fileSize)}
          </Badge>
          <Badge
            size='xs'
            variant='light'
            color='blue'
            leftSection={<IconClock size={10} />}
          >
            {photo.uploadDate}
          </Badge>
        </Group>

        {/* File Info */}
        <Stack gap='xs'>
          <Group justify='space-between'>
            <Text size='sm' fw={500}>
              File Name:
            </Text>
            <Text size='sm' c='dimmed' ta='right'>
              {photo.fileName}
            </Text>
          </Group>
          <Group justify='space-between'>
            <Text size='sm' fw={500}>
              Upload Date:
            </Text>
            <Text size='sm' c='dimmed' ta='right'>
              {photo.uploadDate}
            </Text>
          </Group>
          <Group justify='space-between'>
            <Text size='sm' fw={500}>
              Timestamp:
            </Text>
            <Text size='sm' c='dimmed' ta='right' style={{ fontFamily: 'monospace' }}>
              {formatUsDateTimeForDisplay(new Date(photo.timestamp))}
            </Text>
          </Group>
          <Group justify='space-between'>
            <Text size='sm' fw={500}>
              Image ID:
            </Text>
            <Text size='sm' c='dimmed' ta='right' style={{ fontFamily: 'monospace' }}>
              {photo.imageId}
            </Text>
          </Group>
        </Stack>

        <Divider />

        {/* Location Info */}
        {photo.location && (
          <>
            <Stack gap='xs'>
              <Group gap='xs'>
                <IconMapPin size={16} />
                <Text size='sm' fw={500}>
                  Location:
                </Text>
              </Group>
              <Text size='sm' c='dimmed' pl='md'>
                {formatLocation(photo)}
              </Text>
              {photo.location.accuracy && (
                <Text size='xs' c='dimmed' pl='md'>
                  Accuracy: ±{Math.round(photo.location.accuracy)} meters
                </Text>
              )}
              {getGoogleMapsUrl(photo) && (
                <Button
                  component='a'
                  href={getGoogleMapsUrl(photo) || undefined}
                  target='_blank'
                  rel='noopener noreferrer'
                  variant='light'
                  size='xs'
                  leftSection={<IconMapPin size={14} />}
                  fullWidth
                >
                  View on Google Maps
                </Button>
              )}
            </Stack>
          </>
        )}

        {!photo.location && (
          <>
            <Divider />
            <Alert color='gray' radius='md'>
              <Text size='xs' c='dimmed'>
                Location information not available for this sighting
              </Text>
            </Alert>
          </>
        )}

        {showViewAllButton && totalPhotos && (
          <Button
            variant='light'
            size='sm'
            onClick={() => navigate(`/admin/turtle-match/${photo.imageId}`)}
            fullWidth
          >
            View All {totalPhotos} Sightings
          </Button>
        )}
      </Stack>
    </Card>
  );
}
