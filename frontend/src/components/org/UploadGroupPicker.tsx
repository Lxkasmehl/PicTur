import { Group, Text } from '@mantine/core';
import OrgSwitcher from '../OrgSwitcher';
import { useActiveOrg } from '../../hooks/useActiveOrg';

/**
 * "Upload for: <group>" above the upload form. Only shown when more than one research group can
 * receive photos; switching changes the active group (and its upload flow).
 */
export function UploadGroupPicker() {
  const { options } = useActiveOrg();
  if (options.length < 2) return null;
  return (
    <Group justify='center' gap='xs' data-testid='upload-group-picker'>
      <Text size='sm' c='dimmed'>
        Upload for research group:
      </Text>
      <OrgSwitcher />
    </Group>
  );
}
