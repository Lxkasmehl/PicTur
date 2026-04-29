import {
  Container,
  Paper,
  Title,
  Text,
  Stack,
  Group,
  SimpleGrid,
  ThemeIcon,
  Anchor,
  Divider,
  List,
} from '@mantine/core';
import {
  IconRoute,
  IconTemperature,
  IconBrain,
  IconSchool,
  IconExternalLink,
} from '@tabler/icons-react';
import { WASHBURN_TURTLE_LAB_URL } from '../config/contact';

export default function AboutPage() {
  return (
    <Container size='md' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Stack gap='md'>
            <Title order={1}>{'PicTur & the Washburn turtle team'}</Title>
            <Text c='dimmed' size='sm'>
              PicTur is the community photo platform for turtle identification and monitoring. It
              supports field research led at Washburn University on imperiled turtles in Kansas and
              beyond.
            </Text>
            <Text size='sm'>
              The Washburn group studies ecology and behavior of turtles, with a strong focus on
              undergraduate research that informs conservation and habitat management. Work includes{' '}
              <Text span fw={600}>
                box turtles
              </Text>{' '}
              (<em>Terrapene ornata</em> and <em>Terrapene triunguis</em>) in northeastern Kansas, plus
              demographic studies of aquatic turtles.
            </Text>
            <Anchor
              href={WASHBURN_TURTLE_LAB_URL}
              target='_blank'
              rel='noopener noreferrer'
              size='sm'
              fw={500}
              display='inline-flex'
              style={{ alignItems: 'center', gap: 6, width: 'fit-content' }}
            >
              <span>Washburn turtle research site</span>
              <IconExternalLink size={14} stroke={1.5} style={{ flexShrink: 0 }} aria-hidden />
            </Anchor>
          </Stack>
        </Paper>

        <Title order={2} size='h3' ta={{ base: 'left', sm: 'center' }}>
          Research themes
        </Title>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='md'>
          <Paper p='md' radius='md' withBorder shadow='xs'>
            <Stack gap='sm' align='flex-start'>
              <ThemeIcon size='lg' radius='md' variant='light' color='teal'>
                <IconRoute size={22} />
              </ThemeIcon>
              <Title order={3} size='h4'>
                Movement ecology
              </Title>
              <Text size='sm' c='dimmed'>
                Radio telemetry tracks daily and seasonal movement. Home-range models help estimate
                habitat needs and how individuals use the landscape.
              </Text>
            </Stack>
          </Paper>

          <Paper p='md' radius='md' withBorder shadow='xs'>
            <Stack gap='sm' align='flex-start'>
              <ThemeIcon size='lg' radius='md' variant='light' color='cyan'>
                <IconTemperature size={22} />
              </ThemeIcon>
              <Title order={3} size='h4'>
                Temperature &amp; behavior
              </Title>
              <Text size='sm' c='dimmed'>
                As ectotherms, turtles rely heavily on behavior to regulate body temperature. The lab
                studies how climate and weather relate to activity and habitat use.
              </Text>
            </Stack>
          </Paper>

          <Paper p='md' radius='md' withBorder shadow='xs'>
            <Stack gap='sm' align='flex-start'>
              <ThemeIcon size='lg' radius='md' variant='light' color='grape'>
                <IconBrain size={22} />
              </ThemeIcon>
              <Title order={3} size='h4'>
                Personality &amp; cognition
              </Title>
              <Text size='sm' c='dimmed'>
                Individual differences in personality and spatial cognition may affect fitness. The
                team explores how that variation scales to population persistence.
              </Text>
            </Stack>
          </Paper>
        </SimpleGrid>

        <Paper shadow='sm' p={{ base: 'md', sm: 'lg' }} radius='md' withBorder>
          <Stack gap='sm'>
            <GroupHeader />
            <Text size='sm'>
              Students gain hands-on experience in field methods, data analysis, and science
              communication—skills that transfer to conservation careers and informed citizenship.
            </Text>
            <Divider label='PicTur platform' labelPosition='center' />
            <List size='sm' spacing='xs' c='dimmed'>
              <List.Item>Community plastron photo upload and matching workflows</List.Item>
              <List.Item>Observer tools for sightings, quests, and engagement</List.Item>
              <List.Item>Staff review, turtle records, and release tracking</List.Item>
            </List>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}

function GroupHeader() {
  return (
    <Group gap='sm' wrap='nowrap' align='flex-start'>
      <ThemeIcon size='lg' radius='md' variant='light' color='green'>
        <IconSchool size={22} />
      </ThemeIcon>
      <Title order={3} size='h4'>
        Education through research
      </Title>
    </Group>
  );
}
