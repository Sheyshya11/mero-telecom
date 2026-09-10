'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { MeroTelecomLogo } from '../../components/brand/mero-telecom-logo';
import {
  getHomeRoute,
  hasRole,
  isMultiWorkspaceUser,
  PUBLIC_WEBSITE_ROUTE,
} from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import styles from './portal-shell.module.css';

const navigation = {
  admin: [
    ['dashboard', 'Overview'],
    ['customers', 'Customers'],
    ['plans', 'Plans'],
    ['subscriptions', 'Subscriptions'],
    ['cancellations', 'Cancellations'],
    ['invoices', 'Invoices'],
    ['refunds', 'Refunds'],
    ['billing/reports', 'Billing reports'],
    ['coverage', 'Coverage'],
    ['users', 'Team'],
  ],
  staff: [
    ['support', 'Support'],
    ['customers', 'Customers'],
    ['plans', 'Plan highlights'],
    ['coverage', 'Coverage'],
    ['refunds', 'Refunds'],
  ],
  customer: [
    ['dashboard', 'Overview'],
    ['support', 'Support'],
    ['subscription', 'My Internet'],
    ['invoices', 'Invoices'],
    ['refunds', 'Refunds'],
    ['profile', 'My profile'],
  ],
  controlStaff: [
    ['dashboard', 'Overview'],
    ['support', 'Support'],
    ['internal-requests', 'Internal Requests'],
    ['customers', 'Customers'],
    ['services', 'Services'],
    ['cancellations', 'Cancellations'],
    ['coverage', 'Coverage'],
    ['refunds', 'Refunds'],
  ],
  controlAdmin: [
    ['dashboard', 'Overview'],
    ['support', 'Support'],
    ['internal-requests', 'Internal Requests'],
    ['customers', 'Customers'],
    ['services', 'Services'],
    ['cancellations', 'Cancellations'],
    ['invoices', 'Invoices'],
    ['billing', 'Billing'],
    ['refunds', 'Refunds'],
    ['plans', 'Plans'],
    ['coverage', 'Coverage'],
    ['staff', 'Team'],
  ],
  controlSuperAdmin: [
    ['dashboard', 'Overview'],
    ['support', 'Support'],
    ['internal-requests', 'Internal Requests'],
    ['customers', 'Customers'],
    ['services', 'Services'],
    ['cancellations', 'Cancellations'],
    ['invoices', 'Invoices'],
    ['billing', 'Billing'],
    ['refunds', 'Refunds'],
    ['plans', 'Plans'],
    ['coverage', 'Coverage'],
    ['staff', 'Team'],
    ['audit-logs', 'Audit logs'],
  ],
} as const;

export function PortalShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  if (!user) return null;

  const area = pathname.startsWith('/control-centre/')
    ? 'control-centre'
    : pathname.startsWith('/staff/')
      ? 'staff'
      : pathname.startsWith('/customer/')
        ? 'customer'
        : 'admin';
  const roleLabel =
    user.role === 'SUPER_ADMIN'
      ? 'Super admin'
      : user.role === 'ADMIN'
        ? 'Administrator'
        : user.role === 'STAFF'
          ? 'Staff workspace'
          : 'My account';

  async function signOut() {
    setIsSigningOut(true);
    setSignOutError(false);
    try {
      await logout();
    } catch {
      setSignOutError(true);
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className={styles.portal}>
      <a className={styles.skipLink} href="#portal-content">
        Skip to content
      </a>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <Link
              className={styles.brand}
              href={getHomeRoute(user)}
              aria-label="Mero Telecom dashboard"
            >
              <MeroTelecomLogo alt="" size="portal" />
            </Link>
            <span className={styles.role}>{roleLabel}</span>
          </div>
          <div className={styles.account}>
            <span className={styles.email} title={user.email}>
              {user.email}
            </span>
            <Link className={styles.website} href={PUBLIC_WEBSITE_ROUTE}>
              Visit website
            </Link>
            {isMultiWorkspaceUser(user) ? (
              <Link
                className={styles.website}
                href={area === 'customer' ? '/control-centre/dashboard' : '/customer/dashboard'}
              >
                Switch workspace
              </Link>
            ) : null}
            <button
              className="button-primary"
              disabled={isSigningOut}
              onClick={() => void signOut()}
              type="button"
            >
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          <nav aria-label={`${roleLabel} navigation`} className={styles.navigation}>
            {(area === 'control-centre'
              ? hasRole(user, 'SUPER_ADMIN')
                ? navigation.controlSuperAdmin
                : hasRole(user, 'ADMIN')
                  ? navigation.controlAdmin
                  : navigation.controlStaff
              : navigation[area]
            ).map(([path, label]) => {
              const href = `/${area}/${path}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link key={href} href={href} aria-current={active ? 'page' : undefined}>
                  {label}
                </Link>
              );
            })}
            {area === 'staff' && user.role !== 'STAFF' ? (
              <Link href="/admin/dashboard">Admin overview</Link>
            ) : null}
          </nav>
        </header>
        {signOutError ? <p role="alert">Unable to sign out. Please try again.</p> : null}
        <div className={styles.content} id="portal-content" tabIndex={-1}>
          {children}
        </div>
        <footer className={styles.footer}>
          Mero Telecom <span>·</span> {roleLabel}
        </footer>
      </div>
    </div>
  );
}
