import {
  Modal,
  Stack,
  Image,
  ScrollArea,
  Group,
  Text,
  Button,
  Divider,
  Alert,
} from '@mantine/core';
import { IconX, IconMapPin } from '@tabler/icons-react';
import type { UploadedPhoto } from '../types/photo';
import { formatUsDateTimeForDisplay } from '../utils/usDateFormat';
import { formatFileSize, formatLocation, getGoogleMapsUrl } from '../utils/photoHelpers';

interface PhotoDetailModalProps {
  opened: boolean;
  onClose: () => void;
  photo: UploadedPhoto | null;
}

export function PhotoDetailModal({ opened, onClose, photo }: PhotoDetailModalProps) {
  if (!photo) return null;

  return (
    <Modal opened={opened} onClose={onClose} title={photo.fileName} size='xl' centered>
      <Stack gap='md'>
        <Image
          src={photo.preview}
          alt={photo.fileName}
          radius='md'
          style={{ maxWidth: '100%', height: 'auto' }}
        />
        <ScrollArea h={200}>
          <Stack gap='sm'>
            <Group justify='space-between'>
              <Text size='sm' fw={500}>
                File Name:
              </Text>
              <Text size='sm' c='dimmed'>
                {photo.fileName}
              </Text>
            </Group>
            <Group justify='space-between'>
              <Text size='sm' fw={500}>
                File Size:
              </Text>
              <Text size='sm' c='dimmed'>
                {formatFileSize(photo.fileSize)}
              </Text>
            </Group>
            <Group justify='space-between'>
              <Text size='sm' fw={500}>
                File Type:
              </Text>
              <Text size='sm' c='dimmed'>
                {photo.fileType}
              </Text>
            </Group>
            <Group justify='space-between'>
              <Text size='sm' fw={500}>
                Image ID:
              </Text>
              <Text size='sm' c='dimmed' style={{ fontFamily: 'monospace' }}>
                {photo.imageId}
              </Text>
            </Group>
            <Group justify='space-between' align='flex-start'>
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
              <Text size='sm' c='dimmed' style={{ fontFamily: 'monospace' }}>
                {formatUsDateTimeForDisplay(new Date(photo.timestamp))}
              </Text>
            </Group>
          </Stack>
        </ScrollArea>

        {/* Location Info */}
        {photo.location && (
          <>
            <Divider />
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
                  size='sm'
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
                Location information not available for this photo
              </Text>
            </Alert>
          </>
        )}

        <Group justify='flex-end' mt='md'>
          <Button variant='light' onClick={onClose} leftSection={<IconX size={16} />}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

