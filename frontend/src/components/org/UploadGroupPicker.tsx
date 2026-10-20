import { Group, Select, Text } from '@mantine/core';
import { IconBuildingCommunity, IconUsersGroup } from '@tabler/icons-react';
import OrgSwitcher from '../OrgSwitcher';
import { useActiveOrg } from '../../hooks/useActiveOrg';
import { useUploadToAllGroups } from '../../hooks/useUploadToAllGroups';

const ALL_GROUPS = '__all__';

/**
 * "Upload for: <group>" above the upload form. Only shown when more than one research group can
 * receive photos; switching changes the active group (and its upload flow). Community members
 * can also pick "All research groups" when they do not know which group the turtle belongs to.
 */
export function UploadGroupPicker() {
  const { active, options, select } = useActiveOrg();
  const allGroups = useUploadToAllGroups();
  if (options.length < 2) return null;

  if (!allGroups.available) {
    return (
      <Group justify='center' gap='xs' data-testid='upload-group-picker'>
        <Text size='sm' c='dimmed'>
          Upload for research group:
        </Text>
        <OrgSwitcher />
      </Group>
    );
  }

  return (
    <Group justify='center' gap='xs' data-testid='upload-group-picker'>
      <Text size='sm' c='dimmed'>
        Upload for research group:
      </Text>
      <Select
        data-testid='upload-group-select'
        aria-label='Research group'
        size='xs'
        w={240}
        allowDeselect={false}
        leftSection={allGroups.enabled ? <IconUsersGroup size={14} /> : <IconBuildingCommunity size={14} />}
        value={allGroups.enabled ? ALL_GROUPS : active.slug}
        data={[
          { value: ALL_GROUPS, label: `All research groups (${allGroups.groupCount})` },
          ...options.map((o) => ({ value: o.slug, label: o.name })),
        ]}
        onChange={(value) => {
          if (!value) return;
          if (value === ALL_GROUPS) {
            allGroups.setEnabled(true);
            return;
          }
          allGroups.setEnabled(false);
          if (value !== active.slug) select(value);
        }}
        comboboxProps={{ withinPortal: true, zIndex: 1100 }}
      />
      {allGroups.enabled && (
        <Text size='xs' c='dimmed' w='100%' ta='center'>
          Not sure which group to choose? Your photo goes to every group that accepts community photos, and each
          group reviews it on its own.
        </Text>
      )}
    </Group>
  );
}
