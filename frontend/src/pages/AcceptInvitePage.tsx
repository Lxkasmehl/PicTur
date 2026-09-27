import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Center,
  Container,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { useAppDispatch } from '../store/hooks';
import { setActiveOrg } from '../store/slices/orgSlice';
import { refreshMyOrgs } from '../store/orgActions';
import { getCurrentUser, register } from '../services/api';
import { acceptOrgInvitation, getOrgInvitation, type OrgInvitationDetails } from '../services/api/orgs';
import { meetsAllRequirements, PASSWORD_MIN_LENGTH } from '../utils/passwordStrength';

/**
 * Landing page of research-group invitation emails (/accept-invite?token=...).
 * New users register right here (email is fixed and counts as verified); existing users log in
 * with the invited address and accept.
 */
export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { user, isLoggedIn, authChecked, setUser } = useUser();
  const [invite, setInvite] = useState<OrgInvitationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('The invitation link is incomplete.');
      return;
    }
    getOrgInvitation(token).then(setInvite).catch((e) => setError((e as Error).message));
  }, [token]);

  const finish = async (slug: string) => {
    await refreshMyOrgs(dispatch);
    dispatch(setActiveOrg(slug));
    notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: 'Welcome!', message: `You joined ${invite?.org.name}.` });
    navigate(`/g/${slug}`);
  };

  const accept = async () => {
    setBusy(true);
    try {
      const res = await acceptOrgInvitation(token);
      await finish(res.org.slug);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const registerAndJoin = async () => {
    if (!invite) return;
    if (!meetsAllRequirements(password)) {
      notifications.show({
        color: 'red',
        title: 'Password too weak',
        message: `Use at least ${PASSWORD_MIN_LENGTH} characters with upper- and lowercase letters, a number and a symbol.`,
      });
      return;
    }
    setBusy(true);
    try {
      await register({ email: invite.email, password, name: name.trim() || undefined, org_invite_token: token });
      const me = await getCurrentUser();
      if (me) setUser(me);
      await finish(invite.org.slug);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Registration failed', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Container size='xs' py='xl'>
        <Alert color='red' icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      </Container>
    );
  }
  if (!invite || !authChecked) {
    return (
      <Center py='xl'>
        <Loader />
      </Center>
    );
  }

  const roleLabel = invite.role === 'admin' ? 'Admin' : 'Staff';
  const emailMatches = user?.email?.toLowerCase() === invite.email.toLowerCase();

  return (
    <Container size='xs' py='xl'>
      <Paper withBorder p='lg' radius='md'>
        <Stack gap='md'>
          <Title order={3}>Join {invite.org.name}</Title>
          <Text>
            You were invited as <b>{roleLabel}</b> ({invite.email}).
          </Text>

          {isLoggedIn && emailMatches && (
            <Button onClick={accept} loading={busy} data-testid='accept-invite'>
              Accept invitation
            </Button>
          )}

          {isLoggedIn && !emailMatches && (
            <Alert color='orange'>
              You are logged in as {user?.email}. Log out and sign in as {invite.email} to accept this invitation.
            </Alert>
          )}

          {!isLoggedIn && invite.has_account && (
            <Stack gap='xs'>
              <Text size='sm'>You already have an account. Log in with {invite.email}, then open this link again.</Text>
              <Button component={Link} to={`/login?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`}>
                Log in
              </Button>
            </Stack>
          )}

          {!isLoggedIn && !invite.has_account && (
            <Stack gap='sm'>
              <TextInput label='Email' value={invite.email} disabled />
              <TextInput label='Name (optional)' value={name} onChange={(e) => setName(e.currentTarget.value)} />
              <PasswordInput label='Choose a password' value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
              <Button onClick={registerAndJoin} loading={busy} disabled={!password} data-testid='accept-invite-register'>
                Create account and join
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
