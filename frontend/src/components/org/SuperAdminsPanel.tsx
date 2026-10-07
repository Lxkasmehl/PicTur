import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconShieldPlus, IconTrash } from '@tabler/icons-react';
import { useUser } from '../../hooks/useUser';
import { useAppDispatch } from '../../store/hooks';
import { refreshMyOrgs } from '../../store/orgActions';
import { addSuperAdmin, listSuperAdmins, removeSuperAdmin, type SuperAdmin } from '../../services/api/orgs';

/** Super admins: who they are, promote an account by email, revoke the role again. */
export function SuperAdminsPanel() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useUser();
  const [admins, setAdmins] = useState<SuperAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SuperAdmin | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    listSuperAdmins()
      .then((list) => {
        setAdmins(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const add = async () => {
    setAdding(true);
    try {
      setAdmins(await addSuperAdmin(email.trim()));
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: 'Super admin added', message: `${email.trim()} is now a super admin.` });
      setEmail('');
      setConfirmAdd(false);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not add super admin', message: (e as Error).message });
    } finally {
      setAdding(false);
    }
  };

  const remove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const res = await removeSuperAdmin(removeTarget.id);
      setAdmins(res.super_admins);
      setRemoveTarget(null);
      notifications.show({ color: 'green', title: 'Super admin removed', message: `${removeTarget.email} is no longer a super admin.` });
      if (res.self) {
        await refreshMyOrgs(dispatch);
        navigate('/');
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not remove super admin', message: (e as Error).message });
    } finally {
      setRemoving(false);
    }
  };

  const onlyOneRemovable = (admins?.length ?? 0) <= 1;

  return (
    <Paper withBorder radius='md' p='md'>
      <Stack gap='sm'>
        <div>
          <Text fw={500}>Super admins</Text>
          <Text size='sm' c='dimmed'>
            Everyone who can create research groups and act as admin in all of them.
          </Text>
        </div>

        {error && <Alert color='red'>{error}</Alert>}
        {admins === null && !error ? (
          <Center py='sm'>
            <Loader size='sm' />
          </Center>
        ) : (
          <Stack gap={6} data-testid='super-admin-list'>
            {admins?.map((a) => {
              const isSelf = a.id === user?.id;
              const blockedReason = a.from_env
                ? 'Set in the server configuration (SUPER_ADMIN_EMAILS); remove it there.'
                : onlyOneRemovable
                  ? 'The last super admin cannot be removed.'
                  : null;
              return (
                <Group key={a.id} justify='space-between' wrap='nowrap'>
                  <div style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Text size='sm' fw={500} truncate>
                        {a.name || a.email}
                      </Text>
                      {isSelf && <Badge size='xs' variant='light'>you</Badge>}
                      {a.from_env && (
                        <Badge size='xs' variant='light' color='gray'>
                          server config
                        </Badge>
                      )}
                    </Group>
                    {a.name && (
                      <Text size='xs' c='dimmed' truncate>
                        {a.email}
                      </Text>
                    )}
                  </div>
                  <Tooltip label={blockedReason ?? `Remove super admin rights from ${a.email}`} multiline w={240}>
                    <ActionIcon
                      color='red'
                      variant='light'
                      disabled={!!blockedReason}
                      onClick={() => setRemoveTarget(a)}
                      aria-label={`Remove super admin ${a.email}`}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              );
            })}
          </Stack>
        )}

        <Group align='flex-end' gap='sm'>
          <TextInput
            style={{ flex: 1, minWidth: 200 }}
            label='Promote to super admin'
            description='The person needs an account already (they can register on the login page).'
            placeholder='email@example.org'
            type='email'
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <Button
            leftSection={<IconShieldPlus size={16} />}
            disabled={!email.trim()}
            onClick={() => setConfirmAdd(true)}
            data-testid='super-admin-add'
          >
            Promote
          </Button>
        </Group>
      </Stack>

      <Modal opened={confirmAdd} onClose={() => !adding && setConfirmAdd(false)} title='Make super admin?' centered>
        <Stack gap='md'>
          <Text size='sm'>
            <b>{email.trim()}</b> will be able to create research groups, act as admin in <b>every</b> group
            (including all turtle data and members) and manage super admins.
          </Text>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setConfirmAdd(false)} disabled={adding}>
              Cancel
            </Button>
            <Button color='grape' onClick={add} loading={adding}>
              Make super admin
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!removeTarget} onClose={() => !removing && setRemoveTarget(null)} title='Remove super admin?' centered>
        <Stack gap='md'>
          <Text size='sm'>
            {removeTarget?.id === user?.id ? (
              <>You will lose super admin rights right away and leave this page.</>
            ) : (
              <>
                <b>{removeTarget?.email}</b> will no longer be a super admin.
              </>
            )}{' '}
            The account and its roles in research groups stay as they are.
          </Text>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setRemoveTarget(null)} disabled={removing}>
              Cancel
            </Button>
            <Button color='red' onClick={remove} loading={removing}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
