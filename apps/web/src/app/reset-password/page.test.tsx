import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import ResetPasswordPage from './page';

const replace = vi.fn();
let queryToken = 't'.repeat(43);

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({ get: (key: string) => (key === 'token' ? queryToken : null) }),
}));

const apiRequestMock = vi.mocked(apiRequest);

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    queryToken = 't'.repeat(43);
    replace.mockReset();
    apiRequestMock.mockReset();
    window.history.replaceState(null, '', `/reset-password?token=${queryToken}`);
  });

  it('removes the token from the address bar, validates it, and completes reset', async () => {
    apiRequestMock.mockResolvedValueOnce({ valid: true }).mockResolvedValueOnce(undefined as never);
    render(<ResetPasswordPage />);

    expect(
      await screen.findByRole('heading', { name: 'Create a new password' }),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('');
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewStrongPassword1!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'NewStrongPassword1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/reset-password/success'));
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, '/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: queryToken, newPassword: 'NewStrongPassword1!' }),
    });
  });

  it('shows one generic unavailable state for expired tokens', async () => {
    apiRequestMock.mockResolvedValueOnce({ valid: false });
    render(<ResetPasswordPage />);

    expect(
      await screen.findByRole('heading', { name: 'Reset link unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('blocks mismatched passwords in the browser', async () => {
    apiRequestMock.mockResolvedValueOnce({ valid: true });
    render(<ResetPasswordPage />);
    await screen.findByRole('heading', { name: 'Create a new password' });

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewStrongPassword1!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'DifferentPassword1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });
});
