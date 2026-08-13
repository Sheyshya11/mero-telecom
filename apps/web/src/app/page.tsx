import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-16">
      <section>
        <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
          ISP management, built to grow with the business.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-700">
          Customer, plan, and subscription management are ready for the next billing phase.
        </p>
        <div className="mt-7 flex gap-3">
          <Link className="button-primary inline-flex" href="/login">
            Sign in to manage services
          </Link>
          <Link className="button-secondary inline-flex" href="/plans">
            View plans
          </Link>
        </div>
      </section>
    </main>
  );
}
