import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  AppShell,
  Burger,
  Group,
  Text,
  Drawer,
  Stack,
  Button,
  useMantineTheme,
  useMantineColorScheme,
  ActionIcon,
  Badge,
  Anchor,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { useMemo } from 'react';
import {
  IconSun,
  IconMoon,
  IconHome,
  IconLogin,
  IconLogout,
  IconUser,
  IconShield,
  IconPhoto,
  IconUsers,
  IconFlag,
  IconCompass,
} from '@tabler/icons-react';
import { useUser } from '../hooks/useUser';
import { logout as apiLogout } from '../services/api';
import { isStaffRole } from '../services/api/auth';
import { notifications } from '@mantine/notifications';

interface NavigationProps {
  children: React.ReactNode;
}

const navigationItems = [
  { label: 'Home', path: '/', icon: IconHome },
];

/** About & Contact live in the footer so the header stays compact for staff/admin. */
const footerNavItems = [
  { label: 'About', path: '/about', testId: 'footer-link-about' as const },
  { label: 'Contact', path: '/contact', testId: 'footer-link-contact' as const },
];

export default function Navigation({ children }: NavigationProps) {
  const [opened, { toggle, close }] = useDisclosure(false);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useMantineTheme();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { role, isLoggedIn, user, logout: setUserLogout } = useUser();

  const isStaff = isStaffRole(role);
  const isAdmin = role === 'admin';
  // Theme/UI color per role: community=blue, staff=orange, admin=red
  const roleColor = role === 'admin' ? 'red' : role === 'staff' ? 'orange' : 'blue';
  const roleColorHex =
    role === 'admin' ? theme.colors.red[6] : role === 'staff' ? theme.colors.orange[6] : theme.colors.blue[6];

  // Get navigation items in the correct order based on role
  const getNavigationItems = () => {
    const items = [...navigationItems];
    items.splice(1, 0, {
      label: 'Observer HQ',
      path: '/observer',
      icon: IconCompass,
    });
    if (isStaff) {
      items.splice(2, 0, {
        label: 'Turtle Records',
        path: '/admin/turtle-records',
        icon: IconPhoto,
      });
      items.splice(3, 0, {
        label: 'Release',
        path: '/admin/release',
        icon: IconFlag,
      });
      if (isAdmin) {
        items.splice(4, 0, {
          label: 'User Management',
          path: '/admin/users',
          icon: IconUsers,
        });
      }
    }
    return items;
  };

  // Calculate dynamic breakpoint based on navbar content
  // Admin view has more items, long usernames take more space
  // Higher breakpoint = drawer appears earlier (at larger screen width)
  const dynamicBreakpoint = useMemo(() => {
    const baseBreakpoint = 1000; // Base breakpoint for customer view with normal name

    // Home + Observer HQ (+ staff/admin ops); About/Contact are in the footer
    const itemCount = isAdmin ? 5 : isStaff ? 4 : 2;

    // Admin has 2 extra items, increase breakpoint by ~167px per extra item
    // This makes drawer appear earlier when there are more nav items
    // Target: Admin with normal name should be around 1000 + 333 = 1333px
    const itemAdjustment = (itemCount - 3) * 167;

    // Long usernames/emails take more space
    const userName = user?.name || user?.email || '';
    const userNameLength = userName.length;
    // Increase breakpoint by ~11px per character over 15 characters
    // This makes drawer appear earlier when username is long
    const userNameAdjustment = Math.max(0, (userNameLength - 15) * 11);

    // Calculate final breakpoint (higher = drawer appears at larger screen width)
    return baseBreakpoint + itemAdjustment + userNameAdjustment;
  }, [isStaff, isAdmin, user?.name, user?.email]);

  // Use dynamic breakpoint; on mobile (< 768px) always show drawer for best touch UX
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isNarrowViewport = useMediaQuery(`(max-width: ${dynamicBreakpoint}px)`);
  const showDrawer = isMobile || isNarrowViewport;

  const handleNavigation = (path: string) => {
    navigate(path);
    close();
  };

  const handleLogout = async () => {
    try {
      await apiLogout();
      setUserLogout();
      notifications.show({
        title: 'Successfully logged out',
        message: 'You have been logged out successfully.',
        color: 'blue',
      });
      navigate('/');
      close();
    } catch (error) {
      console.error('Logout error:', error);
      // Still logout locally even if API call fails
      setUserLogout();
      navigate('/');
      close();
    }
  };

  const NavButton = ({
    item,
    variant = 'subtle',
  }: {
    item: (typeof navigationItems)[0];
    variant?: 'subtle' | 'light';
  }) => (
    <Button
      variant={variant}
      leftSection={<item.icon size={16} />}
      onClick={() => handleNavigation(item.path)}
      color={
        location.pathname === item.path ? roleColor : undefined
      }
      data-active={location.pathname === item.path ? 'true' : 'false'}
      style={{
        backgroundColor:
          location.pathname === item.path ? roleColorHex : 'transparent',
        color: location.pathname === item.path ? 'white' : undefined,
        transition: 'all 0.2s ease',
      }}
    >
      {item.label}
    </Button>
  );

  return (
    <AppShell
      header={{ height: isMobile ? 56 : 60 }}
      footer={{ height: 'auto' }}
      padding={isMobile ? 'xs' : 'md'}
    >
      <AppShell.Header>
        <Group
          h='100%'
          px={isMobile ? 'xs' : 'md'}
          gap={isMobile ? 'xs' : 'md'}
          wrap='nowrap'
          justify='space-between'
          style={{
            overflow: 'hidden',
            width: '100%',
            minWidth: 0,
          }}
        >
          {/* Left side - Logo (truncate on very small screens) */}
          <Group gap='xs' style={{ flexShrink: 1, minWidth: 0 }}>
            <Text
              size='lg'
              fw={700}
              style={{
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onClick={() => handleNavigation('/')}
            >
              PicTur
            </Text>
            <Badge
              data-testid='role-badge'
              color={roleColor}
              leftSection={
                isStaff ? <IconShield size={12} /> : <IconUser size={12} />
              }
              size='sm'
              style={{ flexShrink: 0 }}
            >
              {role === 'admin' ? 'Admin' : role === 'staff' ? 'Staff' : 'Community'}
            </Badge>
          </Group>

          {/* Center - Desktop Navigation */}
          {!showDrawer && (
            <Group
              gap='xs'
              style={{
                flex: 1,
                minWidth: 0,
                justifyContent: 'center',
                flexWrap: 'nowrap',
              }}
            >
              {getNavigationItems().map((item) => (
                <NavButton key={item.path} item={item} />
              ))}
            </Group>
          )}

          {/* Right side - Login/Logout, Theme Toggle, Mobile Menu */}
          <Group gap='xs' style={{ flexShrink: 0 }}>
            {/* Desktop Login/Logout Link */}
            {!showDrawer && (
              <>
                {isLoggedIn ? (
                  <Group gap='xs' style={{ flexWrap: 'nowrap', minWidth: 0 }}>
                    {user && (
                      <Text
                        size='sm'
                        c='dimmed'
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flexShrink: 1,
                          minWidth: 0,
                        }}
                        title={user.name || user.email}
                      >
                        {user.name || user.email}
                      </Text>
                    )}
                    <Button
                      variant='subtle'
                      leftSection={<IconLogout size={16} />}
                      onClick={handleLogout}
                      color={role === 'admin' ? 'red' : 'blue'}
                      style={{ flexShrink: 0 }}
                    >
                      Logout
                    </Button>
                  </Group>
                ) : (
                  <Button
                    variant='subtle'
                    leftSection={<IconLogin size={16} />}
                    onClick={() => handleNavigation('/login')}
                    color={
                      location.pathname === '/login' ? roleColor : undefined
                    }
                    style={{
                      backgroundColor:
                        location.pathname === '/login' ? roleColorHex : 'transparent',
                      color: location.pathname === '/login' ? 'white' : undefined,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    Login
                  </Button>
                )}
              </>
            )}

            {/* Color Scheme Toggle - hidden in drawer on mobile to save space */}
            {!showDrawer && (
              <ActionIcon variant='subtle' onClick={() => toggleColorScheme()} size='lg'>
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            )}

            {/* Mobile: theme toggle + burger */}
            {showDrawer && (
              <>
                <ActionIcon
                  variant='subtle'
                  onClick={() => toggleColorScheme()}
                  size='lg'
                  aria-label={
                    colorScheme === 'dark'
                      ? 'Switch to light mode'
                      : 'Switch to dark mode'
                  }
                >
                  {colorScheme === 'dark' ? (
                    <IconSun size={18} />
                  ) : (
                    <IconMoon size={18} />
                  )}
                </ActionIcon>
                <Burger
                  data-testid='mobile-menu-button'
                  opened={opened}
                  onClick={toggle}
                  size='sm'
                  aria-label='Open menu'
                />
              </>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      {/* Mobile Drawer - full width on small screens for easier touch */}
      <Drawer
        opened={opened}
        onClose={close}
        position='right'
        size={isMobile ? '85%' : 'xs'}
        padding='md'
      >
        <div data-testid='nav-drawer'>
          <Stack gap='xs' h='90vh' justify='space-between'>
          {/* Main navigation links at top */}
          <Stack gap='xs'>
            {getNavigationItems().map((item) => (
              <NavButton key={item.path} item={item} variant='light' />
            ))}
          </Stack>

          {/* Login/Logout link pushed to bottom */}
          {isLoggedIn ? (
            <Stack gap='xs'>
              {user && (
                <Text size='sm' c='dimmed' ta='center' p='xs'>
                  {user.name || user.email}
                </Text>
              )}
              <Button
                variant='light'
                leftSection={<IconLogout size={16} />}
                onClick={handleLogout}
                color={roleColor}
              >
                Logout
              </Button>
            </Stack>
          ) : (
            <Button
              variant='light'
              leftSection={<IconLogin size={16} />}
              onClick={() => handleNavigation('/login')}
              color={
                location.pathname === '/login' ? roleColor : undefined
              }
              style={{
                backgroundColor:
                  location.pathname === '/login' ? roleColorHex : undefined,
                color: location.pathname === '/login' ? 'white' : undefined,
                transition: 'all 0.2s ease',
              }}
            >
              Login
            </Button>
          )}
          </Stack>
        </div>
      </Drawer>

      <AppShell.Main>{children}</AppShell.Main>

      <AppShell.Footer py='xs' px='xs'>
        <Stack gap='xs' align='center'>
          <Group gap='lg' justify='center' wrap='wrap'>
            {footerNavItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Anchor
                  key={item.path}
                  component={Link}
                  to={item.path}
                  size='sm'
                  fw={active ? 600 : 400}
                  data-testid={item.testId}
                  c={active ? undefined : 'dimmed'}
                  style={
                    active
                      ? { color: roleColorHex }
                      : undefined
                  }
                  onClick={close}
                >
                  {item.label}
                </Anchor>
              );
            })}
          </Group>
          <Text size='xs' c='dimmed' ta='center' m={0} lh={1.35}>
            Favicon:{' '}
            <Anchor
              href='https://www.flaticon.com/free-icon/turtle_8493027'
              target='_blank'
              rel='noopener noreferrer'
              size='xs'
              c='dimmed'
            >
              turtle icon
            </Anchor>
            . Icons made by{' '}
            <Anchor
              href='https://www.freepik.com'
              target='_blank'
              rel='noopener noreferrer'
              size='xs'
              c='dimmed'
            >
              Freepik
            </Anchor>{' '}
            from{' '}
            <Anchor
              href='https://www.flaticon.com/'
              target='_blank'
              rel='noopener noreferrer'
              size='xs'
              c='dimmed'
            >
              www.flaticon.com
            </Anchor>
          </Text>
        </Stack>
      </AppShell.Footer>
    </AppShell>
  );
}
