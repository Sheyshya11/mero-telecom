import Link from 'next/link';

import { MeroTelecomLogo } from '../../components/brand/mero-telecom-logo';

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link aria-label="Mero Telecom home" className="inline-flex" href="/">
        <MeroTelecomLogo alt="" preload size="compact" />
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Terms of service</h1>
      <p className="mt-4 leading-7 text-slate-600">
        This development environment uses Stripe test mode and prototype service qualification.
        Final connection, acceptable-use, cancellation, and billing terms must be reviewed before a
        production launch.
      </p>
    </main>
  );
}
