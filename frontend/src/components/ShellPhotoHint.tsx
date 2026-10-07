import { Alert, Text } from '@mantine/core';
import { IconCamera } from '@tabler/icons-react';
import { SHELL_COLOR, type Shell } from '../utils/shell';

const SHELL_TEXT: Record<Shell, { title: string; detail: string }> = {
  plastron: {
    title: 'Plastron photo: the bottom shell',
    detail: 'Turn the turtle over (or hold it) so the whole underside is visible.',
  },
  carapace: {
    title: 'Carapace photo: the top shell',
    detail: 'Photograph the turtle from straight above with the whole top shell in frame.',
  },
};

/** Which shell the current upload expects (the main group's staff: plastron; everyone else: carapace). */
export function ShellPhotoHint({ shell }: { shell: Shell }) {
  const text = SHELL_TEXT[shell];
  return (
    <Alert
      color={SHELL_COLOR[shell]}
      variant='light'
      radius='md'
      icon={<IconCamera size={20} />}
      data-testid='shell-photo-hint'
      data-shell={shell}
    >
      <Text fw={700} size='sm'>
        {text.title}
      </Text>
      <Text size='sm'>{text.detail}</Text>
    </Alert>
  );
}
