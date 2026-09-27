import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Card,
  Center,
  Container,
  Group,
  Image,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { OrgGate } from '../../components/org/OrgGate';
import type { OrgOption } from '../../hooks/useActiveOrg';
import { getSubmissions, mediaUrl, type Submission } from '../../services/api/orgData';
import { formatDate, SUBMISSION_STATUS } from './orgFormat';

type Filter = 'pending' | 'approved' | 'rejected';

export default function OrgReviewQueuePage() {
  return <OrgGate minRole='staff'>{(org) => <ReviewQueue org={org} />}</OrgGate>;
}

function ReviewQueue({ org }: { org: OrgOption }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('pending');
  const [items, setItems] = useState<Submission[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    getSubmissions(org.slug, filter)
      .then((rows) => !cancelled && setItems(rows))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [org.slug, filter]);

  return (
    <Container size='lg' py='md'>
      <Stack gap='md'>
        <Group justify='space-between'>
          <Title order={2}>Review Queue</Title>
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            data={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Identified' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
        </Group>

        {error && <Text c='red'>{error}</Text>}
        {items === null && !error && (
          <Center py='xl'>
            <Loader />
          </Center>
        )}
        {items?.length === 0 && (
          <Text c='dimmed' ta='center' py='xl'>
            Nothing here.
          </Text>
        )}

        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
          {items?.map((s) => {
            const best = s.candidates?.[0];
            return (
              <Card
                key={s.id}
                withBorder
                padding='sm'
                radius='md'
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/g/${org.slug}/review/${s.id}`)}
                data-testid='org-review-card'
              >
                <Card.Section>
                  <Image src={mediaUrl(s.image_url, 400)} alt='Submitted carapace' h={160} fit='cover' />
                </Card.Section>
                <Stack gap={4} mt='xs'>
                  <Group justify='space-between' gap={4}>
                    <Text size='sm' fw={500}>
                      {formatDate(s.observed_at || s.created_at)}
                    </Text>
                    <Badge size='xs' color={SUBMISSION_STATUS[s.status].color}>
                      {SUBMISSION_STATUS[s.status].label}
                    </Badge>
                  </Group>
                  <Text size='xs' c='dimmed' truncate>
                    {s.uploader_is_staff ? 'Staff upload' : s.uploader_email || 'Anonymous'}
                  </Text>
                  <Text size='xs'>
                    {s.match_state === 'pending'
                      ? 'Matching…'
                      : s.match_state === 'failed'
                        ? 'Matching failed'
                        : best?.turtle
                          ? `Best match: ${best.turtle.bio_id}${best.turtle.name ? ` (${best.turtle.name})` : ''} · ${best.score}`
                          : 'No match found'}
                  </Text>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      </Stack>
    </Container>
  );
}
