import { Center, Loader } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { useUser } from '../hooks/useUser';
import { useActiveOrg } from '../hooks/useActiveOrg';
import { isStaffRole } from '../services/api/auth';
import { useAdminTurtleMatch } from '../hooks/useAdminTurtleMatch';
import { AdminTurtleMatchProvider } from './AdminTurtleMatch/AdminTurtleMatchContext';
import { AdminTurtleMatchView } from './AdminTurtleMatch/AdminTurtleMatchView';

export default function AdminTurtleMatchPage() {
  const { authChecked: userAuthChecked } = useUser();
  // Role in the active research group (the account role for the main group)
  const { role, ready: orgReady } = useActiveOrg();
  const authChecked = userAuthChecked && orgReady;
  const { imageId } = useParams<{ imageId: string }>();
  const matchState = useAdminTurtleMatch(role, authChecked, imageId);

  if (!authChecked) {
    return (
      <Center py='xl'>
        <Loader size='lg' />
      </Center>
    );
  }

  if (!isStaffRole(role)) {
    return null;
  }

  return (
    <AdminTurtleMatchProvider value={matchState}>
      <AdminTurtleMatchView />
    </AdminTurtleMatchProvider>
  );
}
