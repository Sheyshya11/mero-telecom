'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { apiRequest } from '../../lib/api/client';

interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
}

export function PublicPlanGrid() {
  const query = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => apiRequest<PublicPlan[]>('/plans/public'),
  });

  if (query.isPending) return <p className="mt-8 text-slate-500">Loading plans…</p>;
  if (query.isError) {
    return (
      <div className="mt-8 flex items-center gap-3 text-rose-700">
        <p>Plans could not be loaded.</p>
        <button className="button-secondary" onClick={() => void query.refetch()} type="button">
          Retry
        </button>
      </div>
    );
  }
  if (query.data.length === 0) {
    return <p className="mt-8 text-slate-500">No plans are currently available.</p>;
  }

  return (
    <div className="mt-8 grid gap-5 md:grid-cols-3">
      {query.data.map((plan) => (
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
            <span className="text-sm font-normal text-slate-500">/month, GST included</span>
          </p>
          <Link
            className="button-primary mt-5 inline-flex w-full justify-center"
            href={`/checkout?planId=${encodeURIComponent(plan.id)}`}
          >
            Choose plan
          </Link>
        </article>
      ))}
    </div>
  );
}
