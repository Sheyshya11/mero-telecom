'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../../../features/auth/auth-provider';
import { ApiError, apiRequest } from '../../../lib/api/client';

type Customer = { id: string; customerNumber: string; firstName: string; lastName: string };
type Plan = {
  id: string;
  name: string;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
};
type Subscription = {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  startDate: string;
  customer: Customer;
  plan: Plan;
};
const schema = z.object({
  customerId: z.string().uuid('Select a customer.'),
  planId: z.string().uuid('Select an active plan.'),
  startDate: z.string().date('Select a start date.'),
});
type Values = z.infer<typeof schema>;

export default function AdminSubscriptionsPage() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { customerId: '', planId: '', startDate: new Date().toISOString().slice(0, 10) },
  });
  const customers = useQuery({
    queryKey: ['subscription-customers'],
    queryFn: () => apiRequest<{ data: Customer[] }>('/customers?limit=100', {}, accessToken),
    enabled: Boolean(accessToken && (user?.role === 'ADMIN' || user?.role === 'STAFF')),
  });
  const plans = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: () => apiRequest<Plan[]>('/plans/public'),
    enabled: Boolean(accessToken && user),
  });
  const subscriptions = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () =>
      apiRequest<{ data: Subscription[] }>('/subscriptions?limit=100', {}, accessToken),
    enabled: Boolean(accessToken && (user?.role === 'ADMIN' || user?.role === 'STAFF')),
  });
  const create = useMutation({
    mutationFn: (values: Values) =>
      apiRequest<Subscription>(
        '/subscriptions',
        { method: 'POST', body: JSON.stringify(values) },
        accessToken,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      form.reset({ customerId: '', planId: '', startDate: new Date().toISOString().slice(0, 10) });
    },
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
  const error = create.error ?? transition.error;
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-sm font-semibold tracking-wide text-sky-700">
          MERO TELECOM · OPERATIONS
        </p>
        <h1 className="mt-2 text-3xl font-bold">Subscriptions</h1>
        <p className="mt-2 text-slate-600">
          Assign active plans and manage the subscription lifecycle.
        </p>
      </header>
      {customers.isError || plans.isError || subscriptions.isError ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md bg-rose-50 p-4 text-sm text-rose-800">
          <p>Some subscription data could not be loaded.</p>
          <button
            className="button-secondary"
            onClick={() => {
              void customers.refetch();
              void plans.refetch();
              void subscriptions.refetch();
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="mt-8 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Assign a plan</h2>
          <form
            className="mt-5 space-y-4"
            onSubmit={form.handleSubmit((values) => create.mutate(values))}
          >
            <label className="block text-sm font-medium">
              Customer
              <select className="field mt-1" {...form.register('customerId')}>
                <option value="">Select customer</option>
                {customers.data?.data.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.customerNumber} — {customer.firstName} {customer.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Active plan
              <select className="field mt-1" {...form.register('planId')}>
                <option value="">Select plan</option>
                {plans.data?.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} — ${(plan.monthlyCents / 100).toFixed(2)}/month
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Start date
              <input className="field mt-1" type="date" {...form.register('startDate')} />
            </label>
            {Object.values(form.formState.errors).map((entry) => (
              <p className="text-sm text-rose-700" key={entry.message}>
                {entry.message}
              </p>
            ))}
            {error && (
              <p className="text-sm text-rose-700">
                {error instanceof ApiError ? error.message : 'Unable to save subscription.'}
              </p>
            )}
            <button className="button-primary w-full" disabled={create.isPending} type="submit">
              {create.isPending ? 'Assigning…' : 'Assign as pending'}
            </button>
          </form>
        </section>
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
                  {subscription.status === 'PENDING' && (
                    <button
                      className="button-primary"
                      onClick={() => transition.mutate({ id: subscription.id, status: 'ACTIVE' })}
                      type="button"
                    >
                      Activate
                    </button>
                  )}
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
