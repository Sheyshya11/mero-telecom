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
import { useAuth } from '../auth/auth-provider';
import {
  formatRefundMoney,
  humanizeRefundValue,
  refundReasons,
  type RefundList,
} from './refund.types';

export function RefundManagement({
  basePath,
}: Readonly<{ basePath: '/admin/refunds' | '/staff/refunds' }>) {
  const { accessToken, isLoading, user } = useAuth();
  const table = useTableQueryParams([
    'status',
    'reason',
    'type',
    'dateFrom',
    'dateTo',
    'minAmount',
    'maxAmount',
  ]);
  const permitted = user && ['SUPER_ADMIN', 'ADMIN', 'STAFF'].includes(user.role);
  const refunds = useQuery({
    queryKey: ['admin-refunds', table.query],
    placeholderData: keepPreviousData,
    queryFn: () => apiRequest<RefundList>(`/admin/refunds?${table.query}`, {}, accessToken),
    enabled: Boolean(accessToken && permitted),
  });

  if (isLoading) return <Status message="Restoring your session…" />;
  if (!permitted) return <Status message="Staff or administrator access is required." />;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-6 py-10 text-slate-950">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">BILLING · REFUNDS</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Refund management</h1>
          <p className="mt-2 text-slate-600">
            Review requests, approve controlled amounts, and reconcile Stripe results.
          </p>
        </div>
      </header>
      <section className="mt-8">
        <DataTableControls
          state={table}
          sorts={['createdAt', 'requestedAt', 'refundAmountCents', 'status']}
          placeholder="Search customer, invoice, refund or payment…"
          fields={[
            {
              key: 'status',
              label: 'Status',
              options: [
                'DRAFT',
                'REQUESTED',
                'UNDER_REVIEW',
                'MORE_INFORMATION_REQUIRED',
                'APPROVED',
                'PROCESSING',
                'SUCCEEDED',
                'FAILED',
                'REJECTED',
                'CANCELLED',
              ],
            },
            { key: 'reason', label: 'Reason', options: refundReasons },
            { key: 'type', label: 'Type', options: ['FULL', 'PARTIAL'] },
            { key: 'dateFrom', label: 'Requested from', type: 'date' },
            { key: 'dateTo', label: 'Requested to', type: 'date' },
            { key: 'minAmount', label: 'Minimum amount (cents)', type: 'number' },
            { key: 'maxAmount', label: 'Maximum amount (cents)', type: 'number' },
          ]}
        />
      </section>
      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {refunds.isPending ? <TableSkeleton /> : null}
        {refunds.isError ? <p className="p-6 text-rose-700">Unable to load refunds.</p> : null}
        {refunds.data?.data.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-240 text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Refund</th>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th className="px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {refunds.data.data.map((refund) => (
                  <tr className="border-b border-slate-100" key={refund.id}>
                    <td className="px-5 py-4 font-mono text-xs">{refund.id.slice(0, 8)}</td>
                    <td>
                      <p className="font-semibold">
                        {refund.customer?.firstName} {refund.customer?.lastName}
                      </p>
                      <p className="text-xs text-slate-500">{refund.customer?.email}</p>
                    </td>
                    <td>{refund.invoice?.invoiceNumber ?? '—'}</td>
                    <td>{formatRefundMoney(refund.refundAmountCents, refund.currency)}</td>
                    <td>{humanizeRefundValue(refund.reason)}</td>
                    <td>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">
                        {humanizeRefundValue(refund.status)}
                      </span>
                    </td>
                    <td>{new Date(refund.requestedAt).toLocaleDateString('en-AU')}</td>
                    <td className="px-5 text-right">
                      <Link className="button-secondary" href={`${basePath}/${refund.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !refunds.isPending && !refunds.isError ? (
          <p className="p-6 text-slate-600">No refunds match these filters.</p>
        ) : null}
        <DataTablePagination
          state={table}
          meta={refunds.data?.meta}
          busy={refunds.isFetching}
          noun="refunds"
        />
      </section>
    </main>
  );
}

function Status({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <p>{message}</p>
    </main>
  );
}
