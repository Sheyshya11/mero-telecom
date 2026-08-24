import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link className="text-sm font-semibold text-sky-700" href="/">
        MERO TELECOM
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
