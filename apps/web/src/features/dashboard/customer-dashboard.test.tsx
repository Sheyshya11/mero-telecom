import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { CustomerDashboardView } from './customer-dashboard';
import type { CustomerDashboard } from './customer-dashboard.types';

const auth = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    email: 'customer@example.test',
    role: 'CUSTOMER' as const,
  } as { id: string; email: string; role: 'CUSTOMER' } | null,
}));

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn(), apiDownload: vi.fn() };
});
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ accessToken: 'token', isLoading: false, user: auth.user }),
}));
vi.mock('../payments/stripe-checkout-button', () => ({
  StripeCheckoutButton: () => <button type="button">Pay securely with Stripe</button>,
}));

const apiRequestMock = vi.mocked(apiRequest);
const invoice: NonNullable<CustomerDashboard['latestInvoice']> = {
  id: 'invoice-1',
  invoiceNumber: 'INV-2026-000001',
  issueDate: '2026-09-01T00:00:00.000Z',
  dueDate: '2026-09-15T00:00:00.000Z',
  totalCents: 9900,
  status: 'PAID',
  paymentStatus: 'REFUNDED',
  payment: {
    id: 'payment-1',
    amountCents: 9900,
    refundedCents: 2530,
    currency: 'AUD',
    status: 'REFUNDED',
    paidAt: '2026-09-02T00:00:00.000Z',
  },
};
const dashboard: CustomerDashboard = {
  profile: {
    customerNumber: 'CUST-000001',
    firstName: 'Anika',
    lastName: 'Singh',
    email: 'customer@example.test',
    phone: '0400000000',
  },
  subscription: {
    id: 'subscription-1',
    status: 'ACTIVE',
    startDate: '2026-08-24T00:00:00.000Z',
    plan: { name: 'NBN 100', downloadMbps: 100, uploadMbps: 40, monthlyCents: 9900 },
  },
  billing: {
    nextPaymentAmountCents: 9900,
    nextBillingDate: '2026-09-24T00:00:00.000Z',
    outstandingInvoiceCents: 0,
    latestPaymentStatus: 'REFUNDED',
  },
  pendingAction: null,
  recentActivity: [
    {
      id: 'payment-payment-1',
      kind: 'PAYMENT',
      title: 'Payment received',
      description: 'INV-2026-000001',
      occurredAt: '2026-09-02T00:00:00.000Z',
      amountCents: 9900,
      href: '/customer/invoices',
      tone: 'positive',
    },
  ],
  latestInvoice: invoice,
  invoices: [invoice],
};

function renderDashboard(data: CustomerDashboard = dashboard) {
  apiRequestMock.mockResolvedValue(data as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CustomerDashboardView />
    </QueryClientProvider>,
  );
}

describe('CustomerDashboardView', () => {
  beforeEach(() => {
    auth.user = { id: 'user-1', email: 'customer@example.test', role: 'CUSTOMER' };
  });

  it('prioritises service, next payment and existing customer actions', async () => {
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Welcome back, Anika' })).toBeInTheDocument();
    expect(screen.getByText('NBN 100')).toBeInTheDocument();
    const nextPayment = screen.getByRole('heading', { name: 'Next payment' }).closest('section');
    expect(nextPayment).not.toBeNull();
    expect(within(nextPayment!).getByText('$99.00')).toBeInTheDocument();
    expect(within(nextPayment!).getByText('24 September 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage plan' })).toHaveAttribute(
      'href',
      '/customer/subscription',
    );
    expect(screen.getByRole('link', { name: /Request refund/ })).toHaveAttribute(
      'href',
      '/customer/refunds',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a real pending action only when supplied by the dashboard API', async () => {
    renderDashboard({
      ...dashboard,
      pendingAction: {
        type: 'PAYMENT',
        title: 'Payment action required',
        description: 'Your latest payment was unsuccessful.',
        actionLabel: 'View billing',
        actionUrl: '/customer/invoices',
        severity: 'critical',
      },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Payment action required');
    expect(within(alert).getByRole('link', { name: /View billing/ })).toHaveAttribute(
      'href',
      '/customer/invoices',
    );
  });

  it('clearly separates invoice and refunded payment states', async () => {
    renderDashboard();

    const latestInvoice = (await screen.findByRole('heading', { name: 'Latest invoice' })).closest(
      'section',
    );
    expect(latestInvoice).not.toBeNull();
    expect(within(latestInvoice!).getByText('Invoice status')).toBeInTheDocument();
    expect(within(latestInvoice!).getByText('Payment status')).toBeInTheDocument();
    expect(within(latestInvoice!).getByText('Paid')).toBeInTheDocument();
    expect(within(latestInvoice!).getByText('Refunded')).toBeInTheDocument();
    expect(within(latestInvoice!).getByText('$25.30 refunded')).toBeInTheDocument();
  });

  it('handles no service, no upcoming payment and no activity', async () => {
    renderDashboard({
      ...dashboard,
      subscription: null,
      billing: {
        nextPaymentAmountCents: null,
        nextBillingDate: null,
        outstandingInvoiceCents: 0,
        latestPaymentStatus: null,
      },
      latestInvoice: null,
      invoices: [],
      recentActivity: [],
    });

    expect(
      await screen.findByText('You do not have a current internet service.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No upcoming payment available')).toBeInTheDocument();
    expect(screen.getByText('No recent account activity is available.')).toBeInTheDocument();
    expect(screen.getByText('You do not have any invoices yet.')).toBeInTheDocument();
  });

  it('does not request protected dashboard data without a signed-in customer', () => {
    auth.user = null;
    renderDashboard();

    expect(screen.getByText('Sign in to view your account.')).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});
