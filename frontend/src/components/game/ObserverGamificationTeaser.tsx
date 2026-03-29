import { Paper, Group, Text, Stack, Button, ThemeIcon, List, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconCompass, IconLock, IconChevronRight, IconTrophy, IconSparkles } from '@tabler/icons-react';

type Variant = 'home' | 'hub';

export function ObserverGamificationTeaser({ variant }: { variant: Variant }) {
  if (variant === 'home') {
    return (
      <Paper
        p="md"
        radius="md"
        withBorder
        style={{
          background: 'linear-gradient(120deg, var(--mantine-color-gray-0) 0%, var(--mantine-color-teal-0) 100%)',
        }}
      >
        <Group align="flex-start" wrap="nowrap" gap="md">
          <ThemeIcon size={48} radius="md" variant="light" color="gray">
            <IconLock size={26} />
          </ThemeIcon>
          <Stack gap="sm" style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs">
              <IconCompass size={18} color="var(--mantine-color-teal-7)" />
              <Text fw={700} size="sm">
                Observer HQ
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              Log in or create a free account to earn XP, unlock badges, and complete weekly quests—your progress
              is saved to your profile. You can still upload sightings without an account.
            </Text>
            <Group gap="xs" wrap="wrap">
              <Button component={Link} to="/login" size="xs" color="teal">
                Log in
              </Button>
              <Button component={Link} to="/register" size="xs" variant="light" color="teal">
                Create account
              </Button>
              <Button
                component={Link}
                to="/observer"
                size="xs"
                variant="subtle"
                rightSection={<IconChevronRight size={14} />}
              >
                Learn more
              </Button>
            </Group>
          </Stack>
        </Group>
      </Paper>
    );
  }

  return (
    <Stack gap="xl">
      <Paper
        p={{ base: 'md', sm: 'xl' }}
        radius="lg"
        withBorder
        style={{
          background: 'linear-gradient(135deg, var(--mantine-color-gray-7) 0%, var(--mantine-color-teal-8) 100%)',
          color: 'white',
        }}
      >
        <Stack gap="md">
          <Group gap="sm">
            <ThemeIcon size={44} radius="md" variant="white" color="teal">
              <IconLock size={22} />
            </ThemeIcon>
            <div>
              <Text size="sm" opacity={0.9} tt="uppercase" fw={700}>
                Observer HQ
              </Text>
              <Title order={2} c="white" mt={4}>
                Sign in to unlock the full program
              </Title>
            </div>
          </Group>
          <Text size="md" opacity={0.92}>
            XP, badges, and weekly quests are tied to your account so nothing gets lost when you switch devices or
            clear your browser. Anonymous uploads still help the project—they just don&apos;t count toward Observer
            progress.
          </Text>
          <Group gap="sm" wrap="wrap">
            <Button component={Link} to="/login" variant="white" color="dark">
              Log in
            </Button>
            <Button component={Link} to="/register" variant="outline" color="gray" style={{ borderColor: 'rgba(255,255,255,0.5)', color: 'white' }}>
              Create account
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Paper p="lg" radius="md" withBorder>
        <Text fw={600} mb="sm">
          What you get with an account
        </Text>
        <List
          spacing="sm"
          size="sm"
          icon={
            <ThemeIcon color="teal" size={24} radius="xl" variant="light">
              <IconSparkles size={14} />
            </ThemeIcon>
          }
        >
          <List.Item>Level and XP for every successful sighting upload</List.Item>
          <List.Item>Badges for milestones (GPS hints, training, verification, and more)</List.Item>
          <List.Item>Rotating weekly quests with bonus XP</List.Item>
          <List.Item>Progress stored securely on the server</List.Item>
        </List>
      </Paper>

      <Paper p="lg" radius="md" withBorder bg="var(--mantine-color-gray-0)">
        <Group gap="md" wrap="nowrap">
          <ThemeIcon size="lg" variant="light" color="teal">
            <IconTrophy size={22} />
          </ThemeIcon>
          <Text size="sm" c="dimmed">
            Already contributing without logging in? Thank you—when you&apos;re ready, create an account and keep
            building your observer profile from there.
          </Text>
        </Group>
      </Paper>
    </Stack>
  );
}
