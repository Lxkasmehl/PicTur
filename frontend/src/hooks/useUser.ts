import { useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { setRole, setIsLoggedIn, login, logout, setUser, type UserInfo } from '../store/slices/userSlice';
import { type UserRole } from '../types/User';

export function useUser() {
  const dispatch = useAppDispatch();
  const { role, isLoggedIn, user, authChecked } = useAppSelector((state) => state.user);

  const setRoleCb = useCallback((newRole: UserRole) => dispatch(setRole(newRole)), [dispatch]);
  const setIsLoggedInCb = useCallback(
    (loggedIn: boolean) => dispatch(setIsLoggedIn(loggedIn)),
    [dispatch],
  );
  const setUserCb = useCallback((userInfo: UserInfo) => dispatch(setUser(userInfo)), [dispatch]);
  const loginCb = useCallback((userInfo: UserInfo) => dispatch(login(userInfo)), [dispatch]);
  const logoutCb = useCallback(() => dispatch(logout()), [dispatch]);

  return {
    role,
    isLoggedIn,
    user,
    authChecked,
    setRole: setRoleCb,
    setIsLoggedIn: setIsLoggedInCb,
    setUser: setUserCb,
    login: loginCb,
    logout: logoutCb,
  };
}
