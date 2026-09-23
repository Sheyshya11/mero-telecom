'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { hasRole } from '../../../features/auth/auth-navigation';
import { useAuth } from '../../../features/auth/auth-provider';
import {
  type PlanFormInput,
  type PlanFormValues,
  planSchema,
} from '../../../features/plans/plan.schemas';
import type { InternetPlan, PlanLifecycle } from '../../../features/plans/plan.types';
import {
  formatPlanMoney,
  parsePlanHighlights,
  planLifecycle,
} from '../../../features/plans/plan.utils';
import { ApiError, apiRequest } from '../../../lib/api/client';

type Confirmation =
  | { kind: 'SAVE'; plan: InternetPlan; values: PlanFormValues }
  | { kind: 'PUBLISH' | 'PAUSE' | 'ACTIVATE' | 'DEACTIVATE' | 'DELETE'; plan: InternetPlan };

const lifecycleStyles: Record<PlanLifecycle, string> = {
  DRAFT: 'bg-secondary text-foreground',
  PUBLISHED: 'bg-success-subtle text-success-foreground',
  PAUSED: 'bg-warning-subtle text-warning-foreground',
  RETIRED: 'bg-destructive-subtle text-destructive-foreground',
};

export default function AdminPlansPage() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<InternetPlan | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<PlanLifecycle | ''>('');
  const form = useForm<PlanFormInput, undefined, PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: emptyPlanForm(),
  });

  const canManagePlans = Boolean(user && hasRole(user, 'ADMIN', 'SUPER_ADMIN'));
  const plansQuery = useQuery({
    queryKey: ['plans'],
    queryFn: () => apiRequest<InternetPlan[]>('/plans', {}, accessToken ?? ''),
    enabled: Boolean(accessToken && canManagePlans),
  });

  const refreshPlans = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['plans'] }),
      queryClient.invalidateQueries({ queryKey: ['public-plans'] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (values: PlanFormValues) =>
      apiRequest<InternetPlan>(
        '/plans',
        {
          method: 'POST',
          body: JSON.stringify(planPayload(values, false)),
        },
        accessToken ?? '',
      ),
    onSuccess: async () => {
      await refreshPlans();
      form.reset(emptyPlanForm());
      setNotice('Draft plan created. Add a coverage rule before publishing it.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ plan, values }: { plan: InternetPlan; values: PlanFormValues }) =>
      apiRequest<InternetPlan>(
        `/plans/${plan.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ...planPayload(values, true), expectedUpdatedAt: plan.updatedAt }),
        },
        accessToken ?? '',
      ),
    onSuccess: async () => {
      await refreshPlans();
      setEditingPlan(null);
      form.reset(emptyPlanForm());
      setNotice('Plan changes saved. Existing subscribers keep their agreed monthly price.');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ plan, changes }: { plan: InternetPlan; changes: Partial<InternetPlan> }) =>
      apiRequest<InternetPlan>(
        `/plans/${plan.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ...changes, expectedUpdatedAt: plan.updatedAt }),
        },
        accessToken ?? '',
      ),
    onSuccess: async (plan) => {
      await refreshPlans();
      setNotice(`Plan is now ${planLifecycle(plan).toLowerCase()}.`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (plan: InternetPlan) =>
      apiRequest<InternetPlan>(
        `/plans/${plan.id}?expectedUpdatedAt=${encodeURIComponent(plan.updatedAt)}`,
        { method: 'DELETE' },
        accessToken ?? '',
      ),
    onSuccess: async () => {
      await refreshPlans();
      setNotice('Unused retired plan deleted.');
    },
  });

  const displayedPlans = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (plansQuery.data ?? []).filter((plan) => {
      if (lifecycleFilter && planLifecycle(plan) !== lifecycleFilter) return false;
      if (!normalizedSearch) return true;
      return [plan.name, plan.description ?? '', ...plan.highlights].some((value) =>
        value.toLowerCase().includes(normalizedSearch),
      );
    });
  }, [lifecycleFilter, plansQuery.data, search]);

  if (isLoading) return <PageStatus message="Checking your session…" />;
  if (!user) return <PageStatus message="Sign in to manage internet plans." />;
  if (!canManagePlans) return <PageStatus message="Administrator access is required." />;

  const requestError =
    createMutation.error ?? updateMutation.error ?? statusMutation.error ?? deleteMutation.error;
  const errorMessage =
    requestError instanceof ApiError
      ? requestError.message
      : requestError
        ? 'Unable to save the plan.'
        : null;
  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    statusMutation.isPending ||
    deleteMutation.isPending;

  function resetFeedback() {
    setNotice(null);
    createMutation.reset();
    updateMutation.reset();
    statusMutation.reset();
    deleteMutation.reset();
  }

  function beginEditing(plan: InternetPlan) {
    resetFeedback();
    setEditingPlan(plan);
    form.reset({
      name: plan.name,
      description: plan.description ?? '',
      highlightsText: plan.highlights.join('\n'),
      downloadMbps: plan.downloadMbps,
      uploadMbps: plan.uploadMbps,
      monthlyPrice: plan.monthlyCents / 100,
      tierRank: plan.tierRank,
      isPublic: plan.isPublic,
      isAvailable: plan.isAvailable,
      isFeatured: plan.isFeatured,
    });
  }

  function confirmAction() {
    if (!confirmation) return;
    resetFeedback();
    if (confirmation.kind === 'SAVE') {
      updateMutation.mutate({ plan: confirmation.plan, values: confirmation.values });
    } else if (confirmation.kind === 'PUBLISH') {
      statusMutation.mutate({
        plan: confirmation.plan,
        changes: { isActive: true, isPublic: true, isAvailable: true },
      });
    } else if (confirmation.kind === 'PAUSE') {
      statusMutation.mutate({ plan: confirmation.plan, changes: { isAvailable: false } });
    } else if (confirmation.kind === 'ACTIVATE') {
      statusMutation.mutate({ plan: confirmation.plan, changes: { isActive: true } });
    } else if (confirmation.kind === 'DEACTIVATE') {
      statusMutation.mutate({ plan: confirmation.plan, changes: { isActive: false } });
    } else {
      deleteMutation.mutate(confirmation.plan);
    }
    setConfirmation(null);
  }

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-wide text-primary">ADMIN · PLAN CATALOGUE</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Internet plans</h1>
          <p className="mt-2 text-muted-foreground">
            Create draft plans, configure coverage, and publish them when they are ready.
          </p>
        </div>
        <span className="rounded-full bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success-foreground">
          Administrator
        </span>
      </header>

      {notice ? (
        <p className="mb-6 rounded-md bg-success-subtle p-3 text-sm text-success-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mb-6 rounded-md bg-destructive-subtle p-3 text-sm text-destructive-foreground" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-7 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">
            {editingPlan ? `Edit ${editingPlan.name}` : 'Add a plan'}
          </h2>
          {!editingPlan ? (
            <p className="mt-2 text-sm text-muted-foreground">
              New plans are saved as drafts so they cannot be advertised before coverage is set up.
            </p>
          ) : null}
          <form
            className="mt-5 space-y-4"
            onSubmit={form.handleSubmit((values) => {
              resetFeedback();
              if (editingPlan) setConfirmation({ kind: 'SAVE', plan: editingPlan, values });
              else createMutation.mutate(values);
            })}
          >
            <FormField label="Plan name" error={form.formState.errors.name?.message}>
              <input autoFocus className="field mt-1" {...form.register('name')} />
            </FormField>
            <FormField label="Tier rank" error={form.formState.errors.tierRank?.message}>
              <input className="field mt-1" min="0" type="number" {...form.register('tierRank')} />
            </FormField>
            {editingPlan ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Checkbox label="Publicly visible" registration={form.register('isPublic')} />
                <Checkbox label="Available to order" registration={form.register('isAvailable')} />
                <Checkbox label="Featured plan" registration={form.register('isFeatured')} />
              </div>
            ) : null}
            {form.formState.errors.isAvailable?.message ? (
              <p className="text-sm text-destructive-foreground">{form.formState.errors.isAvailable.message}</p>
            ) : null}
            {form.formState.errors.isFeatured?.message ? (
              <p className="text-sm text-destructive-foreground">{form.formState.errors.isFeatured.message}</p>
            ) : null}
            <FormField
              label="Description (optional)"
              error={form.formState.errors.description?.message}
            >
              <textarea className="field mt-1 min-h-24" {...form.register('description')} />
            </FormField>
            <FormField
              label="Best-for highlights (one per line, up to five)"
              error={form.formState.errors.highlightsText?.message}
            >
              <textarea
                className="field mt-1 min-h-28"
                placeholder={'Multiple devices at once\nHD streaming\nWorking from home'}
                {...form.register('highlightsText')}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Download Mbps" error={form.formState.errors.downloadMbps?.message}>
                <input
                  className="field mt-1"
                  min="1"
                  type="number"
                  {...form.register('downloadMbps')}
                />
              </FormField>
              <FormField label="Upload Mbps" error={form.formState.errors.uploadMbps?.message}>
                <input
                  className="field mt-1"
                  min="1"
                  type="number"
                  {...form.register('uploadMbps')}
                />
              </FormField>
            </div>
            <FormField
              label="Monthly price (AUD)"
              error={form.formState.errors.monthlyPrice?.message}
            >
              <input
                className="field mt-1"
                min="0.01"
                step="0.01"
                type="number"
                {...form.register('monthlyPrice')}
              />
            </FormField>
            <div className="flex flex-wrap gap-3">
              {editingPlan ? (
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditingPlan(null);
                    form.reset(emptyPlanForm());
                    resetFeedback();
                  }}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
              <button className="button-primary" disabled={busy} type="submit">
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving…'
                  : editingPlan
                    ? 'Review changes'
                    : 'Create draft plan'}
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-5">
            <h2 className="text-lg font-semibold text-foreground">Plan catalogue</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <input
                aria-label="Search plans"
                className="field"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search plans"
                type="search"
                value={search}
              />
              <select
                aria-label="Filter by lifecycle"
                className="field"
                onChange={(event) => setLifecycleFilter(event.target.value as PlanLifecycle | '')}
                value={lifecycleFilter}
              >
                <option value="">All lifecycle states</option>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="PAUSED">Paused</option>
                <option value="RETIRED">Retired</option>
              </select>
            </div>
          </div>
          {plansQuery.isPending ? <p className="p-6 text-muted-foreground">Loading plans…</p> : null}
          {plansQuery.isError ? (
            <div className="flex items-center gap-3 p-6 text-destructive-foreground">
              <p>Unable to load plans.</p>
              <button
                className="button-secondary"
                onClick={() => void plansQuery.refetch()}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}
          {plansQuery.data?.length === 0 ? (
            <p className="p-6 text-muted-foreground">No plans have been created yet.</p>
          ) : displayedPlans.length === 0 && plansQuery.data ? (
            <p className="p-6 text-muted-foreground">No plans match these filters.</p>
          ) : null}
          <div className="divide-y divide-border/70">
            {displayedPlans.map((plan) => (
              <PlanCard
                busy={busy}
                key={plan.id}
                onAction={(kind) => {
                  resetFeedback();
                  setConfirmation({ kind, plan });
                }}
                onEdit={() => beginEditing(plan)}
                plan={plan}
              />
            ))}
          </div>
        </section>
      </div>

      <PlanConfirmation
        confirmation={confirmation}
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmAction}
      />
    </main>
  );
}

function emptyPlanForm(): PlanFormInput {
  return {
    name: '',
    description: '',
    highlightsText: '',
    downloadMbps: 50,
    uploadMbps: 20,
    monthlyPrice: 59,
    tierRank: 1,
    isPublic: false,
    isAvailable: false,
    isFeatured: false,
  };
}

function planPayload(values: PlanFormValues, includeLifecycle: boolean) {
  return {
    name: values.name,
    description: values.description || null,
    highlights: parsePlanHighlights(values.highlightsText),
    downloadMbps: values.downloadMbps,
    uploadMbps: values.uploadMbps,
    monthlyCents: Math.round(values.monthlyPrice * 100),
    tierRank: values.tierRank,
    ...(includeLifecycle
      ? {
          isPublic: values.isPublic,
          isAvailable: values.isAvailable,
          isFeatured: values.isFeatured,
        }
      : {}),
  };
}

function PlanCard({
  busy,
  onAction,
  onEdit,
  plan,
}: Readonly<{
  busy: boolean;
  onAction: (kind: Exclude<Confirmation['kind'], 'SAVE'>) => void;
  onEdit: () => void;
  plan: InternetPlan;
}>) {
  const lifecycle = planLifecycle(plan);
  return (
    <article className="grid gap-4 p-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-foreground">{plan.name}</h3>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${lifecycleStyles[lifecycle]}`}
          >
            {lifecycle.charAt(0) + lifecycle.slice(1).toLowerCase()}
          </span>
          {plan.isFeatured ? (
            <span className="rounded-full bg-info-subtle px-2.5 py-1 text-xs text-info-foreground">
              Featured
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.downloadMbps} Mbps down · {plan.uploadMbps} Mbps up ·{' '}
          {formatPlanMoney(plan.monthlyCents)}/month · rank {plan.tierRank}
        </p>
        {plan.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
        ) : null}
        {plan.highlights.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {plan.highlights.map((highlight, index) => (
              <span
                className="rounded-full bg-primary-subtle px-2.5 py-1 text-xs text-primary"
                key={`${highlight}-${index}`}
              >
                {highlight}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="button-secondary" disabled={busy} onClick={onEdit} type="button">
          Edit
        </button>
        {lifecycle === 'PUBLISHED' ? (
          <button
            className="button-secondary"
            disabled={busy}
            onClick={() => onAction('PAUSE')}
            type="button"
          >
            Pause orders
          </button>
        ) : lifecycle !== 'RETIRED' ? (
          <button
            className="button-secondary"
            disabled={busy}
            onClick={() => onAction('PUBLISH')}
            type="button"
          >
            {lifecycle === 'PAUSED' ? 'Resume orders' : 'Publish'}
          </button>
        ) : null}
        {lifecycle !== 'RETIRED' ? (
          <button
            className="button-secondary"
            disabled={busy}
            onClick={() => onAction('DEACTIVATE')}
            type="button"
          >
            Deactivate
          </button>
        ) : (
          <>
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() => onAction('ACTIVATE')}
              type="button"
            >
              Reactivate as draft
            </button>
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() => onAction('DELETE')}
              type="button"
            >
              Delete unused plan
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function PlanConfirmation({
  confirmation,
  onCancel,
  onConfirm,
}: Readonly<{
  confirmation: Confirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const copy = confirmationCopy(confirmation);
  return (
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={
              confirmation?.kind === 'DELETE' || confirmation?.kind === 'DEACTIVATE'
                ? undefined
                : 'bg-primary hover:bg-primary-hover'
            }
            onClick={onConfirm}
          >
            {copy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function confirmationCopy(confirmation: Confirmation | null) {
  if (!confirmation) return { title: '', description: '', action: 'Confirm' };
  if (confirmation.kind === 'SAVE') {
    const priceChanged =
      Math.round(confirmation.values.monthlyPrice * 100) !== confirmation.plan.monthlyCents;
    return {
      title: `Save changes to ${confirmation.plan.name}?`,
      description: priceChanged
        ? 'The new catalogue price applies to future subscriptions. Existing subscribers retain their agreed monthly price.'
        : 'This updates the customer-facing catalogue. Existing subscription pricing remains unchanged.',
      action: 'Save changes',
    };
  }
  if (confirmation.kind === 'PUBLISH') {
    return {
      title: `Publish ${confirmation.plan.name}?`,
      description:
        'The plan will become visible and orderable after its active coverage rules are verified.',
      action: 'Publish plan',
    };
  }
  if (confirmation.kind === 'PAUSE') {
    return {
      title: `Pause orders for ${confirmation.plan.name}?`,
      description:
        'The plan will immediately disappear from new purchases and plan-change choices.',
      action: 'Pause orders',
    };
  }
  if (confirmation.kind === 'DEACTIVATE') {
    return {
      title: `Deactivate ${confirmation.plan.name}?`,
      description:
        'The plan will be retired and hidden. Existing subscriptions and their prices are preserved.',
      action: 'Deactivate plan',
    };
  }
  if (confirmation.kind === 'ACTIVATE') {
    return {
      title: `Reactivate ${confirmation.plan.name}?`,
      description:
        'The plan will return as a draft and will not be advertised until it is published.',
      action: 'Reactivate plan',
    };
  }
  return {
    title: `Delete ${confirmation.plan.name}?`,
    description:
      'Deletion succeeds only when the retired plan has no coverage, purchase, subscription, or plan-change history.',
    action: 'Delete plan',
  };
}

function FormField({
  children,
  error,
  label,
}: Readonly<{ children: React.ReactNode; error?: string; label: string }>) {
  return (
    <label className="block text-sm font-medium text-foreground">
      {label}
      {children}
      {error ? <span className="mt-1 block text-sm text-destructive-foreground">{error}</span> : null}
    </label>
  );
}

function Checkbox({
  label,
  registration,
}: Readonly<{ label: string; registration: UseFormRegisterReturn }>) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input type="checkbox" {...registration} /> {label}
    </label>
  );
}

function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-muted-foreground">
      {message}
    </main>
  );
}
