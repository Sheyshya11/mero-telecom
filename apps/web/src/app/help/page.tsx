import type { Metadata } from 'next';
import Link from 'next/link';

import { LandingHeader } from '../../components/landing/landing-header';
import { LandingIcon, type LandingIconName } from '../../components/landing/landing-icons';
import { PublicEnquiryForm } from '../../features/support/public-enquiry-form';

export const metadata: Metadata = {
  title: 'Help & Contact | Mero Telecom',
  description:
    'Contact Mero Telecom about plans, pricing, address availability, signup or an existing service.',
};

const helpOptions = [
  {
    icon: 'layers',
    title: 'Plans & Pricing',
    description: 'Questions about choosing a Mero Telecom internet plan.',
  },
  {
    icon: 'pin',
    title: 'Address / NBN',
    description: 'Ask about availability or checking a South Australian address.',
  },
  {
    icon: 'user',
    title: 'Signup / Order Help',
    description: 'Get help joining Mero Telecom or completing an order.',
  },
] satisfies ReadonlyArray<{ icon: LandingIconName; title: string; description: string }>;

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-muted text-foreground">
      <LandingHeader />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-28 sm:px-6 sm:pb-24 sm:pt-32">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
            Help & Contact
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">How can we help?</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            Ask about joining Mero Telecom without creating an account, or sign in for secure help
            with an existing service.
          </p>
        </header>

        <section
          className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-3"
          aria-label="Help topics"
        >
          {helpOptions.map(({ description, icon, title }) => (
            <article
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
              key={title}
            >
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-xl bg-primary-subtle text-primary"
              >
                <LandingIcon name={icon} size={20} />
              </span>
              <h2 className="mt-4 font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </article>
          ))}
        </section>

        <section className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <PublicEnquiryForm />
          <aside className="rounded-2xl border border-primary/20 bg-primary-subtle p-6 lg:sticky lg:top-24">
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center rounded-xl bg-card text-primary shadow-sm"
            >
              <LandingIcon name="headphones" size={22} />
            </span>
            <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-primary">
              Existing customer?
            </p>
            <h2 className="mt-2 text-xl font-bold">Get account-specific support</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
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
