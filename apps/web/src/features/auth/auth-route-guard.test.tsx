import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthRouteGuard } from './auth-route-guard';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  state: { isLoading: false, user: null as null | { role: 'CUSTOMER' | 'STAFF' | 'ADMIN' } },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('./auth-provider', () => ({ useAuth: () => mocks.state }));

describe('AuthRouteGuard', () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.state = { isLoading: false, user: null };
    window.history.replaceState(null, '', '/admin/dashboard?view=finance');
  });

  it('withholds protected content and preserves a safe return path for signed-out users', async () => {
    render(
      <AuthRouteGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
        <p>Sensitive dashboard</p>
      </AuthRouteGuard>,
    );

    expect(screen.queryByText('Sensitive dashboard')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        '/login?returnTo=%2Fadmin%2Fdashboard%3Fview%3Dfinance',
      ),
    );
  });

  it('redirects a wrong-role user to their own home without rendering protected content', async () => {
    mocks.state = { isLoading: false, user: { role: 'CUSTOMER' } };
    render(
      <AuthRouteGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
        <p>Sensitive dashboard</p>
      </AuthRouteGuard>,
    );

    expect(screen.queryByText('Sensitive dashboard')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/customer/dashboard'));
  });

  it('renders the page only for an allowed role', () => {
    mocks.state = { isLoading: false, user: { role: 'ADMIN' } };
    render(
      <AuthRouteGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
        <p>Sensitive dashboard</p>
      </AuthRouteGuard>,
    );

    expect(screen.getByText('Sensitive dashboard')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
