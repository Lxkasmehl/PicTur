import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Container,
  Grid,
  Group,
  Image,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconDeviceFloppy, IconStar, IconTrash } from '@tabler/icons-react';
import { OrgGate } from '../../components/org/OrgGate';
import type { OrgOption } from '../../hooks/useActiveOrg';
import {
  deleteSighting,
  deleteTurtle,
  deleteTurtleImage,
  getRegions,
  getTurtle,
  mediaUrl,
  regionOptions,
  setReferenceImage,
  updateTurtle,
  type Region,
  type TurtleDetail,
  type TurtleSex,
  type TurtleStatus,
} from '../../services/api/orgData';
import { formatDate, SEX_OPTIONS, STATUS_OPTIONS, TURTLE_STATUS } from './orgFormat';

export default function OrgTurtleDetailPage() {
  return <OrgGate minRole='staff'>{(org) => <TurtleDetailView org={org} />}</OrgGate>;
}

interface FormState {
  name: string;
  sex: TurtleSex;
  species: string;
  region_id: string | null;
  status: TurtleStatus;
  notes: string;
}

function toForm(t: TurtleDetail): FormState {
  return {
    name: t.name ?? '',
    sex: t.sex,
    species: t.species ?? '',
    region_id: t.region_id != null ? String(t.region_id) : null,
    status: t.status,
    notes: t.notes ?? '',
  };
}

function TurtleDetailView({ org }: { org: OrgOption }) {
  const { turtleId } = useParams();
  const id = Number(turtleId);
  const navigate = useNavigate();
  const isAdmin = org.role === 'admin';
  const [turtle, setTurtle] = useState<TurtleDetail | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((t: TurtleDetail) => {
    setTurtle(t);
    setForm(toForm(t));
  }, []);

  useEffect(() => {
    getTurtle(org.slug, id).then(apply).catch((e) => setError((e as Error).message));
    getRegions(org.slug).then(setRegions).catch(() => setRegions([]));
  }, [org.slug, id, apply]);

  const regionLabels = useMemo(() => new Map(regionOptions(regions).map((r) => [Number(r.value), r.label])), [regions]);

  const notifyError = (e: unknown) =>
    notifications.show({ color: 'red', title: 'Action failed', message: (e as Error).message });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      apply(
        await updateTurtle(org.slug, id, {
          name: form.name.trim() || null,
          sex: form.sex,
          species: form.species.trim() || null,
          region_id: form.region_id ? Number(form.region_id) : null,
          status: form.status,
          notes: form.notes.trim() || null,
        }),
      );
      notifications.show({ color: 'green', title: 'Saved', message: 'Turtle record updated.' });
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const makeReference = async (imageId: number) => {
    try {
      apply(await setReferenceImage(org.slug, id, imageId));
    } catch (e) {
      notifyError(e);
    }
  };

  const removeImage = (imageId: number) =>
    modals.openConfirmModal({
      title: 'Delete photo?',
      children: <Text size='sm'>The photo is removed permanently.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await deleteTurtleImage(org.slug, id, imageId);
          apply(await getTurtle(org.slug, id));
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const removeSighting = (sightingId: number) =>
    modals.openConfirmModal({
      title: 'Delete sighting?',
      children: <Text size='sm'>Photos of this sighting stay with the turtle.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await deleteSighting(org.slug, sightingId);
          apply(await getTurtle(org.slug, id));
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const removeTurtle = () =>
    modals.openConfirmModal({
      title: `Delete turtle ${turtle?.bio_id}?`,
      children: <Text size='sm'>The record, all sightings and all photos are deleted permanently.</Text>,
      labels: { confirm: 'Delete turtle', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await deleteTurtle(org.slug, id);
          navigate(`/g/${org.slug}/turtles`);
        } catch (e) {
          notifyError(e);
        }
      },
    });

  if (error) {
    return (
      <Container size='sm' py='xl'>
        <Alert color='red'>{error}</Alert>
      </Container>
    );
  }
  if (!turtle || !form) {
    return (
      <Center py='xl'>
        <Loader />
      </Center>
    );
  }

  const reference = turtle.images.find((i) => i.is_reference);

  return (
    <Container size='xl' py='md'>
      <Stack gap='md'>
        <Anchor component={Link} to={`/g/${org.slug}/turtles`} size='sm'>
          <Group gap={4}>
            <IconArrowLeft size={14} /> All turtles
          </Group>
        </Anchor>

        <Group justify='space-between'>
          <Group gap='sm'>
            <Title order={2}>{turtle.bio_id}</Title>
            {turtle.name && <Title order={3} c='dimmed'>{turtle.name}</Title>}
            <Badge color={TURTLE_STATUS[turtle.status].color}>{TURTLE_STATUS[turtle.status].label}</Badge>
          </Group>
          <Text size='xs' c='dimmed'>Primary ID {turtle.primary_id}</Text>
        </Group>

        <Grid gutter='lg'>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Paper withBorder p='sm' radius='md'>
              {reference ? (
                <Image src={mediaUrl(reference.url, 1200)} alt='Reference carapace' radius='sm' fit='contain' mah={420} />
              ) : (
                <Text c='dimmed'>No reference photo.</Text>
              )}
              <Text size='xs' c='dimmed' mt={4}>
                Reference photo (used for matching)
              </Text>
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Paper withBorder p='md' radius='md'>
              <Stack gap='sm'>
                <Group grow>
                  <TextInput label='Name' value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
                  <Select label='Sex' data={SEX_OPTIONS} value={form.sex} allowDeselect={false} onChange={(v) => setForm({ ...form, sex: (v || 'U') as TurtleSex })} />
                </Group>
                <Group grow>
                  <TextInput label='Species' value={form.species} onChange={(e) => setForm({ ...form, species: e.currentTarget.value })} />
                  <Select label='Status' data={STATUS_OPTIONS} value={form.status} allowDeselect={false} onChange={(v) => setForm({ ...form, status: (v || 'active') as TurtleStatus })} />
                </Group>
                <Select label='Home region' data={regionOptions(regions)} value={form.region_id} onChange={(v) => setForm({ ...form, region_id: v })} clearable searchable />
                <Textarea label='Notes' autosize minRows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} />
                <Text size='xs' c='dimmed'>
                  The ID {turtle.bio_id} stays fixed even if the sex changes later.
                </Text>
                <Group justify='space-between'>
                  {isAdmin ? (
                    <Button color='red' variant='subtle' leftSection={<IconTrash size={14} />} onClick={removeTurtle}>
                      Delete turtle
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button leftSection={<IconDeviceFloppy size={14} />} loading={saving} onClick={save}>
                    Save
                  </Button>
                </Group>
              </Stack>
            </Paper>
          </Grid.Col>
        </Grid>

        <Title order={3}>Photos</Title>
        <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
          {turtle.images.map((img) => (
            <Card key={img.id} withBorder padding='xs' radius='md'>
              <Card.Section>
                <Image src={mediaUrl(img.url, 400)} alt='Carapace photo' h={140} fit='cover' />
              </Card.Section>
              <Group justify='space-between' mt='xs' gap={4}>
                <Text size='xs' c='dimmed'>{formatDate(img.created_at)}</Text>
                {img.is_reference ? (
                  <Badge size='xs' leftSection={<IconStar size={10} />}>Reference</Badge>
                ) : (
                  <Group gap={2}>
                    <Tooltip label='Use as reference'>
                      <ActionIcon size='sm' variant='subtle' onClick={() => makeReference(img.id)} aria-label='Use as reference'>
                        <IconStar size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label='Delete photo'>
                      <ActionIcon size='sm' variant='subtle' color='red' onClick={() => removeImage(img.id)} aria-label='Delete photo'>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                )}
              </Group>
            </Card>
          ))}
        </SimpleGrid>

        <Title order={3}>Sightings</Title>
        <Paper withBorder radius='md'>
          <Table verticalSpacing='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Region</Table.Th>
                <Table.Th>Location</Table.Th>
                <Table.Th>Observer</Table.Th>
                <Table.Th>Notes</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {turtle.sightings.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>{formatDate(s.observed_at || s.created_at)}</Table.Td>
                  <Table.Td>{(s.region_id != null && regionLabels.get(s.region_id)) || '–'}</Table.Td>
                  <Table.Td>
                    {s.lat != null && s.lon != null ? (
                      <Anchor size='sm' href={`https://www.google.com/maps?q=${s.lat},${s.lon}`} target='_blank' rel='noopener noreferrer'>
                        {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
                      </Anchor>
                    ) : (
                      '–'
                    )}
                  </Table.Td>
                  <Table.Td>{s.observer_name || '–'}</Table.Td>
                  <Table.Td>{s.notes || ''}</Table.Td>
                  <Table.Td>
                    {turtle.sightings.length > 1 && (
                      <ActionIcon size='sm' variant='subtle' color='red' onClick={() => removeSighting(s.id)} aria-label='Delete sighting'>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      </Stack>
    </Container>
  );
}
