'use client';

import Link from 'next/link';

import { getHomeRoute } from '../../features/auth/auth-navigation';
import { useAuth } from '../../features/auth/auth-provider';
import styles from '../../styles/landing.module.css';

export function LandingAccountAction() {
  const { isLoading, user } = useAuth();

  if (isLoading) return <span className={styles.accountActionPlaceholder} />;
  return (
    <Link
      className={`${styles.button} ${styles.buttonWhite}`}
      href={user ? getHomeRoute(user) : '/login'}
    >
      {user ? 'Go to Dashboard' : 'Sign In'}
    </Link>
  );
}

export function LandingFooterAccountLink() {
  const { isLoading, user } = useAuth();

  if (isLoading) return <span>Loading account…</span>;
  return <Link href={user ? getHomeRoute(user) : '/login'}>{user ? 'Dashboard' : 'Sign In'}</Link>;
}

export function LandingHomeLink({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user } = useAuth();
  return <Link href={getHomeRoute(user)}>{children}</Link>;
}
