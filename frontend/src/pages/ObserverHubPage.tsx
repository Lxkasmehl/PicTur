import { Link } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  Text,
  Stack,
  Group,
  SimpleGrid,
  ThemeIcon,
  Progress,
  Button,
  Badge,
  RingProgress,
  Divider,
  Alert,
  Loader,
} from '@mantine/core';
import {
  IconCamera,
  IconFlame,
  IconMapPin,
  IconTrophy,
  IconCheck,
  IconMailForward,
} from '@tabler/icons-react';
import { useAppSelector } from '../store/hooks';
import { useUser } from '../hooks/useUser';
import { isEmailVerified } from '../utils/emailVerified';
import {
  BADGE_DEFINITIONS,
  BADGE_BY_ID,
  levelFromTotalXp,
  xpToNextLevel,
  XP_LEVEL_THRESHOLDS,
  activeWeeklyQuestsForWeek,
} from '../gamification/definitions';
import { getISOWeekKey, consecutiveWeeksEndingAt } from '../gamification/isoWeek';
import { BadgeIcon } from '../components/game/BadgeIcon';
import { ObserverGamificationTeaser } from '../components/game/ObserverGamificationTeaser';

function questProgress(
  questId: string,
  game: {
    weeklySightings: number;
    weeklyGpsSightings: number;
    weeklyExtraSightings: number;
  },
  target: number,
): number {
  if (questId === 'weekly_three_sightings') return Math.min(game.weeklySightings, target);
  if (questId === 'weekly_two_gps') return Math.min(game.weeklyGpsSightings, target);
  if (questId === 'weekly_detail') return Math.min(game.weeklyExtraSightings, target);
  return 0;
}

export default function ObserverHubPage() {
  const { user, isLoggedIn, authChecked } = useUser();
  const game = useAppSelector((s) => s.communityGame);

  if (!authChecked) {
    return (
      <Container size="lg" py="xl">
        <Group justify="center">
          <Loader size="md" />
        </Group>
      </Container>
    );
  }

  if (!isLoggedIn) {
    return (
      <Container size="lg" py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
        <ObserverGamificationTeaser variant="hub" />
      </Container>
    );
  }

  const weekKey = getISOWeekKey();
  const weekAligned = game.questWeekKey === weekKey;
  const weeklyGame = {
    weeklySightings: weekAligned ? game.weeklySightings : 0,
    weeklyGpsSightings: weekAligned ? game.weeklyGpsSightings : 0,
    weeklyExtraSightings: weekAligned ? game.weeklyExtraSightings : 0,
  };
  const completedWeekly = weekAligned ? game.completedWeeklyQuestIds : [];

  const level = levelFromTotalXp(game.totalXp);
  const { needed, intoLevel, currentLevel } = xpToNextLevel(game.totalXp);
  const prevThreshold = XP_LEVEL_THRESHOLDS[currentLevel - 1] ?? 0;
  const nextThreshold = XP_LEVEL_THRESHOLDS[currentLevel] ?? game.totalXp;
  const span = Math.max(1, nextThreshold - prevThreshold);
  const pct = Math.min(100, ((game.totalXp - prevThreshold) / span) * 100);

  const streak = consecutiveWeeksEndingAt(weekKey, new Set(game.weeksWithUpload));
  const quests = activeWeeklyQuestsForWeek(weekKey);
  const completedSet = new Set(completedWeekly);

  const needsVerify = user && !isEmailVerified(user);

  return (
    <Container size="lg" py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap="xl">
        <Paper
          p={{ base: 'md', sm: 'xl' }}
          radius="lg"
          style={{
            background: 'linear-gradient(135deg, var(--mantine-color-teal-8) 0%, var(--mantine-color-cyan-7) 50%, var(--mantine-color-blue-7) 100%)',
            color: 'white',
          }}
        >
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={4} maw={600}>
                <Text size="sm" opacity={0.9} tt="uppercase" fw={700}>
                  Community field program
                </Text>
                <Title order={1} c="white">
                  Observer HQ
                </Title>
                <Text size="md" opacity={0.92}>
                  Log sightings, earn XP and badges, and complete weekly quests. The core workflow is still a
                  simple photo upload — this layer celebrates your contribution.
                </Text>
              </Stack>
              <Button
                component={Link}
                to="/"
                size="md"
                variant="white"
                color="dark"
                leftSection={<IconCamera size={18} />}
              >
                New sighting
              </Button>
            </Group>

            <Group gap="xl" align="center" wrap="wrap" mt="sm">
              <RingProgress
                size={100}
                thickness={10}
                roundCaps
                sections={[{ value: pct, color: 'white' }]}
                label={
                  <Text ta="center" fz="xs" fw={700} c="white">
                    Lv
                    <br />
                    {level}
                  </Text>
                }
              />
              <Stack gap={6} style={{ flex: 1, minWidth: 200 }}>
                <Group justify="space-between">
                  <Text fw={600} c="white">
                    Observer level {level}
                  </Text>
                  <Text size="sm" c="white" opacity={0.85}>
                    {game.totalXp} XP
                  </Text>
                </Group>
                <Progress value={pct} size="lg" radius="xl" color="white" />
                <Text size="xs" c="white" opacity={0.85}>
                  {needed > 0
                    ? `${intoLevel} XP into this level · ${needed} XP to level ${currentLevel + 1}`
                    : 'Max level bracket reached — you are carrying the team.'}
                </Text>
              </Stack>
            </Group>
          </Stack>
        </Paper>

        {needsVerify && (
          <Alert
            color="yellow"
            variant="light"
            title="Verify your email"
            icon={<IconMailForward size={18} />}
          >
            Confirm your email to unlock the full upload experience. You can still browse Observer HQ and
            review your progress here.
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Paper p="md" radius="md" withBorder>
            <Group gap="sm">
              <ThemeIcon variant="light" color="teal" size="lg" radius="md">
                <IconCamera size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Lifetime sightings
                </Text>
                <Text fz="xl" fw={800}>
                  {game.lifetimeSightings}
                </Text>
              </div>
            </Group>
          </Paper>
          <Paper p="md" radius="md" withBorder>
            <Group gap="sm">
              <ThemeIcon variant="light" color="orange" size="lg" radius="md">
                <IconFlame size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Week streak
                </Text>
                <Text fz="xl" fw={800}>
                  {streak} week{streak === 1 ? '' : 's'}
                </Text>
              </div>
            </Group>
          </Paper>
          <Paper p="md" radius="md" withBorder>
            <Group gap="sm">
              <ThemeIcon variant="light" color="blue" size="lg" radius="md">
                <IconMapPin size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  GPS hints (all time)
                </Text>
                <Text fz="xl" fw={800}>
                  {game.gpsHintTotal}
                </Text>
              </div>
            </Group>
          </Paper>
        </SimpleGrid>

        <Paper p={{ base: 'md', sm: 'lg' }} radius="md" withBorder shadow="xs">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Title order={3}>This week&apos;s quests</Title>
              <Badge variant="light" color="gray">
                Week {weekKey}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              Two quests rotate each calendar week. Bonus XP is applied automatically when you complete them
              through normal uploads.
            </Text>
            <Stack gap="md">
              {quests.map((q) => {
                const prog = questProgress(q.id, weeklyGame, q.target);
                const done = completedSet.has(q.id);
                const p = Math.min(100, (prog / q.target) * 100);
                return (
                  <Paper key={q.id} p="md" radius="md" withBorder bg="var(--mantine-color-body)">
                    <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs">
                      <Stack gap={4}>
                        <Group gap="xs">
                          <ThemeIcon size="sm" variant="light" color={done ? 'teal' : 'gray'}>
                            {done ? <IconCheck size={14} /> : <IconTrophy size={14} />}
                          </ThemeIcon>
                          <Text fw={600}>{q.title}</Text>
                        </Group>
                        <Text size="sm" c="dimmed">
                          {q.description}
                        </Text>
                      </Stack>
                      <Badge color={done ? 'teal' : 'gray'} variant={done ? 'filled' : 'light'}>
                        +{q.bonusXp} XP
                      </Badge>
                    </Group>
                    <Progress value={done ? 100 : p} size="sm" radius="xl" color="teal" />
                    <Text size="xs" c="dimmed" mt={6}>
                      {done ? 'Completed — nice work!' : `${prog} / ${q.target}`}
                    </Text>
                  </Paper>
                );
              })}
            </Stack>
          </Stack>
        </Paper>

        <Paper p={{ base: 'md', sm: 'lg' }} radius="md" withBorder shadow="xs">
          <Stack gap="md">
            <Title order={3}>Badges</Title>
            <Text size="sm" c="dimmed">
              {game.badges.length} / {BADGE_DEFINITIONS.length} unlocked
            </Text>
            <Divider />
            <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing="md">
              {BADGE_DEFINITIONS.map((b) => {
                const unlocked = game.badges.includes(b.id);
                return (
                  <Paper
                    key={b.id}
                    p="sm"
                    radius="md"
                    withBorder
                    style={{
                      opacity: unlocked ? 1 : 0.45,
                      filter: unlocked ? undefined : 'grayscale(1)',
                    }}
                  >
                    <Stack gap="xs" align="center">
                      <ThemeIcon
                        size={48}
                        radius="md"
                        variant={unlocked ? 'gradient' : 'light'}
                        gradient={unlocked ? { from: 'teal', to: 'cyan' } : undefined}
                        color={unlocked ? undefined : 'gray'}
                      >
                        <BadgeIcon name={b.icon} size={26} />
                      </ThemeIcon>
                      <Text size="xs" fw={700} ta="center">
                        {b.title}
                      </Text>
                      <Text size="xs" c="dimmed" ta="center" lineClamp={3}>
                        {BADGE_BY_ID[b.id]?.description}
                      </Text>
                    </Stack>
                  </Paper>
                );
              })}
            </SimpleGrid>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
