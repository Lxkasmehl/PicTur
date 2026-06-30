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
  TextInput,
  Modal,
  Divider,
  Table,
  ThemeIcon,
  Menu,
} from '@mantine/core';
import { useState, useEffect, useCallback } from 'react';
import {
  IconMapPin,
  IconTrash,
  IconLock,
  IconLockOpen,
  IconAlertCircle,
  IconCheck,
  IconPlus,
  IconChevronDown,
  IconChevronRight,
  IconDots,
} from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import {
  getGeneralLocationCatalog,
  addGeneralLocation,
  addSheetDefault,
  removeSheetDefault,
  getAffectedTurtleCount,
  deleteGeneralLocation,
  type GeneralLocationCatalog,
} from '../services/api/general-locations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeleteTarget {
  state: string;
  location: string;
  /** When true the location is a fixed sheet default — force=true is sent to backend. */
  isFixed: boolean;
}

interface AffectedInfo {
  loading: boolean;
  total: number;
  sheets: { sheet_name: string; count: number }[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminLocationManagementPage() {
  const { role, authChecked } = useUser();
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<GeneralLocationCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [lockedLocations, setLockedLocations] = useState<Set<string>>(new Set());

  // Expanded selectable-program accordion entries
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());

  // Delete confirmation (selectable location OR fixed program)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>('');
  const [affected, setAffected] = useState<AffectedInfo>({
    loading: false,
    total: 0,
    sheets: [],
    error: null,
  });
  const [deleting, setDeleting] = useState(false);

  // Inline add-location
  const [addingState, setAddingState] = useState<string | null>(null);
  const [newLocationName, setNewLocationName] = useState('');
  const [addingLoading, setAddingLoading] = useState(false);

  // Create fixed program
  const [createFixedOpen, setCreateFixedOpen] = useState(false);
  const [newProgramName, setNewProgramName] = useState('');
  const [newProgramLocation, setNewProgramLocation] = useState('');
  const [creatingFixed, setCreatingFixed] = useState(false);

  // Convert selectable → fixed
  const [makeFixedState, setMakeFixedState] = useState<string | null>(null);
  const [makeFixedLocation, setMakeFixedLocation] = useState('');
  const [makingFixed, setMakingFixed] = useState(false);

  // Convert fixed → selectable
  const [makeSelectableSheet, setMakeSelectableSheet] = useState<string | null>(null);
  const [makingSelectable, setMakingSelectable] = useState(false);

  // ---------------------------------------------------------------------------
  // Auth guard
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'admin') navigate('/');
  }, [authChecked, role, navigate]);

  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------

  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError(null);
    getGeneralLocationCatalog()
      .then((res) => {
        if (res.success && res.catalog) {
          setCatalog(res.catalog);
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

  // ---------------------------------------------------------------------------
  // Delete flow (shared for selectable locations and fixed programs)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!deleteTarget) return;
    setMoveTarget('');
    setAffected({ loading: true, total: 0, sheets: [], error: null });
    getAffectedTurtleCount(deleteTarget.location, deleteTarget.state)
      .then((res) =>
        setAffected({ loading: false, total: res.total, sheets: res.sheets, error: null }),
      )
      .catch((err: Error) =>
        setAffected({ loading: false, total: 0, sheets: [], error: err.message }),
      );
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
        force: deleteTarget.isFixed,
      });

      if (!res.success) {
        notifications.show({ color: 'red', title: 'Delete failed', message: res.error || 'Unknown error' });
        return;
      }

      const movedMsg = res.moved && res.moved > 0 ? ` ${res.moved} turtle(s) moved.` : '';
      notifications.show({
        color: 'green',
        title: 'Deleted',
        message: `"${deleteTarget.location}" removed.${movedMsg}`,
        icon: <IconCheck size={16} />,
      });
      setDeleteTarget(null);
      loadCatalog();
    } catch (err: unknown) {
      notifications.show({ color: 'red', title: 'Error', message: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Add location (selectable programs)
  // ---------------------------------------------------------------------------

  const handleAddLocation = async (stateName: string) => {
    const name = newLocationName.trim();
    if (!name) return;
    setAddingLoading(true);
    try {
      const res = await addGeneralLocation({ state: stateName, general_location: name });
      if (res.success && res.catalog) {
        setCatalog(res.catalog);
        notifications.show({ color: 'green', title: 'Location added', message: `"${name}" added.`, icon: <IconCheck size={16} /> });
        setAddingState(null);
        setNewLocationName('');
      } else {
        notifications.show({ color: 'red', title: 'Error', message: res.error || 'Failed to add location' });
      }
    } catch (err: unknown) {
      notifications.show({ color: 'red', title: 'Error', message: err instanceof Error ? err.message : 'Failed to add location' });
    } finally {
      setAddingLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Create fixed program
  // ---------------------------------------------------------------------------

  const handleCreateFixed = async () => {
    const name = newProgramName.trim();
    const loc = newProgramLocation.trim();
    if (!name || !loc) return;
    setCreatingFixed(true);
    try {
      const res = await addSheetDefault({ sheet_name: name, general_location: loc });
      if (res.success && res.catalog) {
        setCatalog(res.catalog);
        notifications.show({ color: 'green', title: 'Fixed program created', message: `"${name}" → "${loc}".`, icon: <IconCheck size={16} /> });
        setCreateFixedOpen(false);
        setNewProgramName('');
        setNewProgramLocation('');
        loadCatalog();
      } else {
        notifications.show({ color: 'red', title: 'Error', message: res.error || 'Failed' });
      }
    } catch (err: unknown) {
      notifications.show({ color: 'red', title: 'Error', message: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setCreatingFixed(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Convert selectable → fixed
  // ---------------------------------------------------------------------------

  const handleMakeFixed = async () => {
    if (!makeFixedState || !makeFixedLocation) return;
    setMakingFixed(true);
    try {
      const res = await addSheetDefault({ sheet_name: makeFixedState, general_location: makeFixedLocation });
      if (res.success && res.catalog) {
        setCatalog(res.catalog);
        notifications.show({ color: 'green', title: 'Converted to fixed', message: `"${makeFixedState}" is now fixed to "${makeFixedLocation}".`, icon: <IconCheck size={16} /> });
        setMakeFixedState(null);
        setMakeFixedLocation('');
        loadCatalog();
      } else {
        notifications.show({ color: 'red', title: 'Error', message: res.error || 'Failed' });
      }
    } catch (err: unknown) {
      notifications.show({ color: 'red', title: 'Error', message: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setMakingFixed(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Convert fixed → selectable
  // ---------------------------------------------------------------------------

  const handleMakeSelectable = async () => {
    if (!makeSelectableSheet) return;
    setMakingSelectable(true);
    try {
      const res = await removeSheetDefault({ sheet_name: makeSelectableSheet });
      if (res.success && res.catalog) {
        setCatalog(res.catalog);
        notifications.show({ color: 'green', title: 'Converted to selectable', message: `"${makeSelectableSheet}" is now a selectable program.`, icon: <IconCheck size={16} /> });
        setMakeSelectableSheet(null);
        loadCatalog();
      } else {
        notifications.show({ color: 'red', title: 'Error', message: res.error || 'Failed' });
      }
    } catch (err: unknown) {
      notifications.show({ color: 'red', title: 'Error', message: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setMakingSelectable(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  if (!authChecked || role !== 'admin') {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  // States where at least one location is not a sheet default.
  const freeChoiceStates = catalog
    ? Object.entries(catalog.states).filter(([stateName, locations]) =>
        locations.some((loc) => !isLocked(stateName, loc)),
      )
    : [];

  // All fixed programs from sheet_defaults.
  const fixedPrograms = catalog ? Object.entries(catalog.sheet_defaults) : [];

  // Move-target options for the delete modal — restricted to the same state so the
  // backend's state-scoped bulk-update accepts the target without validation errors.
  const moveOptions: { value: string; label: string }[] = (() => {
    if (!deleteTarget || !catalog) return [];
    const stateLocations = catalog.states[deleteTarget.state] ?? [];
    return stateLocations
      .filter((loc) => loc !== deleteTarget.location)
      .map((loc) => ({ value: loc, label: loc }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Container size='md' py='xl'>
      <Stack gap='lg'>
        <Group gap='sm'>
          <IconMapPin size={28} />
          <Title order={2}>Location Management</Title>
        </Group>
        <Text c='dimmed' size='sm'>
          Manage General Location options available to admins when entering turtle data.
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
          <Stack gap='xl'>
            {/* ----------------------------------------------------------------
                Selectable locations
            ---------------------------------------------------------------- */}
            <Stack gap='sm'>
              <Stack gap={2}>
                <Title order={4}>Selectable Locations</Title>
                <Text size='xs' c='dimmed'>
                  Admins choose one of these per turtle when entering data.
                </Text>
              </Stack>

              {freeChoiceStates.length === 0 ? (
                <Text size='sm' c='dimmed'>
                  No selectable location programs configured.
                </Text>
              ) : (
                <Stack gap='xs'>
                  {freeChoiceStates.map(([stateName, locations]) => {
                    const isOpen = expandedStates.has(stateName);
                    const selectableLocations = locations.filter((loc) => !isLocked(stateName, loc));
                    const makeFixedOptions = selectableLocations.map((l) => ({ value: l, label: l }));

                    return (
                      <Paper key={stateName} withBorder radius='md' style={{ overflow: 'hidden' }}>
                        <Group
                          px='md'
                          py='sm'
                          justify='space-between'
                          style={{ cursor: 'pointer' }}
                          onClick={() =>
                            setExpandedStates((prev) => {
                              const next = new Set(prev);
                              next.has(stateName) ? next.delete(stateName) : next.add(stateName);
                              return next;
                            })
                          }
                        >
                          <Group gap='sm'>
                            <Text fw={600} size='sm'>
                              {stateName}
                            </Text>
                            <Badge variant='filled' size='sm' color='red'>
                              {selectableLocations.length}{' '}
                              {selectableLocations.length !== 1 ? 'locations' : 'location'}
                            </Badge>
                          </Group>
                          <Group gap='xs' onClick={(e) => e.stopPropagation()}>
                            <Menu shadow='md' position='bottom-end'>
                              <Menu.Target>
                                <ActionIcon variant='subtle' color='gray' size='sm'>
                                  <IconDots size={14} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Label>Program</Menu.Label>
                                <Menu.Item
                                  leftSection={<IconLock size={14} />}
                                  onClick={() => {
                                    setMakeFixedState(stateName);
                                    setMakeFixedLocation(makeFixedOptions[0]?.value ?? '');
                                  }}
                                >
                                  Make fixed
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                            <ThemeIcon variant='subtle' color='gray' size='sm'>
                              {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                            </ThemeIcon>
                          </Group>
                        </Group>

                        {isOpen && (
                          <>
                            <Divider />
                            <Stack gap='xs' p='md'>
                              {selectableLocations.map((loc) => (
                                <Group key={loc} justify='space-between'>
                                  <Text size='sm'>{loc}</Text>
                                  <ActionIcon
                                    color='red'
                                    variant='light'
                                    size='sm'
                                    onClick={() =>
                                      setDeleteTarget({ state: stateName, location: loc, isFixed: false })
                                    }
                                    title={`Delete "${loc}"`}
                                  >
                                    <IconTrash size={14} />
                                  </ActionIcon>
                                </Group>
                              ))}

                              <Divider my={4} />

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
                                  variant='subtle'
                                  size='xs'
                                  leftSection={<IconPlus size={14} />}
                                  onClick={() => {
                                    setAddingState(stateName);
                                    setNewLocationName('');
                                  }}
                                >
                                  Add location
                                </Button>
                              )}
                            </Stack>
                          </>
                        )}
                      </Paper>
                    );
                  })}
                </Stack>
              )}
            </Stack>

            {/* ----------------------------------------------------------------
                Fixed programs
            ---------------------------------------------------------------- */}
            <Stack gap='sm'>
              <Group justify='space-between' align='flex-end'>
                <Stack gap={2}>
                  <Title order={4}>Fixed Programs</Title>
                  <Text size='xs' c='dimmed'>
                    These programs always use a single General Location tied to their sheet tab.
                  </Text>
                </Stack>
                <Button
                  variant='light'
                  size='xs'
                  leftSection={<IconPlus size={14} />}
                  onClick={() => {
                    setCreateFixedOpen(true);
                    setNewProgramName('');
                    setNewProgramLocation('');
                  }}
                >
                  Add fixed program
                </Button>
              </Group>

              {fixedPrograms.length === 0 ? (
                <Text size='sm' c='dimmed'>
                  No fixed programs configured.
                </Text>
              ) : (
                <Paper withBorder radius='md' style={{ overflow: 'hidden' }}>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>
                          <Text size='xs' fw={600} c='dimmed'>
                            Program (Sheet)
                          </Text>
                        </Table.Th>
                        <Table.Th>
                          <Text size='xs' fw={600} c='dimmed'>
                            Fixed Location
                          </Text>
                        </Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {fixedPrograms.map(([sheetName, rule]) => (
                          <Table.Tr key={sheetName}>
                            <Table.Td>
                              <Text size='sm' fw={500}>
                                {sheetName}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Group gap='xs'>
                                <Text size='sm'>{rule.general_location}</Text>
                                <Badge
                                  color='gray'
                                  variant='light'
                                  size='xs'
                                  leftSection={<IconLock size={10} />}
                                >
                                  Fixed
                                </Badge>
                              </Group>
                            </Table.Td>
                            <Table.Td>
                              <Group gap='xs' justify='flex-end'>
                                <Button
                                  variant='subtle'
                                  size='xs'
                                  color='gray'
                                  leftSection={<IconLockOpen size={12} />}
                                  onClick={() => setMakeSelectableSheet(sheetName)}
                                >
                                  Make selectable
                                </Button>
                                <ActionIcon
                                  color='red'
                                  variant='light'
                                  size='sm'
                                  onClick={() =>
                                    setDeleteTarget({
                                      state: rule.state,
                                      location: rule.general_location,
                                      isFixed: true,
                                    })
                                  }
                                  title={`Delete program "${sheetName}"`}
                                >
                                  <IconTrash size={14} />
                                </ActionIcon>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>
              )}
            </Stack>
          </Stack>
        ) : null}
      </Stack>

      {/* ======================================================================
          Modals
      ====================================================================== */}

      {/* Delete confirmation */}
      <Modal
        opened={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={
          <Group gap='sm'>
            <IconTrash size={18} color='red' />
            <Text fw={600}>Delete {deleteTarget?.isFixed ? 'Fixed Program' : 'Location'}</Text>
          </Group>
        }
        centered
        size='sm'
      >
        {deleteTarget && (
          <Stack gap='md'>
            <Text size='sm'>
              Delete{' '}
              <Text span fw={600}>
                "{deleteTarget.location}"
              </Text>
              {deleteTarget.isFixed && (
                <>
                  {' '}
                  and its fixed program? This will also remove the sheet default.
                </>
              )}
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
                  Their General Location in Google Sheets and on-disk folders will be updated.
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

      {/* Create fixed program */}
      <Modal
        opened={createFixedOpen}
        onClose={() => !creatingFixed && setCreateFixedOpen(false)}
        title={
          <Group gap='sm'>
            <IconLock size={18} />
            <Text fw={600}>Add Fixed Program</Text>
          </Group>
        }
        centered
        size='sm'
      >
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            A fixed program always uses one specific General Location. The program name must match
            the Google Sheets tab name.
          </Text>
          <TextInput
            label='Program name (sheet tab name)'
            placeholder='e.g. MissouriSite'
            value={newProgramName}
            onChange={(e) => setNewProgramName(e.currentTarget.value)}
            required
          />
          <TextInput
            label='Fixed General Location'
            placeholder='e.g. Riverview'
            value={newProgramLocation}
            onChange={(e) => setNewProgramLocation(e.currentTarget.value)}
            required
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFixed();
            }}
          />
          <Group justify='flex-end' gap='sm'>
            <Button
              variant='subtle'
              color='gray'
              onClick={() => setCreateFixedOpen(false)}
              disabled={creatingFixed}
            >
              Cancel
            </Button>
            <Button
              loading={creatingFixed}
              disabled={!newProgramName.trim() || !newProgramLocation.trim()}
              onClick={handleCreateFixed}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Convert selectable → fixed */}
      <Modal
        opened={!!makeFixedState}
        onClose={() => !makingFixed && setMakeFixedState(null)}
        title={
          <Group gap='sm'>
            <IconLock size={18} />
            <Text fw={600}>Make Fixed</Text>
          </Group>
        }
        centered
        size='sm'
      >
        {makeFixedState && catalog && (
          <Stack gap='md'>
            <Text size='sm'>
              Convert{' '}
              <Text span fw={600}>
                {makeFixedState}
              </Text>{' '}
              to a fixed program. Admins will no longer choose a location per turtle — it will
              always be locked to the selected one.
            </Text>
            <Select
              label='Fixed location'
              placeholder='Select…'
              data={(catalog.states[makeFixedState] ?? [])
                .filter((l) => !isLocked(makeFixedState, l))
                .map((l) => ({ value: l, label: l }))}
              value={makeFixedLocation}
              onChange={(v) => setMakeFixedLocation(v ?? '')}
              required
            />
            <Group justify='flex-end' gap='sm'>
              <Button
                variant='subtle'
                color='gray'
                onClick={() => setMakeFixedState(null)}
                disabled={makingFixed}
              >
                Cancel
              </Button>
              <Button
                loading={makingFixed}
                disabled={!makeFixedLocation}
                onClick={handleMakeFixed}
              >
                Make fixed
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Convert fixed → selectable */}
      <Modal
        opened={!!makeSelectableSheet}
        onClose={() => !makingSelectable && setMakeSelectableSheet(null)}
        title={
          <Group gap='sm'>
            <IconLockOpen size={18} />
            <Text fw={600}>Make Selectable</Text>
          </Group>
        }
        centered
        size='sm'
      >
        {makeSelectableSheet && catalog && (
          <Stack gap='md'>
            <Text size='sm'>
              Convert{' '}
              <Text span fw={600}>
                {makeSelectableSheet}
              </Text>{' '}
              to a selectable program. Admins will be able to choose a General Location per turtle
              again.
            </Text>
            <Group justify='flex-end' gap='sm'>
              <Button
                variant='subtle'
                color='gray'
                onClick={() => setMakeSelectableSheet(null)}
                disabled={makingSelectable}
              >
                Cancel
              </Button>
              <Button loading={makingSelectable} onClick={handleMakeSelectable}>
                Make selectable
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}
