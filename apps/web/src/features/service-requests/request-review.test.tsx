import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../lib/api/client';
import { RequestReviewControls } from './request-review-controls';
import { RequestReviewQueue } from './request-review-queue';
const auth = vi.hoisted(() => ({ role: 'STAFF' }));
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ accessToken: 'token', user: { role: auth.role } }),
}));
vi.mock('../../lib/api/client', () => ({ apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
describe('Employee service request review controls', () => {
  beforeEach(() => {
    api.mockReset();
    auth.role = 'STAFF';
  });
  it('requires a customer-safe reason and sends internal notes separately', async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    render(<RequestReviewControls kind="Cancellation" busy={false} onDecision={onDecision} />);
    expect(screen.getByRole('button', { name: 'Reject Request' })).toBeDisabled();
    await user.type(screen.getByLabelText('Customer-safe rejection reason'), '   ');
    expect(screen.getByRole('button', { name: 'Reject Request' })).toBeDisabled();
    await user.type(
      screen.getByLabelText('Customer-safe rejection reason'),
      'Contact support to confirm the date.',
    );
    await user.type(screen.getByLabelText('Internal review notes'), 'Private notes');
    await user.click(screen.getByRole('button', { name: 'Reject Request' }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('reject', {
      reason: 'Contact support to confirm the date.',
      reviewNotes: 'Private notes',
    });
  });
  it('labels approval as a review decision and sends notes without inventing completion', async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    render(<RequestReviewControls kind="Move" busy={false} onDecision={onDecision} />);
    expect(screen.getByText(/Approval allows operational processing to begin/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve Move' }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('approve', { reviewNotes: undefined });
    expect(screen.queryByText('Move completed')).not.toBeInTheDocument();
  });
  it('disables both decisions during a pending mutation', () => {
    render(<RequestReviewControls kind="Move" busy onDecision={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Approve Move' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject Request' })).toBeDisabled();
  });
  it.each(['STAFF', 'ADMIN', 'SUPER_ADMIN'])(
    'surfaces existing filtered management links to %s without submitting a decision',
    async (role) => {
      auth.role = role;
      api.mockResolvedValue({ cancellations: 2, relocations: 3, refunds: 1 } as never);
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <RequestReviewQueue />
        </QueryClientProvider>,
      );
      expect(await screen.findByText('3')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Cancellation/ })).toHaveAttribute(
        'href',
        '/control-centre/cancellations?status=PENDING_REVIEW',
      );
      expect(screen.getByRole('link', { name: /Move home/ })).toHaveAttribute(
        'href',
        '/control-centre/relocations?status=PENDING_REVIEW',
      );
      expect(screen.getByRole('link', { name: /Refund/ })).toHaveAttribute(
        'href',
        '/control-centre/refunds?status=REQUESTED',
      );
      expect(api).toHaveBeenCalledExactlyOnceWith('/dashboard/service-requests', {}, 'token');
    },
  );
});
