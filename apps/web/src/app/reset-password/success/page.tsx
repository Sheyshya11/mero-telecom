import Link from 'next/link';

import { MeroTelecomLogo } from '../../../components/brand/mero-telecom-logo';

export default function PasswordResetSuccessPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 py-12 text-center">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Link aria-label="Mero Telecom home" className="inline-flex" href="/">
          <MeroTelecomLogo alt="" preload size="auth" />
        </Link>
        <h1 className="mt-5 text-3xl font-bold">Password updated</h1>
        <p className="mt-3 text-slate-600">
          Your password has been changed and all existing sessions have been signed out. Sign in
          again with your new password.
        </p>
        <Link className="button-primary mt-7 inline-flex" href="/login">
          Back to Login
        </Link>
      </section>
    </main>
  );
}
