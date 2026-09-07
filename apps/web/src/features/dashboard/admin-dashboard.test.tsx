import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { AdminDashboardView } from './admin-dashboard';
import type { AdminDashboard } from './dashboard.types';

const auth = vi.hoisted(() => ({
  user: {
    id: 'admin-1',
    email: 'admin@merotelecom.test',
    role: 'ADMIN' as 'ADMIN' | 'SUPER_ADMIN' | 'STAFF' | 'CUSTOMER',
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
const dashboard: AdminDashboard = {
  metrics: {
    customerCount: 12,
    activeSubscriptions: 8,
    monthlyRecurringRevenueCents: 79200,
    outstandingInvoiceCents: 12430,
    outstandingInvoiceCount: 2,
    overdueInvoiceCount: 1,
    pendingRefunds: 3,
    pendingRefundAmountCents: 22400,
    failedPaymentCount: 1,
  },
  attention: [
    {
      type: 'OVERDUE_INVOICES',
      count: 1,
      title: '1 overdue invoice',
      description: 'Payment is past the invoice due date.',
      actionLabel: 'View invoices',
      actionUrl: '/admin/invoices',
      severity: 'critical',
    },
    {
      type: 'PENDING_REFUNDS',
      count: 3,
      title: '3 refund requests awaiting action',
      description: '$224.00 is currently in progress.',
      actionLabel: 'Review refunds',
      actionUrl: '/admin/refunds',
      severity: 'warning',
    },
  ],
  invoiceTrend: [{ month: '2026-09', label: 'Sep', totalCents: 2530, count: 1 }],
  subscriptionsByStatus: [
    { status: 'ACTIVE', count: 8 },
    { status: 'SUSPENDED', count: 2 },
  ],
  recentActivity: [
    {
      id: 'payment-1',
      kind: 'PAYMENT',
      title: 'Payment received',
      description: 'Anika Singh · INV-2026-000014',
      occurredAt: '2026-09-06T06:45:00.000Z',
      amountCents: 2530,
      href: '/admin/invoices',
      tone: 'positive',
    },
  ],
  recentInvoices: [
    {
      id: 'invoice-1',
      invoiceNumber: 'INV-2026-000014',
      issueDate: '2026-09-06T00:00:00.000Z',
      totalCents: 2530,
      status: 'PAID',
      paymentStatus: 'REFUNDED',
      customerName: 'Anika Singh',
    },
  ],
};

function renderDashboard(data: AdminDashboard = dashboard) {
  apiRequestMock.mockResolvedValue(data as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AdminDashboardView />
    </QueryClientProvider>,
  );
}

describe('AdminDashboardView', () => {
  beforeEach(() => {
    auth.user = { id: 'admin-1', email: 'admin@merotelecom.test', role: 'ADMIN' };
    apiRequestMock.mockReset();
  });

  it('shows clear KPIs, actionable issues, activity, actions and separate invoice states', async () => {
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Business dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Total customers')).toBeInTheDocument();
    expect(screen.getByText('Active subscriptions')).toBeInTheDocument();
    expect(screen.getByText('Outstanding balance')).toBeInTheDocument();
    expect(screen.getByText('$124.30')).toBeInTheDocument();
    expect(screen.getByText('$224.00 awaiting action')).toBeInTheDocument();

    const attention = screen.getByRole('heading', { name: 'Needs attention' }).closest('section');
    expect(attention).not.toBeNull();
    expect(within(attention!).getByText('1 overdue invoice')).toBeInTheDocument();
    expect(within(attention!).getByRole('link', { name: /Review refunds/ })).toHaveAttribute(
      'href',
      '/admin/refunds',
    );

    expect(screen.getByText('Payment received')).toBeInTheDocument();
    expect(screen.getAllByText('$25.30')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Manage staff/ })).toHaveAttribute(
      'href',
      '/admin/users',
    );

    const invoiceTable = screen.getByRole('table');
    expect(within(invoiceTable).getByText('Invoice status')).toBeInTheDocument();
    expect(within(invoiceTable).getByText('Payment status')).toBeInTheDocument();
    expect(within(invoiceTable).getByText('Paid')).toBeInTheDocument();
    expect(within(invoiceTable).getByText('Refunded')).toBeInTheDocument();
  });

  it('renders useful empty states without empty charts or tables', async () => {
    renderDashboard({
      ...dashboard,
      metrics: {
        ...dashboard.metrics,
        outstandingInvoiceCents: 0,
        outstandingInvoiceCount: 0,
        overdueInvoiceCount: 0,
        pendingRefunds: 0,
        pendingRefundAmountCents: 0,
      },
      attention: [],
      invoiceTrend: [],
      subscriptionsByStatus: [],
      recentActivity: [],
      recentInvoices: [],
    });

    expect(
      await screen.findByText('No urgent issues require your attention right now.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No requests awaiting review')).toBeInTheDocument();
    expect(
      screen.getByText('No invoice value is available for the last six months.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No subscriptions are available yet.')).toBeInTheDocument();
    expect(screen.getByText('No recent activity.')).toBeInTheDocument();
    expect(screen.getByText('No recent invoices.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a friendly retry state when the dashboard request fails', async () => {
    apiRequestMock.mockRejectedValue(new Error('database details') as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AdminDashboardView />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("We couldn't load the admin overview.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.queryByText('database details')).not.toBeInTheDocument();
  });

  it.each(['CUSTOMER', 'STAFF'] as const)(
    'does not request admin dashboard data for a %s account',
    (role) => {
      auth.user = { id: `${role.toLowerCase()}-1`, email: `${role}@example.test`, role };
      renderDashboard();

      expect(screen.getByText('Administrator access is required.')).toBeInTheDocument();
      expect(apiRequestMock).not.toHaveBeenCalled();
    },
  );
});
