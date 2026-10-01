import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { NotificationBell } from './notification-bell';
import type { AppNotification, NotificationPage } from './notification.types';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  count: 3,
  notifications: [] as AppNotification[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ accessToken: 'access-token' }),
}));

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);
const item: AppNotification = {
  id: '33333333-3333-4333-8333-333333333333',
  type: 'PAYMENT_FAILED',
  severity: 'ACTION_REQUIRED',
  title: 'Payment failed',
  message: 'Update your payment method.',
  isRead: false,
  readAt: null,
  actionUrl: '/customer/subscription',
  entityType: 'Payment',
  entityId: 'payment-id',
  metadata: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function page(data = mocks.notifications): NotificationPage {
  return {
    data,
    meta: {
      page: 1,
      limit: 10,
      total: data.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

function renderBell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationBell />
    </QueryClientProvider>,
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.count = 3;
    mocks.notifications = [item];
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/notifications/unread-count') return { count: mocks.count } as never;
      if (path === '/notifications?page=1&limit=10') return page() as never;
      if (path === '/notifications/read-all' && options?.method === 'PATCH') {
        mocks.count = 0;
        return { updatedCount: 1 } as never;
      }
      if (path === '/notifications/' + item.id + '/read' && options?.method === 'PATCH') {
        mocks.count = 0;
        mocks.notifications = [{ ...item, isRead: true, readAt: new Date().toISOString() }];
        return mocks.notifications[0] as never;
      }
      throw new Error('Unexpected request: ' + path);
    });
  });

  it('shows the unread count and caps the badge at 99+', async () => {
    mocks.count = 120;
    renderBell();

    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('hides the unread badge when the count is zero', async () => {
    mocks.count = 0;
    renderBell();

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/notifications/unread-count',
        {},
        'access-token',
      ),
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('renders the dropdown, marks an item read, and follows its safe action', async () => {
    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Payment failed')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Payment failed: Update your payment method.',
      }),
    );

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/notifications/' + item.id + '/read',
        { method: 'PATCH' },
        'access-token',
      ),
    );
    expect(mocks.push).toHaveBeenCalledWith('/customer/subscription');
  });

  it('marks all notifications as read from the dropdown', async () => {
    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/notifications/read-all',
        { method: 'PATCH' },
        'access-token',
      ),
    );
  });
});
