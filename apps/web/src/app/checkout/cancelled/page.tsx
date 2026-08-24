import Link from 'next/link';

export default function CheckoutCancelledPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
        <h1 className="mt-3 text-3xl font-bold">Checkout cancelled</h1>
        <p className="mt-3 text-slate-600">
          No successful payment was confirmed and no subscription was activated.
        </p>
        <Link className="button-primary mt-6 inline-flex" href="/plans">
          Return to plans
        </Link>
      </section>
    </main>
  );
}
