import { Badge, Button, Group, Paper, Text, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useAdminTurtleMatchContext } from './AdminTurtleMatchContext';

export function AdminTurtleMatchHeader() {
  const { matchData, showDetail, navigate } = useAdminTurtleMatchContext();

  return (
    <>
      <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder>
        <Group justify='space-between' align='flex-start' wrap='wrap' gap='md'>
          <div>
            <Title order={1}>Turtle Match Review 🐢</Title>
            <Text size='sm' c='dimmed' mt='xs'>
              {showDetail
                ? 'Review match details and confirm'
                : 'Select a match and review/edit turtle data'}
            </Text>
          </div>
          <Badge size='lg' variant='light' color='blue'>
            {matchData?.matches.length || 0} Matches
          </Badge>
        </Group>
      </Paper>

      {!showDetail && (
        <Button
          variant='light'
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate('/')}
          w='fit-content'
        >
          Back to upload
        </Button>
      )}
    </>
  );
}
