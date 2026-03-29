import { Paper, Group, Text, RingProgress, Stack, Button, Badge } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link } from 'react-router-dom';
import { IconCompass, IconChevronRight } from '@tabler/icons-react';
import { useAppSelector } from '../../store/hooks';
import { levelFromTotalXp, xpToNextLevel, XP_LEVEL_THRESHOLDS } from '../../gamification/definitions';

export function ObserverHomeSummary() {
  const game = useAppSelector((s) => s.communityGame);
  const isNarrow = useMediaQuery('(max-width: 575px)');
  if (!game.hydrated) return null;

  const level = levelFromTotalXp(game.totalXp);
  const { needed, currentLevel } = xpToNextLevel(game.totalXp);
  const prevThreshold = XP_LEVEL_THRESHOLDS[currentLevel - 1] ?? 0;
  const nextThreshold = XP_LEVEL_THRESHOLDS[currentLevel] ?? game.totalXp;
  const span = Math.max(1, nextThreshold - prevThreshold);
  const pct = Math.min(100, ((game.totalXp - prevThreshold) / span) * 100);

  return (
    <Paper
      p="md"
      radius="md"
      withBorder
      style={{
        background: 'linear-gradient(120deg, var(--mantine-color-teal-0) 0%, var(--mantine-color-cyan-0) 100%)',
      }}
    >
      <Group justify="space-between" align="center" wrap="nowrap" gap="md">
        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          <RingProgress
            size={72}
            thickness={8}
            sections={[{ value: pct, color: 'teal' }]}
            label={
              <Text size="xs" fw={800} ta="center">
                {level}
              </Text>
            }
          />
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap="xs">
              <IconCompass size={18} color="var(--mantine-color-teal-7)" />
              <Text fw={700} size="sm">
                Observer HQ
              </Text>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={2}>
              Level {level} · {game.totalXp} XP
              {needed > 0 ? ` · ${needed} XP to next level` : ''} · {game.badges.length} badges
            </Text>
            <Group gap="xs" mt={4}>
              <Badge size="xs" variant="light" color="teal">
                {game.lifetimeSightings} sightings
              </Badge>
            </Group>
          </Stack>
        </Group>
        {!isNarrow && (
          <Button
            component={Link}
            to="/observer"
            size="xs"
            variant="filled"
            color="teal"
            rightSection={<IconChevronRight size={14} />}
          >
            Open
          </Button>
        )}
      </Group>
      {isNarrow && (
        <Button
          component={Link}
          to="/observer"
          fullWidth
          mt="sm"
          size="xs"
          variant="light"
          color="teal"
          rightSection={<IconChevronRight size={14} />}
        >
          Open Observer HQ
        </Button>
      )}
    </Paper>
  );
}
