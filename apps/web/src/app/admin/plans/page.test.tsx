import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../../lib/api/client';
import AdminPlansPage from './page';

vi.mock('../../../features/auth/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'token',
    isLoading: false,
    user: {
      id: 'admin-id',
      email: 'admin@example.test',
      role: 'ADMIN',
      roles: ['CUSTOMER', 'ADMIN'],
    },
  }),
}));
vi.mock('../../../lib/api/client', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../../../lib/api/client')>();
  return { ...original, apiRequest: vi.fn() };
});

const plan = {
  id: 'plan-id',
  name: 'Essential 50',
  description: 'Everyday internet',
  highlights: ['HD streaming'],
  downloadMbps: 50,
  uploadMbps: 20,
  monthlyCents: 6900,
  isActive: true,
  isPublic: false,
  isAvailable: false,
  isFeatured: false,
  tierRank: 1,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T01:00:00.000Z',
};

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminPlansPage />
    </QueryClientProvider>,
  );
}

describe('AdminPlansPage', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === '/plans' && !options?.method) return [plan] as never;
      return plan as never;
    });
  });

  it('publishes only after confirmation and sends the concurrency timestamp', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('alertdialog', { name: 'Publish Essential 50?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish plan' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/plans/plan-id',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            isActive: true,
            isPublic: true,
            isAvailable: true,
            expectedUpdatedAt: plan.updatedAt,
          }),
        }),
        'token',
      ),
    );
  });

  it('creates a draft without publication flags', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Essential 50');

    const name = screen.getByLabelText('Plan name');
    await user.clear(name);
    await user.type(name, 'Family 100');
    await user.click(screen.getByRole('button', { name: 'Create draft plan' }));

    await waitFor(() => {
      const createCall = vi
        .mocked(apiRequest)
        .mock.calls.find(([path, options]) => path === '/plans' && options?.method === 'POST');
      expect(createCall).toBeDefined();
      const body = JSON.parse(String(createCall?.[1]?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty('isPublic');
      expect(body).not.toHaveProperty('isAvailable');
      expect(body).not.toHaveProperty('isFeatured');
    });
  });
});
