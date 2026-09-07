import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import type { SuperAdminDashboard } from './dashboard.types';
import { SuperAdminDashboardView } from './super-admin-dashboard';

const auth = vi.hoisted(() => ({
  user: {
    id: 'super-admin-1',
    email: 'owner@merotelecom.test',
    role: 'SUPER_ADMIN' as 'ADMIN' | 'SUPER_ADMIN' | 'STAFF' | 'CUSTOMER',
  } as {
    id: string;
    email: string;
    role: 'ADMIN' | 'SUPER_ADMIN' | 'STAFF' | 'CUSTOMER';
  } | null,
}));

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ accessToken: 'token', isLoading: false, user: auth.user }),
}));

const apiRequestMock = vi.mocked(apiRequest);
const dashboard: SuperAdminDashboard = {
  business: {
    customerCount: 1248,
    activeSubscriptions: 1102,
    monthlyRecurringRevenueCents: 8745000,
    outstandingInvoiceCents: 624000,
    outstandingInvoiceCount: 42,
    overdueInvoiceCount: 7,
    pendingRefunds: 8,
    pendingRefundAmountCents: 124000,
    failedPaymentCount: 12,
  },
  organisation: {
    activeSuperAdmins: 2,
    activeAdmins: 3,
    activeStaff: 12,
    restrictedInternalAccounts: 1,
    pendingInvitations: 2,
  },
  governance: {
    recentRoleChanges: 4,
    privilegedActionsToday: 6,
    deniedPrivilegedActionsLast24Hours: 1,
  },
  attention: [
    {
      type: 'FAILED_PAYMENTS',
      count: 12,
      title: '12 failed payments',
      description: 'Payments linked to unpaid invoices need review.',
      actionLabel: 'Review invoices',
      actionUrl: '/admin/invoices',
      severity: 'critical',
    },
  ],
  invoiceTrend: [{ month: '2026-09', label: 'Sep', totalCents: 930000, count: 42 }],
  subscriptionsByStatus: [
    { status: 'ACTIVE', count: 1102 },
    { status: 'SUSPENDED', count: 14 },
  ],
  recentPrivilegedActivity: [
    {
      id: 'audit-1',
      title: 'Administrator role granted',
      description: 'Morgan Lee · Sarah Jones',
      occurredAt: '2026-09-06T06:15:00.000Z',
      href: '/admin/users',
      tone: 'neutral',
    },
  ],
  recentBusinessActivity: [
    {
      id: 'payment-1',
      kind: 'PAYMENT',
      title: 'Payment received',
      description: 'Anika Singh · INV-2026-000014',
      occurredAt: '2026-09-06T06:45:00.000Z',
      amountCents: 9900,
      href: '/admin/invoices',
      tone: 'positive',
    },
  ],
  systemHealth: [
    { name: 'Database', status: 'HEALTHY', description: 'PostgreSQL is responding normally.' },
    { name: 'Redis', status: 'HEALTHY', description: 'Redis is responding normally.' },
  ],
  observedAt: '2026-09-07T01:30:00.000Z',
};

function renderDashboard(data: SuperAdminDashboard = dashboard) {
  apiRequestMock.mockResolvedValue(data as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SuperAdminDashboardView />
    </QueryClientProvider>,
  );
}

describe('SuperAdminDashboardView', () => {
  beforeEach(() => {
    auth.user = { id: 'super-admin-1', email: 'owner@merotelecom.test', role: 'SUPER_ADMIN' };
    apiRequestMock.mockReset();
  });

  it('shows business, organisation, governance, health, activity and real actions', async () => {
    renderDashboard();

    expect(
      await screen.findByRole('heading', { name: 'Platform, organisation and business overview' }),
    ).toBeInTheDocument();
    expect(apiRequestMock).toHaveBeenCalledWith('/dashboard/super-admin', {}, 'token');
    expect(screen.getByText('$87,450.00')).toBeInTheDocument();
    expect(screen.getByText('$6,240.00')).toBeInTheDocument();
    expect(screen.getByText('Active admins')).toBeInTheDocument();
    expect(screen.getByText('Administrator role granted')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL is responding normally.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View audit logs/ })).toHaveAttribute(
      'href',
      '/admin/users',
    );

    const attention = screen.getByRole('heading', { name: 'Needs attention' }).closest('section');
    expect(attention).not.toBeNull();
    expect(within(attention!).getByText('12 failed payments')).toBeInTheDocument();
  });

  it('shows useful empty states without fabricated issues or activity', async () => {
    renderDashboard({
      ...dashboard,
      attention: [],
      invoiceTrend: [],
      subscriptionsByStatus: [],
      recentPrivilegedActivity: [],
      recentBusinessActivity: [],
    });

    expect(
      await screen.findByText('No critical issues require your attention right now.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No recent privileged activity.')).toBeInTheDocument();
    expect(screen.getByText('No recent business activity.')).toBeInTheDocument();
    expect(
      screen.getByText('No invoice value is available for the last six months.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No subscriptions are available yet.')).toBeInTheDocument();
  });

  it('shows a safe retry state when loading fails', async () => {
    apiRequestMock.mockRejectedValue(new Error('database connection details') as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SuperAdminDashboardView />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("We couldn't load the Super Admin overview."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.queryByText('database connection details')).not.toBeInTheDocument();
  });

  it.each(['ADMIN', 'STAFF', 'CUSTOMER'] as const)(
    'does not request restricted data for a %s account',
    (role) => {
      auth.user = { id: `${role.toLowerCase()}-1`, email: `${role}@example.test`, role };
      renderDashboard();

      expect(screen.getByText('Super Administrator access is required.')).toBeInTheDocument();
      expect(apiRequestMock).not.toHaveBeenCalled();
    },
  );
});
