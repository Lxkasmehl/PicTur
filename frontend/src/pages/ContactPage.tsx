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
import {
  getLabContactEmail,
  WASHBURN_TURTLE_CONTACT_URL,
  WASHBURN_TURTLE_LAB_URL,
} from '../config/contact';

function buildMailtoHref(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ subject, body });
  return `mailto:${to}?${q.toString()}`;
}

export default function ContactPage() {
  const labEmail = getLabContactEmail();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (labEmail) {
      const body = `${message}\n\n—\nFrom: ${name}\nReply-To: ${email}`;
      const subject = `PicTur / lab inquiry from ${name}`;
      window.location.href = buildMailtoHref(labEmail, subject, body);
      notifications.show({
        title: 'Opening your email app',
        message: 'If nothing opens, copy the address from “Email the lab” below.',
        color: 'teal',
      });
      return;
    }
    window.open(WASHBURN_TURTLE_CONTACT_URL, '_blank', 'noopener,noreferrer');
    notifications.show({
      title: 'Washburn contact page',
      message: 'We opened the lab site contact form in a new tab.',
      color: 'teal',
    });
  };

  return (
    <Container size='sm' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
        <Stack gap='lg'>
          <div>
            <Title order={1}>Contact</Title>
            <Text size='sm' c='dimmed' mt='xs'>
              PicTur accounts and uploads are separate from day-to-day lab scheduling. Use the options
              below for research outreach, talks, or site questions.
            </Text>
          </div>

          <Alert variant='light' color='teal' icon={<IconInfoCircle size={18} />}>
            There is no published phone number or mailing address for this contact flow. Prefer email or
            the Washburn team site.
          </Alert>

          <Stack gap='xs'>
            <Text size='sm' fw={600}>
              Email the lab
            </Text>
            {labEmail ? (
              <Anchor size='sm' href={`mailto:${labEmail}`}>
                {labEmail}
              </Anchor>
            ) : (
              <Text size='sm' c='dimmed'>
                Set <Text span ff='monospace'>VITE_CONTACT_EMAIL</Text> when building PicTur to show the
                lab address here. Until then, the form below opens the Washburn contact page.
              </Text>
            )}
          </Stack>

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

          <form onSubmit={handleSubmit}>
            <Stack gap='md'>
              <Text size='sm' fw={500}>
                {labEmail ? 'Compose in your mail app' : 'Message for the lab'}
              </Text>
              {!labEmail && (
                <Text size='xs' c='dimmed'>
                  PicTur does not send this form to the lab. The button below opens the Washburn team’s
                  contact page in a <strong>new browser tab</strong> (Weebly). Copy your message from
                  here if you like, then submit it on their site.
                </Text>
              )}
              <TextInput
                label='Your name'
                placeholder='Your name'
                leftSection={<IconUser size={16} />}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <TextInput
                label='Your email'
                placeholder='you@example.com'
                leftSection={<IconMail size={16} />}
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Textarea
                label='Message'
                placeholder='How we can help…'
                leftSection={<IconMessage size={16} />}
                minRows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
              <Stack gap='xs'>
                <Group wrap='wrap' gap='sm' align='center'>
                  <Button type='submit' leftSection={<IconMail size={18} />}>
                    {labEmail ? 'Open email draft' : 'Open lab contact page'}
                  </Button>
                  {!labEmail && (
                    <Text size='xs' c='dimmed' style={{ lineHeight: 1.4 }}>
                      New tab · Weebly contact form
                    </Text>
                  )}
                </Group>
                {labEmail && (
                  <Text size='xs' c='dimmed'>
                    Opens your default mail app with the fields above filled into the message.
                  </Text>
                )}
              </Stack>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Container>
  );
}
