import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Container, Group, Image, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconInfoCircle } from '@tabler/icons-react';
import { OrgGate } from '../../components/org/OrgGate';
import { SubmissionUploadForm } from '../../components/org/SubmissionUploadForm';
import { UploadGroupPicker } from '../../components/org/UploadGroupPicker';
import { useUser } from '../../hooks/useUser';
import type { OrgOption } from '../../hooks/useActiveOrg';
import { getMySubmissions, mediaUrl, type Submission } from '../../services/api/orgData';
import { formatDate, SUBMISSION_STATUS } from './orgFormat';

export default function OrgHomePage() {
  return <OrgGate minRole='community'>{(org) => <OrgHome org={org} />}</OrgGate>;
}

function OrgHome({ org }: { org: OrgOption }) {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const isStaff = org.role === 'staff' || org.role === 'admin';
  const [mine, setMine] = useState<Submission[]>([]);

  const loadMine = useCallback(() => {
    if (!isLoggedIn || isStaff) return;
    getMySubmissions(org.slug).then(setMine).catch(() => setMine([]));
  }, [org.slug, isLoggedIn, isStaff]);

  useEffect(loadMine, [loadMine]);

  const onUploaded = (s: Submission) => {
    if (isStaff) {
      navigate(`/g/${org.slug}/review/${s.id}`);
      return;
    }
    notifications.show({
      color: 'green',
      icon: <IconCheck size={18} />,
      title: 'Thank you!',
      message: `Your photo was sent to ${org.name} for review.`,
    });
    loadMine();
  };

  return (
    <Container size='md' py='md'>
      <Stack gap='lg'>
        <UploadGroupPicker />
        <div>
          <Title order={2}>{org.name}</Title>
          <Text c='dimmed'>
            {isStaff
              ? 'Upload a carapace photo to find matching turtles in this research group.'
              : 'Found a turtle? Upload a photo of its shell (carapace) to help this research group.'}
          </Text>
        </div>

        {!isLoggedIn && (
          <Alert icon={<IconInfoCircle size={18} />} color='blue'>
            You can upload without an account. Log in to keep track of your submissions.
          </Alert>
        )}

        <SubmissionUploadForm
          slug={org.slug}
          submitLabel={isStaff ? 'Upload and find matches' : 'Send photo'}
          onUploaded={onUploaded}
        />

        {mine.length > 0 && (
          <Stack gap='xs'>
            <Title order={4}>Your submissions</Title>
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              {mine.map((s) => (
                <Paper key={s.id} withBorder p='xs' radius='md'>
                  <Image src={mediaUrl(s.image_url, 300)} alt='Your submission' h={110} fit='cover' radius='sm' />
                  <Group justify='space-between' mt={6} gap={4}>
                    <Text size='xs' c='dimmed'>
                      {formatDate(s.observed_at || s.created_at)}
                    </Text>
                    <Badge size='xs' color={SUBMISSION_STATUS[s.status].color}>
                      {SUBMISSION_STATUS[s.status].label}
                    </Badge>
                  </Group>
                </Paper>
              ))}
            </SimpleGrid>
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
