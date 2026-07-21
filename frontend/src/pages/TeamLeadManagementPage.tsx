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
  Table,
  Badge,
  Group,
  Alert,
  Tooltip,
  ActionIcon,
} from '@mantine/core';
import { useState, useEffect, useCallback } from 'react';
import {
  IconUsersGroup,
  IconAlertCircle,
  IconCheck,
  IconArrowUp,
  IconArrowDown,
  IconDoorExit,
  IconUserPlus,
  IconMapPin,
  IconCrown,
} from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import {
  getMyGroup,
  claimMember,
  setMemberRank,
  releaseMember,
  isTeamLead,
  isAdminRole,
  ApiError,
} from '../services/api';
import type { GroupMember, MyGroupResponse } from '../services/api';
import type { UserRole, GroupRole } from '../types/User';

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  staff: 'Staff',
  community: 'Community',
};

const ROLE_BADGE_COLOR: Record<UserRole, string> = {
  admin: 'red',
  staff: 'orange',
  community: 'blue',
};

/** Ladder position: community(0) → staff member(1) → staff lead(2). Admin(3) is off the ladder. */
function rankIndex(role: UserRole, groupRole: GroupRole): number {
  if (role === 'community') return 0;
  if (role === 'staff') return groupRole === 'lead' ? 2 : 1;
  return 3;
}

const notifyError = (message: string) =>
  notifications.show({ title: 'Error', message, color: 'red', icon: <IconAlertCircle size={18} /> });

const notifySuccess = (title: string, message: string) =>
  notifications.show({ title, message, color: 'green', icon: <IconCheck size={18} /> });

export default function TeamLeadManagementPage() {
  const { role, authChecked, user: currentUser } = useUser();
  const navigate = useNavigate();

  const allowed = isTeamLead(currentUser) || isAdminRole(role);

  const [data, setData] = useState<MyGroupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notALead, setNotALead] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [claimEmail, setClaimEmail] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (!authChecked) return;
    if (!allowed) navigate('/');
  }, [authChecked, allowed, navigate]);

  const loadGroup = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getMyGroup()
      .then((res) => {
        setData(res);
        setNotALead(false);
      })
      .catch((err: unknown) => {
        // Admins (and anyone not a staff lead) get 403 from /api/lead — show the empty state.
        if (err instanceof ApiError && err.status === 403) {
          setNotALead(true);
          setData(null);
        } else {
          setLoadError(err instanceof Error ? err.message : 'Failed to load your group');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!authChecked || !allowed) return;
    loadGroup();
  }, [authChecked, allowed, loadGroup]);

  if (!authChecked) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }
  if (!allowed) return null;

  const handleClaim = async () => {
    const targetEmail = claimEmail.trim();
    if (!targetEmail) return;
    setClaiming(true);
    try {
      const res = await claimMember(targetEmail);
      notifySuccess('Member claimed', `${res.user.email} joined your group.`);
      setClaimEmail('');
      loadGroup();
    } catch (err) {
      // Surfaces "Only unassigned community users can be claimed" (400) and not-found (404).
      notifyError(err instanceof Error ? err.message : 'Failed to claim member');
    } finally {
      setClaiming(false);
    }
  };

  const handleRank = async (m: GroupMember, action: 'promote' | 'demote') => {
    setActionBusyId(m.id);
    try {
      await setMemberRank(m.id, action);
      notifySuccess('Rank updated', `${m.email} ${action === 'promote' ? 'promoted' : 'demoted'}.`);
      loadGroup();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to change rank');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRelease = async (m: GroupMember) => {
    if (!window.confirm(`Release ${m.email} back to Unassigned? Staff are dropped to community.`)) return;
    setActionBusyId(m.id);
    try {
      await releaseMember(m.id);
      notifySuccess('Member released', `${m.email} moved to Unassigned.`);
      loadGroup();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to release member');
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <Container size='md' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <div>
            <Group gap='xs'>
              <IconUsersGroup size={26} />
              <Title order={1}>My Team</Title>
            </Group>
            <Text size='sm' c='dimmed' mt='xs'>
              As a Team Lead you manage your own group: claim unassigned community members, walk a
              member up or down the ladder (community ↔ staff ↔ lead), and release members back to
              Unassigned. You can only act within your own group.
            </Text>
          </div>
        </Paper>

        {loading ? (
          <Center py='xl'>
            <Loader size='lg' />
          </Center>
        ) : notALead ? (
          <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
            <Alert icon={<IconAlertCircle size={18} />} color='blue' title='No group to lead'>
              <Text size='sm'>
                You are an admin, not a Team Lead of a specific group. Manage groups, members, and
                Team Leads from the admin pages instead.
              </Text>
              <Group gap='sm' mt='md'>
                <Button size='xs' variant='light' onClick={() => navigate('/admin/groups')}>
                  Group Management
                </Button>
                <Button size='xs' variant='light' onClick={() => navigate('/admin/users')}>
                  User Management
                </Button>
              </Group>
            </Alert>
          </Paper>
        ) : loadError ? (
          <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
            <Alert icon={<IconAlertCircle size={18} />} color='red' title='Error'>
              {loadError}
            </Alert>
          </Paper>
        ) : data ? (
          <>
            <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
              <Group justify='space-between' align='flex-start' gap='sm'>
                <div>
                  <Group gap='xs'>
                    <Title order={2} size='h3'>
                      {data.group.name}
                    </Title>
                    <Badge variant='light' color={data.group.scope === 'global' ? 'teal' : 'indigo'}>
                      {data.group.scope}
                    </Badge>
                  </Group>
                  <Text size='sm' c='dimmed' mt={4}>
                    {data.members.length} member{data.members.length === 1 ? '' : 's'}
                  </Text>
                </div>
              </Group>
              {data.group.scope === 'scoped' && (
                <Stack gap={6} mt='md'>
                  <Group gap='xs'>
                    <IconMapPin size={16} />
                    <Text size='sm' fw={500}>
                      Areas
                    </Text>
                  </Group>
                  {data.areas.length === 0 ? (
                    <Text size='sm' c='dimmed'>
                      No areas assigned yet — ask an admin to assign areas on the Groups page.
                    </Text>
                  ) : (
                    <Group gap='xs'>
                      {data.areas.map((a) => (
                        <Badge key={a} variant='outline' color='indigo'>
                          {a}
                        </Badge>
                      ))}
                    </Group>
                  )}
                </Stack>
              )}
            </Paper>

            <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
              <Title order={2} size='h3'>
                <Group gap='xs'>
                  <IconUserPlus size={20} />
                  Claim a member
                </Group>
              </Title>
              <Text size='sm' c='dimmed' mt='xs' mb='md'>
                Add an existing <strong>unassigned community</strong> user to your group by email.
                They join as a plain member.
              </Text>
              <Group align='flex-end' gap='sm' wrap='nowrap'>
                <TextInput
                  label='Email'
                  placeholder='member@example.com'
                  type='email'
                  value={claimEmail}
                  onChange={(e) => setClaimEmail(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleClaim();
                  }}
                  style={{ flex: 1 }}
                  disabled={claiming}
                />
                <Button
                  leftSection={<IconUserPlus size={16} />}
                  onClick={handleClaim}
                  loading={claiming}
                  disabled={!claimEmail.trim()}
                >
                  Claim
                </Button>
              </Group>
            </Paper>

            <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
              <Title order={2} size='h3'>
                <Group gap='xs'>
                  <IconUsersGroup size={20} />
                  Members
                </Group>
              </Title>
              <Table.ScrollContainer minWidth={640} mt='md'>
                <Table striped highlightOnHover verticalSpacing='sm'>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Email</Table.Th>
                      <Table.Th style={{ width: 140 }}>Name</Table.Th>
                      <Table.Th style={{ width: 160 }}>Rank</Table.Th>
                      <Table.Th style={{ width: 150 }}> </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.members.map((m) => {
                      const isSelf = m.id === currentUser?.id;
                      const isAdmin = m.role === 'admin';
                      const idx = rankIndex(m.role, m.group_role);
                      const busy = actionBusyId === m.id;
                      const canPromote = !isSelf && !isAdmin && idx < 2;
                      const canDemote = !isSelf && !isAdmin && idx > 0;
                      const canRelease = !isSelf && !isAdmin;
                      return (
                        <Table.Tr key={m.id}>
                          <Table.Td>
                            <Group gap={6} wrap='nowrap'>
                              {m.email}
                              {isSelf && (
                                <Badge size='xs' variant='light' color='gray'>
                                  you
                                </Badge>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>{m.name || '—'}</Table.Td>
                          <Table.Td>
                            <Group gap={6} wrap='nowrap'>
                              <Badge variant='light' color={ROLE_BADGE_COLOR[m.role]}>
                                {ROLE_LABEL[m.role]}
                              </Badge>
                              {m.group_role === 'lead' && (
                                <Badge
                                  size='xs'
                                  color='grape'
                                  variant='filled'
                                  leftSection={<IconCrown size={10} />}
                                >
                                  Lead
                                </Badge>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap='nowrap' justify='flex-end'>
                              <Tooltip label='Promote' withArrow>
                                <ActionIcon
                                  variant='subtle'
                                  color='green'
                                  aria-label={`Promote ${m.email}`}
                                  disabled={!canPromote || busy}
                                  loading={busy}
                                  onClick={() => handleRank(m, 'promote')}
                                >
                                  <IconArrowUp size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label='Demote' withArrow>
                                <ActionIcon
                                  variant='subtle'
                                  color='orange'
                                  aria-label={`Demote ${m.email}`}
                                  disabled={!canDemote || busy}
                                  onClick={() => handleRank(m, 'demote')}
                                >
                                  <IconArrowDown size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label='Release to Unassigned' withArrow>
                                <ActionIcon
                                  variant='subtle'
                                  color='red'
                                  aria-label={`Release ${m.email}`}
                                  disabled={!canRelease || busy}
                                  onClick={() => handleRelease(m)}
                                >
                                  <IconDoorExit size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </>
        ) : null}
      </Stack>
    </Container>
  );
}
