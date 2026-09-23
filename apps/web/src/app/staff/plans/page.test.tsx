import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../../lib/api/client';
import StaffPlansPage from './page';

vi.mock('../../../features/auth/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'token',
    isLoading: false,
    user: { id: 'staff-id', email: 'staff@example.test', role: 'STAFF', roles: ['STAFF'] },
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
  isPublic: true,
  isAvailable: true,
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
      <StaffPlansPage />
    </QueryClientProvider>,
  );
}

describe('StaffPlansPage', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === '/plans' && !options?.method) return [plan] as never;
      return plan as never;
    });
  });

  it('closes the accessible highlight dialog with Escape', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit highlights' }));
    expect(screen.getByRole('dialog', { name: 'Edit Essential 50' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deduplicates highlights and sends the concurrency timestamp', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit highlights' }));
    const textarea = screen.getByLabelText(/Plan highlights/);
    await user.clear(textarea);
    await user.type(textarea, 'Streaming\nStreaming\nWorking from home');
    await user.click(screen.getByRole('button', { name: 'Save highlights' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/plans/plan-id/highlights',
        {
          method: 'PATCH',
          body: JSON.stringify({
            highlights: ['Streaming', 'Working from home'],
            expectedUpdatedAt: plan.updatedAt,
          }),
        },
        'token',
      ),
    );
  });
});
