'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '../../../features/auth/auth-provider';
import { ApiError, apiRequest } from '../../../lib/api/client';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  highlights: string[];
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
}

function parseHighlights(value: string): string[] {
  return value
    .split('\n')
    .map((highlight) => highlight.trim())
    .filter(Boolean);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default function StaffPlansPage() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [highlightsText, setHighlightsText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const canEditHighlights =
    user?.role === 'STAFF' || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const plansQuery = useQuery({
    queryKey: ['plans'],
    queryFn: () => apiRequest<Plan[]>('/plans', {}, accessToken ?? ''),
    enabled: Boolean(accessToken && canEditHighlights),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, highlights }: { id: string; highlights: string[] }) =>
      apiRequest<Plan>(
        `/plans/${id}/highlights`,
        {
          method: 'PATCH',
          body: JSON.stringify({ highlights }),
        },
        accessToken ?? '',
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plans'] }),
        queryClient.invalidateQueries({ queryKey: ['public-plans'] }),
      ]);
      setEditingPlan(null);
      setHighlightsText('');
      setValidationError(null);
    },
  });

  if (isLoading) {
    return <PageStatus message="Restoring your session…" />;
  }

  if (!user) {
    return <PageStatus message="Sign in to manage plan highlights." />;
  }

  if (!canEditHighlights) {
    return <PageStatus message="Plan highlights require staff access." />;
  }

  const requestError = updateMutation.error;
  const errorMessage =
    validationError ??
    (requestError instanceof ApiError
      ? requestError.message
      : requestError
        ? 'Unable to save the plan highlights.'
        : null);
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

  function startEditing(plan: Plan) {
    setEditingPlan(plan);
    setHighlightsText(plan.highlights.join('\n'));
    setValidationError(null);
    updateMutation.reset();
  }

  function saveHighlights() {
    if (!editingPlan) return;

    const highlights = parseHighlights(highlightsText);
    if (highlights.length > 5) {
      setValidationError('Add no more than five highlights.');
      return;
    }
    if (highlights.some((highlight) => highlight.length > 100)) {
      setValidationError('Each highlight must be 100 characters or fewer.');
      return;
    }

    setValidationError(null);
    updateMutation.mutate({ id: editingPlan.id, highlights });
  }

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-primary">
            {isAdmin ? 'ADMIN' : 'STAFF'} · PLAN HIGHLIGHTS
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Plan highlights</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Manage the customer-facing “Best for” points. Pricing, speeds and availability remain
            administrator-controlled.
          </p>
        </div>
      </header>

      <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5">
          <h2 className="text-lg font-semibold text-foreground">Internet plans</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use short, specific phrases. Up to five highlights are shown on each landing-page card.
          </p>
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
        ) : null}

        <div className="divide-y divide-slate-100">
          {plansQuery.data?.map((plan) => (
            <article
              className="grid gap-4 p-6 md:grid-cols-[minmax(0,1fr)_minmax(18rem,1.35fr)_auto] md:items-center"
              key={plan.id}
            >
              <div>
                <h3 className="font-semibold text-foreground">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan.downloadMbps}/{plan.uploadMbps} Mbps · {formatMoney(plan.monthlyCents)}
                  /month
                </p>
                {plan.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{plan.description}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {plan.highlights.length ? (
                  plan.highlights.map((highlight) => (
                    <span
                      className="rounded-full bg-primary-subtle px-2.5 py-1 text-xs font-medium text-primary"
                      key={highlight}
                    >
                      {highlight}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No custom highlights yet.</span>
                )}
              </div>
              <button className="button-secondary" onClick={() => startEditing(plan)} type="button">
                Edit highlights
              </button>
            </article>
          ))}
        </div>
      </section>

      {editingPlan ? (
        <div className="fixed inset-0 z-20 grid place-items-center bg-overlay p-4">
          <section
            aria-labelledby="highlight-editor-title"
            aria-modal="true"
            className="w-full max-w-xl rounded-2xl bg-card p-6 shadow-2xl"
            role="dialog"
          >
            <p className="text-sm font-semibold tracking-wide text-primary">BEST FOR</p>
            <h2 className="mt-1 text-xl font-bold text-foreground" id="highlight-editor-title">
              Edit {editingPlan.name}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Add one feature per line. These appear in the lower section of the public plan card.
            </p>
            <label className="mt-5 block text-sm font-medium text-foreground">
              Plan highlights <span className="text-muted-foreground/70">(up to five)</span>
              <textarea
                autoFocus
                className="field mt-1 min-h-36"
                maxLength={504}
                onChange={(event) => {
                  setHighlightsText(event.target.value);
                  setValidationError(null);
                }}
                placeholder={'Multiple devices at once\nHD streaming\nWorking from home'}
                value={highlightsText}
              />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              {parseHighlights(highlightsText).length}/5 highlights
            </p>
            {errorMessage ? (
              <p className="mt-4 rounded-md bg-destructive-subtle p-3 text-sm text-destructive-foreground">{errorMessage}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="button-secondary"
                disabled={updateMutation.isPending}
                onClick={() => {
                  setEditingPlan(null);
                  setHighlightsText('');
                  setValidationError(null);
                  updateMutation.reset();
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button-primary"
                disabled={updateMutation.isPending}
                onClick={saveHighlights}
                type="button"
              >
                {updateMutation.isPending ? 'Saving…' : 'Save highlights'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-muted-foreground">
      {message}
    </main>
  );
}
