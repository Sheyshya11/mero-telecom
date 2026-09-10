import type { Metadata } from 'next';
import Link from 'next/link';

import { LandingHeader } from '../../components/landing/landing-header';
import { PublicEnquiryForm } from '../../features/support/public-enquiry-form';

export const metadata: Metadata = {
  title: 'Help & Contact | Mero Telecom',
  description:
    'Contact Mero Telecom about plans, pricing, address availability, signup or an existing service.',
};

const helpOptions = [
  ['Plans & Pricing', 'Questions about choosing a Mero Telecom internet plan.'],
  ['Address / NBN', 'Ask about availability or checking a South Australian address.'],
  ['Signup / Order Help', 'Get help joining Mero Telecom or completing an order.'],
] as const;

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <LandingHeader />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-28 sm:px-6 sm:pb-24 sm:pt-32">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-700">
            Help & Contact
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">How can we help?</h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Ask about joining Mero Telecom without creating an account, or sign in for secure help
            with an existing service.
          </p>
        </header>

        <section
          className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-3"
          aria-label="Help topics"
        >
          {helpOptions.map(([title, description]) => (
            <article
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              key={title}
            >
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
            </article>
          ))}
        </section>

        <section className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <PublicEnquiryForm />
          <aside className="rounded-2xl border border-sky-200 bg-sky-50 p-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">
              Existing customer?
            </p>
            <h2 className="mt-2 text-xl font-bold">Get account-specific support</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              Sign in before discussing invoices, payments, service faults or subscription changes.
              This protects your account information.
            </p>
            <Link
              className="button-primary mt-5 w-full justify-center"
              href="/login?returnTo=/customer/support"
            >
              Sign in for support
            </Link>
          </aside>
        </section>
      </main>
    </div>
  );
}
