'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { getHomeRoute, PUBLIC_WEBSITE_ROUTE } from '../../features/auth/auth-navigation';
import { type AppRole, useAuth } from '../../features/auth/auth-provider';
import styles from '../../styles/landing.module.css';
import { MeroTelecomLogo } from '../brand/mero-telecom-logo';
import { LandingIcon } from './landing-icons';

function Brand() {
  return <MeroTelecomLogo alt="" preload size="header" />;
}

const navigation = [
  ['Internet', '#internet'],
  ['NBN Plans', '#plans'],
  ['Check Coverage', '#coverage'],
  ['Why Mero', '#why-mero'],
  ['Help & Contact', '/help'],
] as const;

const accountNavigation: Record<AppRole, ReadonlyArray<readonly [string, string]>> = {
  CUSTOMER: [
    ['Dashboard', '/customer/dashboard'],
    ['My Plan', '/customer/subscription'],
    ['Invoices', '/customer/invoices'],
    ['Profile', '/customer/profile'],
  ],
  STAFF: [
    ['Overview', '/control-centre/dashboard'],
    ['Customers', '/control-centre/customers'],
    ['Services', '/control-centre/services'],
    ['Coverage', '/control-centre/coverage'],
  ],
  ADMIN: [
    ['Dashboard', '/control-centre/dashboard'],
    ['Customers', '/control-centre/customers'],
    ['Plans', '/control-centre/plans'],
    ['Invoices', '/control-centre/invoices'],
    ['Team', '/control-centre/staff'],
  ],
  SUPER_ADMIN: [
    ['Dashboard', '/control-centre/dashboard'],
    ['Customers', '/control-centre/customers'],
    ['Plans', '/control-centre/plans'],
    ['Invoices', '/control-centre/invoices'],
    ['Team', '/control-centre/staff'],
  ],
};

export function LandingBrand() {
  return <MeroTelecomLogo size="footer" />;
}

export function LandingHeader() {
  const { isLoading, logout, user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolledRef = useRef(false);
  const visibleNavigation = isLoading ? [] : user ? accountNavigation[user.role] : navigation;

  useEffect(() => {
    let frame = 0;
    const updateScrolledState = () => {
      frame = 0;
      const nextScrolled = window.scrollY > 10;
      if (nextScrolled !== scrolledRef.current) {
        scrolledRef.current = nextScrolled;
        setScrolled(nextScrolled);
      }
    };
    const handleScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateScrolledState);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header className={`${styles.header} ${scrolled ? styles.headerScrolled : ''}`}>
      <nav aria-label="Main navigation" className={styles.nav}>
        <Link
          aria-label="Mero Telecom home"
          href={getHomeRoute(user)}
          onClick={() => setMenuOpen(false)}
        >
          <Brand />
        </Link>
        <div className={styles.navLinks}>
          {visibleNavigation.map(([label, href]) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
        </div>
        <div className={styles.navActions}>
          {isLoading ? (
            <span aria-label="Restoring session" className={styles.navSessionPlaceholder} />
          ) : user ? (
            <>
              <Link className={styles.signInLink} href={PUBLIC_WEBSITE_ROUTE}>
                Visit Website
              </Link>
              <button
                className={`${styles.button} ${styles.buttonSmall}`}
                onClick={() => void logout()}
                type="button"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link className={styles.signInLink} href="/login">
                Sign In
              </Link>
              <a className={`${styles.button} ${styles.buttonSmall}`} href="#coverage">
                Check Your Address
              </a>
            </>
          )}
          <button
            aria-controls="mobile-navigation"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            className={styles.mobileMenuButton}
            onClick={() => setMenuOpen((current) => !current)}
            type="button"
          >
            <LandingIcon name={menuOpen ? 'x' : 'menu'} size={24} />
          </button>
        </div>
      </nav>
      {menuOpen ? (
        <div className={styles.mobileMenuPanel} id="mobile-navigation">
          {visibleNavigation.map(([label, href]) => (
            <Link href={href} key={href} onClick={() => setMenuOpen(false)}>
              {label}
            </Link>
          ))}
          {isLoading ? (
            <span aria-label="Restoring session" className={styles.mobileSessionPlaceholder} />
          ) : user ? (
            <>
              <Link
                className={styles.mobileOutlineButton}
                href={PUBLIC_WEBSITE_ROUTE}
                onClick={() => setMenuOpen(false)}
              >
                Visit Website
              </Link>
              <button className={styles.button} onClick={() => void logout()} type="button">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link className={styles.mobileOutlineButton} href="/login">
                Sign In
              </Link>
              <a className={styles.button} href="#coverage" onClick={() => setMenuOpen(false)}>
                Check Your Address
              </a>
            </>
          )}
        </div>
      ) : null}
    </header>
  );
}
