import type { ReactNode } from 'react';
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
  Anchor,
  Divider,
  List,
} from '@mantine/core';
import {
  IconCamera,
  IconSearch,
  IconNotebook,
  IconRoute,
  IconTemperature,
  IconBrain,
  IconSchool,
  IconExternalLink,
  IconUsersGroup,
  IconHeartHandshake,
} from '@tabler/icons-react';
import { WASHBURN_TURTLE_LAB_URL } from '../config/contact';

export default function AboutPage() {
  return (
    <Container size='md' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        {/* What PicTur is */}
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Stack gap='md'>
            <Title order={1}>About PicTur</Title>
            <Text size='sm'>
              PicTur identifies individual turtles from photos. The shell pattern of a turtle is as unique as
              a fingerprint: take a picture, and PicTur checks it against the turtles a research group already
              knows — is this a turtle they have seen before, or a new one? If it is known, everything recorded
              about it so far is right there.
            </Text>
            <Text size='sm'>
              Research groups use PicTur to keep their turtle records, photos and field data in one place.
              Each group works on its own: its turtles, members and records are separate from every other
              group, wherever in the world it studies turtles. Anyone can help by sending in a photo of a
              turtle they came across.
            </Text>
          </Stack>
        </Paper>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='md'>
          <FeatureCard
            icon={<IconCamera size={22} />}
            color='blue'
            title='Photograph'
            text='Researchers and community members upload a photo of the shell — in the field, straight from the phone.'
          />
          <FeatureCard
            icon={<IconSearch size={22} />}
            color='teal'
            title='Match'
            text='Image matching compares the photo with the turtles the group already knows and suggests the closest candidates.'
          />
          <FeatureCard
            icon={<IconNotebook size={22} />}
            color='grape'
            title='Record'
            text='The research team confirms the match and keeps the turtle’s history: sightings, measurements, photos and releases.'
          />
        </SimpleGrid>

        {/* Where PicTur comes from */}
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Stack gap='md'>
            <Group gap='sm' wrap='nowrap' align='flex-start'>
              <ThemeIcon size='lg' radius='md' variant='light' color='green'>
                <IconUsersGroup size={22} />
              </ThemeIcon>
              <Title order={2} size='h3'>
                Where PicTur comes from
              </Title>
            </Group>
            <Text size='sm'>
              PicTur started at{' '}
              <Text span fw={600}>
                Washburn University
              </Text>{' '}
              in Topeka, Kansas.{' '}
              <Text span fw={600}>
                Dr. Benjamin Reed
              </Text>
              , professor of biology, studies turtles with his students — finding them in the field, examining
              them outdoors and in the lab, and following individuals over the years. His idea: take a photo
              of a turtle and immediately know whether the team has met it before and what they already know
              about it.
            </Text>
            <Text size='sm'>
              Two Washburn computer science students,{' '}
              <Text span fw={600}>
                Garrett King-Cody
              </Text>{' '}
              and{' '}
              <Text span fw={600}>
                Lukas Mehl
              </Text>
              , took that idea on as research assistants and built PicTur in close collaboration with the
              turtle research team: features came straight from what the researchers needed in the field and
              in the lab.
            </Text>
            <Text size='sm'>
              What began as a tool for one research group is now open to independent research groups
              anywhere, each with its own turtles and members.
            </Text>
          </Stack>
        </Paper>

        {/* Who is behind it */}
        <Paper shadow='sm' p={{ base: 'md', sm: 'lg' }} radius='md' withBorder>
          <Stack gap='sm'>
            <Group gap='sm' wrap='nowrap' align='flex-start'>
              <ThemeIcon size='lg' radius='md' variant='light' color='orange'>
                <IconHeartHandshake size={22} />
              </ThemeIcon>
              <Title order={2} size='h3'>
                No company behind it
              </Title>
            </Group>
            <Text size='sm'>
              PicTur is a small project, developed and maintained by its two developers in their spare time,
              together with the researchers who use it. It is not a commercial product — it exists to help
              people study and protect turtles.
            </Text>
            <Text size='sm'>
              Found a problem or have an idea? Tell us on the{' '}
              <Anchor component={Link} to='/feedback'>
                feedback page
              </Anchor>
              , or get in touch through the{' '}
              <Anchor component={Link} to='/contact'>
                contact page
              </Anchor>
              .
            </Text>
          </Stack>
        </Paper>

        {/* The original research group */}
        <Stack gap={4} align='center'>
          <Title order={2} size='h3' ta={{ base: 'left', sm: 'center' }}>
            The original research group
          </Title>
          <Text size='sm' c='dimmed' ta={{ base: 'left', sm: 'center' }}>
            PicTur was built for the Washburn turtle team, which continues to use it in its research.
          </Text>
        </Stack>

        <Paper shadow='sm' p={{ base: 'md', sm: 'lg' }} radius='md' withBorder>
          <Stack gap='md'>
            <Text size='sm'>
              The Washburn group studies ecology and behavior of turtles, with a strong focus on undergraduate
              research that informs conservation and habitat management. Work includes{' '}
              <Text span fw={600}>
                box turtles
              </Text>{' '}
              (<em>Terrapene ornata</em> and <em>Terrapene triunguis</em>) in northeastern Kansas, plus
              demographic studies of aquatic turtles.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='md'>
              <FeatureCard
                icon={<IconRoute size={22} />}
                color='teal'
                title='Movement ecology'
                text='Radio telemetry tracks daily and seasonal movement. Home-range models help estimate habitat needs and how individuals use the landscape.'
              />
              <FeatureCard
                icon={<IconTemperature size={22} />}
                color='cyan'
                title='Temperature & behavior'
                text='As ectotherms, turtles rely heavily on behavior to regulate body temperature. The lab studies how climate and weather relate to activity and habitat use.'
              />
              <FeatureCard
                icon={<IconBrain size={22} />}
                color='grape'
                title='Personality & cognition'
                text='Individual differences in personality and spatial cognition may affect fitness. The team explores how that variation scales to population persistence.'
              />
            </SimpleGrid>
            <Group gap='sm' wrap='nowrap' align='flex-start'>
              <ThemeIcon size='md' radius='md' variant='light' color='green'>
                <IconSchool size={18} />
              </ThemeIcon>
              <Text size='sm'>
                <Text span fw={600}>
                  Education through research:{' '}
                </Text>
                students gain hands-on experience in field methods, data analysis, and science
                communication—skills that transfer to conservation careers and informed citizenship.
              </Text>
            </Group>
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

        <Paper shadow='sm' p={{ base: 'md', sm: 'lg' }} radius='md' withBorder>
          <Stack gap='sm'>
            <Divider label='What PicTur offers' labelPosition='center' />
            <List size='sm' spacing='xs' c='dimmed'>
              <List.Item>Photo upload and matching for plastron and carapace photos</List.Item>
              <List.Item>Independent research groups, each with its own turtles, members and locations</List.Item>
              <List.Item>Community sightings for any group that accepts them, plus Observer tools and quests</List.Item>
              <List.Item>Staff review, turtle records and release tracking</List.Item>
            </List>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}

function FeatureCard({
  icon,
  color,
  title,
  text,
}: {
  icon: ReactNode;
  color: string;
  title: string;
  text: string;
}) {
  return (
    <Paper p='md' radius='md' withBorder shadow='xs'>
      <Stack gap='sm' align='flex-start'>
        <ThemeIcon size='lg' radius='md' variant='light' color={color}>
          {icon}
        </ThemeIcon>
        <Title order={3} size='h4'>
          {title}
        </Title>
        <Text size='sm' c='dimmed'>
          {text}
        </Text>
      </Stack>
    </Paper>
  );
}
