import {
  Container,
  Title,
  Text,
  Stack,
  Paper,
  TextInput,
  Button,
  Alert,
  Loader,
  Center,
  Select,
  Table,
  Badge,
  Group,
} from '@mantine/core';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  IconMail,
  IconShield,
  IconAlertCircle,
  IconCheck,
  IconUsers,
  IconTrash,
  IconUserQuestion,
} from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { useNavigate } from 'react-router-dom';
import {
  promoteToAdmin,
  getUsers,
  setUserRole,
  deleteUser,
  getGroups,
  setUserMembership,
} from '../services/api';
import type { UserRole, AdminUserRow, Group as GroupType } from '../services/api';
import type { GroupRole } from '../types/User';
import { notifications } from '@mantine/notifications';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'community', label: 'Community' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
];

const RANK_OPTIONS: { value: GroupRole; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'lead', label: 'Lead' },
];

const UNASSIGNED_VALUE = 'none';

/** Display order: admin first, then staff, then community */
const ROLE_ORDER: UserRole[] = ['admin', 'staff', 'community'];

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

const notifyError = (message: string) =>
  notifications.show({ title: 'Error', message, color: 'red', icon: <IconAlertCircle size={18} /> });

const notifySuccess = (title: string, message: string) =>
  notifications.show({ title, message, color: 'green', icon: <IconCheck size={18} /> });

/**
 * Group + rank controls for one user row. The Group select is the one-step "move to any group"
 * path; the Rank select appears only when the user is in a group and can hold a lead (staff/admin).
 */
function MembershipControls({
  user,
  groups,
  busy,
  isSelf,
  onMove,
  onRank,
}: {
  user: AdminUserRow;
  groups: GroupType[];
  busy: boolean;
  isSelf: boolean;
  onMove: (u: AdminUserRow, groupId: number | null) => void;
  onRank: (u: AdminUserRow, rank: GroupRole) => void;
}) {
  const inGroup = user.group_id != null;
  const canLead = user.role === 'staff' || user.role === 'admin';
  const groupOptions = [
    { value: UNASSIGNED_VALUE, label: 'Unassigned' },
    ...groups.map((g) => ({ value: String(g.id), label: g.name })),
  ];
  // Editing your own membership can revoke your own token (demoting yourself out
  // of lead, or releasing yourself to Unassigned bumps tokens_valid_after), which
  // would 403 every subsequent request and wedge the session. Another admin must
  // make the change — mirrors the self-guard on the Delete button.
  const selfTitle = isSelf ? 'Ask another admin to change your own group or rank' : undefined;
  return (
    <Stack gap={6}>
      <Select
        size='xs'
        w={150}
        data={groupOptions}
        value={user.group_id == null ? UNASSIGNED_VALUE : String(user.group_id)}
        allowDeselect={false}
        disabled={busy || isSelf}
        title={selfTitle}
        onChange={(v) => v && onMove(user, v === UNASSIGNED_VALUE ? null : Number(v))}
        aria-label={`Move ${user.email} to a group`}
      />
      {inGroup && canLead && (
        <Select
          size='xs'
          w={150}
          data={RANK_OPTIONS}
          value={user.group_role === 'lead' ? 'lead' : 'member'}
          allowDeselect={false}
          disabled={busy || isSelf}
          title={selfTitle}
          onChange={(v) => v && onRank(user, v as GroupRole)}
          aria-label={`Set ${user.email} rank`}
        />
      )}
    </Stack>
  );
}

export default function AdminUserManagementPage() {
  const { role, authChecked, user: currentUser } = useUser();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [groups, setGroups] = useState<GroupType[]>([]);
  const [updatingRoleId, setUpdatingRoleId] = useState<number | null>(null);
  const [membershipBusyId, setMembershipBusyId] = useState<number | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'admin') {
      navigate('/');
    }
  }, [authChecked, role, navigate]);

  const refetchUsers = useCallback(() => {
    // On a refetch error (e.g. this admin's token was just revoked by a concurrent
    // change), keep the last-known list rather than blanking every table — a wiped
    // page with a success toast reads as data loss. AuthProvider handles a genuinely
    // invalid token on the next mount; a real load failure surfaces via notifyError.
    return getUsers()
      .then((res) => {
        if (res.success && res.users) setUsers(res.users);
      })
      .catch((err) => {
        notifyError(err instanceof Error ? err.message : 'Could not refresh the user list');
      });
  }, []);

  useEffect(() => {
    if (role !== 'admin') return;
    setUsersLoading(true);
    refetchUsers().finally(() => setUsersLoading(false));
    getGroups()
      .then((res) => res.success && res.groups && setGroups(res.groups))
      .catch(() => setGroups([]));
  }, [role, refetchUsers]);

  const usersByRole = useMemo(() => {
    const map: Record<UserRole, AdminUserRow[]> = {
      admin: [],
      staff: [],
      community: [],
    };
    users.forEach((u) => map[u.role].push(u));
    return ROLE_ORDER.map((r) => ({ role: r, list: map[r] }));
  }, [users]);

  const unassignedUsers = useMemo(() => users.filter((u) => u.group_id == null), [users]);

  if (!authChecked) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }
  if (role !== 'admin') {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await promoteToAdmin(email);
      notifySuccess('Success!', result.message);
      setEmail('');
      refetchUsers();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to promote user to admin';
      setError(errorMessage);
      notifyError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: number, newRole: UserRole) => {
    setUpdatingRoleId(userId);
    try {
      await setUserRole(userId, newRole);
      // Role changes can affect membership eligibility (e.g. lead requires staff), so refetch.
      await refetchUsers();
      notifySuccess('Role updated', `User role set to ${newRole}`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleMove = async (u: AdminUserRow, groupId: number | null) => {
    if ((u.group_id ?? null) === groupId) return;
    setMembershipBusyId(u.id);
    try {
      await setUserMembership(u.id, { group_id: groupId });
      const dest = groupId == null ? 'Unassigned' : groups.find((g) => g.id === groupId)?.name ?? 'group';
      await refetchUsers();
      notifySuccess('Membership updated', `${u.email} moved to ${dest}.`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to move user');
    } finally {
      setMembershipBusyId(null);
    }
  };

  const handleRank = async (u: AdminUserRow, rank: GroupRole) => {
    if ((u.group_role === 'lead' ? 'lead' : 'member') === rank) return;
    setMembershipBusyId(u.id);
    try {
      await setUserMembership(u.id, { group_id: u.group_id, group_role: rank });
      await refetchUsers();
      notifySuccess('Rank updated', `${u.email} is now ${rank}.`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to change rank');
    } finally {
      setMembershipBusyId(null);
    }
  };

  const handleDeleteUser = async (u: AdminUserRow) => {
    const ok = window.confirm(
      `Permanently delete account ${u.email}? They can register again with the same email.`,
    );
    if (!ok) return;
    setDeletingUserId(u.id);
    try {
      await deleteUser(u.id);
      setUsers((prev) => prev.filter((row) => row.id !== u.id));
      notifySuccess('User deleted', `${u.email} was removed.`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingUserId(null);
    }
  };

  const renderGroupBadge = (u: AdminUserRow) => (
    <Group gap={6} wrap='nowrap'>
      <Badge variant='light' color={u.group_id == null ? 'gray' : 'grape'}>
        {u.group_name ?? 'Unassigned'}
      </Badge>
      {u.group_role === 'lead' && (
        <Badge size='xs' color='grape' variant='filled'>
          Lead
        </Badge>
      )}
    </Group>
  );

  return (
    <Container size='lg' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Stack gap='lg'>
            <div>
              <Title order={1}>User Management</Title>
              <Text size='sm' c='dimmed' mt='xs'>
                Promote a user to admin by email (or invite new users). Only admins can
                access this page and change user roles or group membership. Staff have the same
                app access as admins but cannot manage users.
              </Text>
            </div>

            {error && (
              <Alert icon={<IconAlertCircle size={16} />} title='Error' color='red'>
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <Stack gap='md'>
                <TextInput
                  label='Email Address'
                  placeholder='user@example.com'
                  leftSection={<IconMail size={16} />}
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  required
                  type='email'
                  disabled={loading}
                  description='Promote to admin (or send invitation if no account)'
                />

                <Button
                  type='submit'
                  leftSection={<IconShield size={16} />}
                  disabled={!email || loading}
                  loading={loading}
                  color='red'
                  fullWidth
                  size='md'
                >
                  {loading ? 'Promoting...' : 'Promote to Admin'}
                </Button>
              </Stack>
            </form>

            <Alert icon={<IconAlertCircle size={16} />} title='How it works' color='blue'>
              <Text size='sm'>
                <strong>Existing users:</strong> Promoted immediately and receive a
                notification email.
                <br />
                <br />
                <strong>New users:</strong> Receive an invitation email; when they register
                with that link, their account is created as admin.
              </Text>
            </Alert>
          </Stack>
        </Paper>

        {/* Unassigned strays — quick view of everyone with no group. */}
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder data-testid='unassigned-users-section'>
          <Title order={2} size='h3'>
            <Group gap='xs'>
              <IconUserQuestion size={20} />
              Unassigned users ({unassignedUsers.length})
            </Group>
          </Title>
          <Text size='sm' c='dimmed' mt='xs' mb='md'>
            Users not in any group. New community members land here; a stray staff/admin without a
            group is easy to spot and can be moved into one in a single step.
          </Text>
          {usersLoading ? (
            <Center py='md'>
              <Loader />
            </Center>
          ) : unassignedUsers.length === 0 ? (
            <Text size='sm' c='dimmed'>
              Everyone is assigned to a group.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={620}>
              <Table striped highlightOnHover verticalSpacing='sm'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Email</Table.Th>
                    <Table.Th style={{ width: 110 }}>Role</Table.Th>
                    <Table.Th style={{ width: 190 }}>Move to group</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {unassignedUsers.map((u) => (
                    <Table.Tr key={u.id}>
                      <Table.Td>{u.email}</Table.Td>
                      <Table.Td>
                        <Badge variant='light' color={ROLE_BADGE_COLOR[u.role]}>
                          {ROLE_LABEL[u.role]}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <MembershipControls
                          user={u}
                          groups={groups}
                          busy={membershipBusyId === u.id}
                          isSelf={u.id === currentUser?.id}
                          onMove={handleMove}
                          onRank={handleRank}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>

        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Title order={2} size='h3'>
            <Group gap='xs'>
              <IconUsers size={20} />
              All users by role
            </Group>
          </Title>
          <Text size='sm' c='dimmed' mt='xs' mb='md'>
            Change a user&apos;s role: Community (default), Staff (admin-like, no user
            management), Admin (full access including this page). Use <strong>Group</strong> to move a
            user into any group in one step and set their rank (Member / Lead). Delete removes the
            account so the same email can register again (you cannot delete yourself or the last admin).
          </Text>
          {usersLoading ? (
            <Center py='xl'>
              <Loader size='lg' />
            </Center>
          ) : (
            <Stack gap='xl'>
              {usersByRole.map(({ role: roleKey, list }) => (
                <Stack key={roleKey} gap='xs'>
                  <Group gap='xs'>
                    <Badge color={ROLE_BADGE_COLOR[roleKey]} size='lg' variant='light'>
                      {ROLE_LABEL[roleKey]} ({list.length})
                    </Badge>
                  </Group>
                  {/* The per-role <Table> must stay a direct sibling of the badge <Group> above:
                      staff-and-user-management.spec.ts selects it via
                      //table[preceding-sibling::*[1][contains(.,'Staff (')]]. Don't wrap it. */}
                  {list.length === 0 ? (
                    <Text size='sm' c='dimmed'>
                      No users with this role.
                    </Text>
                  ) : (
                    <Table striped highlightOnHover verticalSpacing='sm'>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Email</Table.Th>
                          <Table.Th style={{ width: 150 }}>Name</Table.Th>
                          <Table.Th style={{ width: 150 }}>Change role</Table.Th>
                          <Table.Th style={{ width: 190 }}>Group</Table.Th>
                          <Table.Th style={{ width: 90 }}> </Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {list.map((u) => (
                          <Table.Tr key={u.id}>
                            <Table.Td>{u.email}</Table.Td>
                            <Table.Td>{u.name || '—'}</Table.Td>
                            <Table.Td>
                              <Group gap='xs' wrap='nowrap' align='center'>
                                <Select
                                  size='xs'
                                  w={130}
                                  data={ROLE_OPTIONS}
                                  value={u.role}
                                  allowDeselect={false}
                                  onChange={(v) => v && handleRoleChange(u.id, v as UserRole)}
                                  disabled={updatingRoleId === u.id}
                                />
                                {updatingRoleId === u.id && <Loader size='xs' />}
                              </Group>
                            </Table.Td>
                            <Table.Td>
                              <Stack gap={6}>
                                {renderGroupBadge(u)}
                                <MembershipControls
                                  user={u}
                                  groups={groups}
                                  busy={membershipBusyId === u.id}
                                  isSelf={u.id === currentUser?.id}
                                  onMove={handleMove}
                                  onRank={handleRank}
                                />
                              </Stack>
                            </Table.Td>
                            <Table.Td>
                              <Button
                                size='xs'
                                variant='subtle'
                                color='red'
                                leftSection={<IconTrash size={14} />}
                                loading={deletingUserId === u.id}
                                disabled={deletingUserId !== null || u.id === currentUser?.id}
                                onClick={() => handleDeleteUser(u)}
                              >
                                Delete
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
