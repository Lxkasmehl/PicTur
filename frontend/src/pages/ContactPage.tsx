import {
  Container,
  Paper,
  Title,
  Text,
  Stack,
  TextInput,
  Textarea,
  Button,
  Anchor,
  Alert,
  Group,
} from '@mantine/core';
import { IconMail, IconUser, IconMessage, IconExternalLink, IconInfoCircle } from '@tabler/icons-react';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { WASHBURN_TURTLE_CONTACT_URL, WASHBURN_TURTLE_LAB_URL } from '../config/contact';
import { submitContactForm } from '../services/api/contact';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const result = await submitContactForm({ name, email, message });
      if (result.ok) {
        setName('');
        setEmail('');
        setMessage('');
        notifications.show({
          title: 'Message sent',
          message: 'Thank you. The team can reply directly to the address you entered.',
          color: 'teal',
        });
        return;
      }
      if (result.status === 503 && result.code === 'CONTACT_DISABLED') {
        notifications.show({
          title: 'Contact form unavailable',
          message: 'This deployment has not set lab inboxes yet. Use the Washburn link below.',
          color: 'yellow',
        });
        return;
      }
      notifications.show({
        title: 'Could not send',
        message: result.error,
        color: 'red',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Container size='sm' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
        <Stack gap='lg'>
          <div>
            <Title order={1}>Contact</Title>
            <Text size='sm' c='dimmed' mt='xs'>
              PicTur accounts and uploads are separate from day-to-day lab scheduling. Send a message
              to the team using the form below (no lab email address is shown on this page).
            </Text>
          </div>

          <Alert variant='light' color='teal' icon={<IconInfoCircle size={18} />}>
            There is no published phone number or mailing address here. Messages go by email only.
            If the form is unavailable on this server, use the Washburn team contact page (link below).
          </Alert>

          <Anchor
            href={WASHBURN_TURTLE_LAB_URL}
            target='_blank'
            rel='noopener noreferrer'
            size='sm'
            display='inline-flex'
            style={{ alignItems: 'center', gap: 6, width: 'fit-content' }}
          >
            <span>Washburn turtle research (context, publications, donate)</span>
            <IconExternalLink size={14} stroke={1.5} style={{ flexShrink: 0 }} aria-hidden />
          </Anchor>

          <Anchor href={WASHBURN_TURTLE_CONTACT_URL} target='_blank' rel='noopener noreferrer' size='xs' c='dimmed'>
            Alternate: Washburn contact form (new tab)
          </Anchor>

          <form onSubmit={handleSubmit}>
            <Stack gap='md'>
              <Text size='sm' fw={500}>
                Message to the lab
              </Text>
              <Text size='xs' c='dimmed'>
                Sends one email to the lab’s configured inboxes (set on the server, not shown here).
                Your address is used as the reply-to.
              </Text>
              <TextInput
                label='Your name'
                placeholder='Your name'
                leftSection={<IconUser size={16} />}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={sending}
              />
              <TextInput
                label='Your email'
                placeholder='you@example.com'
                leftSection={<IconMail size={16} />}
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={sending}
              />
              <Textarea
                label='Message'
                placeholder='How we can help…'
                leftSection={<IconMessage size={16} />}
                minRows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                disabled={sending}
              />
              <Group wrap='wrap' gap='sm' align='center'>
                <Button type='submit' leftSection={<IconMail size={18} />} loading={sending}>
                  Send message
                </Button>
              </Group>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Container>
  );
}
