'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { LandingIcon } from '../../components/landing/landing-icons';
import { useAuth } from '../../features/auth/auth-provider';
import { ApiError } from '../../lib/api/client';
import styles from './login.module.css';

const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least eight characters.'),
});

type LoginValues = z.infer<typeof loginSchema>;
type Toast = { message: string; tone: 'info' | 'success' };

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
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const [error, setError] = useState<string | null>(null);
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

  async function submit(values: LoginValues) {
    setError(null);
    try {
      const user = await login(values.email, values.password);
      setToast({ message: 'Welcome back to Mero Telecom!', tone: 'success' });
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      router.push(
        user.role === 'CUSTOMER'
          ? (returnTo ?? '/customer/dashboard')
          : user.role === 'STAFF'
            ? '/staff/customers'
            : '/admin/dashboard',
      );
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to sign in.');
    }
  }

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
                  <button
                    className={styles.forgotButton}
                    onClick={() =>
                      setToast({
                        message: 'Password reset is not available in this demo.',
                        tone: 'info',
                      })
                    }
                    type="button"
                  >
                    Forgot password?
                  </button>
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
            <LandingIcon name={toast.tone === 'success' ? 'check' : 'shield'} size={16} />
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

function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
