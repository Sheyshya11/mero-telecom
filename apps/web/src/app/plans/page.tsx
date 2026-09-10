import Link from 'next/link';

import { MeroTelecomLogo } from '../../components/brand/mero-telecom-logo';
import { PublicPlanGrid } from '../../features/plans/public-plan-grid';

export default function PlansPage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <Link aria-label="Mero Telecom home" className="inline-flex" href="/">
        <MeroTelecomLogo alt="" preload size="compact" />
      </Link>
      <h1 className="mt-3 text-4xl font-bold text-slate-950">Internet plans</h1>
      <p className="mt-3 text-slate-600">
        Choose an available plan. You can sign in or create your account during checkout.
      </p>
      <PublicPlanGrid />
    </main>
  );
}
