import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../store/hooks';

/** Routes that are allowed without email verification (logged-in but unverified users). */
const ALLOWED_WITHOUT_VERIFICATION = [
  '/verify-email',
  '/login',
  '/register',
  '/about',
  '/contact',
];

/**
 * Redirects logged-in users with unverified email to /verify-email.
 * They can only access login, register, verify-email, about, contact until verified.
 */
export default function EmailVerificationGuard({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, authChecked } = useAppSelector((state) => state.user);

  const isAllowed = ALLOWED_WITHOUT_VERIFICATION.some(
    (path) => location.pathname === path || location.pathname.startsWith(path + '/')
  );

  useEffect(() => {
    if (!authChecked) return;
    if (!user) return;
    // Treat missing email_verified as verified for backward compatibility (e.g. old sessions)
    if (user.email_verified !== false) return;
    if (isAllowed) return;

    navigate('/verify-email', { replace: true });
  }, [authChecked, user, isAllowed, navigate]);

  return <>{children}</>;
}
