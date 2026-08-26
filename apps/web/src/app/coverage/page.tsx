import Link from 'next/link';

import { CoverageChecker } from '../../features/coverage/coverage-checker';

export default function CoveragePage() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <Link className="text-sm font-semibold tracking-wide text-sky-700" href="/">
        MERO TELECOM
      </Link>
      <header className="py-8">
        <p className="text-sm font-semibold tracking-wide text-sky-700">SERVICE COVERAGE</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">
          Check an Australian address
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Select a recognised address for a preliminary Mero Telecom database estimate. Final
          serviceability may still require confirmation.
        </p>
      </header>
      <CoverageChecker />
    </main>
  );
}
