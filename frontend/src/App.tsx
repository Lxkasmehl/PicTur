import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Provider } from 'react-redux';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import Navigation from './components/Navigation';
import HomePage from './pages/HomePage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import FeedbackPage from './pages/FeedbackPage';
import LoginPage from './pages/LoginPage';
import AdminTurtleRecordsPage from './pages/AdminTurtleRecordsPage';
import AdminTurtleMatchPage from './pages/AdminTurtleMatchPage';
import AdminReleasePage from './pages/AdminReleasePage';
import AdminUserManagementPage from './pages/AdminUserManagementPage';
import AdminLocationManagementPage from './pages/AdminLocationManagementPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import EmailVerificationGuard from './components/EmailVerificationGuard';
import { store } from './store';
import { communityTheme, staffTheme, adminTheme } from './store/slices/themeSlice';
import AuthProvider from './components/AuthProvider';
import BackupCountdownOverlay from './components/BackupCountdownOverlay';
import GamePersistence from './components/game/GamePersistence';
import ObserverHubPage from './pages/ObserverHubPage';
import OrgProvider from './components/OrgProvider';
import { useActiveOrg } from './hooks/useActiveOrg';
import PlatformGroupsPage from './pages/PlatformGroupsPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import OrgHomePage from './pages/org/OrgHomePage';
import OrgReviewQueuePage from './pages/org/OrgReviewQueuePage';
import OrgSubmissionPage from './pages/org/OrgSubmissionPage';
import OrgTurtlesPage from './pages/org/OrgTurtlesPage';
import OrgTurtleDetailPage from './pages/org/OrgTurtleDetailPage';
import OrgRegionsPage from './pages/org/OrgRegionsPage';
import OrgMembersPage from './pages/org/OrgMembersPage';

function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Role in the selected research group (main group: the account role, unchanged)
  const { role } = useActiveOrg();
  const currentTheme =
    role === 'admin' ? adminTheme : role === 'staff' ? staffTheme : communityTheme;

  return (
    <MantineProvider theme={currentTheme}>
      <ModalsProvider>{children}</ModalsProvider>
    </MantineProvider>
  );
}

/** "/" shows the classic home page for the main group and the group home for other groups. */
function HomeRoute() {
  const { active, isDbOrg, loaded } = useActiveOrg();
  if (isDbOrg && loaded) return <Navigate to={`/g/${active.slug}`} replace />;
  return <HomePage />;
}

function App(): React.JSX.Element {
  return (
    <Provider store={store}>
      <AuthProvider>
        <OrgProvider>
        <GamePersistence />
        <ThemeProvider>
          <Notifications position='bottom-center' zIndex={1000} />
          <Router>
            <Navigation>
              <EmailVerificationGuard>
              <Routes>
                <Route path='/' element={<HomeRoute />} />
                <Route path='/about' element={<AboutPage />} />
                <Route path='/contact' element={<ContactPage />} />
                <Route path='/feedback' element={<FeedbackPage />} />
                <Route path='/observer' element={<ObserverHubPage />} />
                <Route path='/login' element={<LoginPage />} />
                <Route path='/register' element={<LoginPage initialMode='signup' />} />
                <Route path='/verify-email' element={<VerifyEmailPage />} />
                <Route
                  path='/admin/turtle-records'
                  element={<AdminTurtleRecordsPage />}
                />
                <Route
                  path='/admin/turtle-match/:imageId'
                  element={<AdminTurtleMatchPage />}
                />
                <Route path='/admin/release' element={<AdminReleasePage />} />
                <Route path='/admin/users' element={<AdminUserManagementPage />} />
                <Route path='/admin/locations' element={<AdminLocationManagementPage />} />
                <Route path='/platform/groups' element={<PlatformGroupsPage />} />
                <Route path='/accept-invite' element={<AcceptInvitePage />} />
                <Route path='/g/:slug' element={<OrgHomePage />} />
                <Route path='/g/:slug/review' element={<OrgReviewQueuePage />} />
                <Route path='/g/:slug/review/:submissionId' element={<OrgSubmissionPage />} />
                <Route path='/g/:slug/turtles' element={<OrgTurtlesPage />} />
                <Route path='/g/:slug/turtles/:turtleId' element={<OrgTurtleDetailPage />} />
                <Route path='/g/:slug/regions' element={<OrgRegionsPage />} />
                <Route path='/g/:slug/members' element={<OrgMembersPage />} />
              </Routes>
              </EmailVerificationGuard>
            </Navigation>
            <BackupCountdownOverlay />
          </Router>
        </ThemeProvider>
        </OrgProvider>
      </AuthProvider>
    </Provider>
  );
}

export default App;
