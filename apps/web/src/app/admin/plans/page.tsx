'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../../../features/auth/auth-provider';
import { ApiError, apiRequest } from '../../../lib/api/client';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
  isActive: boolean;
}

const planSchema = z.object({
  name: z.string().trim().min(2, 'Enter a plan name.').max(150),
  description: z.string().trim().max(2000).optional(),
  downloadMbps: z.coerce.number().int().min(1, 'Must be at least 1 Mbps.'),
  uploadMbps: z.coerce.number().int().min(1, 'Must be at least 1 Mbps.'),
  monthlyPrice: z.coerce.number().positive('Enter a price greater than zero.'),
});

type PlanFormInput = z.input<typeof planSchema>;
type PlanFormValues = z.output<typeof planSchema>;

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

export default function AdminPlansPage() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const form = useForm<PlanFormInput, undefined, PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: '',
      description: '',
      downloadMbps: 50,
      uploadMbps: 20,
      monthlyPrice: 59,
    },
  });

  const plansQuery = useQuery({
    queryKey: ['plans'],
    queryFn: () => apiRequest<Plan[]>('/plans', {}, accessToken ?? ''),
    enabled: Boolean(accessToken && user?.role === 'ADMIN'),
  });

  const createMutation = useMutation({
    mutationFn: (values: PlanFormValues) =>
      apiRequest<Plan>(
        '/plans',
        {
          method: 'POST',
          body: JSON.stringify({
            name: values.name,
            description: values.description || undefined,
            downloadMbps: values.downloadMbps,
            uploadMbps: values.uploadMbps,
            monthlyCents: Math.round(values.monthlyPrice * 100),
          }),
        },
        accessToken ?? '',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plans'] });
      form.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (values: PlanFormValues) =>
      apiRequest<Plan>(
        `/plans/${editingPlan?.id ?? ''}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: values.name,
            description: values.description || null,
            downloadMbps: values.downloadMbps,
            uploadMbps: values.uploadMbps,
            monthlyCents: Math.round(values.monthlyPrice * 100),
          }),
        },
        accessToken ?? '',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plans'] });
      setEditingPlan(null);
      form.reset();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: Pick<Plan, 'id' | 'isActive'>) =>
      apiRequest<Plan>(
        `/plans/${id}`,
        { method: 'PATCH', body: JSON.stringify({ isActive }) },
        accessToken ?? '',
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-slate-600">
        Checking your session…
      </main>
    );
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-slate-600">
        Sign in to manage internet plans.
      </main>
    );
  }

  if (user.role !== 'ADMIN') {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-slate-600">
        Administrator access is required.
      </main>
    );
  }

  const requestError = createMutation.error ?? updateMutation.error ?? statusMutation.error;
  const errorMessage =
    requestError instanceof ApiError
      ? requestError.message
      : requestError
        ? 'Unable to save the plan.'
        : null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM · ADMIN</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Internet plans</h1>
          <p className="mt-2 text-slate-600">
            Create plans and control whether they can be offered to customers.
          </p>
        </div>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          Administrator
        </span>
      </header>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            {editingPlan ? `Edit ${editingPlan.name}` : 'Add a plan'}
          </h2>
          <form
            className="mt-5 space-y-4"
            onSubmit={form.handleSubmit((values) => {
              if (editingPlan) {
                updateMutation.mutate(values);
              } else {
                createMutation.mutate(values);
              }
            })}
          >
            <label className="block text-sm font-medium text-slate-700">
              Plan name
              <input className="field mt-1" {...form.register('name')} />
              {form.formState.errors.name && (
                <span className="mt-1 block text-sm text-rose-700">
                  {form.formState.errors.name.message}
                </span>
              )}
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Description <span className="text-slate-400">(optional)</span>
              <textarea className="field mt-1 min-h-24" {...form.register('description')} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-slate-700">
                Download Mbps
                <input
                  className="field mt-1"
                  type="number"
                  min="1"
                  {...form.register('downloadMbps')}
                />
                {form.formState.errors.downloadMbps && (
                  <span className="mt-1 block text-sm text-rose-700">
                    {form.formState.errors.downloadMbps.message}
                  </span>
                )}
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Upload Mbps
                <input
                  className="field mt-1"
                  type="number"
                  min="1"
                  {...form.register('uploadMbps')}
                />
                {form.formState.errors.uploadMbps && (
                  <span className="mt-1 block text-sm text-rose-700">
                    {form.formState.errors.uploadMbps.message}
                  </span>
                )}
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Monthly price (AUD)
              <input
                className="field mt-1"
                type="number"
                min="0.01"
                step="0.01"
                {...form.register('monthlyPrice')}
              />
              {form.formState.errors.monthlyPrice && (
                <span className="mt-1 block text-sm text-rose-700">
                  {form.formState.errors.monthlyPrice.message}
                </span>
              )}
            </label>
            {errorMessage && (
              <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{errorMessage}</p>
            )}
            {editingPlan && (
              <button
                className="button-secondary mr-3"
                onClick={() => {
                  setEditingPlan(null);
                  form.reset();
                }}
                type="button"
              >
                Cancel
              </button>
            )}
            <button
              className="button-primary"
              disabled={createMutation.isPending || updateMutation.isPending}
              type="submit"
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'Saving…'
                : editingPlan
                  ? 'Save changes'
                  : 'Create plan'}
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Available plans</h2>
          </div>
          {plansQuery.isLoading && <p className="p-6 text-slate-600">Loading plans…</p>}
          {plansQuery.isError && <p className="p-6 text-red-700">Unable to load plans.</p>}
          {plansQuery.data?.length === 0 && (
            <p className="p-6 text-slate-600">No plans have been created yet.</p>
          )}
          <div className="divide-y divide-slate-100">
            {plansQuery.data?.map((plan) => (
              <article
                className="flex flex-wrap items-center justify-between gap-4 p-6"
                key={plan.id}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-950">{plan.name}</h3>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${plan.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}
                    >
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {plan.downloadMbps} Mbps down · {plan.uploadMbps} Mbps up ·{' '}
                    {formatMoney(plan.monthlyCents)}/month
                  </p>
                  {plan.description && (
                    <p className="mt-2 text-sm text-slate-500">{plan.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    className="button-secondary"
                    onClick={() => {
                      setEditingPlan(plan);
                      form.reset({
                        name: plan.name,
                        description: plan.description ?? '',
                        downloadMbps: plan.downloadMbps,
                        uploadMbps: plan.uploadMbps,
                        monthlyPrice: plan.monthlyCents / 100,
                      });
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="button-secondary"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: plan.id, isActive: !plan.isActive })}
                    type="button"
                  >
                    {plan.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
