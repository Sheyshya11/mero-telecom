'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../features/auth/auth-provider';
import { ApiError, apiRequest } from '../../../lib/api/client';

type Customer = { id: string; customerNumber: string; firstName: string; lastName: string };
type Subscription = {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  startDate: string;
  customer: Customer;
  plan: {
    id: string;
    name: string;
    downloadMbps: number;
    uploadMbps: number;
    monthlyCents: number;
  };
};

export default function AdminSubscriptionsPage() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const subscriptions = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () =>
      apiRequest<{ data: Subscription[] }>('/subscriptions?limit=100', {}, accessToken),
    enabled: Boolean(accessToken && (user?.role === 'ADMIN' || user?.role === 'STAFF')),
  });
  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Subscription['status'] }) =>
      apiRequest<Subscription>(
        `/subscriptions/${id}`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
        accessToken,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
  });
  if (isLoading)
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Checking your session…
      </main>
    );
  if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF'))
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Staff or administrator access is required.
      </main>
    );
  const error = transition.error;
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-sm font-semibold tracking-wide text-sky-700">
          MERO TELECOM · OPERATIONS
        </p>
        <h1 className="mt-2 text-3xl font-bold">Subscriptions</h1>
        <p className="mt-2 text-slate-600">
          Review customer-selected plans and manage active service status.
        </p>
      </header>
      {subscriptions.isError ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md bg-rose-50 p-4 text-sm text-rose-800">
          <p>Some subscription data could not be loaded.</p>
          <button
            className="button-secondary"
            onClick={() => {
              void subscriptions.refetch();
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-6 rounded-md bg-rose-50 p-4 text-sm text-rose-800">
          {error instanceof ApiError ? error.message : 'Unable to update subscription.'}
        </p>
      ) : null}
      <div className="mt-8">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="font-semibold">Subscription history</h2>
          </div>
          {subscriptions.isPending && <p className="p-6 text-slate-600">Loading subscriptions…</p>}
          <div className="divide-y divide-slate-100">
            {subscriptions.data?.data.map((subscription) => (
              <article
                className="flex flex-wrap items-center justify-between gap-4 p-6"
                key={subscription.id}
              >
                <div>
                  <p className="font-semibold">
                    {subscription.customer.firstName} {subscription.customer.lastName}{' '}
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs">
                      {subscription.status}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {subscription.plan.name} · {subscription.plan.downloadMbps}/
                    {subscription.plan.uploadMbps} Mbps · starts{' '}
                    {new Date(subscription.startDate).toLocaleDateString('en-AU')}
                  </p>
                </div>
                <div className="flex gap-2">
                  {subscription.status === 'ACTIVE' && (
                    <button
                      className="button-secondary"
                      onClick={() =>
                        transition.mutate({ id: subscription.id, status: 'SUSPENDED' })
                      }
                      type="button"
                    >
                      Suspend
                    </button>
                  )}
                  {subscription.status === 'SUSPENDED' && (
                    <button
                      className="button-primary"
                      onClick={() => transition.mutate({ id: subscription.id, status: 'ACTIVE' })}
                      type="button"
                    >
                      Reactivate
                    </button>
                  )}
                  {subscription.status !== 'CANCELLED' && (
                    <button
                      className="button-secondary"
                      onClick={() =>
                        transition.mutate({ id: subscription.id, status: 'CANCELLED' })
                      }
                      type="button"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
