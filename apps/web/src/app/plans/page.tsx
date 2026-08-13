'use client';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api/client';
interface Plan {
  id: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
}
export default function PlansPage() {
  const query = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => apiRequest<Plan[]>('/plans/public'),
  });
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
      <h1 className="mt-3 text-4xl font-bold text-slate-950">Internet plans</h1>
      <p className="mt-3 text-slate-600">Choose an active Mero Telecom internet plan.</p>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {query.data?.map((plan) => (
          <article
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            key={plan.id}
          >
            <h2 className="text-xl font-bold">{plan.name}</h2>
            <p className="mt-3 min-h-12 text-slate-600">{plan.description}</p>
            <p className="mt-5 text-sm text-slate-600">
              {plan.downloadMbps}/{plan.uploadMbps} Mbps
            </p>
            <p className="mt-2 text-2xl font-bold">
              ${(plan.monthlyCents / 100).toFixed(2)}
              <span className="text-sm font-normal text-slate-500">/month</span>
            </p>
          </article>
        ))}
      </div>
      {query.isPending ? <p className="mt-8 text-slate-500">Loading plans…</p> : null}
      {query.data?.length === 0 ? (
        <p className="mt-8 text-slate-500">No plans are currently available.</p>
      ) : null}
    </main>
  );
}
