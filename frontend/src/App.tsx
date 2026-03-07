import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import Navigation from './components/Navigation';
import HomePage from './pages/HomePage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import LoginPage from './pages/LoginPage';
import AdminTurtleRecordsPage from './pages/AdminTurtleRecordsPage';
import AdminTurtleMatchPage from './pages/AdminTurtleMatchPage';
import AdminReleasePage from './pages/AdminReleasePage';
import AdminUserManagementPage from './pages/AdminUserManagementPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import EmailVerificationGuard from './components/EmailVerificationGuard';
import { store } from './store';
import { useAppSelector } from './store/hooks';
import { communityTheme, adminTheme } from './store/slices/themeSlice';
import AuthProvider from './components/AuthProvider';

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { role } = useAppSelector((state) => state.user);
  const currentTheme = role === 'admin' ? adminTheme : communityTheme;

  return <MantineProvider theme={currentTheme}>{children}</MantineProvider>;
}

function App(): React.JSX.Element {
  return (
    <Provider store={store}>
      <AuthProvider>
        <ThemeProvider>
          <Notifications position='bottom-center' zIndex={1000} />
          <Router>
            <Navigation>
              <EmailVerificationGuard>
              <Routes>
                <Route path='/' element={<HomePage />} />
                <Route path='/about' element={<AboutPage />} />
                <Route path='/contact' element={<ContactPage />} />
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
              </Routes>
              </EmailVerificationGuard>
            </Navigation>
          </Router>
        </ThemeProvider>
      </AuthProvider>
    </Provider>
  );
}

export default App;
