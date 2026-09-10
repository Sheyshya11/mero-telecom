'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { apiRequest } from '../../lib/api/client';
import { hasRole } from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import { AdminDashboardView } from './admin-dashboard';

export function ControlCentreDashboard() {
  const { accessToken, user } = useAuth();
  const staffOnly = Boolean(
    user && hasRole(user, 'STAFF') && !hasRole(user, 'ADMIN', 'SUPER_ADMIN'),
  );
  const supportSummary = useQuery({
    queryKey: ['staff-support-summary'],
    queryFn: () =>
      apiRequest<{
        newRequests: number;
        assignedToMe: number;
        waitingForCustomer: number;
        resolvedToday: number;
      }>('/staff/support/summary', {}, accessToken),
    enabled: Boolean(accessToken && staffOnly),
  });
  const internalSummary = useQuery({
    queryKey: ['staff-internal-request-summary'],
    queryFn: () =>
      apiRequest<{
        myOpenRequests: number;
        myPendingRequests: number;
        needsMyResponse: number;
        approved: number;
        escalated: number;
        recentlyResolved: number;
      }>('/staff/internal-requests/summary', {}, accessToken),
    enabled: Boolean(accessToken && staffOnly),
  });
  if (!user) return null;
  if (hasRole(user, 'ADMIN', 'SUPER_ADMIN')) return <AdminDashboardView />;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-sm font-semibold tracking-wide text-sky-700">STAFF CONTROL CENTRE</p>
        <h1 className="mt-2 text-3xl font-bold">Operations overview</h1>
        <p className="mt-2 text-slate-600">
          Access the customer and service workflows assigned to staff.
        </p>
      </header>
      <section aria-label="Support summary" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['New requests', supportSummary.data?.newRequests],
          ['Assigned to me', supportSummary.data?.assignedToMe],
          ['Waiting for customer', supportSummary.data?.waitingForCustomer],
          ['Resolved today', supportSummary.data?.resolvedToday],
        ].map(([label, value]) => (
          <Link
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-sky-300"
            href="/control-centre/support"
            key={label}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-bold">
              {supportSummary.isPending ? '…' : (value ?? 0)}
            </p>
          </Link>
        ))}
      </section>
      <section aria-label="Internal request summary" className="mt-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-semibold">Admin action requests</h2>
            <p className="mt-1 text-sm text-slate-600">
              Private requests you have raised for Administrator review.
            </p>
          </div>
          <Link className="button-secondary" href="/control-centre/internal-requests">
            View Internal Requests
          </Link>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['My open requests', internalSummary.data?.myOpenRequests],
            ['Needs my response', internalSummary.data?.needsMyResponse],
            ['Escalated', internalSummary.data?.escalated],
            ['Recently resolved', internalSummary.data?.recentlyResolved],
          ].map(([label, value]) => (
            <Link
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-sky-300"
              href="/control-centre/internal-requests"
              key={label}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="mt-2 text-2xl font-bold">
                {internalSummary.isPending ? '…' : (value ?? 0)}
              </p>
            </Link>
          ))}
        </div>
      </section>
      <section aria-label="Staff quick actions" className="mt-8 grid gap-4 md:grid-cols-2">
        <WorkspaceLink
          href="/control-centre/internal-requests/new"
          title="Request Admin action"
          description="Escalate work that needs Administrator review or authorisation."
        />
        <WorkspaceLink
          href="/control-centre/support"
          title="Support requests"
          description="Take customer requests and follow conversations through resolution."
        />
        <WorkspaceLink
          href="/control-centre/customers"
          title="Customers"
          description="Find customer accounts and service details."
        />
        <WorkspaceLink
          href="/control-centre/services"
          title="Services"
          description="Review subscriptions and plan-change requests."
        />
        <WorkspaceLink
          href="/control-centre/coverage"
          title="Coverage"
          description="Check and manage service availability."
        />
        <WorkspaceLink
          href="/control-centre/refunds"
          title="Refunds"
          description="Review customer refund requests."
        />
      </section>
    </main>
  );
}

function WorkspaceLink({
  href,
  title,
  description,
}: Readonly<{ href: string; title: string; description: string }>) {
  return (
    <Link
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-sky-300"
      href={href}
    >
      <h2 className="font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </Link>
  );
}
