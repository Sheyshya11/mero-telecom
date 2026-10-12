import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('link', { name: 'Pay Now' })).toHaveAttribute(
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
  it.each([
    ['FIRST_REMINDER', 'Payment overdue', 'status', 'border-warning'],
    ['SECOND_REMINDER', 'Payment required', 'status', 'border-l-4'],
    ['SUSPENSION_SCHEDULED', 'FINAL PAYMENT NOTICE', 'alert', 'border-destructive'],
    ['SUSPENDED', 'SERVICE SUSPENDED', 'alert', 'border-destructive'],
  ])(
    'shows the %s recorded stage with appropriate prominence',
    async (collectionStage, title, role, treatment) => {
      vi.mocked(apiRequest).mockResolvedValue({
        overdueCents: 7990,
        suspended: collectionStage === 'SUSPENDED',
        paymentProcessing: false,
        collectionStage,
        suspensionDate: '2026-10-11T00:00:00Z',
        invoiceId: 'invoice-1',
      });
      show(<CollectionBanner />);
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByRole(role)).toHaveClass(treatment);
      expect(
        screen.getByRole('link', {
          name: collectionStage === 'SUSPENDED' ? 'Pay Outstanding Balance' : 'Pay Now',
        }),
      ).toHaveAttribute('href', '/customer/invoices?invoiceId=invoice-1');
      if (collectionStage === 'SUSPENSION_SCHEDULED')
        expect(screen.getByText(/scheduled for suspension on 11 October 2026/)).toBeInTheDocument();
    },
  );
  it('replaces the previous deadline when the customer summary refreshes after an extension', async () => {
    const summary = {
      overdueCents: 7990,
      suspended: false,
      paymentProcessing: false,
      collectionStage: 'SUSPENSION_SCHEDULED',
      suspensionDate: '2026-10-08T00:00:00Z',
      invoiceId: 'invoice-1',
    };
    vi.mocked(apiRequest).mockResolvedValue(summary);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CollectionBanner />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/8 October 2026/)).toBeInTheDocument();
    vi.mocked(apiRequest).mockResolvedValue({ ...summary, suspensionDate: '2026-10-11T00:00:00Z' });
    await client.invalidateQueries({ queryKey: ['customer-collections'] });
    expect(await screen.findByText(/11 October 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/8 October 2026/)).not.toBeInTheDocument();
  });
  it('hides resolved collection banners and suppresses dates while a payment is processing', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      overdueCents: 0,
      suspended: false,
      paymentProcessing: false,
      collectionStage: 'RESOLVED',
      suspensionDate: null,
      invoiceId: null,
    });
    const resolved = show(<CollectionBanner />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    expect(screen.queryByLabelText('Overdue payment')).not.toBeInTheDocument();
    resolved.unmount();
    vi.mocked(apiRequest).mockResolvedValue({
      overdueCents: 7990,
      suspended: false,
      paymentProcessing: true,
      collectionStage: 'SUSPENSION_SCHEDULED',
      suspensionDate: '2026-10-08T00:00:00Z',
      invoiceId: 'invoice-1',
    });
    show(<CollectionBanner />);
    expect(await screen.findByText(/being reviewed before any suspension/)).toBeInTheDocument();
    expect(screen.queryByText(/8 October 2026/)).not.toBeInTheDocument();
  });
  it.each(['STAFF', 'ADMIN', 'SUPER_ADMIN'])(
    'shows dated escalation history and the extended schedule for %s',
    async (role) => {
      auth.role = role;
      vi.mocked(apiRequest).mockResolvedValue([
        {
          id: 'first',
          action: 'FIRST_REMINDER_SENT',
          actorUserId: null,
          createdAt: '2026-10-01T00:00:00Z',
          notificationDeliveredAt: '2026-10-02T00:00:00Z',
        },
        {
          id: 'second',
          action: 'SECOND_REMINDER_SENT',
          actorUserId: null,
          createdAt: '2026-10-04T00:00:00Z',
          notificationDeliveredAt: '2026-10-04T00:00:00Z',
        },
        {
          id: 'final',
          action: 'FINAL_WARNING_SENT',
          actorUserId: null,
          createdAt: '2026-10-06T00:00:00Z',
          notificationDeliveredAt: '2026-10-06T00:00:00Z',
        },
      ]);
      show(
        <CollectionControls
          subscriptionId="sub-1"
          graceEndsAt="2026-10-11T00:00:00Z"
          invoices={[
            {
              id: 'invoice-1',
              invoiceNumber: 'INV-001',
              dueDate: '2026-10-01',
              totalCents: 7990,
              collectionStage: 'SUSPENSION_SCHEDULED',
              suspensionScheduledAt: '2026-10-08T00:00:00Z',
            },
          ]}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Collection history' }));
      expect(
        await screen.findByText(/2 October 2026 · First payment reminder sent/),
      ).toBeInTheDocument();
      expect(screen.getByText(/4 October 2026 · Urgent payment reminder sent/)).toBeInTheDocument();
      expect(
        screen.getByText(/6 October 2026 · Final suspension warning sent/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/11 October 2026 · Automatic suspension scheduled/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/8 October 2026/)).not.toBeInTheDocument();
    },
  );
  it('shows recovery as a critical final notice with the actual new deadline', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      overdueCents: 7990,
      suspended: false,
      paymentProcessing: false,
      recoveryFinalWarning: true,
      collectionStage: 'SUSPENSION_SCHEDULED',
      suspensionDate: '2026-10-10T00:00:00Z',
      invoiceId: 'invoice-1',
    });
    show(<CollectionBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'original payment grace period has ended',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('10 October 2026');
    expect(screen.getByRole('link', { name: 'Pay Now' })).toBeInTheDocument();
  });
  it.each(['STAFF', 'ADMIN', 'SUPER_ADMIN'])(
    'shows recovery history and server effective deadline for %s',
    async (role) => {
      auth.role = role;
      vi.mocked(apiRequest).mockResolvedValue([
        {
          id: 'recovery',
          action: 'RECOVERY_SAFETY_EXTENSION',
          actorUserId: null,
          createdAt: '2026-10-08T00:00:00Z',
          metadata: { recoveryDeadline: '2026-10-10T00:00:00Z' },
        },
      ]);
      show(
        <CollectionControls
          subscriptionId="sub"
          graceEndsAt="2026-10-08T00:00:00Z"
          invoices={[
            {
              id: 'invoice',
              invoiceNumber: 'INV',
              totalCents: 7990,
              dueDate: '2026-10-01',
              collectionStage: 'SUSPENSION_SCHEDULED',
              recoveryFinalWarningSentAt: '2026-10-08T00:00:00Z',
              recoverySuspensionDeadline: '2026-10-10T00:00:00Z',
              suspensionScheduledAt: '2026-10-08T00:00:00Z',
              effectiveSuspensionDeadline: '2026-10-10T00:00:00Z',
            },
          ]}
        />,
      );
      expect(screen.getByText('Collection stage: RECOVERY FINAL WARNING')).toBeInTheDocument();
      expect(screen.getByText(/Suspension scheduled: 10 October 2026/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Collection history' }));
      expect(
        await screen.findByText(/One-time 48-hour safety extension granted/),
      ).toBeInTheDocument();
    },
  );
});

describe('Collection hold controls', () => {
  const eligible = {
    status: 'ACTIVE' as const,
    canPlace: true,
    canUpdate: false,
    canRelease: false,
    active: false,
    collectibleCents: 7990,
    message: 'An unresolved overdue balance can be placed on collection hold.',
  };
  it.each(['NONE', 'RESOLVED'] as const)(
    'hides Save hold for an ineligible %s collection',
    (status) => {
      show(
        <CollectionControls
          subscriptionId="sub"
          graceEndsAt={null}
          invoices={[]}
          collectionHold={{
            ...eligible,
            status,
            canPlace: false,
            message:
              status === 'RESOLVED'
                ? 'Collection resolved. No collection action is required.'
                : 'Collection hold is only available when the account has an unresolved overdue balance.',
          }}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Save hold' })).not.toBeInTheDocument();
      expect(screen.getByText(/No collection action|only available/)).toBeInTheDocument();
    },
  );
  it('explains pending overdue data rather than exposing a hold', () => {
    show(
      <CollectionControls
        subscriptionId="sub"
        graceEndsAt={null}
        invoices={[]}
        collectionHold={{
          ...eligible,
          status: 'NONE',
          canPlace: false,
          message:
            'Collection hold is unavailable. An overdue invoice on a pending service requires billing review.',
        }}
      />,
    );
    expect(screen.getByText(/requires billing review/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save hold' })).not.toBeInTheDocument();
  });
  it.each(['ADMIN', 'SUPER_ADMIN'])(
    'saves reason, internal notes and optional deadline for %s',
    async (role) => {
      auth.role = role;
      const user = userEvent.setup();
      vi.mocked(apiRequest).mockResolvedValue({});
      show(
        <CollectionControls
          subscriptionId="sub"
          graceEndsAt={null}
          invoices={[]}
          collectionHold={eligible}
        />,
      );
      expect(screen.getByRole('button', { name: 'Save hold' })).toBeDisabled();
      await user.type(screen.getByLabelText('Collection hold reason'), 'Billing dispute');
      await user.type(screen.getByLabelText('Collection hold notes'), 'Internal investigation');
      fireEvent.change(screen.getByLabelText('Hold until'), {
        target: { value: '2100-10-12T12:00' },
      });
      await user.click(screen.getByRole('button', { name: 'Save hold' }));
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          '/collections/subscriptions/sub/hold',
          {
            method: 'PUT',
            body: JSON.stringify({
              reason: 'Billing dispute',
              notes: 'Internal investigation',
              holdUntil: new Date('2100-10-12T12:00').toISOString(),
            }),
          },
          'token',
        ),
      );
    },
  );
  it('preserves staff read access without granting hold writes', () => {
    auth.role = 'STAFF';
    show(
      <CollectionControls
        subscriptionId="sub"
        graceEndsAt={null}
        invoices={[]}
        collectionHold={{
          ...eligible,
          status: 'ON_HOLD',
          canPlace: false,
          canUpdate: true,
          canRelease: true,
          active: true,
          reason: 'Billing dispute',
          notes: 'Internal notes',
        }}
      />,
    );
    expect(screen.getByText('Notes: Internal notes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save hold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release hold' })).not.toBeInTheDocument();
  });
  it('requires confirmation before sending the release request', async () => {
    vi.mocked(apiRequest).mockResolvedValue({});
    show(
      <CollectionControls
        subscriptionId="sub"
        graceEndsAt={null}
        invoices={[]}
        collectionHold={{
          ...eligible,
          status: 'ON_HOLD',
          canPlace: false,
          canUpdate: true,
          canRelease: true,
          active: true,
          reason: 'Billing dispute',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Release hold' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Release collection hold?');
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep hold' }));
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Release hold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/collections/subscriptions/sub/hold/release',
        { method: 'POST', body: JSON.stringify({ confirmed: true }) },
        'token',
      ),
    );
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
  it('shows an outstanding held balance without an imminent suspension warning', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      overdueCents: 7990,
      suspended: false,
      collectionOnHold: true,
      collectionStage: 'FINAL_WARNING',
      suspensionDate: '2026-10-08T00:00:00Z',
      invoiceId: 'invoice',
    });
    show(<CollectionBanner />);
    expect(await screen.findByRole('heading', { name: 'Collection on hold' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/paused/);
    expect(screen.queryByText(/scheduled for suspension/)).not.toBeInTheDocument();
  });
  it.each(['STAFF', 'ADMIN', 'SUPER_ADMIN'])(
    'shows dated hold audit history with reason and notes for %s',
    async (role) => {
      auth.role = role;
      vi.mocked(apiRequest).mockResolvedValue([
        {
          id: 'held',
          action: 'COLLECTION_HOLD_CREATED',
          actorUserId: 'admin',
          createdAt: '2026-10-05T00:00:00Z',
          metadata: {
            reason: 'Billing dispute',
            notes: 'Internal investigation',
            newDeadline: '2026-10-12T00:00:00Z',
          },
        },
        {
          id: 'expired',
          action: 'COLLECTION_HOLD_EXPIRED',
          actorUserId: null,
          createdAt: '2026-10-12T00:00:00Z',
          metadata: { holdReason: 'Billing dispute' },
        },
      ]);
      show(<CollectionControls subscriptionId="sub" graceEndsAt={null} invoices={[]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Collection history' }));
      expect(
        await screen.findByText(/5 October 2026 .* Collection placed on hold/),
      ).toBeInTheDocument();
      expect(screen.getByText(/Notes: Internal investigation/)).toBeInTheDocument();
      expect(screen.getByText(/12 October 2026 .* Collection hold expired/)).toBeInTheDocument();
    },
  );
});
