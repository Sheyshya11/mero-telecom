import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import ForgotPasswordPage from './page';

const replace = vi.fn();

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});
vi.mock('../../features/auth/auth-provider', () => ({
  useAuth: () => ({ isLoading: false, user: null }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const apiRequestMock = vi.mocked(apiRequest);

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    replace.mockReset();
  });

  it('shows the generic acknowledgement after a reset request', async () => {
    apiRequestMock.mockResolvedValue({
      message: 'If an account exists for that email address, a password reset link has been sent.',
    });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'unknown@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('If an account'));
    expect(apiRequestMock).toHaveBeenCalledWith('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'unknown@example.com' }),
    });
  });

  it('validates the email before calling the API', async () => {
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'not-an-email' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send reset link' }).closest('form')!);

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});
