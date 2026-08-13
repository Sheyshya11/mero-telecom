'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuth } from '../../../features/auth/auth-provider';
import { apiRequest } from '../../../lib/api/client';
type Subscription = {
  id: string;
  status: string;
  startDate: string;
  plan: { name: string; downloadMbps: number; uploadMbps: number; monthlyCents: number };
};
export default function CustomerSubscriptionPage() {
  const { accessToken, isLoading, user } = useAuth();
  const query = useQuery({
    queryKey: ['my-subscriptions'],
    queryFn: () => apiRequest<Subscription[]>('/subscriptions/me', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });
  if (isLoading)
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Checking your session…
      </main>
    );
  if (!user || user.role !== 'CUSTOMER')
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Customer access is required.
      </main>
    );
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
          <h1 className="mt-2 text-3xl font-bold">My subscription</h1>
        </div>
        <Link className="button-secondary" href="/customer/dashboard">
          My dashboard
        </Link>
      </header>
      {query.isPending && <p className="mt-6 text-slate-600">Loading your subscription…</p>}
      {query.isError && (
        <div className="mt-6 flex items-center gap-3 text-rose-700">
          <p>Unable to load your subscription.</p>
          <button className="button-secondary" onClick={() => void query.refetch()} type="button">
            Retry
          </button>
        </div>
      )}
      <div className="mt-6 space-y-4">
        {query.data?.map((subscription) => (
          <article
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            key={subscription.id}
          >
            <div className="flex justify-between gap-4">
              <h2 className="font-semibold text-slate-950">{subscription.plan.name}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                {subscription.status}
              </span>
            </div>
            <p className="mt-2 text-slate-600">
              {subscription.plan.downloadMbps}/{subscription.plan.uploadMbps} Mbps · $
              {(subscription.plan.monthlyCents / 100).toFixed(2)}/month
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Started {new Date(subscription.startDate).toLocaleDateString('en-AU')}
            </p>
          </article>
        ))}
      </div>
      {query.data?.length === 0 && (
        <p className="mt-6 text-slate-600">You do not have a subscription yet.</p>
      )}
    </main>
  );
}
