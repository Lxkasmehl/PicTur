import {
  Container,
  Paper,
  Title,
  Text,
  Stack,
  TextInput,
  Textarea,
  Button,
  Group,
  Alert,
  Select,
} from '@mantine/core';
import { IconBug, IconBulb, IconMessageCircle, IconSend, IconInfoCircle } from '@tabler/icons-react';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { submitFeedbackForm, type FeedbackCategory } from '../services/api/feedback';
import { useUser } from '../hooks/useUser';

const categoryOptions: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature idea' },
  { value: 'feedback', label: 'General feedback' },
];

export default function FeedbackPage() {
  const { isLoggedIn } = useUser();
  const [category, setCategory] = useState<FeedbackCategory | null>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) return;
    setSending(true);
    try {
      const result = await submitFeedbackForm({
        category,
        title,
        description,
        ...(!isLoggedIn
          ? {
              ...(contactName.trim() ? { contactName: contactName.trim() } : {}),
              ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
            }
          : {}),
      });
      if (result.ok) {
        setTitle('');
        setDescription('');
        setContactName('');
        setContactEmail('');
        notifications.show({
          title: 'Thanks for the report',
          message: result.projectAdded
            ? `We received it as issue #${result.issueNumber} and added it to the project board.`
            : `We received it as issue #${result.issueNumber}.`,
          color: 'teal',
        });
        return;
      }
      if (result.status === 503 && result.code === 'FEEDBACK_DISABLED') {
        notifications.show({
          title: 'Feedback unavailable',
          message: 'This server is not connected to the issue tracker yet.',
          color: 'yellow',
        });
        return;
      }
      if (result.status === 429) {
        notifications.show({
          title: 'Slow down',
          message: result.error,
          color: 'yellow',
        });
        return;
      }
      if (result.code === 'GITHUB_VALIDATION') {
        notifications.show({
          title: 'Could not submit',
          message: result.error,
          color: 'red',
        });
        return;
      }
      notifications.show({
        title: 'Could not submit',
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
            <Title order={1}>Feedback</Title>
            <Text size='sm' c='dimmed' mt='xs'>
              Report bugs, suggest improvements, or share thoughts about PicTur. Your message is sent
              to the maintainers only; nothing is posted publicly on this page.
            </Text>
          </div>

          <Alert variant='light' color='blue' icon={<IconInfoCircle size={18} />}>
            You stay on this site the whole time. If the server is configured for it, your submission
            becomes a private development ticket (for example a GitHub issue with a “user feedback”
            label) so the team can triage and improve the app.
          </Alert>

          {isLoggedIn ? (
            <Alert variant='light' color='gray' icon={<IconInfoCircle size={18} />}>
              You are signed in. Your PicTur account name and email address are attached to this
              report automatically so maintainers can reach you if needed.
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit}>
            <Stack gap='md'>
              <Select
                label='Type'
                placeholder='Choose one'
                data={categoryOptions}
                value={category}
                onChange={(v) => setCategory((v as FeedbackCategory) || null)}
                required
                disabled={sending}
                leftSection={
                  category === 'bug' ? (
                    <IconBug size={16} />
                  ) : category === 'feature' ? (
                    <IconBulb size={16} />
                  ) : (
                    <IconMessageCircle size={16} />
                  )
                }
              />
              <TextInput
                label='Short summary'
                description='A clear title (what went wrong or what you want)'
                placeholder='e.g. Upload fails when I pick a second photo'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={3}
                maxLength={200}
                disabled={sending}
              />
              <Textarea
                label='Details'
                description='Steps to reproduce, what you expected, device or browser if relevant'
                placeholder='Describe what happened…'
                minRows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={10}
                maxLength={8000}
                disabled={sending}
              />
              {!isLoggedIn ? (
                <>
                  <TextInput
                    label='Your name (optional)'
                    description={
                      'Helps if we might already know you (for example from the community or field ' +
                      'work). You can also leave this empty.'
                    }
                    placeholder='e.g. Jamie Chen'
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    disabled={sending}
                    maxLength={200}
                  />
                  <TextInput
                    label='Contact email (optional)'
                    description='Only if you are okay being reached for follow-up questions'
                    placeholder='you@example.com'
                    type='email'
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    disabled={sending}
                  />
                </>
              ) : null}
              <Group wrap='wrap' gap='sm' align='center'>
                <Button type='submit' leftSection={<IconSend size={18} />} loading={sending}>
                  Submit feedback
                </Button>
              </Group>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Container>
  );
}
