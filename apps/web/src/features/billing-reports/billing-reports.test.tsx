import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingReports } from './billing-reports';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'token',
    isLoading: false,
    user: { id: 'admin', email: 'admin@example.test', role: 'ADMIN' },
  }),
}));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
}));

const moneyMetric = (valueCents: number) => ({
  valueCents,
  previousPeriodValueCents: valueCents,
  percentageChange: 0,
  direction: 'flat',
});
const countMetric = (count: number) => ({
  count,
  previousPeriodCount: count,
  percentageChange: 0,
  direction: 'flat',
});

describe('BillingReports', () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[1] === 'summary') {
        return {
          isLoading: false,
          isError: false,
          data: {
            period: {
              from: '2026-08-31T14:30:00.000Z',
              to: '2026-09-08T14:30:00.000Z',
              timezone: 'Australia/Adelaide',
              generatedAt: '2026-09-08T05:00:00.000Z',
            },
            reconciliationLastCompletedAt: null,
            metrics: {
              grossBilled: moneyMetric(9_900),
              paymentsReceived: moneyMetric(0),
              outstanding: moneyMetric(9_900),
              netCashCollected: moneyMetric(-5_530),
              mrr: moneyMetric(9_000),
              activeServices: countMetric(1),
              arpu: moneyMetric(9_000),
              overdueBalance: moneyMetric(0),
              failedPayments: countMetric(0),
              refundsPaid: moneyMetric(5_530),
              creditsIssued: moneyMetric(0),
              unreconciledTransactions: countMetric(0),
            },
            tax: {
              gstBilledCents: 900,
              gstAssociatedWithPaymentsCents: 0,
              gstRefundedOrCreditedCents: 503,
            },
            overdue: {
              invoiceCount: 0,
              customerCount: 0,
              totalAmountCents: 0,
              averageDaysOverdue: 0,
              oldestInvoiceAgeDays: 0,
            },
            paymentHealth: {
              successfulPaymentCount: 0,
              successfulPaymentValueCents: 0,
              failedPaymentCount: 0,
              paymentSuccessRate: 0,
              averagePaymentValueCents: 0,
              refundCount: 1,
              refundValueCents: 5_530,
              creditCount: 0,
              creditValueCents: 0,
            },
          },
        };
      }
      if (queryKey[1] === 'revenue') {
        return { isLoading: false, isError: false, data: { trend: [] } };
      }
      return { isLoading: false, isError: false, data: { data: [], buckets: [] } };
    });
  });

  it('uses precise financial terminology and explains a negative net-cash period', () => {
    render(<BillingReports />);
    expect(screen.getByRole('heading', { name: 'Billing & Revenue Reports' })).toBeInTheDocument();
    expect(screen.getByText('Net cash collected')).toBeInTheDocument();
    expect(screen.getByText('-$55.30')).toBeInTheDocument();
    expect(screen.queryByText('Net revenue')).not.toBeInTheDocument();
    expect(screen.getByText('Not enough historical data to show a trend.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'This financial year' })).toBeInTheDocument();
    expect(screen.getByText(/GST associated with collected payments/)).toBeInTheDocument();
  });
});
