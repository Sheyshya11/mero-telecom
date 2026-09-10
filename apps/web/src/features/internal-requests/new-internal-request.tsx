'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest } from '../../lib/api/client';
import { hasRole } from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import {
  internalRequestPriorities,
  internalRequestTypes,
  type InternalRequest,
  type InternalRequestContextOptions,
} from './internal-request.types';

const optionalId = z.string();
const formSchema = z.object({
  type: z.enum([
    'REFUND_REVIEW',
    'BILLING_REVIEW',
    'SUBSCRIPTION_ACTION',
    'CUSTOMER_ACCOUNT_ACTION',
    'PLAN_CHANGE_REVIEW',
    'SUPPORT_ASSISTANCE',
    'OTHER',
  ]),
  title: z.string().trim().min(3, 'Enter a clear title.').max(200),
  description: z.string().trim().min(1, 'Describe what Admin needs to review.').max(5000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']),
  customerId: optionalId,
  supportCaseId: optionalId,
  invoiceId: optionalId,
  paymentId: optionalId,
  refundId: optionalId,
  subscriptionId: optionalId,
  planChangeRequestId: optionalId,
});

type FormValues = z.infer<typeof formSchema>;

export function NewInternalRequest({
  initialCustomerId = '',
  initialSupportCaseNumber = '',
  initialSubscriptionId = '',
  initialTitle = '',
  initialType = '',
}: Readonly<{
  initialCustomerId?: string;
  initialSupportCaseNumber?: string;
  initialSubscriptionId?: string;
  initialTitle?: string;
  initialType?: string;
}>) {
  const { accessToken, isLoading, user } = useAuth();
  const router = useRouter();
  const [customerSearch, setCustomerSearch] = useState('');
  const permitted = Boolean(user && hasRole(user, 'STAFF'));
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: internalRequestTypes.some((option) => option.value === initialType)
        ? (initialType as FormValues['type'])
        : 'SUPPORT_ASSISTANCE',
      title: initialTitle,
      description: '',
      priority: 'NORMAL',
      customerId: initialCustomerId,
      supportCaseId: '',
      invoiceId: '',
      paymentId: '',
      refundId: '',
      subscriptionId: initialSubscriptionId,
      planChangeRequestId: '',
    },
  });
  const selectedCustomerId = form.watch('customerId');
  const discovery = useQuery({
    queryKey: ['internal-request-customer-options', customerSearch],
    queryFn: () =>
      apiRequest<InternalRequestContextOptions>(
        `/staff/internal-requests/context-options?${new URLSearchParams(customerSearch ? { search: customerSearch } : {}).toString()}`,
        {},
        accessToken,
      ),
    enabled: Boolean(accessToken && permitted && !selectedCustomerId && !initialSupportCaseNumber),
  });
  const context = useQuery({
    queryKey: ['internal-request-context', selectedCustomerId, initialSupportCaseNumber],
    queryFn: () => {
      const query = new URLSearchParams();
      if (selectedCustomerId) query.set('customerId', selectedCustomerId);
      if (initialSupportCaseNumber) query.set('supportCaseNumber', initialSupportCaseNumber);
      return apiRequest<InternalRequestContextOptions>(
        `/staff/internal-requests/context-options?${query}`,
        {},
        accessToken,
      );
    },
    enabled: Boolean(accessToken && permitted && (selectedCustomerId || initialSupportCaseNumber)),
  });

  useEffect(() => {
    if (!context.data) return;
    if (context.data.selectedCustomerId && !form.getValues('customerId')) {
      form.setValue('customerId', context.data.selectedCustomerId);
    }
    if (context.data.selectedSupportCaseId && !form.getValues('supportCaseId')) {
      form.setValue('supportCaseId', context.data.selectedSupportCaseId);
    }
  }, [context.data, form]);

  const create = useMutation({
    mutationFn: (values: FormValues) => {
      const relationships = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) =>
            !['type', 'title', 'description', 'priority'].includes(key) && Boolean(value),
        ),
      );
      return apiRequest<InternalRequest>(
        '/staff/internal-requests',
        {
          method: 'POST',
          body: JSON.stringify({
            type: values.type,
            title: values.title.trim(),
            description: values.description.trim(),
            priority: values.priority,
            ...relationships,
          }),
        },
        accessToken,
      );
    },
    onSuccess: (created) => {
      router.push(`/control-centre/internal-requests/${created.requestNumber}`);
    },
  });

  if (isLoading) return <PageStatus message="Restoring your session…" />;
  if (!permitted) return <PageStatus message="Staff access is required." />;

  const options = context.data ?? discovery.data;
  const relationshipLoading = context.isFetching;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-4xl px-4 py-8 text-slate-950 sm:px-6 sm:py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">STAFF · ADMIN ACTION</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">New Internal Request</h1>
          <p className="mt-2 text-slate-600">
            Ask Admin to review or authorise work you cannot complete directly.
          </p>
        </div>
        <Link className="button-secondary" href="/control-centre/internal-requests">
          Cancel
        </Link>
      </header>

      <form
        className="mt-8 grid gap-6"
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">Request details</h2>
          <p className="mt-1 text-sm text-slate-600">
            Approval records an Admin decision only. It will not execute a refund or service change.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Request type" error={form.formState.errors.type?.message}>
              <select className="field" {...form.register('type')}>
                {internalRequestTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority" error={form.formState.errors.priority?.message}>
              <select className="field" {...form.register('priority')}>
                {internalRequestPriorities.map((priority) => (
                  <option key={priority.value} value={priority.value}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4 grid gap-4">
            <Field label="Title" error={form.formState.errors.title?.message}>
              <input
                className="field"
                maxLength={200}
                placeholder="What does Admin need to review?"
                {...form.register('title')}
              />
            </Field>
            <Field label="Description" error={form.formState.errors.description?.message}>
              <textarea
                className="field min-h-40 resize-y"
                maxLength={5000}
                placeholder="Summarise your investigation, evidence and requested outcome."
                {...form.register('description')}
              />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">
            Related records <span className="font-normal text-slate-500">(optional)</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Select records instead of entering database IDs. All selected records must belong to the
            same customer.
          </p>
          {!selectedCustomerId ? (
            <label className="mt-5 grid gap-1.5 text-sm font-medium text-slate-700">
              Find customer
              <input
                className="field"
                onChange={(event) => setCustomerSearch(event.target.value.trim())}
                placeholder="Search name, email or customer number…"
                value={customerSearch}
              />
            </label>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Related customer">
              <select
                className="field"
                disabled={Boolean(initialSupportCaseNumber)}
                onChange={(event) => {
                  form.setValue('customerId', event.target.value);
                  for (const key of [
                    'supportCaseId',
                    'invoiceId',
                    'paymentId',
                    'refundId',
                    'subscriptionId',
                    'planChangeRequestId',
                  ] as const)
                    form.setValue(key, '');
                }}
                value={selectedCustomerId}
              >
                <option value="">No customer</option>
                {(options?.customers ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.customerNumber} · {customer.firstName} {customer.lastName} ·{' '}
                    {customer.email}
                  </option>
                ))}
              </select>
            </Field>
            <RelationshipSelect
              disabled={!selectedCustomerId || relationshipLoading}
              label="Related support request"
              name="supportCaseId"
              options={(options?.supportCases ?? []).map((item) => ({
                value: item.id,
                label: `${item.caseNumber} · ${item.subject}`,
              }))}
              register={form.register}
            />
            <RelationshipSelect
              disabled={!selectedCustomerId || relationshipLoading}
              label="Related invoice"
              name="invoiceId"
              options={(options?.invoices ?? []).map((item) => ({
                value: item.id,
                label: `${item.invoiceNumber} · ${item.status}`,
              }))}
              register={form.register}
            />
            <RelationshipSelect
              disabled={!selectedCustomerId || relationshipLoading}
              label="Related refund"
              name="refundId"
              options={(options?.refunds ?? []).map((item) => ({
                value: item.id,
                label: `${item.reason.replaceAll('_', ' ')} · ${item.status}`,
              }))}
              register={form.register}
            />
            <RelationshipSelect
              disabled={!selectedCustomerId || relationshipLoading}
              label="Related subscription"
              name="subscriptionId"
              options={(options?.subscriptions ?? []).map((item) => ({
                value: item.id,
                label: `${item.plan.name} · ${item.status}`,
              }))}
              register={form.register}
            />
            <RelationshipSelect
              disabled={!selectedCustomerId || relationshipLoading}
              label="Related payment"
              name="paymentId"
              options={(options?.payments ?? []).map((item) => ({
                value: item.id,
                label: `${item.providerPaymentId ?? 'Payment'} · ${item.status}`,
              }))}
              register={form.register}
            />
            <RelationshipSelect
              disabled={!selectedCustomerId || relationshipLoading}
              label="Related plan change"
              name="planChangeRequestId"
              options={(options?.planChanges ?? []).map((item) => ({
                value: item.id,
                label: `${item.type} to ${item.targetPlan.name} · ${item.status}`,
              }))}
              register={form.register}
            />
          </div>
          {relationshipLoading ? (
            <p className="mt-3 text-sm text-slate-500">Loading related records…</p>
          ) : null}
          {context.isError || discovery.isError ? (
            <p className="mt-3 text-sm text-rose-700">We couldn&apos;t load related records.</p>
          ) : null}
        </section>

        {create.error ? (
          <p className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800" role="alert">
            {create.error instanceof ApiError
              ? create.error.message
              : "We couldn't submit this request. Please try again."}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Link className="button-secondary" href="/control-centre/internal-requests">
            Cancel
          </Link>
          <button className="button-primary" disabled={create.isPending} type="submit">
            {create.isPending ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </form>
    </main>
  );
}

function RelationshipSelect({
  disabled,
  label,
  name,
  options,
  register,
}: Readonly<{
  disabled: boolean;
  label: string;
  name:
    | 'supportCaseId'
    | 'invoiceId'
    | 'paymentId'
    | 'refundId'
    | 'subscriptionId'
    | 'planChangeRequestId';
  options: Array<{ value: string; label: string }>;
  register: ReturnType<typeof useForm<FormValues>>['register'];
}>) {
  return (
    <Field label={label}>
      <select className="field" disabled={disabled} {...register(name)}>
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Field({
  label,
  error,
  children,
}: Readonly<{ label: string; error?: string; children: React.ReactNode }>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      {children}
      {error ? <span className="text-xs font-normal text-rose-700">{error}</span> : null}
    </label>
  );
}

function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <p>{message}</p>
    </main>
  );
}
