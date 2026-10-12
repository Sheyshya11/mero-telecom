import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import NotificationsPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../../features/auth/auth-provider', () => ({
  useAuth: () => ({ accessToken: 'access-token' }),
}));

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsPage />
    </QueryClientProvider>,
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path.startsWith('/notifications?')) {
        return {
          data: [],
          meta: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        } as never;
      }
      if (path === '/notifications/read-all' && options?.method === 'PATCH') {
        return { updatedCount: 0 } as never;
      }
      throw new Error('Unexpected request: ' + path);
    });
  });

  it('shows the zero-notification state', async () => {
    renderPage();

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByText(/don't have any notifications/)).toBeInTheDocument();
  });

  it('marks all notifications as read', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/notifications/read-all',
        { method: 'PATCH' },
        'access-token',
      ),
    );
  });
  it('keeps previous reminders beside critical notices with explicit payment actions', async () => {
    const base = {
      isRead: true,
      createdAt: new Date().toISOString(),
      message: '$79.90 remains unpaid.',
      actionUrl: '/customer/invoices?invoiceId=invoice-1',
    };
    apiRequestMock.mockResolvedValue({
      data: [
        {
          ...base,
          id: 'suspended',
          type: 'SERVICE_SUSPENDED',
          severity: 'CRITICAL',
          title: 'Service suspended',
        },
        {
          ...base,
          id: 'final',
          type: 'FINAL_PAYMENT_WARNING',
          severity: 'CRITICAL',
          title: 'Final notice — service suspension approaching',
        },
        {
          ...base,
          id: 'second',
          type: 'PAYMENT_REMINDER',
          severity: 'WARNING',
          title: 'Payment required — invoice still overdue',
          metadata: { collectionStage: 'SECOND_REMINDER' },
        },
        {
          ...base,
          id: 'first',
          type: 'PAYMENT_REMINDER',
          severity: 'WARNING',
          title: 'Payment overdue',
          metadata: { collectionStage: 'FIRST_REMINDER' },
        },
      ],
      meta: { page: 1, totalPages: 1 },
    } as never);
    renderPage();
    expect(await screen.findByText('FINAL NOTICE')).toBeInTheDocument();
    expect(screen.getByText('FINAL NOTICE').closest('article')).toHaveClass(
      'border-destructive',
      'border-l-4',
    );
    expect(screen.getByText('Urgent payment reminder').closest('article')).toHaveClass(
      'border-warning',
      'border-l-4',
    );
    expect(screen.getByText('First payment reminder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay Outstanding Balance' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Pay Now' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'View Invoice' })).toHaveLength(3);
    expect(apiRequestMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(
      false,
    );
  });
  it.each(['PAID', 'CANCELLED'] as const)(
    'shows %s notice resolution while preserving the original notice as history',
    async (status) => {
      apiRequestMock.mockResolvedValue({
        data: [
          {
            id: 'resolved',
            type: 'FINAL_PAYMENT_WARNING',
            severity: 'CRITICAL',
            title: 'Final notice — service suspension approaching',
            message: 'Pay now to avoid suspension.',
            isRead: false,
            createdAt: new Date().toISOString(),
            actionUrl: '/customer/invoices?invoiceId=invoice-1',
            invoiceResolution: {
              status,
              invoiceId: 'invoice-1',
              resolvedAt: new Date().toISOString(),
            },
          },
        ],
        meta: { page: 1, totalPages: 1 },
      } as never);
      renderPage();
      const resolved = (await screen.findByText('Resolved')).closest('article');
      expect(resolved).toHaveAttribute('data-resolved', 'true');
      expect(resolved).not.toHaveAttribute('data-collection-stage');
      expect(resolved).not.toHaveClass('border-destructive');
      expect(screen.getByRole('button', { name: 'View Invoice' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Pay Now' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
      expect(screen.getByText('Original notice').closest('details')).toContainElement(
        screen.getByText('Pay now to avoid suspension.'),
      );
      expect(screen.queryByText('FINAL NOTICE')).not.toBeInTheDocument();
      expect(screen.queryByText('Service restored')).not.toBeInTheDocument();
    },
  );
});
