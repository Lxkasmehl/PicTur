import {
  Container,
  Title,
  Text,
  Stack,
  Paper,
  TextInput,
  Button,
  Loader,
  Center,
  Select,
  MultiSelect,
  Table,
  Badge,
  Group,
  Tooltip,
  Modal,
  ActionIcon,
} from '@mantine/core';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  IconUsersGroup,
  IconAlertCircle,
  IconCheck,
  IconPlus,
  IconTrash,
  IconLock,
  IconPencil,
  IconMapPin,
  IconDeviceFloppy,
} from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { getGroups, createGroup, updateGroup, deleteGroup, setGroupAreas } from '../services/api';
import { getLocations } from '../services/api/sheets';
import type { Group as GroupType } from '../services/api';
import type { GroupScope } from '../types/User';

const SCOPE_OPTIONS: { value: GroupScope; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'scoped', label: 'Scoped' },
];

/** Friendly label for a system group; Sub-Areas (system_key null) have no system tag. */
function systemLabel(systemKey: string | null): string | null {
  if (systemKey === 'operations') return 'Operations';
  if (systemKey === 'primary') return 'Primary';
  return null;
}

const notifyError = (message: string) =>
  notifications.show({ title: 'Error', message, color: 'red', icon: <IconAlertCircle size={18} /> });

const notifySuccess = (title: string, message: string) =>
  notifications.show({ title, message, color: 'green', icon: <IconCheck size={18} /> });

export default function AdminGroupManagementPage() {
  const { role, authChecked } = useUser();
  const navigate = useNavigate();

  const [groups, setGroups] = useState<GroupType[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [locations, setLocations] = useState<string[]>([]);

  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  const [scopeUpdatingId, setScopeUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Rename modal
  const [renameTarget, setRenameTarget] = useState<GroupType | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Per-group staged area edits + save state
  const [areaEdits, setAreaEdits] = useState<Record<number, string[]>>({});
  const [savingAreasId, setSavingAreasId] = useState<number | null>(null);

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'admin') navigate('/');
  }, [authChecked, role, navigate]);

  const loadGroups = useCallback(() => {
    setGroupsLoading(true);
    getGroups()
      .then((res) => {
        if (res.success && res.groups) {
          setGroups(res.groups);
          setAreaEdits({});
        }
      })
      .catch((err: Error) => notifyError(err.message))
      .finally(() => setGroupsLoading(false));
  }, []);

  useEffect(() => {
    if (role !== 'admin') return;
    loadGroups();
    getLocations()
      .then((res) => {
        if (res.success && res.locations) setLocations(res.locations);
      })
      .catch(() => setLocations([]));
  }, [role, loadGroups]);

  // Options for the area MultiSelect: the full backend location list plus any already-assigned
  // area (so an existing value set via the API always renders as a removable pill).
  const locationOptions = useMemo(() => {
    const set = new Set<string>(locations);
    groups.forEach((g) => g.areas.forEach((a) => set.add(a)));
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
  }, [locations, groups]);

  if (!authChecked) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }
  if (role !== 'admin') return null;

  const handleCreate = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createGroup(name, 'scoped');
      notifySuccess('Group created', `Sub-Area group "${name}" created.`);
      setNewGroupName('');
      loadGroups();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  const handleScopeChange = async (g: GroupType, scope: GroupScope) => {
    if (scope === g.scope) return;
    setScopeUpdatingId(g.id);
    try {
      await updateGroup(g.id, { scope });
      notifySuccess('Scope updated', `"${g.name}" is now ${scope}.`);
      loadGroups();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to update scope');
    } finally {
      setScopeUpdatingId(null);
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      await updateGroup(renameTarget.id, { name });
      notifySuccess('Group renamed', `Renamed to "${name}".`);
      setRenameTarget(null);
      loadGroups();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to rename group');
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async (g: GroupType) => {
    if (!window.confirm(`Delete group "${g.name}"? This cannot be undone.`)) return;
    setDeletingId(g.id);
    try {
      await deleteGroup(g.id);
      notifySuccess('Group deleted', `"${g.name}" was removed.`);
      loadGroups();
    } catch (err) {
      // ApiError for a non-empty group carries "N members — reassign first".
      notifyError(err instanceof Error ? err.message : 'Failed to delete group');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveAreas = async (g: GroupType) => {
    const next = areaEdits[g.id] ?? g.areas;
    setSavingAreasId(g.id);
    try {
      const res = await setGroupAreas(g.id, next);
      setGroups((prev) => prev.map((row) => (row.id === g.id ? { ...row, areas: res.areas } : row)));
      setAreaEdits((prev) => {
        const copy = { ...prev };
        delete copy[g.id];
        return copy;
      });
      notifySuccess('Areas saved', `"${g.name}" now covers ${res.areas.length} area(s).`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to save areas');
    } finally {
      setSavingAreasId(null);
    }
  };

  const scopedGroups = groups.filter((g) => g.scope === 'scoped');

  return (
    <Container size='lg' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Stack gap='lg'>
            <div>
              <Group gap='xs'>
                <IconUsersGroup size={26} />
                <Title order={1}>Group Management</Title>
              </Group>
              <Text size='sm' c='dimmed' mt='xs'>
                Groups organize staff. <strong>Operations</strong> (admins) and <strong>Primary</strong>{' '}
                (global staff) are global — they see everything. Admin-created <strong>Sub-Area</strong>{' '}
                groups are scoped: their members only see and act within the areas assigned below.
              </Text>
            </div>

            <Group align='flex-end' gap='sm' wrap='nowrap'>
              <TextInput
                label='Create a Sub-Area group'
                placeholder='e.g. Kansas Field Team'
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                style={{ flex: 1 }}
                disabled={creating}
              />
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={handleCreate}
                loading={creating}
                disabled={!newGroupName.trim()}
              >
                Create
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Title order={2} size='h3'>
            <Group gap='xs'>
              <IconUsersGroup size={20} />
              All groups
            </Group>
          </Title>
          {groupsLoading ? (
            <Center py='xl'>
              <Loader size='lg' />
            </Center>
          ) : (
            <Table.ScrollContainer minWidth={640} mt='md'>
              <Table striped highlightOnHover verticalSpacing='sm'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th style={{ width: 170 }}>Scope</Table.Th>
                    <Table.Th style={{ width: 100 }}>Members</Table.Th>
                    <Table.Th style={{ width: 170 }}> </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {groups.map((g) => {
                    const sysLabel = systemLabel(g.system_key);
                    const isOperations = g.system_key === 'operations';
                    const isSystem = g.system_key !== null;
                    return (
                      <Table.Tr key={g.id}>
                        <Table.Td>
                          <Group gap='xs' wrap='nowrap'>
                            <Text fw={500}>{g.name}</Text>
                            {sysLabel && (
                              <Badge size='xs' variant='light' color='grape'>
                                {sysLabel}
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {isOperations ? (
                            <Tooltip label='Operations must stay global' withArrow>
                              <Badge
                                color='teal'
                                variant='light'
                                leftSection={<IconLock size={11} />}
                              >
                                Global
                              </Badge>
                            </Tooltip>
                          ) : (
                            <Select
                              size='xs'
                              w={130}
                              data={SCOPE_OPTIONS}
                              value={g.scope}
                              allowDeselect={false}
                              disabled={scopeUpdatingId === g.id}
                              onChange={(v) => v && handleScopeChange(g, v as GroupScope)}
                            />
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Badge variant='light' color='blue' data-testid={`group-members-${g.name}`}>
                            {g.member_count}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap='nowrap' justify='flex-end'>
                            <Tooltip label='Rename' withArrow>
                              <ActionIcon
                                variant='subtle'
                                color='gray'
                                aria-label={`Rename ${g.name}`}
                                onClick={() => {
                                  setRenameTarget(g);
                                  setRenameValue(g.name);
                                }}
                              >
                                <IconPencil size={16} />
                              </ActionIcon>
                            </Tooltip>
                            {isSystem ? (
                              <Tooltip label='System groups cannot be deleted' withArrow>
                                <span style={{ display: 'inline-flex' }}>
                                  <ActionIcon variant='subtle' color='red' disabled aria-label='Delete (disabled)'>
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </span>
                              </Tooltip>
                            ) : (
                              <Tooltip label='Delete group' withArrow>
                                <ActionIcon
                                  variant='subtle'
                                  color='red'
                                  aria-label={`Delete ${g.name}`}
                                  loading={deletingId === g.id}
                                  onClick={() => handleDelete(g)}
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>

        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Title order={2} size='h3'>
            <Group gap='xs'>
              <IconMapPin size={20} />
              Area assignments
            </Group>
          </Title>
          <Text size='sm' c='dimmed' mt='xs' mb='md'>
            Assign one or more areas (a State folder or a State/Location path) to each Sub-Area group.
            Members are limited to these areas. Operations and Primary are global, so areas do not
            apply to them.
          </Text>
          {groupsLoading ? (
            <Center py='md'>
              <Loader />
            </Center>
          ) : scopedGroups.length === 0 ? (
            <Text size='sm' c='dimmed'>
              No scoped groups yet. Create a Sub-Area group above (or flip Primary to scoped) to assign
              areas.
            </Text>
          ) : (
            <Stack gap='md'>
              {scopedGroups.map((g) => {
                const current = areaEdits[g.id] ?? g.areas;
                const dirty = g.id in areaEdits;
                return (
                  <Paper key={g.id} withBorder radius='md' p='md' data-testid={`area-card-${g.name}`}>
                    <Stack gap='sm'>
                      <Group justify='space-between' gap='sm'>
                        <Text fw={600} size='sm'>
                          {g.name}
                        </Text>
                        <Button
                          size='xs'
                          leftSection={<IconDeviceFloppy size={14} />}
                          loading={savingAreasId === g.id}
                          disabled={!dirty}
                          onClick={() => handleSaveAreas(g)}
                        >
                          Save areas
                        </Button>
                      </Group>
                      <MultiSelect
                        data={locationOptions}
                        value={current}
                        onChange={(vals) =>
                          setAreaEdits((prev) => ({ ...prev, [g.id]: vals }))
                        }
                        placeholder={current.length === 0 ? 'No areas — select State/Location paths' : undefined}
                        searchable
                        clearable
                        nothingFoundMessage='No matching locations'
                        comboboxProps={{ withinPortal: true }}
                      />
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Paper>
      </Stack>

      <Modal
        opened={renameTarget !== null}
        onClose={() => !renaming && setRenameTarget(null)}
        title='Rename group'
        centered
        size='sm'
      >
        <Stack gap='md'>
          <TextInput
            label='Group name'
            value={renameValue}
            onChange={(e) => setRenameValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
            }}
            autoFocus
          />
          <Group justify='flex-end' gap='sm'>
            <Button variant='subtle' color='gray' onClick={() => setRenameTarget(null)} disabled={renaming}>
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              loading={renaming}
              disabled={!renameValue.trim() || renameValue.trim() === renameTarget?.name}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
