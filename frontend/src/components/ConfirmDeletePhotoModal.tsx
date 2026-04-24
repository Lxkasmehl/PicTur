import { Modal, Stack, Group, Button, Text, Image, Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { getImageUrl } from '../services/api';

export type DeleteModalContext =
  | { kind: 'active_ref_with_revert'; photoType: 'plastron' | 'carapace'; revertHint?: string }
  | { kind: 'active_ref_no_revert'; photoType: 'plastron' | 'carapace' }
  | { kind: 'non_ref' };

interface ConfirmDeletePhotoModalProps {
  opened: boolean;
  /** Optional preview image path (served via getImageUrl). */
  previewPath?: string | null;
  /** Short label shown with the preview, e.g. 'Microhabitat' or 'Old Plastron Ref'. */
  previewLabel?: string;
  /** Context drives the body text + warning level. */
  context: DeleteModalContext;
  /** Called when the user confirms. Keep quick; parent handles the actual delete. */
  onConfirm: () => void;
  onCancel: () => void;
  /** Disable the primary button while the parent processes the delete. */
  busy?: boolean;
}

export function ConfirmDeletePhotoModal({
  opened,
  previewPath,
  previewLabel,
  context,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDeletePhotoModalProps) {
  const title = 'Are you absolutely sure?';

  const renderBody = () => {
    if (context.kind === 'active_ref_with_revert') {
      return (
        <Stack gap='xs'>
          <Text size='sm'>
            You are about to delete the active {context.photoType} reference. The image
            will be moved to the Deleted folder and can be restored later.
          </Text>
          <Text size='sm'>
            The previous {context.photoType} reference
            {context.revertHint ? ` (${context.revertHint})` : ''} will be promoted
            back to active automatically. Its feature tensor will regenerate and the
            VRAM cache will update.
          </Text>
        </Stack>
      );
    }
    if (context.kind === 'active_ref_no_revert') {
      return (
        <Stack gap='xs'>
          <Text size='sm'>
            You are about to delete the active {context.photoType} reference. The image
            will be moved to the Deleted folder and can be restored later.
          </Text>
          <Alert color='orange' icon={<IconAlertTriangle size={16} />} p='xs'>
            <Text size='xs'>
              There is no previous {context.photoType} reference to promote. The
              turtle will have no active {context.photoType} reference after this
              and new matches for that photo type will not work until a replacement
              is uploaded.
            </Text>
          </Alert>
        </Stack>
      );
    }
    return (
      <Text size='sm'>
        This photo will be moved to the Deleted folder and can be restored later.
      </Text>
    );
  };

  return (
    <Modal opened={opened} onClose={onCancel} title={title} centered size='md'>
      <Stack gap='md'>
        {previewPath && (
          <Group gap='sm' align='flex-start'>
            <Image
              src={getImageUrl(previewPath)}
              alt={previewLabel || 'Preview'}
              w={120}
              h={120}
              fit='cover'
              radius='sm'
              style={{ border: '1px solid var(--mantine-color-default-border)' }}
            />
            {previewLabel && (
              <Text size='xs' c='dimmed' mt={4}>
                {previewLabel}
              </Text>
            )}
          </Group>
        )}
        {renderBody()}
        <Group justify='flex-end' gap='xs'>
          <Button variant='default' onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button color='red' onClick={onConfirm} loading={busy}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
