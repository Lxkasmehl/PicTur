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
  SegmentedControl,
} from '@mantine/core';
import { useState, useEffect, useCallback } from 'react';
import { useMediaQuery } from '@mantine/hooks';
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
import { useActiveOrg } from '../hooks/useActiveOrg';
import { useProgramTerms } from '../hooks/useProgramTerms';
import { publishLocationStructure } from '../hooks/useLocationStructure';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import {
  getGeneralLocationCatalog,
  addGeneralLocation,
  addProgram,
  removeProgram,
  getLocationStructure,
  setLocationStructure,
  type LocationStructure,
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
  /** When true the location is a fixed sheet default - force=true is sent to backend. */
  isFixed: boolean;
}

interface AffectedInfo {
  loading: boolean;
  total: number;
  sheets: { sheet_name: string; count: number }[];
  error: string | null;
}

const STRUCTURE_TEXT: Record<LocationStructure, { label: string; description: string }> = {
  single: {
    label: 'One location',
    description:
      'All turtles come from one study site. When entering data, admins only type the exact Location (spot) of each turtle.',
  },
  areas: {
    label: 'Several areas',
    description:
      'Your study site has a few areas (General Locations). Admins pick the area for each turtle and type the exact Location.',
  },
  programs: {
    label: 'Several programs',
    description:
      'Several programs (studies or projects), each with its own General Locations (or one fixed General Location), plus the exact Location per turtle.',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminLocationManagementPage() {
  const { authChecked: userAuthChecked } = useUser();
  // Role in the active research group (the account role for the main group)
  const { role, ready: orgReady, isDbOrg, active } = useActiveOrg();
  const activeSlug = active.slug;
  const authChecked = userAuthChecked && orgReady;
  const navigate = useNavigate();
  const terms = useProgramTerms();

  // Research groups: one location / several areas / several programs (main group: programs)
  const [structure, setStructure] = useState<LocationStructure>('programs');
  const [changingStructure, setChangingStructure] = useState(false);
  const isPhone = useMediaQuery('(max-width: 576px)');

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

  // Create selectable program
  const [createProgramOpen, setCreateProgramOpen] = useState(false);
  const [newSelectableName, setNewSelectableName] = useState('');
  const [creatingProgram, setCreatingProgram] = useState(false);

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
    if (isDbOrg) {
      getLocationStructure()
        .then((res) => {
          setStructure(res.structure);
          publishLocationStructure(activeSlug, res);
        })
        .catch(() => setStructure('programs'));
    }
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
  }, [isDbOrg, activeSlug]);

  const handleStructureChange = async (next: LocationStructure) => {
    if (next === structure) return;
    setChangingStructure(true);
    try {
      const res = await setLocationStructure(next);
      setStructure(res.structure);
      publishLocationStructure(activeSlug, res);
      notifications.show({ color: 'green', title: 'Location setup changed', message: STRUCTURE_TEXT[next].label, icon: <IconCheck size={16} /> });
      loadCatalog();
    } catch (err: unknown) {
      notifications.show({ color: 'red', title: 'Could not change the setup', message: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setChangingStructure(false);
    }
  };

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
  // Create selectable program
  // ---------------------------------------------------------------------------

  const handleCreateProgram = async () => {
    const name = newSelectableName.trim();
    if (!name) return;
    setCreatingProgram(true);
    try {
      const res = await addProgram(name);
      if (res.success && res.catalog) {
        setCatalog(res.catalog);
        notifications.show({ color: 'green', title: 'Program added', message: `Now add General Locations to "${name}".`, icon: <IconCheck size={16} /> });
        setCreateProgramOpen(false);
        setNewSelectableName('');
        // Open it right away so the first General Location can be added
        setExpandedStates((prev) => new Set(prev).add(name));
        setAddingState(name);
        setNewLocationName('');
      } else {
        notifications.show({ color: 'red', title: 'Error', message: res.error || 'Failed to add program' });
      }
    } catch (err: unknown) {
      notifications.show({ color: 'red', title: 'Error', message: err instanceof Error ? err.message : 'Failed to add program' });
    } finally {
      setCreatingProgram(false);
    }
  };

  const handleRemoveProgram = async (name: string) => {
    try {
      const res = await removeProgram(name);
      if (res.success && res.catalog) {
        setCatalog(res.catalog);
        notifications.show({ color: 'green', title: 'Program deleted', message: `"${name}" removed.`, icon: <IconCheck size={16} /> });
      } else {
        notifications.show({ color: 'red', title: 'Error', message: res.error || 'Failed to delete program' });
      }
    } catch (err: unknown) {
      notifications.show({ color: 'red', title: 'Error', message: err instanceof Error ? err.message : 'Failed to delete program' });
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

  // States where at least one location is not a sheet default, plus new programs that have no
  // General Locations yet (and are not fixed).
  const fixedStates = new Set(
    Object.values(catalog?.sheet_defaults ?? {}).map((rule) => rule.state.toLowerCase()),
  );
  const freeChoiceStates = catalog
    ? Object.entries(catalog.states).filter(([stateName, locations]) =>
        locations.length === 0
          ? !fixedStates.has(stateName.toLowerCase())
          : locations.some((loc) => !isLocked(stateName, loc)),
      )
    : [];

  // One location / several areas: the group's only program
  const programNames = catalog ? Object.keys(catalog.states) : [];
  const onlyProgram = programNames.length === 1 ? programNames[0] : null;

  // All fixed programs from sheet_defaults.
  const fixedPrograms = catalog ? Object.entries(catalog.sheet_defaults) : [];

  // Move-target options for the delete modal - restricted to the same state so the
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
        {isDbOrg && (
          <Paper withBorder radius='md' p='md'>
            <Stack gap='xs'>
              <Text fw={600} size='sm'>
                How does your group record where a turtle was found?
              </Text>
              <SegmentedControl
                fullWidth
                orientation={isPhone ? 'vertical' : 'horizontal'}
                data-testid='location-structure'
                value={structure}
                disabled={changingStructure || catalogLoading}
                onChange={(v) => handleStructureChange(v as LocationStructure)}
                data={(Object.keys(STRUCTURE_TEXT) as LocationStructure[]).map((value) => ({
                  value,
                  label: STRUCTURE_TEXT[value].label,
                }))}
              />
              <Text size='sm' c='dimmed'>
                {STRUCTURE_TEXT[structure].description}
              </Text>
            </Stack>
          </Paper>
        )}

        {catalogError && (
          <Alert color='red' icon={<IconAlertCircle size={16} />} title='Error'>
            {catalogError}
          </Alert>
        )}

        {catalogLoading ? (
          <Center h={160}>
            <Loader />
          </Center>
        ) : catalog && isDbOrg && structure !== 'programs' ? (
          onlyProgram === null ? (
            <Alert color='orange' icon={<IconAlertCircle size={16} />}>
              This group has more than one program. Switch to “Several programs” to manage them.
            </Alert>
          ) : structure === 'single' ? (
            <Paper withBorder radius='md' p='md'>
              <Text size='sm'>
                Nothing else to set up. Turtles are stored under{' '}
                <Text span fw={600}>
                  {onlyProgram}
                </Text>
                {catalog.sheet_defaults[onlyProgram] && (
                  <>
                    {' '}
                    /{' '}
                    <Text span fw={600}>
                      {catalog.sheet_defaults[onlyProgram].general_location}
                    </Text>
                  </>
                )}
                ; admins enter the exact Location for each turtle.
              </Text>
            </Paper>
          ) : (
            <Stack gap='sm'>
              <Stack gap={2}>
                <Title order={4}>Areas</Title>
                <Text size='xs' c='dimmed'>
                  Admins pick one of these General Locations for each turtle.
                </Text>
              </Stack>
              <Paper withBorder radius='md' p='md'>
                <Stack gap='xs'>
                  {(catalog.states[onlyProgram] ?? []).length === 0 && (
                    <Text size='sm' c='dimmed'>
                      No areas yet. Add the first one below.
                    </Text>
                  )}
                  {(catalog.states[onlyProgram] ?? []).map((loc, _i, all) => (
                    <Group key={loc} justify='space-between'>
                      <Text size='sm'>{loc}</Text>
                      <ActionIcon
                        color='red'
                        variant='light'
                        size='sm'
                        disabled={all.length === 1}
                        onClick={() => setDeleteTarget({ state: onlyProgram, location: loc, isFixed: false })}
                        title={all.length === 1 ? 'The last area cannot be deleted' : `Delete "${loc}"`}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Divider my={4} />
                  <Group gap='sm'>
                    <TextInput
                      placeholder='New area name'
                      value={addingState === onlyProgram ? newLocationName : ''}
                      onFocus={() => setAddingState(onlyProgram)}
                      onChange={(e) => {
                        setAddingState(onlyProgram);
                        setNewLocationName(e.currentTarget.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddLocation(onlyProgram);
                      }}
                      size='sm'
                      style={{ flex: 1 }}
                    />
                    <Button
                      size='sm'
                      leftSection={<IconPlus size={14} />}
                      loading={addingLoading}
                      disabled={addingState !== onlyProgram || !newLocationName.trim()}
                      onClick={() => handleAddLocation(onlyProgram)}
                    >
                      Add area
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </Stack>
          )
        ) : catalog ? (
          <Stack gap='xl'>
            {/* ----------------------------------------------------------------
                Selectable locations
            ---------------------------------------------------------------- */}
            <Stack gap='sm'>
              <Group justify='space-between' align='flex-end'>
                <Stack gap={2}>
                  <Title order={4}>Selectable Locations</Title>
                  <Text size='xs' c='dimmed'>
                    Admins choose one of these per turtle when entering data.
                  </Text>
                </Stack>
                <Button
                  variant='light'
                  size='xs'
                  leftSection={<IconPlus size={14} />}
                  onClick={() => {
                    setCreateProgramOpen(true);
                    setNewSelectableName('');
                  }}
                >
                  Add program
                </Button>
              </Group>

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
                              if (next.has(stateName)) {
                                next.delete(stateName);
                              } else {
                                next.add(stateName);
                              }
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
                                  disabled={makeFixedOptions.length === 0}
                                  onClick={() => {
                                    setMakeFixedState(stateName);
                                    setMakeFixedLocation(makeFixedOptions[0]?.value ?? '');
                                  }}
                                >
                                  Make fixed
                                </Menu.Item>
                                {selectableLocations.length === 0 && (
                                  <Menu.Item
                                    color='red'
                                    leftSection={<IconTrash size={14} />}
                                    onClick={() => handleRemoveProgram(stateName)}
                                  >
                                    Delete program
                                  </Menu.Item>
                                )}
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
                              {selectableLocations.length === 0 && (
                                <Text size='sm' c='dimmed'>
                                  No General Locations yet. Add the first one below.
                                </Text>
                              )}
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
                    {terms.isDbOrg
                      ? 'These programs always use the same General Location; admins do not pick one per turtle.'
                      : 'These programs always use a single General Location tied to their sheet tab.'}
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
                            {terms.isDbOrg ? 'Program' : 'Program (Sheet)'}
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
                  and its fixed program?{' '}
                  {terms.isDbOrg
                    ? 'The program is removed as well.'
                    : 'This will also remove the sheet default.'}
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
                  {terms.isDbOrg
                    ? 'Their General Location and photo folders will be updated.'
                    : 'Their General Location in Google Sheets and on-disk folders will be updated.'}
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

      {/* Create selectable program */}
      <Modal
        opened={createProgramOpen}
        onClose={() => !creatingProgram && setCreateProgramOpen(false)}
        title={
          <Group gap='sm'>
            <IconLockOpen size={18} />
            <Text fw={600}>Add Program</Text>
          </Group>
        }
        centered
        size='sm'
      >
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            {terms.isDbOrg
              ? 'A program with selectable locations: you add its General Locations next, and admins pick one per turtle.'
              : 'A program with selectable locations: you add its General Locations next, and admins pick one per turtle. The name should match the Google Sheets tab (or the part before "/").'}
          </Text>
          <TextInput
            label='Program name'
            placeholder={terms.isDbOrg ? 'e.g. River Survey' : 'e.g. Kansas'}
            value={newSelectableName}
            onChange={(e) => setNewSelectableName(e.currentTarget.value)}
            required
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateProgram();
            }}
          />
          <Group justify='flex-end' gap='sm'>
            <Button
              variant='subtle'
              color='gray'
              onClick={() => setCreateProgramOpen(false)}
              disabled={creatingProgram}
            >
              Cancel
            </Button>
            <Button
              loading={creatingProgram}
              disabled={!newSelectableName.trim()}
              onClick={handleCreateProgram}
            >
              Add program
            </Button>
          </Group>
        </Stack>
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
            {terms.isDbOrg
              ? 'A fixed program always uses one specific General Location, so admins do not have to pick it per turtle.'
              : 'A fixed program always uses one specific General Location. The program name must match the Google Sheets tab name.'}
          </Text>
          <TextInput
            label={terms.isDbOrg ? 'Program name' : 'Program name (sheet tab name)'}
            placeholder={terms.isDbOrg ? 'e.g. Pond Study' : 'e.g. MissouriSite'}
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
              to a fixed program. Admins will no longer choose a location per turtle; it will
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
