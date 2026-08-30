'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { LandingIcon } from '../../components/landing/landing-icons';
import { getHomeRoute, getPostLoginRoute } from '../../features/auth/auth-navigation';
import { useAuth } from '../../features/auth/auth-provider';
import { ApiError } from '../../lib/api/client';
import styles from './login.module.css';

const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least eight characters.'),
});

type LoginValues = z.infer<typeof loginSchema>;
type Toast = { message: string; tone: 'success' };

const trustItems = [
  { icon: 'shield' as const, label: 'Secure account access' },
  { icon: 'credit-card' as const, label: 'Manage billing online' },
  { icon: 'headphones' as const, label: 'Australian-based support' },
];

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoadingState />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { isLoading, login, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const sessionExpired = searchParams.get('reason') === 'session-expired';
  const [error, setError] = useState<string | null>(null);
  const submittedLogin = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!isLoading && user && !submittedLogin.current) router.replace(getHomeRoute(user));
  }, [isLoading, router, user]);

  async function submit(values: LoginValues) {
    setError(null);
    submittedLogin.current = true;
    try {
      const user = await login(values.email, values.password);
      setToast({ message: 'Welcome back to Mero Telecom!', tone: 'success' });
      router.replace(getPostLoginRoute(user, returnTo));
    } catch (reason) {
      submittedLogin.current = false;
      setError(reason instanceof ApiError ? reason.message : 'Unable to sign in.');
    }
  }

  if (isLoading || user) return <LoginLoadingState />;

  return (
    <main className={styles.page}>
      <BrandPanel />

      <section className={styles.formPanel}>
        <div aria-hidden="true" className={styles.formGrid} />
        <div className={styles.formWrap}>
          <BrandLogo mobile />

          <section aria-labelledby="sign-in-heading" className={styles.card}>
            <header className={styles.cardHeader}>
              <h1 id="sign-in-heading">Sign In</h1>
              <p>Sign in to manage your service, billing and account.</p>
            </header>

            {sessionExpired ? (
              <p aria-live="polite" className={styles.formError} role="status">
                Your session has expired. Please sign in again.
              </p>
            ) : null}

            <form className={styles.form} onSubmit={form.handleSubmit(submit)}>
              <div className={styles.fieldGroup}>
                <label htmlFor="login-email">Email</label>
                <input
                  autoComplete="email"
                  className={styles.input}
                  id="login-email"
                  placeholder="you@example.com"
                  type="email"
                  {...form.register('email')}
                />
                {form.formState.errors.email?.message ? (
                  <span className={styles.fieldError}>{form.formState.errors.email.message}</span>
                ) : null}
              </div>

              <div className={styles.fieldGroup}>
                <div className={styles.labelRow}>
                  <label htmlFor="login-password">Password</label>
                  <Link className={styles.forgotButton} href="/forgot-password">
                    Forgot password?
                  </Link>
                </div>
                <div className={styles.passwordWrap}>
                  <input
                    autoComplete="current-password"
                    className={styles.input}
                    id="login-password"
                    placeholder="Enter your password"
                    type={showPassword ? 'text' : 'password'}
                    {...form.register('password')}
                  />
                  <button
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword((current) => !current)}
                    type="button"
                  >
                    <LandingIcon name={showPassword ? 'eye-off' : 'eye'} size={19} />
                  </button>
                </div>
                {form.formState.errors.password?.message ? (
                  <span className={styles.fieldError}>
                    {form.formState.errors.password.message}
                  </span>
                ) : null}
              </div>

              <label className={styles.rememberRow} htmlFor="remember-device">
                <input id="remember-device" type="checkbox" />
                <span>Remember me on this device</span>
              </label>

              {error ? (
                <p aria-live="polite" className={styles.formError}>
                  {error}
                </p>
              ) : null}

              <button
                className={styles.submitButton}
                disabled={form.formState.isSubmitting}
                type="submit"
              >
                {form.formState.isSubmitting ? (
                  <>
                    <span aria-hidden="true" className={styles.spinner} />
                    Signing in…
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className={styles.divider}>
              <span>or</span>
            </div>

            <p className={styles.signupPrompt}>
              Don&apos;t have an account? <Link href="/plans">Get connected</Link>
            </p>
          </section>

          <Link className={styles.backLink} href="/">
            <LandingIcon name="arrow-left" size={16} />
            Back to home
          </Link>
        </div>
      </section>

      {toast ? (
        <div aria-live="polite" className={styles.toast} data-tone={toast.tone} role="status">
          <span className={styles.toastIcon}>
            <LandingIcon name="check" size={16} />
          </span>
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}

function BrandPanel() {
  return (
    <aside className={styles.brandPanel}>
      <div aria-hidden="true" className={styles.brandGrid} />
      <div aria-hidden="true" className={`${styles.orb} ${styles.orbTop}`} />
      <div aria-hidden="true" className={`${styles.orb} ${styles.orbBottom}`} />
      <div aria-hidden="true" className={styles.accentGlow} />

      <div className={styles.brandContent}>
        <BrandLogo />

        <div className={styles.brandMessage}>
          <h2>Manage your Mero Telecom service, anytime.</h2>
          <p>
            Sign in to view your plan, check your billing, update your details and get support — all
            in one place.
          </p>
          <ul className={styles.trustList}>
            {trustItems.map((item) => (
              <li key={item.label}>
                <span>
                  <LandingIcon name={item.icon} size={18} />
                </span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        <p className={styles.copyright}>© 2026 Mero Telecom. All rights reserved.</p>
      </div>
    </aside>
  );
}

function BrandLogo({ mobile = false }: Readonly<{ mobile?: boolean }>) {
  return (
    <Link
      aria-label="Mero Telecom home"
      className={mobile ? styles.mobileLogo : styles.brandLogo}
      href="/"
    >
      <span className={styles.logoIcon}>
        <LandingIcon name="wifi" size={20} />
      </span>
      <span>
        Mero<span>Telecom</span>
      </span>
    </Link>
  );
}

function LoginLoadingState() {
  return (
    <main className={styles.loadingPage}>
      <span aria-hidden="true" className={styles.spinnerDark} />
      <span>Preparing sign in…</span>
    </main>
  );
}
