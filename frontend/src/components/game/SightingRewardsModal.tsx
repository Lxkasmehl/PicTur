import { Modal, Stack, Text, Title, Group, ThemeIcon, Badge, Button } from '@mantine/core';
import { IconTrophy, IconSparkles } from '@tabler/icons-react';
import { BADGE_BY_ID } from '../../gamification/definitions';
import { BadgeIcon } from './BadgeIcon';
import type { PendingRewards } from '../../store/slices/communityGameSlice';

interface SightingRewardsModalProps {
  opened: boolean;
  rewards: PendingRewards | null;
  onClose: () => void;
}

export function SightingRewardsModal({
  opened,
  rewards,
  onClose,
}: SightingRewardsModalProps) {
  const show = opened && !!rewards;
  const r = rewards;

  return (
    <Modal
      opened={show}
      onClose={onClose}
      title={
        <Group gap="sm">
          <ThemeIcon size={36} radius="md" variant="gradient" gradient={{ from: 'teal', to: 'cyan' }}>
            <IconTrophy size={20} />
          </ThemeIcon>
          <Text fw={700} size="lg">
            Sighting recorded
          </Text>
        </Group>
      }
      centered
      radius="md"
    >
      {r && (
        <Stack gap="lg">
          <Stack gap={4} align="center">
            <Title order={2} c="teal">
              +{r.xpGained} XP
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Every sighting helps the project. Keep the plastron photos sharp and add location hints when you
              can.
            </Text>
          </Stack>

          {r.questTitles && r.questTitles.length > 0 && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Weekly quest complete
              </Text>
              {r.questTitles.map((t) => (
                <Badge
                  key={t}
                  size="lg"
                  variant="light"
                  color="teal"
                  leftSection={<IconSparkles size={14} />}
                >
                  {t}
                </Badge>
              ))}
            </Stack>
          )}

          {r.newBadgeIds.length > 0 && (
            <Stack gap="sm">
              <Text size="sm" fw={600}>
                New badges
              </Text>
              <Group gap="sm">
                {r.newBadgeIds.map((id) => {
                  const def = BADGE_BY_ID[id];
                  if (!def) return null;
                  return (
                    <Stack key={id} gap={6} align="center" style={{ width: 100 }}>
                      <ThemeIcon size={52} radius="md" variant="light" color="teal">
                        <BadgeIcon name={def.icon} size={28} />
                      </ThemeIcon>
                      <Text size="xs" ta="center" fw={600}>
                        {def.title}
                      </Text>
                    </Stack>
                  );
                })}
              </Group>
            </Stack>
          )}

          <Button fullWidth onClick={onClose} size="md">
            Continue
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
