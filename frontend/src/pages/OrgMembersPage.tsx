import { useCallback, useEffect, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconMail, IconTrash } from '@tabler/icons-react';
import type { OrgOption } from '../hooks/useActiveOrg';
import { useUser } from '../hooks/useUser';
import { useAppDispatch } from '../store/hooks';
import { refreshMyOrgs } from '../store/orgActions';
import {
  addOrgMember,
  getOrgMembers,
  removeOrgMember,
  revokeOrgInvitation,
  setOrgMemberRole,
  updateOrg,
  type OrgInvitation,
  type OrgMember,
  type OrgMemberRole,
  type Organization,
} from '../services/api/orgs';
import { formatLocalDate as formatDate } from '../utils/formatLocalDate';

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
];

/**
 * User management of a database-backed research group (members, invitations, community uploads).
 * Rendered by AdminUserManagementPage when such a group is active; the caller checks admin rights.
 */
export default function OrgMembersPage({ org }: { org: OrgOption }) {
  const dispatch = useAppDispatch();
  const { user } = useUser();
  const [details, setDetails] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgMemberRole>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgId = org.id;

  const load = useCallback(async () => {
    const res = await getOrgMembers(orgId);
    setDetails(res.org);
    setMembers(res.members);
    setInvitations(res.invitations);
  }, [orgId]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      if (success) notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: 'Done', message: success });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Action failed', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    act(async () => {
      const res = await addOrgMember(orgId, email.trim(), role);
      setEmail('');
      notifications.show({
        color: 'green',
        title: res.status === 'added' ? 'Member added' : 'Invitation sent',
        message:
          res.status === 'added'
            ? `${res.email} already had an account and was added.`
            : `An invitation email was sent to ${res.email}.`,
      });
    });

  return (
    <Container size='md' py='md'>
      <Stack gap='md'>
        <Title order={2}>Members of {details?.name ?? org.name}</Title>
        {error && <Text c='red'>{error}</Text>}

        {details && (
          <Paper withBorder p='md' radius='md'>
            <Switch
              label='Accept photos from the community'
              description='When on, anyone can pick this group on the upload page and send carapace photos for review.'
              checked={details.accepts_community}
              disabled={busy}
              onChange={(e) => {
                const accepts = e.currentTarget.checked;
                act(async () => {
                  await updateOrg(orgId, { accepts_community: accepts });
                  await refreshMyOrgs(dispatch);
                });
              }}
            />
          </Paper>
        )}

        <Paper withBorder p='md' radius='md'>
          <Stack gap='xs'>
            <Text fw={500}>Add a member</Text>
            <Text size='sm' c='dimmed'>
              Existing accounts are added right away; everybody else receives an invitation email.
            </Text>
            <Group align='flex-end'>
              <TextInput
                label='Email'
                type='email'
                placeholder='colleague@university.edu'
                leftSection={<IconMail size={14} />}
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Select label='Role' data={ROLE_OPTIONS} value={role} allowDeselect={false} onChange={(v) => setRole((v || 'staff') as OrgMemberRole)} w={120} />
              <Button disabled={!email.trim()} loading={busy} onClick={invite} data-testid='org-invite-member'>
                Add
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder radius='md'>
          <Table verticalSpacing='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Member</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Since</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>
                    <Text size='sm'>{m.name || m.email}</Text>
                    {m.name && <Text size='xs' c='dimmed'>{m.email}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size='xs'
                      w={110}
                      data={ROLE_OPTIONS}
                      value={m.role}
                      allowDeselect={false}
                      disabled={busy}
                      onChange={(v) => v && v !== m.role && act(() => setOrgMemberRole(orgId, m.id, v as OrgMemberRole), 'Role updated')}
                    />
                  </Table.Td>
                  <Table.Td>{formatDate(m.created_at)}</Table.Td>
                  <Table.Td>
                    {m.id !== user?.id && (
                      <ActionIcon variant='subtle' color='red' aria-label='Remove member' disabled={busy} onClick={() => act(() => removeOrgMember(orgId, m.id), 'Member removed')}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
              {invitations.map((i) => (
                <Table.Tr key={`inv-${i.id}`}>
                  <Table.Td>
                    <Text size='sm'>{i.email}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size='sm' variant='light'>
                      Invited · {i.role}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs' c='dimmed'>expires {formatDate(i.expires_at)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant='subtle' color='red' aria-label='Revoke invitation' disabled={busy} onClick={() => act(() => revokeOrgInvitation(orgId, i.id), 'Invitation revoked')}>
                      <IconTrash size={14} />
                    </ActionIcon>
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
