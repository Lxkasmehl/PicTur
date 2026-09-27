import { Fragment } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
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
import { useAppSelector } from './store/hooks';
import PlatformGroupsPage from './pages/PlatformGroupsPage';
import AcceptInvitePage from './pages/AcceptInvitePage';

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

/** Pages are remounted when the research group changes, so every page loads that group's data. */
function GroupScope({ children }: { children: React.ReactNode }) {
  const activeSlug = useAppSelector((s) => s.org.activeSlug);
  return <Fragment key={activeSlug}>{children}</Fragment>;
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
              <GroupScope>
              <Routes>
                <Route path='/' element={<HomePage />} />
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






              </Routes>
              </GroupScope>
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
