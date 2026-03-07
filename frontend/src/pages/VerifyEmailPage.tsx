import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  Text,
  Button,
  Stack,
  Alert,
  Loader,
  Group,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconMail, IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { verifyEmail, resendVerificationEmail } from '../services/api';
import { useUser } from '../hooks/useUser';

export default function VerifyEmailPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { login: setUserLogin, user } = useUser();
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error' | 'timeout'>('idle');
  const [resendLoading, setResendLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const successHandledRef = useRef(false);
  const VERIFY_TIMEOUT_MS = 15000;

  // If we have a token in URL, verify it (only once per token; ignore duplicate errors from Strict Mode / double submit)
  useEffect(() => {
    if (!token) return;
    if (successHandledRef.current) return;

    setStatus('verifying');
    setErrorMessage(null);

    const timeoutId = setTimeout(() => {
      if (successHandledRef.current) return;
      setStatus('timeout');
      setErrorMessage(
        'Verification is taking longer than expected. The link may be invalid or the server is not reachable.'
      );
    }, VERIFY_TIMEOUT_MS);

    verifyEmail(token)
      .then((response) => {
        clearTimeout(timeoutId);
        if (successHandledRef.current) return;
        successHandledRef.current = true;
        setStatus('success');
        if (response.user) {
          setUserLogin({
            ...response.user,
            email_verified: true,
          });
        }
        notifications.show({
          title: 'Email verified',
          message: 'Your email has been verified. You can use all features now.',
          color: 'green',
          icon: <IconCheck size={18} />,
        });
        setTimeout(() => navigate('/', { replace: true }), 1500);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (successHandledRef.current) return;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Verification failed');
      });

    return () => clearTimeout(timeoutId);
  }, [token, setUserLogin, navigate]);

  const handleResend = async () => {
    setResendLoading(true);
    setErrorMessage(null);
    try {
      await resendVerificationEmail();
      notifications.show({
        title: 'Email sent',
        message: 'Check your inbox for a new verification link.',
        color: 'green',
        icon: <IconMail size={18} />,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resend';
      setErrorMessage(msg);
      notifications.show({
        title: 'Could not resend',
        message: msg,
        color: 'red',
        icon: <IconAlertCircle size={18} />,
      });
    } finally {
      setResendLoading(false);
    }
  };

  // Page when we have a token: show verifying / success / error / timeout
  if (token) {
    const isPending = status === 'idle' || status === 'verifying';

    return (
      <Container size='sm' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
        <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md'>
          <Stack gap='md'>
            <Title order={2} ta='center'>
              Verify your email
            </Title>

            {isPending && (
              <Group justify='center' gap='xs'>
                <Loader size='sm' />
                <Text size='sm'>Verifying your email…</Text>
              </Group>
            )}

            {status === 'success' && (
              <Alert color='green' icon={<IconCheck size={16} />}>
                Your email has been verified. Redirecting…
              </Alert>
            )}

            {(status === 'error' || status === 'timeout') && (
              <>
                <Alert
                  color='red'
                  icon={<IconAlertCircle size={16} />}
                  title={status === 'timeout' ? 'Verification timed out' : 'Verification failed'}
                >
                  {errorMessage}
                </Alert>
                <Text size='sm' c='dimmed'>
                  The link may have expired or the server could not be reached. You can request a
                  new link below or continue to the start page.
                </Text>
                {user && !user.email_verified && (
                  <Button
                    variant='light'
                    leftSection={<IconMail size={16} />}
                    loading={resendLoading}
                    onClick={handleResend}
                  >
                    Resend verification email
                  </Button>
                )}
                <Button variant='subtle' onClick={() => navigate('/', { replace: true })}>
                  Continue to start page
                </Button>
              </>
            )}

            {/* Always show an way out when we're not yet successful */}
            {isPending && (
              <Text size='xs' c='dimmed' ta='center'>
                If nothing happens, the link may be invalid or the server unreachable.{' '}
                <button
                  type='button'
                  onClick={() => navigate('/', { replace: true })}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', color: 'inherit' }}
                >
                  Continue to start page
                </button>
              </Text>
            )}
          </Stack>
        </Paper>
      </Container>
    );
  }

  // No token: show "check your email" and resend (for logged-in unverified users)
  const showResend = user && user.email_verified === false;

  return (
    <Container size='sm' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md'>
        <Stack gap='md'>
          <Title order={2} ta='center'>
            Check your email
          </Title>
          <Text c='dimmed' ta='center' size='sm'>
            We've sent a verification link to {user?.email ?? 'your email address'}. Click the link
            in the email to verify your account.
          </Text>
          {errorMessage && (
            <Alert color='red' icon={<IconAlertCircle size={16} />}>
              {errorMessage}
            </Alert>
          )}
          {showResend && (
            <Button
              variant='light'
              leftSection={<IconMail size={16} />}
              loading={resendLoading}
              onClick={handleResend}
              fullWidth
            >
              Resend verification email
            </Button>
          )}
          {!user && (
            <Text size='sm' c='dimmed' ta='center'>
              Log in first to resend the verification email.
            </Text>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
