import {
  Container,
  Title,
  Text,
  Stack,
  Paper,
  Group,
  Badge,
  Tabs,
  Center,
  Loader,
} from '@mantine/core';
import { IconPhoto, IconDatabase } from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { useUser } from '../hooks/useUser';
import { isStaffRole } from '../services/api/auth';
import { useAdminTurtleRecords } from '../hooks/useAdminTurtleRecords';
import { AdminTurtleRecordsProvider } from './AdminTurtleRecords/AdminTurtleRecordsContext';
import { ReviewQueueTab } from './AdminTurtleRecords/ReviewQueueTab';
import { SheetsBrowserTab } from './AdminTurtleRecords/SheetsBrowserTab';
import { CreateNewTurtleModal } from './AdminTurtleRecords/CreateNewTurtleModal';

export default function AdminTurtleRecordsPage() {
  const { role, authChecked } = useUser();
  const isMobile = useMediaQuery('(max-width: 576px)');
  const hook = useAdminTurtleRecords(role, authChecked);

  if (!isStaffRole(role)) {
    return null;
  }

  if (!authChecked) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }

  const { activeTab, setActiveTab, queueItems } = hook;

  return (
    <AdminTurtleRecordsProvider value={hook}>
      <Container size='xl' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
        <Stack gap='lg'>
          <Paper shadow='sm' p={{ base: 'md', sm: 'md' }} radius='md' withBorder>
            <Group justify='space-between' align='center' wrap='wrap' gap='md'>
              <div>
                <Title order={2} size='h3'>
                  Turtle Records
                </Title>
                <Text size='xs' c='dimmed'>
                  Review queue and Google Sheets
                </Text>
              </div>
              {activeTab === 'queue' && queueItems.length > 0 && (
                <Badge
                  size='md'
                  variant='light'
                  color='orange'
                  leftSection={<IconPhoto size={12} />}
                >
                  {queueItems.length} Pending
                </Badge>
              )}
            </Group>
          </Paper>

          <Tabs value={activeTab} onChange={(value) => setActiveTab(value || 'queue')}>
            <Tabs.List grow style={{ flexWrap: 'wrap' }}>
              <Tabs.Tab value='queue' leftSection={<IconPhoto size={16} />}>
                Review Queue ({queueItems.length})
              </Tabs.Tab>
              <Tabs.Tab value='sheets' leftSection={<IconDatabase size={16} />}>
                Google Sheets Browser
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value='queue' pt='md'>
              <ReviewQueueTab />
            </Tabs.Panel>

            <Tabs.Panel value='sheets' pt='md'>
              <SheetsBrowserTab />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Container>

      <CreateNewTurtleModal size={isMobile ? '100%' : 'xl'} />
    </AdminTurtleRecordsProvider>
  );
}
