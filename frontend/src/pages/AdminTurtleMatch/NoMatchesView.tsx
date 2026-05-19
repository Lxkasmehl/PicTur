import { Button, Center, Paper, Stack, Text } from '@mantine/core';
import { IconPhoto, IconPlus } from '@tabler/icons-react';
import { useAdminTurtleMatchContext } from './AdminTurtleMatchContext';

export function NoMatchesView() {
  const { handleCreateNewTurtle } = useAdminTurtleMatchContext();

  return (
    <Paper shadow='sm' p='xl' radius='md' withBorder>
      <Center py='xl'>
        <Stack gap='md' align='center'>
          <IconPhoto size={64} stroke={1.5} style={{ opacity: 0.3 }} />
          <Text size='lg' c='dimmed' ta='center'>
            No matches found
          </Text>
          <Button leftSection={<IconPlus size={16} />} onClick={handleCreateNewTurtle}>
            Create New Turtle
          </Button>
        </Stack>
      </Center>
    </Paper>
  );
}
