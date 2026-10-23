import {
  ActionIcon,
  Button,
  CopyButton,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconCheck, IconConfetti, IconCopy } from '@tabler/icons-react';

/** What the admin needs to find the freshly created turtle again. */
export interface CreatedTurtleInfo {
  /** Biology ID from the form (e.g. F900); may be empty when the sheet has no ID column. */
  id?: string;
  primaryId?: string;
  name?: string;
  sheetName?: string;
}

interface TurtleCreatedModalProps {
  /** Turtle that was just created; the modal is open while this is set. */
  turtle: CreatedTurtleInfo | null;
  onClose: () => void;
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Group justify='space-between' gap='xs' wrap='nowrap'>
      <Text size='sm' c='dimmed'>
        {label}
      </Text>
      <Group gap={4} wrap='nowrap'>
        <Text size='sm' fw={500} data-testid={`turtle-created-${label.toLowerCase().replace(/\s+/g, '-')}`}>
          {value}
        </Text>
        <CopyButton value={value} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copied' : `Copy ${label}`} withArrow>
              <ActionIcon
                variant='subtle'
                color={copied ? 'teal' : 'gray'}
                size='sm'
                onClick={copy}
                aria-label={`Copy ${label}`}
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
    </Group>
  );
}

/**
 * Confirmation shown after a new turtle is created, so the admin sees (and can copy) the new ID
 * instead of having to look it up in Turtle Records afterwards.
 */
export function TurtleCreatedModal({ turtle, onClose }: TurtleCreatedModalProps) {
  const displayId = turtle?.id?.trim() || turtle?.primaryId?.trim() || '';

  return (
    <Modal
      opened={turtle !== null}
      onClose={onClose}
      title='Turtle created'
      centered
      data-testid='turtle-created-modal'
    >
      <Stack gap='md' align='stretch'>
        <Stack gap='xs' align='center'>
          <ThemeIcon size={56} radius='xl' color='green' variant='light'>
            <IconConfetti size={32} />
          </ThemeIcon>
          <Title order={3} ta='center'>
            Congratulations!
          </Title>
          <Text ta='center'>
            You created{' '}
            {displayId ? (
              <Text span fw={700}>
                {displayId}
              </Text>
            ) : (
              'a new turtle'
            )}
            {turtle?.name ? ` (${turtle.name})` : ''}.
          </Text>
        </Stack>

        <Paper p='sm' withBorder radius='md'>
          <Stack gap={6}>
            <DetailRow label='ID' value={turtle?.id?.trim()} />
            <DetailRow label='Primary ID' value={turtle?.primaryId?.trim()} />
            <DetailRow label='Name' value={turtle?.name?.trim()} />
            <DetailRow label='Sheet' value={turtle?.sheetName?.trim()} />
          </Stack>
        </Paper>

        <Group justify='flex-end'>
          <Button onClick={onClose} data-autofocus>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
