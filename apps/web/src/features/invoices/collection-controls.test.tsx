import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../lib/api/client';
import { CollectionPolicyControls, CollectionControls } from './collection-controls';
import { CollectionBanner } from './collection-banner';
const auth = vi.hoisted(() => ({ role: 'SUPER_ADMIN' }));
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ accessToken: 'token', user: { role: auth.role } }),
}));
vi.mock('../../lib/api/client', () => ({ apiRequest: vi.fn() }));
function show(content: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {content}
    </QueryClientProvider>,
  );
}
const policy = {
  firstReminderDays: 1,
  secondReminderDays: 3,
  finalWarningDays: 5,
  suspensionDays: 7,
};
beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  auth.role = 'SUPER_ADMIN';
});
describe('Collection policy and customer controls', () => {
  it('validates the sequence before saving the Super Admin policy', async () => {
    const user = userEvent.setup();
    vi.mocked(apiRequest).mockResolvedValue(policy);
    show(<CollectionPolicyControls />);
    const first = await screen.findByRole('spinbutton', { name: 'First reminder' });
    await user.clear(first);
    await user.type(first, '4');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(first);
    await user.type(first, '2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/collections/policy',
        { method: 'PUT', body: JSON.stringify({ ...policy, firstReminderDays: 2 }) },
        'token',
      ),
    );
  });
  it.each(['STAFF', 'ADMIN', 'CUSTOMER'])('does not expose policy editing to %s', (role) => {
    auth.role = role;
    show(<CollectionPolicyControls />);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it('keeps manual reminders separate from stage changes and requires an extension reason', async () => {
    const user = userEvent.setup();
    auth.role = 'ADMIN';
    vi.mocked(apiRequest).mockResolvedValue({ queued: true });
    show(
      <CollectionControls
        subscriptionId="subscription-1"
        invoices={[
          {
            id: 'invoice-1',
            invoiceNumber: 'INV-1',
            totalCents: 7990,
            dueDate: '2026-10-01',
            collectionStage: 'SECOND_REMINDER',
          },
        ]}
        graceEndsAt="2026-10-08"
      />,
    );
    expect(screen.getByRole('button', { name: 'Extend grace period' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Send payment reminder' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/collections/invoices/invoice-1/remind',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('requestKey') }),
        'token',
      ),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Grace extension reason' }),
      'Customer requested more time',
    );
    await user.click(screen.getByRole('button', { name: 'Extend grace period' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/subscriptions/subscription-1/extend-grace-period',
        expect.objectContaining({
          body: JSON.stringify({ days: 3, reason: 'Customer requested more time' }),
        }),
        'token',
      ),
    );
  });
  it('shows the real overdue amount and invoice-specific payment action', async () => {
    auth.role = 'CUSTOMER';
    vi.mocked(apiRequest).mockResolvedValue({
      overdueCents: 7990,
      suspended: false,
      paymentProcessing: false,
      suspensionDate: '2026-10-08T00:00:00Z',
      invoiceId: 'invoice-1',
    });
    show(<CollectionBanner />);
    expect(await screen.findByText('$79.90 is overdue.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pay now' })).toHaveAttribute(
      'href',
      '/customer/invoices?invoiceId=invoice-1',
    );
    expect(screen.getByText(/8 October 2026/)).toBeInTheDocument();
  });
  it('does not promise service restoration before provisioning succeeds', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      overdueCents: 0,
      suspended: false,
      paymentProcessing: false,
      restorationProcessing: true,
      suspensionDate: null,
      invoiceId: null,
    });
    show(<CollectionBanner />);
    expect(await screen.findByText('Payment received')).toBeInTheDocument();
    expect(screen.getByText(/restoration is being processed/)).toBeInTheDocument();
    expect(screen.queryByText('Service restored')).not.toBeInTheDocument();
  });
});
