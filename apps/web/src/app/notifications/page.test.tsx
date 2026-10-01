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
});
