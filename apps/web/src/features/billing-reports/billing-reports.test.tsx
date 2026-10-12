import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  it('downloads a PDF through the web origin and retains its Blob URL while the download starts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('%PDF-1.3\nreport', {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Report-Content-Type': 'application/pdf',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:billing-report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<BillingReports />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/billing/reports/revenue/export?preset=this_month&page=1&pageSize=25&format=pdf',
      { headers: { Authorization: 'Bearer token' }, credentials: 'include' },
    );
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'application/pdf' }),
    );
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:billing-report'), {
      timeout: 2000,
    });
  });

  it.each([
    ['', 'The exported report was empty. Please try again.'],
    [
      '<html>Service unavailable</html>',
      'The exported report was not a valid PDF. Please try again.',
    ],
  ])('rejects a corrupt PDF response instead of downloading it', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<BillingReports />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled();
  });

  it('shows API permission errors and allows the export to be retried', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { message: 'You do not have permission to export billing reports.' },
            { status: 403 },
          ),
        ),
    );
    render(<BillingReports />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled();
  });
});
