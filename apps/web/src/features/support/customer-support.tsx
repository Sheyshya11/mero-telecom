'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  DataTableControls,
  DataTablePagination,
  TableSkeleton,
  useTableQueryParams,
} from '../../components/data-table';
import { ApiError, apiRequest } from '../../lib/api/client';
import { hasRole } from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import {
  acceptedSupportFileTypes,
  categoryLabel,
  formatSupportDate,
  statusLabel,
  customerSupportCategories,
  supportStatuses,
  validateSupportFiles,
  type SupportCase,
  type SupportList,
} from './support.types';

const formSchema = z.object({
  category: z.enum(['INTERNET_CONNECTION', 'BILLING', 'PLAN', 'ACCOUNT', 'REFUND', 'OTHER']),
  subject: z.string().trim().min(3, 'Enter a short subject.').max(200),
  message: z.string().trim().min(1, 'Tell us how we can help.').max(5000),
});

type FormValues = z.infer<typeof formSchema>;

export function CustomerSupport() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const table = useTableQueryParams(['status', 'category']);
  const [showForm, setShowForm] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { category: 'INTERNET_CONNECTION', subject: '', message: '' },
  });
  const permitted = Boolean(user && hasRole(user, 'CUSTOMER'));
  const cases = useQuery({
    queryKey: ['customer-support', table.query],
    placeholderData: keepPreviousData,
    queryFn: () => apiRequest<SupportList>(`/customer/support?${table.query}`, {}, accessToken),
    enabled: Boolean(accessToken && permitted),
  });
  const create = useMutation({
    mutationFn: (values: FormValues) => {
      const body = new FormData();
      body.append('category', values.category);
      body.append('subject', values.subject.trim());
      body.append('message', values.message.trim());
      files.forEach((file) => body.append('files', file));
      return apiRequest<SupportCase>('/customer/support', { method: 'POST', body }, accessToken);
    },
    onSuccess: async (supportCase) => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['customer-support'] });
      router.push(`/customer/support/${supportCase.caseNumber}`);
    },
    onError: (error) =>
      setActionError(
        error instanceof ApiError
          ? error.message
          : "We couldn't submit your support request. Please try again.",
      ),
  });

  if (isLoading) return <PageStatus message="Restoring your session…" />;
  if (!permitted) return <PageStatus message="Customer access is required." />;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-4 py-8 text-slate-950 sm:px-6 sm:py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">HELP &amp; SUPPORT</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Support</h1>
          <p className="mt-2 text-slate-600">Ask for help and follow every reply in one place.</p>
        </div>
        <button
          className={showForm ? 'button-secondary' : 'button-primary'}
          onClick={() => setShowForm((current) => !current)}
          type="button"
        >
          {showForm ? 'Cancel' : 'Contact Support'}
        </button>
      </header>

      {showForm ? (
        <section className="mt-6 rounded-xl border border-sky-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">Create a support request</h2>
          <p className="mt-1 text-sm text-slate-600">
            Describe the issue once. Future replies will stay in the same conversation.
          </p>
          {actionError ? (
            <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              {actionError}
            </p>
          ) : null}
          <form
            className="mt-5 grid gap-4"
            onSubmit={form.handleSubmit((values) => {
              const validationError = validateSupportFiles(files);
              setFileError(validationError);
              if (!validationError) create.mutate(values);
            })}
          >
            <label className="grid gap-1.5 text-sm font-medium">
              Category
              <select className="field" {...form.register('category')}>
                {customerSupportCategories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Subject
              <input className="field" maxLength={200} {...form.register('subject')} />
              {form.formState.errors.subject ? (
                <span className="text-xs text-rose-700">
                  {form.formState.errors.subject.message}
                </span>
              ) : null}
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Message
              <textarea
                className="field min-h-32 resize-y"
                maxLength={5000}
                {...form.register('message')}
              />
              {form.formState.errors.message ? (
                <span className="text-xs text-rose-700">
                  {form.formState.errors.message.message}
                </span>
              ) : null}
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Attachments (optional)
              <input
                accept={acceptedSupportFileTypes.join(',')}
                className="field"
                multiple
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  setFiles(selected);
                  setFileError(validateSupportFiles(selected));
                }}
                type="file"
              />
              <span className="text-xs text-slate-500">
                Up to 3 files, 10 MB each (20 MB total).
              </span>
              {fileError ? <span className="text-xs text-rose-700">{fileError}</span> : null}
            </label>
            <div>
              <button className="button-primary" disabled={create.isPending} type="submit">
                {create.isPending ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="requests-heading">
        <div className="mb-4">
          <h2 className="text-xl font-semibold" id="requests-heading">
            Your support requests
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Search or filter your existing conversations.
          </p>
        </div>
        <DataTableControls
          fields={[
            { key: 'status', label: 'Status', options: supportStatuses },
            { key: 'category', label: 'Category', options: customerSupportCategories },
          ]}
          placeholder="Search reference or subject…"
          sorts={['updatedAt', 'createdAt', 'status']}
          state={table}
        />
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {cases.isPending ? <TableSkeleton /> : null}
          {cases.isError ? (
            <p className="p-6 text-rose-700">We couldn&apos;t load your support requests.</p>
          ) : null}
          {cases.data?.data.length ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-190 text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Reference</th>
                      <th>Subject</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Last updated</th>
                      <th className="px-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.data.data.map((supportCase) => (
                      <CustomerRow key={supportCase.id} supportCase={supportCase} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 p-4 md:hidden">
                {cases.data.data.map((supportCase) => (
                  <CustomerCard key={supportCase.id} supportCase={supportCase} />
                ))}
              </div>
            </>
          ) : !cases.isPending && !cases.isError ? (
            <div className="p-8 text-center">
              <p className="font-medium">You haven&apos;t created any support requests yet.</p>
              <button
                className="button-primary mt-4"
                onClick={() => setShowForm(true)}
                type="button"
              >
                Contact Support
              </button>
            </div>
          ) : null}
          <DataTablePagination
            busy={cases.isFetching}
            meta={cases.data?.meta}
            noun="requests"
            state={table}
          />
        </div>
      </section>
    </main>
  );
}

function CustomerRow({ supportCase }: Readonly<{ supportCase: SupportCase }>) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-5 py-4 font-mono text-xs font-semibold">{supportCase.caseNumber}</td>
      <td className="font-medium">{supportCase.subject}</td>
      <td>{categoryLabel(supportCase.category)}</td>
      <td>
        <StatusBadge status={supportCase.status} customer />
      </td>
      <td>{formatSupportDate(supportCase.updatedAt)}</td>
      <td className="px-5 text-right">
        <Link className="button-secondary" href={`/customer/support/${supportCase.caseNumber}`}>
          View
        </Link>
      </td>
    </tr>
  );
}

function CustomerCard({ supportCase }: Readonly<{ supportCase: SupportCase }>) {
  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs font-semibold text-sky-800">
          {supportCase.caseNumber}
        </span>
        <StatusBadge status={supportCase.status} customer />
      </div>
      <h3 className="mt-3 font-semibold">{supportCase.subject}</h3>
      <p className="mt-1 text-sm text-slate-600">
        {categoryLabel(supportCase.category)} · Updated {formatSupportDate(supportCase.updatedAt)}
      </p>
      <Link className="button-secondary mt-4" href={`/customer/support/${supportCase.caseNumber}`}>
        View conversation
      </Link>
    </article>
  );
}

export function StatusBadge({
  status,
  customer = false,
}: Readonly<{ status: SupportCase['status']; customer?: boolean }>) {
  const tone =
    status === 'RESOLVED'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'WAITING_FOR_CUSTOMER'
        ? 'bg-amber-100 text-amber-900'
        : status === 'CLOSED'
          ? 'bg-slate-200 text-slate-700'
          : 'bg-sky-100 text-sky-800';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {statusLabel(status, customer)}
    </span>
  );
}

function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <p>{message}</p>
    </main>
  );
}
