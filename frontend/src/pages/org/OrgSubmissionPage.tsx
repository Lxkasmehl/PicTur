import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Container,
  Grid,
  Group,
  Image,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconCheck, IconPlus, IconRefresh, IconX } from '@tabler/icons-react';
import { OrgGate } from '../../components/org/OrgGate';
import type { OrgOption } from '../../hooks/useActiveOrg';
import {
  approveSubmission,
  getRegions,
  getSubmission,
  mediaUrl,
  regionOptions,
  rejectSubmission,
  rematchSubmission,
  type Region,
  type Submission,
  type TurtleSex,
} from '../../services/api/orgData';
import { formatDate, SEX_OPTIONS, SUBMISSION_STATUS } from './orgFormat';

export default function OrgSubmissionPage() {
  return <OrgGate minRole='staff'>{(org) => <SubmissionReview org={org} />}</OrgGate>;
}

function SubmissionReview({ org }: { org: OrgOption }) {
  const { submissionId } = useParams();
  const id = Number(submissionId);
  const navigate = useNavigate();
  const [sub, setSub] = useState<Submission | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [useAsReference, setUseAsReference] = useState(false);
  const [rematchRegion, setRematchRegion] = useState<string | null>(null);
  const [newTurtle, setNewTurtle] = useState({ name: '', sex: 'U' as TurtleSex, species: '', notes: '' });

  const load = useCallback(() => {
    getSubmission(org.slug, id)
      .then((s) => {
        setSub(s);
        setRematchRegion(s.region_id ? String(s.region_id) : null);
      })
      .catch((e) => setError((e as Error).message));
  }, [org.slug, id]);

  useEffect(() => {
    load();
    getRegions(org.slug).then(setRegions).catch(() => setRegions([]));
  }, [load, org.slug]);

  // Community uploads are matched in the background; poll until candidates are ready.
  useEffect(() => {
    if (sub?.match_state !== 'pending') return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [sub, load]);

  const regionName = (rid: number | null) =>
    rid == null ? null : regionOptions(regions).find((r) => r.value === String(rid))?.label ?? null;

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Action failed', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const confirmMatch = (turtleId: number) =>
    run(`match-${turtleId}`, async () => {
      const turtle = await approveSubmission(org.slug, id, { turtle_id: turtleId, set_reference: useAsReference });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: 'Sighting recorded', message: `Added to ${turtle.bio_id}.` });
      navigate(`/g/${org.slug}/turtles/${turtle.id}`);
    });

  const createNew = () =>
    run('new', async () => {
      const turtle = await approveSubmission(org.slug, id, {
        new_turtle: {
          name: newTurtle.name.trim() || undefined,
          sex: newTurtle.sex,
          species: newTurtle.species.trim() || undefined,
          notes: newTurtle.notes.trim() || undefined,
          region_id: sub?.region_id ?? null,
        },
      });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: 'Turtle created', message: `New turtle ${turtle.bio_id}.` });
      navigate(`/g/${org.slug}/turtles/${turtle.id}`);
    });

  const reject = () =>
    run('reject', async () => {
      await rejectSubmission(org.slug, id);
      notifications.show({ color: 'gray', title: 'Submission rejected', message: 'The photo was not used.' });
      navigate(`/g/${org.slug}/review`);
    });

  const rematch = () =>
    run('rematch', async () => {
      setSub(await rematchSubmission(org.slug, id, rematchRegion ? Number(rematchRegion) : null));
    });

  if (error) {
    return (
      <Container size='sm' py='xl'>
        <Alert color='red'>{error}</Alert>
      </Container>
    );
  }
  if (!sub) {
    return (
      <Center py='xl'>
        <Loader />
      </Center>
    );
  }

  const pending = sub.status === 'pending';
  const candidates = sub.candidates ?? [];

  return (
    <Container size='xl' py='md'>
      <Stack gap='md'>
        <Group justify='space-between'>
          <Anchor component={Link} to={`/g/${org.slug}/review`} size='sm'>
            <Group gap={4}>
              <IconArrowLeft size={14} /> Review queue
            </Group>
          </Anchor>
          <Badge color={SUBMISSION_STATUS[sub.status].color}>{SUBMISSION_STATUS[sub.status].label}</Badge>
        </Group>

        <Grid gutter='lg'>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Paper withBorder p='sm' radius='md'>
              <Stack gap='xs'>
                <Image src={mediaUrl(sub.image_url, 1200)} alt='Submitted carapace' radius='sm' fit='contain' mah={480} />
                <Text size='sm'>
                  <b>Observed:</b> {formatDate(sub.observed_at || sub.created_at)}
                  {regionName(sub.region_id) && <> · <b>Region:</b> {regionName(sub.region_id)}</>}
                </Text>
                {sub.lat != null && sub.lon != null && (
                  <Anchor size='sm' href={`https://www.google.com/maps?q=${sub.lat},${sub.lon}`} target='_blank' rel='noopener noreferrer'>
                    {sub.lat.toFixed(5)}, {sub.lon.toFixed(5)}
                  </Anchor>
                )}
                <Text size='sm' c='dimmed'>
                  {sub.uploader_is_staff ? 'Staff upload' : `Community upload by ${sub.uploader_email || 'anonymous visitor'}`}
                </Text>
                {sub.notes && <Text size='sm'>“{sub.notes}”</Text>}
                {!pending && sub.resolved_turtle_id && (
                  <Button component={Link} to={`/g/${org.slug}/turtles/${sub.resolved_turtle_id}`} variant='light'>
                    Open turtle record
                  </Button>
                )}
              </Stack>
            </Paper>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap='md'>
              <Group justify='space-between' align='flex-end'>
                <Title order={3}>Match candidates</Title>
                {pending && (
                  <Group gap='xs' align='flex-end'>
                    <Select
                      size='xs'
                      label='Search in region'
                      placeholder='Whole group'
                      data={regionOptions(regions)}
                      value={rematchRegion}
                      onChange={setRematchRegion}
                      clearable
                      w={200}
                    />
                    <Button size='xs' variant='light' leftSection={<IconRefresh size={14} />} loading={busy === 'rematch'} onClick={rematch}>
                      Match again
                    </Button>
                  </Group>
                )}
              </Group>

              {sub.match_state === 'pending' && (
                <Group gap='xs'>
                  <Loader size='sm' /> <Text size='sm'>Matching in progress…</Text>
                </Group>
              )}
              {sub.match_state === 'failed' && <Alert color='orange'>Matching failed for this photo. You can still create a new turtle or retry.</Alert>}
              {sub.match_state === 'done' && candidates.length === 0 && (
                <Alert color='blue'>No similar turtle found in this research group.</Alert>
              )}

              {pending && candidates.length > 0 && (
                <Checkbox
                  label='Use this photo as the new reference photo of the confirmed turtle'
                  checked={useAsReference}
                  onChange={(e) => setUseAsReference(e.currentTarget.checked)}
                />
              )}

              {candidates.map((c, idx) =>
                c.turtle ? (
                  <Card key={c.turtle_id} withBorder padding='sm' radius='md' data-testid='org-candidate'>
                    <Group align='flex-start' wrap='nowrap'>
                      <Image
                        src={mediaUrl(c.turtle.reference_image_url, 500)}
                        alt={`Reference of ${c.turtle.bio_id}`}
                        w={200}
                        h={150}
                        fit='cover'
                        radius='sm'
                      />
                      <Stack gap={4} style={{ flex: 1 }}>
                        <Group gap='xs'>
                          <Text fw={600}>#{idx + 1} {c.turtle.bio_id}</Text>
                          {c.turtle.name && <Text c='dimmed'>{c.turtle.name}</Text>}
                          {!c.in_region && <Badge size='xs' color='gray'>other region</Badge>}
                        </Group>
                        <Text size='sm'>
                          {c.score} matching keypoints · confidence {(c.confidence * 100).toFixed(0)}%
                        </Text>
                        <Text size='xs' c='dimmed'>
                          {c.turtle.sighting_count} sightings · last seen {formatDate(c.turtle.last_seen)}
                          {regionName(c.turtle.region_id) ? ` · ${regionName(c.turtle.region_id)}` : ''}
                        </Text>
                        <Group gap='xs' mt='xs'>
                          {pending && (
                            <Button size='xs' leftSection={<IconCheck size={14} />} loading={busy === `match-${c.turtle_id}`} disabled={!!busy} onClick={() => confirmMatch(c.turtle_id)}>
                              This is the turtle
                            </Button>
                          )}
                          <Button size='xs' variant='subtle' component={Link} to={`/g/${org.slug}/turtles/${c.turtle_id}`} target='_blank'>
                            Open record
                          </Button>
                        </Group>
                      </Stack>
                    </Group>
                  </Card>
                ) : null,
              )}

              {pending && (
                <Paper withBorder p='md' radius='md'>
                  <Stack gap='sm'>
                    <Title order={4}>None of these? Create a new turtle</Title>
                    <Group grow>
                      <TextInput label='Name (optional)' value={newTurtle.name} onChange={(e) => setNewTurtle({ ...newTurtle, name: e.currentTarget.value })} />
                      <Select label='Sex' data={SEX_OPTIONS} value={newTurtle.sex} allowDeselect={false} onChange={(v) => setNewTurtle({ ...newTurtle, sex: (v || 'U') as TurtleSex })} />
                      <TextInput label='Species' value={newTurtle.species} onChange={(e) => setNewTurtle({ ...newTurtle, species: e.currentTarget.value })} />
                    </Group>
                    <Textarea label='Notes' autosize minRows={2} value={newTurtle.notes} onChange={(e) => setNewTurtle({ ...newTurtle, notes: e.currentTarget.value })} />
                    <Group justify='space-between'>
                      <Button color='gray' variant='light' leftSection={<IconX size={14} />} loading={busy === 'reject'} disabled={!!busy} onClick={reject}>
                        Reject photo
                      </Button>
                      <Button leftSection={<IconPlus size={14} />} loading={busy === 'new'} disabled={!!busy} onClick={createNew} data-testid='org-create-turtle'>
                        Create new turtle
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              )}
            </Stack>
          </Grid.Col>
        </Grid>
      </Stack>
    </Container>
  );
}
