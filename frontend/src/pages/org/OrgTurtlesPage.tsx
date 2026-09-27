import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { OrgGate } from '../../components/org/OrgGate';
import type { OrgOption } from '../../hooks/useActiveOrg';
import {
  getRegions,
  getTurtles,
  mediaUrl,
  regionOptions,
  type Region,
  type TurtleSummary,
} from '../../services/api/orgData';
import { formatDate, STATUS_OPTIONS, TURTLE_STATUS } from './orgFormat';

export default function OrgTurtlesPage() {
  return <OrgGate minRole='staff'>{(org) => <TurtleList org={org} />}</OrgGate>;
}

function TurtleList({ org }: { org: OrgOption }) {
  const navigate = useNavigate();
  const [regions, setRegions] = useState<Region[]>([]);
  const [turtles, setTurtles] = useState<TurtleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 250);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getRegions(org.slug).then(setRegions).catch(() => setRegions([]));
  }, [org.slug]);

  useEffect(() => {
    let cancelled = false;
    getTurtles(org.slug, { q: debounced.trim(), region_id: regionId ? Number(regionId) : null, status })
      .then((rows) => !cancelled && setTurtles(rows))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [org.slug, debounced, regionId, status]);

  const regionLabels = useMemo(() => new Map(regionOptions(regions).map((r) => [Number(r.value), r.label])), [regions]);

  return (
    <Container size='xl' py='md'>
      <Stack gap='md'>
        <Group justify='space-between'>
          <Title order={2}>Turtle Records</Title>
          {turtles && <Text c='dimmed'>{turtles.length} turtles</Text>}
        </Group>

        <Group grow>
          <TextInput
            placeholder='Search ID or name'
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Select placeholder='All regions' data={regionOptions(regions)} value={regionId} onChange={setRegionId} clearable searchable />
          <Select placeholder='Any status' data={STATUS_OPTIONS} value={status} onChange={setStatus} clearable />
        </Group>

        {error && <Text c='red'>{error}</Text>}
        {turtles === null && !error ? (
          <Center py='xl'>
            <Loader />
          </Center>
        ) : (
          <Paper withBorder radius='md'>
            <Table highlightOnHover verticalSpacing='xs'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th />
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Sex</Table.Th>
                  <Table.Th>Region</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Sightings</Table.Th>
                  <Table.Th>Last seen</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {turtles?.map((t) => (
                  <Table.Tr
                    key={t.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/g/${org.slug}/turtles/${t.id}`)}
                    data-testid='org-turtle-row'
                  >
                    <Table.Td>
                      <Avatar src={mediaUrl(t.reference_image_url, 120)} radius='sm' size='md' />
                    </Table.Td>
                    <Table.Td fw={600}>{t.bio_id}</Table.Td>
                    <Table.Td>{t.name || '–'}</Table.Td>
                    <Table.Td>{t.sex}</Table.Td>
                    <Table.Td>{(t.region_id != null && regionLabels.get(t.region_id)) || '–'}</Table.Td>
                    <Table.Td>
                      <Badge size='sm' color={TURTLE_STATUS[t.status].color}>
                        {TURTLE_STATUS[t.status].label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{t.sighting_count}</Table.Td>
                    <Table.Td>{formatDate(t.last_seen)}</Table.Td>
                  </Table.Tr>
                ))}
                {turtles?.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={8}>
                      <Text c='dimmed' ta='center' py='md'>
                        No turtles yet. Upload a carapace photo on the home page to create the first one.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
