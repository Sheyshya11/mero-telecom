import Link from 'next/link';
import { CoverageChecker } from '../features/coverage/coverage-checker';
import { PublicPlanGrid } from '../features/plans/public-plan-grid';

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-16">
      <section className="py-10">
        <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
          ISP management, built to grow with the business.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-700">
          Manage customers, plans, subscriptions, billing, payments, and service availability in one
          secure platform.
        </p>
        <div className="mt-7 flex gap-3">
          <Link className="button-primary inline-flex" href="/login">
            Sign in to manage services
          </Link>
          <Link className="button-secondary inline-flex" href="/plans">
            View plans
          </Link>
          <Link className="button-secondary inline-flex" href="/coverage">
            Check coverage
          </Link>
        </div>
      </section>
      <section className="border-t border-slate-200 py-12">
        <CoverageChecker />
      </section>
      <section className="border-t border-slate-200 py-12">
        <p className="text-sm font-semibold tracking-wide text-sky-700">INTERNET PLANS</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          Choose the right connection
        </h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          Public plans are available without signing in. Prices and availability are confirmed by
          Mero Telecom before payment.
        </p>
        <PublicPlanGrid />
      </section>
    </main>
  );
}
