/**
 * Admin page: view turtles with flag/find metadata (collected to lab, digital flag)
 * for releasing them back to the exact position.
 */

import {
  Container,
  Title,
  Text,
  Stack,
  Paper,
  Center,
  Loader,
  Group,
  Badge,
  Card,
  ScrollArea,
  Button,
} from '@mantine/core';
import { IconMapPin, IconFlag, IconArrowLeft, IconCircleCheck } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../hooks/useUser';
import { isStaffRole } from '../services/api/auth';
import { getTurtlesWithFlags, clearReleaseFlag } from '../services/api';
import { MapWithMarkers } from '../components/MapWithMarkers.tsx';
import { notifications } from '@mantine/notifications';

interface FlagItem {
  turtle_id: string;
  location: string;
  path: string;
  find_metadata: Record<string, unknown> & {
    digital_flag_lat?: number;
    digital_flag_lon?: number;
    digital_flag_source?: string;
    physical_flag?: string;
    collected_to_lab?: string;
  };
}

export default function AdminReleasePage() {
  const { role, authChecked } = useUser();
  const navigate = useNavigate();
  const [items, setItems] = useState<FlagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const loadFlags = () => {
    getTurtlesWithFlags()
      .then((res) => {
        if (res.success && res.items) setItems(res.items);
        else setItems([]);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!authChecked) return;
    if (!isStaffRole(role)) {
      navigate('/');
      return;
    }
    loadFlags();
  }, [authChecked, role, navigate]);

  if (!authChecked || !isStaffRole(role)) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  const markers = items
    .filter(
      (i) =>
        i.find_metadata?.digital_flag_lat != null &&
        i.find_metadata?.digital_flag_lon != null
    )
    .map((i) => ({
      lat: i.find_metadata!.digital_flag_lat!,
      lon: i.find_metadata!.digital_flag_lon!,
      label: `${i.turtle_id} (${i.location})`,
    }));

  return (
    <Container size="xl" py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap="lg">
        <Paper shadow="sm" p={{ base: 'md', sm: 'xl' }} radius="md" withBorder>
          <Group justify="space-between" wrap="wrap" gap="md">
            <Group gap="md">
              <Button
                variant="light"
                leftSection={<IconArrowLeft size={16} />}
                onClick={() => navigate('/')}
              >
                Back
              </Button>
              <div>
                <Title order={1}>Release – Digital Flags</Title>
                <Text size="sm" c="dimmed" mt="xs">
                  Turtles with flag/find metadata for returning them to the exact spot
                </Text>
              </div>
            </Group>
          </Group>
        </Paper>

        {loading ? (
          <Center py="xl">
            <Loader size="lg" />
          </Center>
        ) : items.length === 0 ? (
          <Paper shadow="sm" p="xl" radius="md" withBorder>
            <Center py="xl">
              <Stack gap="md" align="center">
                <IconFlag size={64} stroke={1.5} style={{ opacity: 0.3 }} />
                <Text size="lg" c="dimmed" ta="center">
                  No turtles with flag data yet
                </Text>
                <Text size="sm" c="dimmed" ta="center">
                  When community or admins mark a turtle as collected and set a digital
                  flag, they will appear here for release.
                </Text>
              </Stack>
            </Center>
          </Paper>
        ) : (
          <>
            {markers.length > 0 && (
              <Paper shadow="sm" p="md" radius="md" withBorder>
                <Text fw={600} size="md" mb="sm">
                  All digital flag positions
                </Text>
                <MapWithMarkers markers={markers} height={400} />
              </Paper>
            )}
            <Paper shadow="sm" p="md" radius="md" withBorder>
              <Text fw={600} size="md" mb="sm">
                Turtles with find metadata ({items.length})
              </Text>
              <ScrollArea h={500} type="auto">
                <Stack gap="sm">
                  {items.map((item) => (
                    <Card key={`${item.turtle_id}-${item.location}`} shadow="xs" padding="md" radius="md" withBorder>
                      <Group justify="space-between" wrap="wrap">
                        <Group gap="sm">
                          <Text fw={600}>{item.turtle_id}</Text>
                          <Badge variant="light" size="sm">
                            {item.location}
                          </Badge>
                        </Group>
                        <Group gap="xs">
                          {item.find_metadata?.physical_flag && (
                            <Badge size="sm" variant="outline">
                              Flag: {item.find_metadata.physical_flag}
                            </Badge>
                          )}
                          <Button
                            size="xs"
                            variant="light"
                            color="green"
                            leftSection={<IconCircleCheck size={14} />}
                            loading={releasingId === item.turtle_id}
                            onClick={async () => {
                              setReleasingId(item.turtle_id);
                              try {
                                await clearReleaseFlag(item.turtle_id, item.location);
                                loadFlags();
                                notifications.show({
                                  title: 'Released back to nature',
                                  message: 'Digital flag cleared. Don\'t forget to take the physical flag with you!',
                                  color: 'green',
                                  autoClose: 8000,
                                });
                              } catch (e) {
                                notifications.show({
                                  title: 'Error',
                                  message: e instanceof Error ? e.message : 'Failed to clear release flag',
                                  color: 'red',
                                });
                              } finally {
                                setReleasingId(null);
                              }
                            }}
                          >
                            Released back to nature
                          </Button>
                        </Group>
                      </Group>
                      {(item.find_metadata?.digital_flag_lat != null &&
                        item.find_metadata?.digital_flag_lon != null) && (
                        <Group gap="xs" mt="xs">
                          <IconMapPin size={14} />
                          <Text size="xs" c="dimmed">
                            {item.find_metadata.digital_flag_lat.toFixed(5)},{' '}
                            {item.find_metadata.digital_flag_lon.toFixed(5)}
                            {item.find_metadata.digital_flag_source
                              ? ` (${item.find_metadata.digital_flag_source})`
                              : ''}
                          </Text>
                        </Group>
                      )}
                      {item.find_metadata?.collected_to_lab && (
                        <Text size="xs" c="dimmed" mt={4}>
                          Collected to lab: {item.find_metadata.collected_to_lab}
                        </Text>
                      )}
                    </Card>
                  ))}
                </Stack>
              </ScrollArea>
            </Paper>
          </>
        )}
      </Stack>
    </Container>
  );
}
