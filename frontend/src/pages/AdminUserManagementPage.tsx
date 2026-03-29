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
import { useState, useEffect, useMemo } from 'react';
import {
  IconMail,
  IconShield,
  IconAlertCircle,
  IconCheck,
  IconUsers,
  IconTrash,
} from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { useNavigate } from 'react-router-dom';
import { promoteToAdmin, getUsers, setUserRole, deleteUser } from '../services/api';
import type { UserRole } from '../services/api';
import { notifications } from '@mantine/notifications';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'community', label: 'Community' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
];

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

type UserRow = { id: number; email: string; name: string | null; role: UserRole; created_at: string };

export default function AdminUserManagementPage() {
  const { role, authChecked, user: currentUser } = useUser();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [updatingRoleId, setUpdatingRoleId] = useState<number | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);

  useEffect(() => {
    if (!authChecked) return;
    if (role !== 'admin') {
      navigate('/');
    }
  }, [authChecked, role, navigate]);

  useEffect(() => {
    if (role !== 'admin') return;
    setUsersLoading(true);
    getUsers()
      .then((res) => {
        if (res.success && res.users) setUsers(res.users);
      })
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, [role]);

  const usersByRole = useMemo(() => {
    const map: Record<UserRole, UserRow[]> = {
      admin: [],
      staff: [],
      community: [],
    };
    users.forEach((u) => map[u.role].push(u));
    return ROLE_ORDER.map((r) => ({ role: r, list: map[r] }));
  }, [users]);

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
      notifications.show({
        title: 'Success!',
        message: result.message,
        color: 'green',
        icon: <IconCheck size={18} />,
      });
      setEmail('');
      getUsers().then((res) => res.success && res.users && setUsers(res.users));
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to promote user to admin';
      setError(errorMessage);
      notifications.show({
        title: 'Error',
        message: errorMessage,
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: number, newRole: UserRole) => {
    setUpdatingRoleId(userId);
    try {
      await setUserRole(userId, newRole);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
      );
      notifications.show({
        title: 'Role updated',
        message: `User role set to ${newRole}`,
        color: 'green',
        icon: <IconCheck size={18} />,
      });
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to update role',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleDeleteUser = async (u: UserRow) => {
    const ok = window.confirm(
      `Permanently delete account ${u.email}? They can register again with the same email.`,
    );
    if (!ok) return;
    setDeletingUserId(u.id);
    try {
      await deleteUser(u.id);
      setUsers((prev) => prev.filter((row) => row.id !== u.id));
      notifications.show({
        title: 'User deleted',
        message: `${u.email} was removed.`,
        color: 'green',
        icon: <IconCheck size={18} />,
      });
    } catch (err) {
      notifications.show({
        title: 'Could not delete user',
        message: err instanceof Error ? err.message : 'Delete failed',
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setDeletingUserId(null);
    }
  };

  return (
    <Container size='md' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Stack gap='lg'>
            <div>
              <Title order={1}>User Management</Title>
              <Text size='sm' c='dimmed' mt='xs'>
                Promote a user to admin by email (or invite new users). Only admins can
                access this page and change user roles. Staff have the same app access as
                admins but cannot manage users.
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

        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
          <Title order={2} size='h3'>
            <Group gap='xs'>
              <IconUsers size={20} />
              All users by role
            </Group>
          </Title>
          <Text size='sm' c='dimmed' mt='xs' mb='md'>
            Change a user&apos;s role: Community (default), Staff (admin-like, no user
            management), Admin (full access including this page). Delete removes the account so
            the same email can register again (you cannot delete yourself or the last admin).
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
                    <Badge
                      color={ROLE_BADGE_COLOR[roleKey]}
                      size='lg'
                      variant='light'
                    >
                      {ROLE_LABEL[roleKey]} ({list.length})
                    </Badge>
                  </Group>
                  {list.length === 0 ? (
                    <Text size='sm' c='dimmed'>
                      No users with this role.
                    </Text>
                  ) : (
                    <Table striped highlightOnHover style={{ tableLayout: 'fixed' }}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th style={{ width: '36%' }}>Email</Table.Th>
                          <Table.Th style={{ width: '26%' }}>Name</Table.Th>
                          <Table.Th style={{ width: 180 }}>Change role</Table.Th>
                          <Table.Th style={{ width: 100 }}> </Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {list.map((u) => (
                          <Table.Tr key={u.id}>
                            <Table.Td style={{ width: '40%' }}>{u.email}</Table.Td>
                            <Table.Td style={{ width: '30%' }}>{u.name || '—'}</Table.Td>
                            <Table.Td style={{ width: 180, verticalAlign: 'middle' }}>
                              <Group gap='xs' wrap='nowrap' align='center'>
                                <Select
                                  size='xs'
                                  w={140}
                                  data={ROLE_OPTIONS}
                                  value={u.role}
                                  onChange={(v) =>
                                    v && handleRoleChange(u.id, v as UserRole)
                                  }
                                  disabled={updatingRoleId === u.id}
                                />
                                {updatingRoleId === u.id && (
                                  <Loader size='xs' />
                                )}
                              </Group>
                            </Table.Td>
                            <Table.Td style={{ width: 100, verticalAlign: 'middle' }}>
                              <Button
                                size='xs'
                                variant='subtle'
                                color='red'
                                leftSection={<IconTrash size={14} />}
                                loading={deletingUserId === u.id}
                                disabled={
                                  deletingUserId !== null ||
                                  u.id === currentUser?.id
                                }
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
