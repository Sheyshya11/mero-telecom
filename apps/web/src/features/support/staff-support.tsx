'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import {
  DataTableControls,
  DataTablePagination,
  TableSkeleton,
  useTableQueryParams,
} from '../../components/data-table';
import { apiRequest } from '../../lib/api/client';
import { hasRole } from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import { StatusBadge } from './customer-support';
import {
  categoryLabel,
  formatSupportDate,
  supportCategories,
  supportStatuses,
  type SupportCase,
  type SupportList,
} from './support.types';

interface SupportSummary {
  newRequests: number;
  assignedToMe: number;
  waitingForCustomer: number;
  resolvedToday: number;
  openCustomerTickets: number;
  openEnquiries: number;
  unassignedEnquiries: number;
}

export function StaffSupport() {
  const { accessToken, isLoading, user } = useAuth();
  const table = useTableQueryParams(['requestType', 'status', 'category', 'assignment']);
  const permitted = Boolean(user && hasRole(user, 'STAFF', 'ADMIN', 'SUPER_ADMIN'));
  const cases = useQuery({
    queryKey: ['staff-support', table.query],
    placeholderData: keepPreviousData,
    queryFn: () => apiRequest<SupportList>(`/staff/support?${table.query}`, {}, accessToken),
    enabled: Boolean(accessToken && permitted),
  });
  const summary = useQuery({
    queryKey: ['staff-support-summary'],
    queryFn: () => apiRequest<SupportSummary>('/staff/support/summary', {}, accessToken),
    enabled: Boolean(accessToken && permitted),
  });

  if (isLoading) return <PageStatus message="Restoring your session…" />;
  if (!permitted) return <PageStatus message="Staff access is required." />;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-4 py-8 text-slate-950 sm:px-6 sm:py-10">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-sm font-semibold tracking-wide text-sky-700">CONTROL CENTRE · SUPPORT</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Support requests</h1>
        <p className="mt-2 text-slate-600">
          Handle customer tickets and pre-sales enquiries in one operational queue.
        </p>
      </header>

      <section aria-label="Support summary" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Open customer tickets', summary.data?.openCustomerTickets],
          ['Open enquiries', summary.data?.openEnquiries],
          ['Assigned to me', summary.data?.assignedToMe],
          ['Unassigned enquiries', summary.data?.unassignedEnquiries],
        ].map(([label, value]) => (
          <article
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            key={label}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-bold">{summary.isPending ? '…' : (value ?? 0)}</p>
          </article>
        ))}
      </section>

      <section className="mt-8">
        <DataTableControls
          fields={[
            {
              key: 'requestType',
              label: 'Support type',
              options: [
                { value: 'CUSTOMER_SUPPORT', label: 'Customer tickets' },
                { value: 'PROSPECT_ENQUIRY', label: 'Enquiries' },
              ],
            },
            { key: 'status', label: 'Status', options: supportStatuses },
            { key: 'category', label: 'Category', options: supportCategories },
            {
              key: 'assignment',
              label: 'Assignment',
              options: [
                { value: 'UNASSIGNED', label: 'Unassigned' },
                { value: 'MINE', label: 'Assigned to me' },
              ],
            },
          ]}
          placeholder="Search reference, customer, email or subject…"
          sorts={['updatedAt', 'createdAt', 'status', 'priority']}
          state={table}
        />
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {cases.isPending ? <TableSkeleton /> : null}
          {cases.isError ? (
            <p className="p-6 text-rose-700">We couldn&apos;t load support requests.</p>
          ) : null}
          {cases.data?.data.length ? (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-240 text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Reference</th>
                      <th>Contact</th>
                      <th>Category</th>
                      <th>Subject</th>
                      <th>Status</th>
                      <th>Assigned to</th>
                      <th>Last updated</th>
                      <th className="px-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.data.data.map((supportCase) => (
                      <StaffRow key={supportCase.id} supportCase={supportCase} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:hidden">
                {cases.data.data.map((supportCase) => (
                  <StaffCard key={supportCase.id} supportCase={supportCase} />
                ))}
              </div>
            </>
          ) : !cases.isPending && !cases.isError ? (
            <p className="p-8 text-center text-slate-600">
              {table.values.assignment === 'MINE'
                ? "You don't currently have any assigned support requests."
                : 'No support requests match these filters.'}
            </p>
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

function StaffRow({ supportCase }: Readonly<{ supportCase: SupportCase }>) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-5 py-4 font-mono text-xs font-semibold">{supportCase.caseNumber}</td>
      <td>
        <p className="font-semibold">{customerName(supportCase)}</p>
        <p className="text-xs text-slate-500">
          {supportCase.requestType === 'PROSPECT_ENQUIRY'
            ? supportCase.prospectEmail
            : supportCase.customer?.email}
        </p>
      </td>
      <td>
        <span className="block">{categoryLabel(supportCase.category)}</span>
        <span className="text-xs text-slate-500">
          {supportCase.requestType === 'PROSPECT_ENQUIRY' ? 'Enquiry' : 'Customer ticket'}
        </span>
      </td>
      <td className="max-w-64 truncate font-medium">{supportCase.subject}</td>
      <td>
        <StatusBadge status={supportCase.status} />
      </td>
      <td>
        {supportCase.assignedTo?.displayName || supportCase.assignedTo?.email || 'Unassigned'}
      </td>
      <td>{formatSupportDate(supportCase.updatedAt)}</td>
      <td className="px-5 text-right">
        <Link
          className="button-secondary"
          href={`/control-centre/support/${supportCase.caseNumber}`}
        >
          Open
        </Link>
      </td>
    </tr>
  );
}

function StaffCard({ supportCase }: Readonly<{ supportCase: SupportCase }>) {
  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs font-semibold text-sky-800">
          {supportCase.caseNumber}
        </span>
        <StatusBadge status={supportCase.status} />
      </div>
      <h2 className="mt-3 font-semibold">{supportCase.subject}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {customerName(supportCase)} · {categoryLabel(supportCase.category)}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {supportCase.assignedTo?.displayName || supportCase.assignedTo?.email || 'Unassigned'} ·
        Updated {formatSupportDate(supportCase.updatedAt)}
      </p>
      <Link
        className="button-secondary mt-4"
        href={`/control-centre/support/${supportCase.caseNumber}`}
      >
        Open request
      </Link>
    </article>
  );
}

function customerName(supportCase: SupportCase): string {
  if (supportCase.requestType === 'PROSPECT_ENQUIRY') {
    return supportCase.prospectName || 'Prospective customer';
  }
  return supportCase.customer
    ? `${supportCase.customer.firstName} ${supportCase.customer.lastName}`
    : 'Customer';
}

function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <p>{message}</p>
    </main>
  );
}
