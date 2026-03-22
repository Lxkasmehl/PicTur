import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../store/hooks';
import { isEmailVerified } from '../utils/emailVerified';

/** Routes that are allowed without email verification (logged-in but unverified users). */
const ALLOWED_WITHOUT_VERIFICATION = [
  '/verify-email',
  '/login',
  '/register',
  '/about',
  '/contact',
  '/observer',
];

/**
 * Redirects logged-in users with unverified email to /verify-email.
 * They can only access login, register, verify-email, about, contact, observer until verified.
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
    if (isEmailVerified(user)) return;
    if (isAllowed) return;

    navigate('/verify-email', { replace: true });
  }, [authChecked, user, isAllowed, navigate]);

  return <>{children}</>;
}
