import Link from 'next/link';

import { MeroTelecomLogo } from '../../components/brand/mero-telecom-logo';

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link aria-label="Mero Telecom home" className="inline-flex" href="/">
        <MeroTelecomLogo alt="" preload size="compact" />
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Privacy policy</h1>
      <p className="mt-4 leading-7 text-slate-600">
        Mero Telecom stores the customer and service information required to process a test order,
        issue invoices, provide account access, and support the selected service. Card details are
        collected by Stripe and are not stored by this application.
      </p>
    </main>
  );
}
