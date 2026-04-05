import {
  Paper,
  Stack,
  Group,
  Text,
  Button,
  Image,
  Modal,
  Box,
} from '@mantine/core';
import { IconPhotoPlus, IconTrash, IconZoomIn } from '@tabler/icons-react';
import { useState } from 'react';
import { getImageUrl } from '../services/api';
import { validateFile } from '../utils/fileValidation';
import {
  uploadReviewPacketAdditionalImages,
  removeReviewPacketAdditionalImage,
  uploadTurtleAdditionalImages,
  deleteTurtleAdditionalImage,
} from '../services/api';
import { notifications } from '@mantine/notifications';

/** Single additional image for display (packet or turtle). */
export interface AdditionalImageDisplay {
  imagePath: string;
  filename: string;
  type: string;
}

interface AdditionalImagesSectionProps {
  title?: string;
  /** Images to show (from packet or turtle API). */
  images: AdditionalImageDisplay[];
  /** After add/remove, parent should refetch and pass new images. */
  onRefresh: () => Promise<void>;
  /** Packet mode: add/remove via review-queue API. */
  requestId?: string;
  /** Turtle mode: add/remove via turtles API. */
  turtleId?: string;
  sheetName?: string | null;
  /** Disable add/remove (e.g. while loading). */
  disabled?: boolean;
  /** If true, do not wrap in Paper and hide the generic description (for use inside a combined section). */
  embedded?: boolean;
  /** If true, hide the Microhabitat/Condition add buttons (e.g. when another section in the same block has them). */
  hideAddButtons?: boolean;
}

export function AdditionalImagesSection({
  title = 'Additional photos (Microhabitat / Condition)',
  images,
  onRefresh,
  requestId,
  turtleId,
  sheetName = null,
  disabled = false,
  embedded = false,
  hideAddButtons = false,
}: AdditionalImagesSectionProps) {
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const isPacket = !!requestId;
  const isTurtle = !!turtleId;
  const canEdit = (isPacket || isTurtle) && !disabled;

  const handleRemove = async (filename: string) => {
    setRemoving(filename);
    try {
      if (requestId) {
        await removeReviewPacketAdditionalImage(requestId, filename);
      } else if (turtleId) {
        await deleteTurtleAdditionalImage(turtleId, filename, sheetName);
      } else {
        return;
      }
      await onRefresh();
      notifications.show({
        title: 'Removed',
        message: 'Image removed',
        color: 'green',
      });
    } catch (e) {
      notifications.show({
        title: 'Error',
        message: e instanceof Error ? e.message : 'Failed to remove image',
        color: 'red',
      });
    } finally {
      setRemoving(null);
    }
  };

  const handleAdd = async (type: 'microhabitat' | 'condition' | 'carapace' | 'plastron', files: FileList | null) => {
    if (!files?.length) return;
    const toAdd: Array<{ type: 'microhabitat' | 'condition' | 'carapace' | 'plastron'; file: File }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = validateFile(file);
      if (validation.isValid) toAdd.push({ type, file });
      else if (validation.error) {
        notifications.show({
          title: 'Invalid file',
          message: validation.error,
          color: 'red',
        });
      }
    }
    if (!toAdd.length) return;
    setAdding(true);
    try {
      if (requestId) {
        await uploadReviewPacketAdditionalImages(
          requestId,
          toAdd.map((x) => ({ type: x.type, file: x.file })),
        );
      } else if (turtleId) {
        await uploadTurtleAdditionalImages(turtleId, toAdd, sheetName);
      } else {
        return;
      }
      await onRefresh();
      notifications.show({
        title: 'Added',
        message: `${toAdd.length} image(s) added`,
        color: 'green',
      });
    } catch (e) {
      notifications.show({
        title: 'Error',
        message: e instanceof Error ? e.message : 'Failed to add images',
        color: 'red',
      });
    } finally {
      setAdding(false);
    }
  };

  const byType = (t: string) =>
    images.filter((img) => img.type === t);

  const content = (
    <>
    <Stack gap="xs">
      <Text fw={600} size="sm">
        {title}
      </Text>
        {!embedded && (
        <Text size="xs" c="dimmed">
          View, add or remove microhabitat and condition photos. Click to view full size.
        </Text>
      )}

        {canEdit && !hideAddButtons && (
          <Group gap="xs">
            <Button
              size="sm"
              variant="light"
              leftSection={<IconPhotoPlus size={14} />}
              component="label"
              loading={adding}
              disabled={disabled}
            >
              Microhabitat
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  handleAdd('microhabitat', e.target.files);
                  e.target.value = '';
                }}
              />
            </Button>
            <Button
              size="sm"
              variant="light"
              leftSection={<IconPhotoPlus size={14} />}
              component="label"
              loading={adding}
              disabled={disabled}
            >
              Condition
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  handleAdd('condition', e.target.files);
                  e.target.value = '';
                }}
              />
            </Button>
            <Button
              size="sm"
              variant="light"
              color="teal"
              leftSection={<IconPhotoPlus size={14} />}
              component="label"
              loading={adding}
              disabled={disabled}
            >
              Carapace
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  handleAdd('carapace', e.target.files);
                  e.target.value = '';
                }}
              />
            </Button>
            <Button
              size="sm"
              variant="light"
              color="grape"
              leftSection={<IconPhotoPlus size={14} />}
              component="label"
              loading={adding}
              disabled={disabled}
            >
              Plastron
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  handleAdd('plastron', e.target.files);
                  e.target.value = '';
                }}
              />
            </Button>
          </Group>
        )}

        {(images.length > 0 || canEdit) && (
          <Stack gap="sm">
            {(['microhabitat', 'condition', 'carapace', 'plastron'] as const).map((t) => {
              const list = byType(t);
              if (list.length === 0) return null;
              return (
                <Stack key={t} gap={4}>
                  <Text size="xs" fw={500} c="dimmed" tt="capitalize">
                    {t}
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    {list.map((img) => (
                      <Box key={img.filename} pos="relative">
                        <Box
                          style={{
                            width: 80,
                            height: 80,
                            borderRadius: 8,
                            overflow: 'hidden',
                            border: '1px solid var(--mantine-color-default-border)',
                            cursor: 'pointer',
                          }}
                          onClick={() => setLightboxPath(img.imagePath)}
                        >
                          <Image
                            src={getImageUrl(img.imagePath)}
                            alt={img.filename}
                            w={80}
                            h={80}
                            fit="cover"
                          />
                        </Box>
                        <Group
                          gap={4}
                          align="center"
                          justify="space-between"
                          wrap="nowrap"
                          mt={4}
                        >
                          <Button
                            size="xs"
                            variant="subtle"
                            color="gray"
                            title="View full size"
                            p={4}
                            onClick={() => setLightboxPath(img.imagePath)}
                          >
                            <IconZoomIn size={14} />
                          </Button>
                          {canEdit && (
                            <Button
                              size="xs"
                              variant="subtle"
                              color="red"
                              title="Remove"
                              p={4}
                              loading={removing === img.filename}
                              onClick={() => handleRemove(img.filename)}
                            >
                              <IconTrash size={14} />
                            </Button>
                          )}
                        </Group>
                      </Box>
                    ))}
                  </Group>
                </Stack>
              );
            })}
            {images.length === 0 && canEdit && !adding && (
              <Text size="xs" c="dimmed">
                No additional photos yet. Use the buttons above to add microhabitat or condition images.
              </Text>
            )}
          </Stack>
        )}

        {images.length === 0 && !canEdit && (
          <Text size="xs" c="dimmed">
            No additional photos.
          </Text>
        )}
      </Stack>

      <Modal
        opened={!!lightboxPath}
        onClose={() => setLightboxPath(null)}
        size="lg"
        title="Image"
        centered
      >
        {lightboxPath && (
          <Image
            src={getImageUrl(lightboxPath)}
            alt="Full size"
            fit="contain"
            style={{ maxHeight: '80vh' }}
          />
        )}
      </Modal>
    </>
  );

  const wrapped = embedded ? <>{content}</> : <Paper p="sm" withBorder radius="md">{content}</Paper>;
  return wrapped;
}
