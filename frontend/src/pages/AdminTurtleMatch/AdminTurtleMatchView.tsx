import { Center, Container, Loader, Stack } from '@mantine/core';
import { AdminTurtleMatchHeader } from './AdminTurtleMatchHeader';
import { CreateNewTurtleModal } from './CreateNewTurtleModal';
import { MatchDetailView } from './MatchDetailView';
import { MatchGridView } from './MatchGridView';
import { NoMatchesView } from './NoMatchesView';
import { useAdminTurtleMatchContext } from './AdminTurtleMatchContext';

export function AdminTurtleMatchView() {
  const { loading, matchData, showDetail } = useAdminTurtleMatchContext();

  const hasMatches = matchData?.matches && matchData.matches.length > 0;

  return (
    <Container size='xl' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Stack gap='lg'>
        <AdminTurtleMatchHeader />

        {loading ? (
          <Center py='xl'>
            <Loader size='lg' />
          </Center>
        ) : !hasMatches ? (
          <NoMatchesView />
        ) : showDetail ? (
          <MatchDetailView />
        ) : (
          <MatchGridView />
        )}
      </Stack>

      <CreateNewTurtleModal />
    </Container>
  );
}
