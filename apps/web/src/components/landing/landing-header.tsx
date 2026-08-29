'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import styles from '../../styles/landing.module.css';
import { LandingIcon } from './landing-icons';

function Brand() {
  return (
    <span className={styles.brandLockup}>
      <span className={styles.brandIcon}>
        <LandingIcon name="wifi" size={20} />
      </span>
      <strong>
        Mero<span>Telecom</span>
      </strong>
    </span>
  );
}

const navigation = [
  ['Internet', '#internet'],
  ['NBN Plans', '#plans'],
  ['Check Coverage', '#coverage'],
  ['Why Mero', '#why-mero'],
  ['Help', '#faq'],
] as const;

export function LandingBrand() {
  return <Brand />;
}

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolledRef = useRef(false);

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
        <Link aria-label="Mero Telecom home" href="/" onClick={() => setMenuOpen(false)}>
          <Brand />
        </Link>
        <div className={styles.navLinks}>
          {navigation.map(([label, href]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </div>
        <div className={styles.navActions}>
          <Link className={styles.signInLink} href="/login">
            Sign In
          </Link>
          <a className={`${styles.button} ${styles.buttonSmall}`} href="#coverage">
            Check Your Address
          </a>
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
          {navigation.map(([label, href]) => (
            <a href={href} key={href} onClick={() => setMenuOpen(false)}>
              {label}
            </a>
          ))}
          <Link className={styles.mobileOutlineButton} href="/login">
            Sign In
          </Link>
          <a className={styles.button} href="#coverage" onClick={() => setMenuOpen(false)}>
            Check Your Address
          </a>
        </div>
      ) : null}
    </header>
  );
}
