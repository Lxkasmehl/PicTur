import {
  Modal,
  Stack,
  Text,
  Button,
  Group,
  Divider,
  Paper,
  ThemeIcon,
  Image,
  Checkbox,
  ScrollArea,
  Box,
  List,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCamera, IconCheck, IconPhoto } from '@tabler/icons-react';
import { useState, useRef } from 'react';
import step1Image from '../assets/step1.jpg';
import step2Image from '../assets/step2.jpg';
import finalResultImage from '../assets/finalresult.jpg';

interface InstructionsModalProps {
  opened: boolean;
  onClose: () => void;
  /** Fired when the user completes the full checklist (not reminder-only close). */
  onTrainingCompleted?: () => void;
}

const SECTION_GAP = 'xl';
const CARD_PX = 'xl';
const CARD_PY = 'lg';
const CARD_GAP = 'md';

export function InstructionsModal({ opened, onClose, onTrainingCompleted }: InstructionsModalProps) {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)', undefined, { getInitialValueInEffect: false });

  // If user already saw instructions before (e.g. reopening as reminder), allow closing freely
  const isReminderMode =
    typeof window !== 'undefined' && localStorage.getItem('hasSeenInstructions') === 'true';
  const canCloseFreely = isReminderMode || (acknowledged && hasScrolledToBottom);

  const handleScroll = () => {
    if (viewportRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      if (scrollHeight - scrollTop - clientHeight < 10) {
        setHasScrolledToBottom(true);
      }
    }
  };

  const handleClose = () => {
    if (acknowledged && hasScrolledToBottom) {
      localStorage.setItem('hasSeenInstructions', 'true');
      onTrainingCompleted?.();
    }
    onClose();
  };

  const handleModalClose = () => {
    if (canCloseFreely) {
      if (!isReminderMode && acknowledged && hasScrolledToBottom) {
        localStorage.setItem('hasSeenInstructions', 'true');
        onTrainingCompleted?.();
      }
      onClose();
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleModalClose}
      title="Photo submission instructions"
      size={isMobile ? '100%' : 720}
      fullScreen={isMobile}
      centered={!isMobile}
      closeOnClickOutside={canCloseFreely}
      closeOnEscape={canCloseFreely}
      withCloseButton={canCloseFreely}
      styles={{
        title: {
          fontSize: isMobile ? '1.25rem' : '1.5rem',
          fontWeight: 700,
        },
        body: {
          padding: 0,
          overflow: 'hidden',
        },
      }}
    >
      <ScrollArea
        h={isMobile ? 'calc(100dvh - 9rem)' : 560}
        onScrollPositionChange={handleScroll}
        viewportRef={viewportRef}
        type="scroll"
        scrollbarSize="sm"
        styles={{
          root: { flex: 1 },
          viewport: {
            paddingLeft: 'var(--mantine-spacing-md)',
            paddingRight: 'var(--mantine-spacing-md)',
            paddingBottom: 'var(--mantine-spacing-md)',
          },
        }}
      >
        <Stack gap={SECTION_GAP} py="md" pb="xl">
          {/* Intro + What we need (plastron requirements) */}
          <Stack gap={CARD_GAP}>
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size={36} radius="md" variant="light" color="teal">
                <IconCamera size={20} />
              </ThemeIcon>
              <Text size="lg" fw={600} style={{ lineHeight: 1.4 }}>
                How to photograph a turtle&apos;s plastron
              </Text>
            </Group>
            <Text size="md" c="dimmed" style={{ lineHeight: 1.6 }}>
              The plastron is the bottom shell. We need one main photo per turtle that
              shows the full pattern clearly so we can identify the animal.
            </Text>

            <Paper
              withBorder
              p={CARD_PY}
              px={CARD_PX}
              radius="md"
              bg="var(--mantine-color-teal-0)"
              style={{
                borderLeft: '4px solid var(--mantine-color-teal-6)',
              }}
            >
              <Text size="sm" fw={700} mb="xs" style={{ letterSpacing: '0.02em' }}>
                Your plastron photo must have:
              </Text>
              <List
                size="sm"
                spacing="xs"
                icon={<IconCheck size={14} color="var(--mantine-color-teal-6)" />}
                styles={{ item: { lineHeight: 1.5 } }}
              >
                <List.Item>
                  <strong>Full plastron in frame</strong> — nothing cut off at the edges
                </List.Item>
                <List.Item>
                  <strong>No light reflections</strong> — avoid flash and harsh light on the shell
                </List.Item>
                <List.Item>
                  <strong>Centered and sharp</strong> — camera straight above, high resolution, in focus
                </List.Item>
                <List.Item>
                  <strong>Clear pattern</strong> — scutes and markings clearly visible for ID
                </List.Item>
              </List>
            </Paper>
          </Stack>

          <Divider />

          {/* Step 1 */}
          <Paper
            withBorder
            p={CARD_PY}
            px={CARD_PX}
            radius="md"
            style={{ borderLeft: '4px solid var(--mantine-color-teal-6)' }}
          >
            <Stack gap={CARD_GAP}>
              <Group align="flex-start" gap="md" wrap="nowrap">
                <ThemeIcon size={40} radius="md" variant="filled" color="teal">
                  <Text size="lg" fw={700}>1</Text>
                </ThemeIcon>
                <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                  <Text size="md" fw={600}>Positioning</Text>
                  <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                    Gently turn the turtle over or hold it so the plastron is fully visible. Keep the animal safe and supported.
                  </Text>
                </Stack>
              </Group>
              <Box mx={0}>
                <Image
                  src={step1Image}
                  alt="Step 1: Position the turtle"
                  radius="md"
                  maw={280}
                  fit="contain"
                />
              </Box>
            </Stack>
          </Paper>

          {/* Step 2 */}
          <Paper
            withBorder
            p={CARD_PY}
            px={CARD_PX}
            radius="md"
            style={{ borderLeft: '4px solid var(--mantine-color-cyan-6)' }}
          >
            <Stack gap={CARD_GAP}>
              <Group align="flex-start" gap="md" wrap="nowrap">
                <ThemeIcon size={40} radius="md" variant="filled" color="cyan">
                  <Text size="lg" fw={700}>2</Text>
                </ThemeIcon>
                <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                  <Text size="md" fw={600}>Lighting</Text>
                  <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                    Use natural or even light. Avoid reflections and strong shadows so the pattern is clearly visible.
                  </Text>
                </Stack>
              </Group>
              <Box mx={0}>
                <Image
                  src={step2Image}
                  alt="Step 2: Proper lighting"
                  radius="md"
                  maw={280}
                  fit="contain"
                />
              </Box>
            </Stack>
          </Paper>

          {/* Step 3 */}
          <Paper
            withBorder
            p={CARD_PY}
            px={CARD_PX}
            radius="md"
            style={{ borderLeft: '4px solid var(--mantine-color-teal-6)' }}
          >
            <Group align="flex-start" gap="md" wrap="nowrap">
              <ThemeIcon size={40} radius="md" variant="filled" color="teal">
                <Text size="lg" fw={700}>3</Text>
              </ThemeIcon>
              <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                <Text size="md" fw={600}>Camera angle</Text>
                <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                  Hold the camera directly above and parallel to the plastron. Keep the entire shell in frame with minimal distortion.
                </Text>
              </Stack>
            </Group>
          </Paper>

          {/* Step 4 */}
          <Paper
            withBorder
            p={CARD_PY}
            px={CARD_PX}
            radius="md"
            style={{ borderLeft: '4px solid var(--mantine-color-cyan-6)' }}
          >
            <Group align="flex-start" gap="md" wrap="nowrap">
              <ThemeIcon size={40} radius="md" variant="filled" color="cyan">
                <Text size="lg" fw={700}>4</Text>
              </ThemeIcon>
              <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                <Text size="md" fw={600}>Focus & clarity</Text>
                <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                  Make sure the photo is sharp. Scutes and any unique markings must be clear for identification.
                </Text>
              </Stack>
            </Group>
          </Paper>

          {/* Step 5 – Final result */}
          <Paper
            withBorder
            p={CARD_PY}
            px={CARD_PX}
            radius="md"
            style={{ borderLeft: '4px solid var(--mantine-color-teal-6)' }}
          >
            <Stack gap={CARD_GAP}>
              <Group align="flex-start" gap="md" wrap="nowrap">
                <ThemeIcon size={40} radius="md" variant="filled" color="teal">
                  <Text size="lg" fw={700}>5</Text>
                </ThemeIcon>
                <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                  <Text size="md" fw={600}>Background & result</Text>
                  <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                    Use a plain, contrasting background so the shell stands out. Example of a good plastron photo:
                  </Text>
                </Stack>
              </Group>
              <Box mx={0}>
                <Image
                  src={finalResultImage}
                  alt="Example: clear plastron photo"
                  radius="md"
                  maw={280}
                  fit="contain"
                />
                <Text size="xs" c="dimmed" mt="xs" style={{ lineHeight: 1.5 }}>
                  This is an ideal lab example with perfect lighting and background. Your field photo doesn&apos;t need to look this perfect—just ensure the full plastron is visible, sharp, and without reflections.
                </Text>
              </Box>
            </Stack>
          </Paper>

          {/* Optional: Microhabitat & Condition */}
          <Stack gap="xs">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size={32} radius="md" variant="light" color="gray">
                <IconPhoto size={18} />
              </ThemeIcon>
              <Text size="md" fw={600}>Optional: extra photos</Text>
            </Group>
            <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
              You can add <strong>microhabitat</strong> photos (where the turtle was found) and <strong>condition</strong> photos (e.g. shell condition, injuries). These are optional and can be added after selecting your main plastron image.
            </Text>
          </Stack>

          {/* Best practices – compact */}
          <Stack gap="xs">
            <Text size="md" fw={600}>Best practices</Text>
            <Stack gap="xs">
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                • Gently clean the plastron if dirty so the pattern is visible.
              </Text>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                • Take several shots; pick the sharpest one with the full shell in frame.
              </Text>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                • Include a scale (e.g. ruler) if possible.
              </Text>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                • Handle turtles with care and return them safely to their habitat.
              </Text>
            </Stack>
          </Stack>

          {/* Acknowledgment */}
          <Paper
            withBorder
            p={CARD_PY}
            px={CARD_PX}
            radius="md"
            style={{
              borderLeft: `4px solid ${hasScrolledToBottom ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-gray-4)'}`,
            }}
          >
            <Stack gap="sm">
              <Checkbox
                size="md"
                label={
                  <Text size="sm" fw={500} style={{ lineHeight: 1.5 }}>
                    I have read and understand the photo guidelines
                  </Text>
                }
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.currentTarget.checked)}
                disabled={!hasScrolledToBottom}
              />
              {!hasScrolledToBottom && (
                <Text size="xs" c="dimmed">
                  Please scroll to the bottom to continue
                </Text>
              )}
            </Stack>
          </Paper>
        </Stack>
      </ScrollArea>

      <Box
        p="md"
        style={{
          borderTop: '1px solid var(--mantine-color-default-border)',
          backgroundColor: 'var(--mantine-color-body)',
        }}
      >
        <Group justify="flex-end">
          {isReminderMode ? (
            <Button size="md" variant="default" onClick={() => onClose()}>
              Close
            </Button>
          ) : (
            <Button
              size="md"
              onClick={handleClose}
              disabled={!acknowledged || !hasScrolledToBottom}
              leftSection={<IconCheck size={18} />}
            >
              Got it — let&apos;s upload
            </Button>
          )}
        </Group>
      </Box>
    </Modal>
  );
}
