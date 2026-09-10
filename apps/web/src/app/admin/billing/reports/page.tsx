import { Suspense } from 'react';

import { BillingReports } from '../../../../features/billing-reports/billing-reports';

export default function BillingReportsPage() {
  return (
    <Suspense
      fallback={
        <main className="workspace-page mx-auto max-w-7xl px-6 py-10">
          Loading billing reports…
        </main>
      }
    >
      <BillingReports />
    </Suspense>
  );
}
