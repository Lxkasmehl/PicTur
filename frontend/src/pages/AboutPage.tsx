import {
  Container,
  Paper,
  Title,
  Text,
  Stack,
  Center,
  List,
  ThemeIcon,
  Group,
} from '@mantine/core';
import { IconCheck, IconCode, IconPalette, IconRocket } from '@tabler/icons-react';

export default function AboutPage() {
  return (
    <Container size='md' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md'>
        <Stack gap='lg'>
          <Center>
            <Title order={1} ta='center'>
              About PicTur
            </Title>
          </Center>

          <Text size='lg' c='dimmed' ta='center'>
            A modern React application with beautiful UI components
          </Text>

          <Stack gap='md'>
            <Title order={3}>Features</Title>
            <List
              spacing='xs'
              size='sm'
              center
              icon={
                <ThemeIcon color='green' size={24} radius='xl'>
                  <IconCheck size={16} />
                </ThemeIcon>
              }
            >
              <List.Item>React 18 with TypeScript</List.Item>
              <List.Item>Mantine UI Components</List.Item>
              <List.Item>React Router for Navigation</List.Item>
              <List.Item>Responsive Design</List.Item>
              <List.Item>Dark/Light Theme Support</List.Item>
              <List.Item>Image Upload Functionality</List.Item>
            </List>
          </Stack>

          <Stack gap='md'>
            <Title order={3}>Technologies Used</Title>
            <Group justify='center' gap='xl' wrap='wrap'>
              <Stack align='center' gap='xs'>
                <ThemeIcon size='xl' radius='xl' color='green'>
                  <IconCode size={24} />
                </ThemeIcon>
                <Text size='sm' ta='center'>
                  React + TypeScript
                </Text>
              </Stack>
              <Stack align='center' gap='xs'>
                <ThemeIcon size='xl' radius='xl' color='teal'>
                  <IconPalette size={24} />
                </ThemeIcon>
                <Text size='sm' ta='center'>
                  Mantine UI
                </Text>
              </Stack>
              <Stack align='center' gap='xs'>
                <ThemeIcon size='xl' radius='xl' color='sand'>
                  <IconRocket size={24} />
                </ThemeIcon>
                <Text size='sm' ta='center'>
                  Vite
                </Text>
              </Stack>
            </Group>
          </Stack>

          <Text size='sm' c='dimmed' ta='center' mt='xl'>
            Built with ❤️ using modern web technologies
          </Text>
        </Stack>
      </Paper>
    </Container>
  );
}
