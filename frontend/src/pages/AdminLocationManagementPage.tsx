import {
  Container,
  Title,
  Text,
  Stack,
  Paper,
  Button,
  Alert,
  Loader,
  Center,
  Select,
  Group,
  Badge,
  ActionIcon,
  Accordion,
  TextInput,
  Modal,
  Divider,
} from '@mantine/core';
import { useState, useEffect, useCallback } from 'react';
import {
  IconMapPin,
  IconTrash,
  IconLock,
  IconAlertCircle,
  IconCheck,
  IconPlus,
} from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import {
  getGeneralLocationCatalog,
  addGeneralLocation,
  getAffectedTurtleCount,
  deleteGeneralLocation,
  type GeneralLocationCatalog,
} from '../services/api/general-locations';

interface DeleteState {
  state: string;
  location: string;
}

interface AffectedInfo {
  loading: boolean;
  total: number;
  sheets: { sheet_name: string; count: number }[];
  error: string | null;
}

export default function AdminLocationManagementPage() {
  const { role, authChecked } = useUser();
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<GeneralLocationCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Locked locations: those that are a fixed sheet_default.
  const [lockedLocations, setLockedLocations] = useState<Set<string>>(new Set());

  // Delete modal state.
  const [deleteTarget, setDeleteTarget] = useState<DeleteState | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>('');
  const [affected, setAffected] = useState<AffectedInfo>({
    loading: false,
    total: 0,
    sheets: [],
    error: null,
  });
  const [deleting, setDeleting] = useState(false);

  // Add location inline state.
  const [addingState, setAddingState] = useState<string | null>(null);
  const [newLocationName, setNewLocationName] = useState('');
  const [addingLoading, setAddingLoading] = useState(false);

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'admin') navigate('/');
  }, [authChecked, role, navigate]);

  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError(null);
    getGeneralLocationCatalog()
      .then((res) => {
        if (res.success && res.catalog) {
          setCatalog(res.catalog);
          // Build the set of locked location keys (state::location).
          const locked = new Set<string>();
          for (const rule of Object.values(res.catalog.sheet_defaults)) {
            locked.add(`${rule.state}::${rule.general_location}`);
          }
          setLockedLocations(locked);
        } else {
          setCatalogError('Failed to load location catalog.');
        }
      })
      .catch((err: Error) => setCatalogError(err.message))
      .finally(() => setCatalogLoading(false));
  }, []);

  useEffect(() => {
    if (role === 'admin') loadCatalog();
  }, [role, loadCatalog]);

  const isLocked = (state: string, location: string) =>
    lockedLocations.has(`${state}::${location}`);

  // When delete modal opens, fetch affected turtle count.
  useEffect(() => {
    if (!deleteTarget) return;
    setMoveTarget('');
    setAffected({ loading: true, total: 0, sheets: [], error: null });
    getAffectedTurtleCount(deleteTarget.location)
      .then((res) => {
        setAffected({ loading: false, total: res.total, sheets: res.sheets, error: null });
      })
      .catch((err: Error) => {
        setAffected({ loading: false, total: 0, sheets: [], error: err.message });
      });
  }, [deleteTarget]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (affected.total > 0 && !moveTarget) return;

    setDeleting(true);
    try {
      const res = await deleteGeneralLocation({
        state: deleteTarget.state,
        general_location: deleteTarget.location,
        target_general_location: affected.total > 0 ? moveTarget : undefined,
      });

      if (!res.success) {
        notifications.show({
          color: 'red',
          title: 'Delete failed',
          message: res.error || 'Unknown error',
        });
        return;
      }

      const movedMsg = res.moved && res.moved > 0 ? ` ${res.moved} turtle(s) moved.` : '';
      notifications.show({
        color: 'green',
        title: 'Location deleted',
        message: `"${deleteTarget.location}" removed from ${deleteTarget.state}.${movedMsg}`,
        icon: <IconCheck size={16} />,
      });

      setDeleteTarget(null);
      loadCatalog();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      notifications.show({ color: 'red', title: 'Error', message: msg });
    } finally {
      setDeleting(false);
    }
  };

  const handleAddLocation = async (stateName: string) => {
    const name = newLocationName.trim();
    if (!name) return;
    setAddingLoading(true);
    try {
      const res = await addGeneralLocation({ state: stateName, general_location: name });
      if (res.success && res.catalog) {
        setCatalog(res.catalog);
        notifications.show({
          color: 'green',
          title: 'Location added',
          message: `"${name}" added to ${stateName}.`,
          icon: <IconCheck size={16} />,
        });
        setAddingState(null);
        setNewLocationName('');
      } else {
        notifications.show({ color: 'red', title: 'Error', message: res.error || 'Failed to add location' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add location';
      notifications.show({ color: 'red', title: 'Error', message: msg });
    } finally {
      setAddingLoading(false);
    }
  };

  if (!authChecked || role !== 'admin') {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  }

  const moveOptions =
    deleteTarget && catalog
      ? (catalog.states[deleteTarget.state] ?? [])
          .filter((loc) => loc !== deleteTarget.location)
          .map((loc) => ({ value: loc, label: loc }))
      : [];

  return (
    <Container size='lg' py='xl'>
      <Stack gap='lg'>
        <Group gap='sm'>
          <IconMapPin size={28} />
          <Title order={2}>Location Management</Title>
        </Group>
        <Text c='dimmed' size='sm'>
          Manage General Location options available to admins when entering turtle data. Locked
          locations are fixed sheet defaults and cannot be deleted here.
        </Text>

        {catalogError && (
          <Alert color='red' icon={<IconAlertCircle size={16} />} title='Error'>
            {catalogError}
          </Alert>
        )}

        {catalogLoading ? (
          <Center h={160}>
            <Loader />
          </Center>
        ) : catalog ? (
          <Accordion variant='separated' multiple>
            {Object.entries(catalog.states).map(([stateName, locations]) => (
              <Accordion.Item key={stateName} value={stateName}>
                <Accordion.Control>
                  <Group gap='sm'>
                    <Text fw={600}>{stateName}</Text>
                    <Badge variant='light' size='sm'>
                      {locations.length} location{locations.length !== 1 ? 's' : ''}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap='xs'>
                    {locations.map((loc) => {
                      const locked = isLocked(stateName, loc);
                      // Find which sheet this location is locked to (for tooltip/label).
                      const lockedSheet = locked
                        ? Object.entries(catalog.sheet_defaults).find(
                            ([, rule]) =>
                              rule.state === stateName && rule.general_location === loc,
                          )?.[0]
                        : undefined;

                      return (
                        <Paper key={loc} withBorder px='md' py='sm' radius='sm'>
                          <Group justify='space-between'>
                            <Group gap='sm'>
                              <Text size='sm'>{loc}</Text>
                              {locked && (
                                <Badge
                                  color='gray'
                                  variant='light'
                                  size='xs'
                                  leftSection={<IconLock size={10} />}
                                  title={`Fixed default for sheet "${lockedSheet}"`}
                                >
                                  Fixed{lockedSheet ? ` (${lockedSheet})` : ''}
                                </Badge>
                              )}
                            </Group>
                            {!locked && (
                              <ActionIcon
                                color='red'
                                variant='light'
                                size='sm'
                                onClick={() => setDeleteTarget({ state: stateName, location: loc })}
                                title={`Delete "${loc}"`}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            )}
                          </Group>
                        </Paper>
                      );
                    })}

                    <Divider my='xs' />

                    {addingState === stateName ? (
                      <Group gap='sm'>
                        <TextInput
                          placeholder='New location name'
                          value={newLocationName}
                          onChange={(e) => setNewLocationName(e.currentTarget.value)}
                          size='sm'
                          style={{ flex: 1 }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddLocation(stateName);
                            if (e.key === 'Escape') {
                              setAddingState(null);
                              setNewLocationName('');
                            }
                          }}
                          autoFocus
                        />
                        <Button
                          size='sm'
                          loading={addingLoading}
                          disabled={!newLocationName.trim()}
                          onClick={() => handleAddLocation(stateName)}
                        >
                          Add
                        </Button>
                        <Button
                          size='sm'
                          variant='subtle'
                          color='gray'
                          onClick={() => {
                            setAddingState(null);
                            setNewLocationName('');
                          }}
                        >
                          Cancel
                        </Button>
                      </Group>
                    ) : (
                      <Button
                        variant='light'
                        size='xs'
                        leftSection={<IconPlus size={14} />}
                        onClick={() => {
                          setAddingState(stateName);
                          setNewLocationName('');
                        }}
                      >
                        Add location to {stateName}
                      </Button>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        ) : null}
      </Stack>

      {/* Delete confirmation modal */}
      <Modal
        opened={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={
          <Group gap='sm'>
            <IconTrash size={18} color='red' />
            <Text fw={600}>Delete General Location</Text>
          </Group>
        }
        centered
      >
        {deleteTarget && (
          <Stack gap='md'>
            <Text size='sm'>
              Delete{' '}
              <Text span fw={600}>
                "{deleteTarget.location}"
              </Text>{' '}
              from{' '}
              <Text span fw={600}>
                {deleteTarget.state}
              </Text>
              ?
            </Text>

            {affected.loading ? (
              <Group gap='sm'>
                <Loader size='xs' />
                <Text size='sm' c='dimmed'>
                  Checking for affected turtles…
                </Text>
              </Group>
            ) : affected.error ? (
              <Alert color='orange' icon={<IconAlertCircle size={14} />}>
                Could not check affected turtles: {affected.error}
              </Alert>
            ) : affected.total === 0 ? (
              <Alert color='green' icon={<IconCheck size={14} />}>
                No turtles currently use this location. Safe to delete.
              </Alert>
            ) : (
              <Stack gap='sm'>
                <Alert color='orange' icon={<IconAlertCircle size={14} />}>
                  <Text size='sm' fw={500}>
                    {affected.total} turtle{affected.total !== 1 ? 's' : ''} use this location:
                  </Text>
                  {affected.sheets.map((s) => (
                    <Text key={s.sheet_name} size='xs' c='dimmed'>
                      {s.sheet_name}: {s.count}
                    </Text>
                  ))}
                </Alert>
                <Select
                  label='Move these turtles to'
                  placeholder='Select target location…'
                  data={moveOptions}
                  value={moveTarget}
                  onChange={(v) => setMoveTarget(v ?? '')}
                  required
                  searchable
                />
                <Text size='xs' c='dimmed'>
                  Their General Location in Google Sheets will be updated and their on-disk folders
                  will be relocated automatically.
                </Text>
              </Stack>
            )}

            <Group justify='flex-end' gap='sm'>
              <Button
                variant='subtle'
                color='gray'
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                color='red'
                loading={deleting}
                disabled={affected.loading || (affected.total > 0 && !moveTarget)}
                onClick={handleDelete}
              >
                Delete
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}
