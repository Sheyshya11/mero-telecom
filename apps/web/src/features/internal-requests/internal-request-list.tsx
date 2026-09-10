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
import {
  formatInternalRequestDate,
  internalRequestLevelLabel,
  internalRequestPriorities,
  internalRequestStatusLabel,
  internalRequestStatuses,
  internalRequestTypeLabel,
  internalRequestTypes,
  personLabel,
  type InternalRequest,
  type InternalRequestList,
  type InternalRequestStatus,
} from './internal-request.types';

interface StaffSummary {
  myOpenRequests: number;
  myPendingRequests: number;
  needsMyResponse: number;
  approved: number;
  escalated: number;
  recentlyResolved: number;
}

interface AdminSummary {
  awaitingReview: number;
  assignedToMe: number;
  needsInformation: number;
  highPriority: number;
  escalated: number;
}

interface SuperAdminSummary {
  awaitingReview: number;
  assignedToMe: number;
  inReview: number;
  needsInformation: number;
  highPriority: number;
}

export function InternalRequestListPage() {
  const { accessToken, isLoading, user } = useAuth();
  const superAdminMode = Boolean(user && hasRole(user, 'SUPER_ADMIN'));
  const adminMode = Boolean(user && hasRole(user, 'ADMIN') && !superAdminMode);
  const staffMode = Boolean(user && hasRole(user, 'STAFF') && !adminMode && !superAdminMode);
  const permitted = adminMode || staffMode || superAdminMode;
  const table = useTableQueryParams([
    'status',
    'type',
    'priority',
    'assignment',
    'requestedByUserId',
    'currentLevel',
  ]);
  const mode = superAdminMode ? 'super-admin' : adminMode ? 'admin' : 'staff';
  const apiPrefix = `/${mode}/internal-requests`;
  const requests = useQuery({
    queryKey: [`${mode}-internal-requests`, table.query],
    placeholderData: keepPreviousData,
    queryFn: () => apiRequest<InternalRequestList>(`${apiPrefix}?${table.query}`, {}, accessToken),
    enabled: Boolean(accessToken && permitted),
  });
  const summary = useQuery({
    queryKey: [`${mode}-internal-request-summary`],
    queryFn: () =>
      apiRequest<AdminSummary | StaffSummary | SuperAdminSummary>(
        `${apiPrefix}/summary`,
        {},
        accessToken,
      ),
    enabled: Boolean(accessToken && permitted),
  });
  const requesters = useQuery({
    queryKey: ['internal-request-requesters'],
    queryFn: () =>
      apiRequest<Array<{ id: string; displayName: string | null; email: string }>>(
        `/${mode}/internal-requests/requesters`,
        {},
        accessToken,
      ),
    enabled: Boolean(accessToken && (adminMode || superAdminMode)),
  });

  if (isLoading) return <PageStatus message="Restoring your session…" />;
  if (!permitted) return <PageStatus message="Staff or Administrator access is required." />;

  const summaryCards: Array<{
    label: string;
    value: number | undefined;
    filters: Record<string, string>;
  }> = superAdminMode
    ? [
        {
          label: 'Awaiting review',
          value: (summary.data as SuperAdminSummary | undefined)?.awaitingReview,
          filters: { status: 'PENDING', currentLevel: 'SUPER_ADMIN' },
        },
        {
          label: 'Assigned to me',
          value: (summary.data as SuperAdminSummary | undefined)?.assignedToMe,
          filters: { assignment: 'MINE', status: '', currentLevel: 'SUPER_ADMIN' },
        },
        {
          label: 'Needs information',
          value: (summary.data as SuperAdminSummary | undefined)?.needsInformation,
          filters: { status: 'MORE_INFO_REQUIRED', currentLevel: 'SUPER_ADMIN' },
        },
        {
          label: 'High priority',
          value: (summary.data as SuperAdminSummary | undefined)?.highPriority,
          filters: { priority: 'HIGH', status: '', currentLevel: 'SUPER_ADMIN' },
        },
      ]
    : adminMode
      ? [
          {
            label: 'Awaiting review',
            value: (summary.data as AdminSummary | undefined)?.awaitingReview,
            filters: { status: 'PENDING', currentLevel: 'ADMIN' },
          },
          {
            label: 'Assigned to me',
            value: (summary.data as AdminSummary | undefined)?.assignedToMe,
            filters: { assignment: 'MINE', status: '', currentLevel: 'ADMIN' },
          },
          {
            label: 'Needs information',
            value: (summary.data as AdminSummary | undefined)?.needsInformation,
            filters: { status: 'MORE_INFO_REQUIRED', currentLevel: 'ADMIN' },
          },
          {
            label: 'Escalated',
            value: (summary.data as AdminSummary | undefined)?.escalated,
            filters: { currentLevel: 'SUPER_ADMIN', status: '' },
          },
        ]
      : [
          {
            label: 'My open requests',
            value: (summary.data as StaffSummary | undefined)?.myOpenRequests,
            filters: { status: '', currentLevel: '' },
          },
          {
            label: 'Needs my response',
            value: (summary.data as StaffSummary | undefined)?.needsMyResponse,
            filters: { status: 'MORE_INFO_REQUIRED' },
          },
          {
            label: 'Approved',
            value: (summary.data as StaffSummary | undefined)?.approved,
            filters: { status: 'APPROVED' },
          },
          {
            label: 'Escalated',
            value: (summary.data as StaffSummary | undefined)?.escalated,
            filters: { currentLevel: 'SUPER_ADMIN', status: '' },
          },
        ];

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-4 py-8 text-slate-950 sm:px-6 sm:py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">
            CONTROL CENTRE · INTERNAL
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {superAdminMode ? 'Escalations' : adminMode ? 'Staff requests' : 'Internal requests'}
          </h1>
          <p className="mt-2 text-slate-600">
            {superAdminMode
              ? 'Review Staff requests escalated by Administrators while preserving the full internal history.'
              : adminMode
                ? 'Review private requests raised by Staff for Administrator action.'
                : 'Ask an Administrator to review work that needs higher authority.'}
          </p>
        </div>
        {staffMode ? (
          <Link className="button-primary" href="/control-centre/internal-requests/new">
            New Internal Request
          </Link>
        ) : null}
      </header>

      <section
        aria-label="Internal request summary"
        className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {summaryCards.map(({ label, value, filters }) => (
          <button
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300"
            key={label}
            onClick={() => table.update(filters)}
            type="button"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-bold">{summary.isPending ? '…' : (value ?? 0)}</p>
          </button>
        ))}
      </section>

      <div className="mt-6 flex flex-wrap gap-2" aria-label="Queue presets">
        {[
          {
            label: staffMode ? 'Open' : 'Pending',
            status: staffMode ? '' : 'PENDING',
            level: superAdminMode ? 'SUPER_ADMIN' : '',
          },
          { label: 'In Review', status: 'IN_REVIEW', level: superAdminMode ? 'SUPER_ADMIN' : '' },
          {
            label: staffMode ? 'Needs My Response' : 'Needs Information',
            status: 'MORE_INFO_REQUIRED',
            level: superAdminMode ? 'SUPER_ADMIN' : '',
          },
          ...(staffMode || adminMode
            ? [{ label: 'Escalated', status: '', level: 'SUPER_ADMIN' }]
            : []),
          { label: 'Resolved', status: 'RESOLVED', level: '' },
          { label: 'All', status: '', level: '' },
        ].map((preset) => (
          <button
            className="button-secondary"
            key={preset.label}
            onClick={() =>
              table.update({ status: preset.status, currentLevel: preset.level, assignment: '' })
            }
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <section className="mt-6">
        <DataTableControls
          fields={[
            { key: 'status', label: 'Status', options: internalRequestStatuses },
            { key: 'type', label: 'Type', options: internalRequestTypes },
            { key: 'priority', label: 'Priority', options: internalRequestPriorities },
            ...(adminMode
              ? [
                  {
                    key: 'currentLevel',
                    label: 'Currently With',
                    options: [
                      { value: 'ADMIN', label: 'Admin' },
                      { value: 'SUPER_ADMIN', label: 'Super Admin' },
                    ],
                  },
                ]
              : []),
            ...(adminMode || superAdminMode
              ? [
                  {
                    key: 'assignment',
                    label: 'Assignment',
                    options: [
                      { value: 'UNASSIGNED', label: 'Unassigned' },
                      { value: 'MINE', label: 'Assigned to me' },
                    ],
                  },
                  {
                    key: 'requestedByUserId',
                    label: 'Requested By',
                    options: (requesters.data ?? []).map((person) => ({
                      value: person.id,
                      label: personLabel(person),
                    })),
                  },
                ]
              : []),
          ]}
          placeholder="Search request number, title or customer…"
          sorts={['updatedAt', 'createdAt', 'status', 'priority']}
          state={table}
        />
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {requests.isPending ? <TableSkeleton /> : null}
          {requests.isError ? (
            <p className="p-6 text-rose-700">We couldn&apos;t load internal requests.</p>
          ) : null}
          {requests.data?.data.length ? (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-260 text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Request</th>
                      {adminMode || superAdminMode ? <th>Requested by</th> : null}
                      <th>Type</th>
                      <th>Customer</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Currently with</th>
                      <th>Created</th>
                      <th>Updated</th>
                      <th className="px-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.data.data.map((item) => (
                      <RequestRow
                        privilegedMode={adminMode || superAdminMode}
                        item={item}
                        key={item.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:hidden">
                {requests.data.data.map((item) => (
                  <RequestCard
                    privilegedMode={adminMode || superAdminMode}
                    item={item}
                    key={item.id}
                  />
                ))}
              </div>
            </>
          ) : !requests.isPending && !requests.isError ? (
            <p className="p-8 text-center text-slate-600">
              {staffMode && !table.values.status && !table.values.search
                ? "You haven't submitted any internal requests."
                : (adminMode || superAdminMode) && table.values.status === 'PENDING'
                  ? superAdminMode
                    ? 'No escalations currently require your attention.'
                    : 'No staff requests are waiting for review.'
                  : 'No requests match these filters.'}
            </p>
          ) : null}
          <DataTablePagination
            busy={requests.isFetching}
            meta={requests.data?.meta}
            noun="requests"
            state={table}
          />
        </div>
      </section>
    </main>
  );
}

function RequestRow({
  item,
  privilegedMode,
}: Readonly<{ item: InternalRequest; privilegedMode: boolean }>) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-5 py-4 font-mono text-xs font-semibold">{item.requestNumber}</td>
      {privilegedMode ? <td>{personLabel(item.requestedBy)}</td> : null}
      <td>{internalRequestTypeLabel(item.type)}</td>
      <td>{item.customer ? `${item.customer.firstName} ${item.customer.lastName}` : '—'}</td>
      <td>
        <PriorityBadge priority={item.priority} />
      </td>
      <td>
        <InternalStatusBadge status={item.status} />
      </td>
      <td>{internalRequestLevelLabel(item.currentLevel)}</td>
      <td>{formatInternalRequestDate(item.createdAt)}</td>
      <td>{formatInternalRequestDate(item.updatedAt)}</td>
      <td className="px-5 text-right">
        <Link
          className="button-secondary"
          href={`/control-centre/internal-requests/${item.requestNumber}`}
        >
          Open
        </Link>
      </td>
    </tr>
  );
}

function RequestCard({
  item,
  privilegedMode,
}: Readonly<{ item: InternalRequest; privilegedMode: boolean }>) {
  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs font-semibold text-sky-800">{item.requestNumber}</span>
        <InternalStatusBadge status={item.status} />
      </div>
      <h2 className="mt-3 font-semibold">{item.title}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {internalRequestTypeLabel(item.type)} ·{' '}
        {item.customer
          ? `${item.customer.firstName} ${item.customer.lastName}`
          : 'No customer linked'}
      </p>
      {privilegedMode ? (
        <p className="mt-2 text-xs text-slate-500">Requested by {personLabel(item.requestedBy)}</p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <PriorityBadge priority={item.priority} />
          <p className="mt-1 text-xs text-slate-500">
            With {internalRequestLevelLabel(item.currentLevel)}
          </p>
        </div>
        <Link
          className="button-secondary"
          href={`/control-centre/internal-requests/${item.requestNumber}`}
        >
          Open request
        </Link>
      </div>
    </article>
  );
}

export function InternalStatusBadge({ status }: Readonly<{ status: InternalRequestStatus }>) {
  const tone =
    status === 'APPROVED' || status === 'RESOLVED'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'REJECTED'
        ? 'bg-rose-100 text-rose-800'
        : status === 'MORE_INFO_REQUIRED'
          ? 'bg-amber-100 text-amber-900'
          : status === 'CLOSED'
            ? 'bg-slate-200 text-slate-700'
            : 'bg-sky-100 text-sky-800';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {internalRequestStatusLabel(status)}
    </span>
  );
}

export function PriorityBadge({ priority }: Readonly<{ priority: 'LOW' | 'NORMAL' | 'HIGH' }>) {
  const tone =
    priority === 'HIGH'
      ? 'text-rose-700'
      : priority === 'LOW'
        ? 'text-slate-500'
        : 'text-slate-800';
  return (
    <span className={`text-xs font-semibold capitalize ${tone}`}>{priority.toLowerCase()}</span>
  );
}

function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <p>{message}</p>
    </main>
  );
}
