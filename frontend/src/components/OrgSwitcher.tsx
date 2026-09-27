import { Select } from '@mantine/core';
import { IconBuildingCommunity } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useActiveOrg } from '../hooks/useActiveOrg';
import { MAIN_ORG_SLUG } from '../store/slices/orgSlice';

const ROLE_SUFFIX: Record<string, string> = { admin: ' · Admin', staff: ' · Staff', community: '' };

/** Research group picker; only rendered when there is more than one group to choose from. */
export default function OrgSwitcher({ fullWidth = false, onSwitched }: { fullWidth?: boolean; onSwitched?: () => void }) {
  const { active, options, select } = useActiveOrg();
  const navigate = useNavigate();

  if (options.length < 2) return null;

  return (
    <Select
      data-testid='org-switcher'
      aria-label='Research group'
      size='xs'
      w={fullWidth ? '100%' : 200}
      allowDeselect={false}
      leftSection={<IconBuildingCommunity size={14} />}
      value={active.slug}
      data={options.map((o) => ({
        value: o.slug,
        label: `${o.name}${o.isMember && o.slug !== MAIN_ORG_SLUG ? ROLE_SUFFIX[o.role] ?? '' : ''}`,
      }))}
      onChange={(slug) => {
        if (!slug || slug === active.slug) return;
        select(slug);
        const next = options.find((o) => o.slug === slug);
        navigate(next?.kind === 'db' ? `/g/${slug}` : '/');
        onSwitched?.();
      }}
      comboboxProps={{ withinPortal: true, zIndex: 1100 }}
    />
  );
}
