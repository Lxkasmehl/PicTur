import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Center, Container, Loader } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useUser } from '../../hooks/useUser';
import { useActiveOrg, type OrgOption } from '../../hooks/useActiveOrg';
import type { UserRole } from '../../types/User';

const RANK: Record<UserRole, number> = { community: 1, staff: 2, admin: 3 };

interface OrgGateProps {
  /** Minimum role in the group; 'community' = any visitor of a group that accepts uploads. */
  minRole: UserRole;
  children: (org: OrgOption) => React.ReactNode;
}

/**
 * Resolves the research group of a /g/:slug page, makes it the active group, and renders the
 * page only for database-backed groups where the user holds at least `minRole`.
 */
export function OrgGate({ minRole, children }: OrgGateProps) {
  const { slug } = useParams();
  const { authChecked } = useUser();
  const { options, loaded, active, select } = useActiveOrg();
  const org = options.find((o) => o.slug === slug);

  useEffect(() => {
    if (org && active.slug !== org.slug) select(org.slug);
  }, [org, active.slug, select]);

  if (!authChecked || !loaded) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }
  if (!org || org.kind !== 'db') {
    return <GateMessage text='This research group does not exist or is not available to you.' />;
  }
  if (RANK[org.role] < RANK[minRole]) {
    return <GateMessage text='You do not have access to this page of the research group.' />;
  }
  return <>{children(org)}</>;
}

function GateMessage({ text }: { text: string }) {
  return (
    <Container size='sm' py='xl'>
      <Alert color='orange' icon={<IconAlertCircle size={18} />} data-testid='org-gate-message'>
        {text}
      </Alert>
    </Container>
  );
}
