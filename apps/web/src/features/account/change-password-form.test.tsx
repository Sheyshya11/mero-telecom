import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRequest } from '../../lib/api/client';
import { ChangePasswordForm } from './change-password-form';

vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ accessToken: 'access-token' }),
}));

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);
const currentPassword = 'CurrentPassword1!';
const newPassword = 'ReplacementPassword2!';

function renderForm() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ChangePasswordForm />
    </QueryClientProvider>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Current password'), currentPassword);
  await user.type(screen.getByLabelText('New password'), newPassword);
  await user.type(screen.getByLabelText('Confirm new password'), newPassword);
}

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('uses password inputs, accessible visibility controls, and a live requirement indicator', async () => {
    const user = userEvent.setup();
    renderForm();

    const current = screen.getByLabelText('Current password');
    const next = screen.getByLabelText('New password');
    const confirmation = screen.getByLabelText('Confirm new password');
    expect(current).toHaveAttribute('type', 'password');
    expect(next).toHaveAttribute('type', 'password');
    expect(confirmation).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show new password' }));
    expect(next).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide new password' })).toBeInTheDocument();

    await user.type(next, newPassword);
    expect(screen.getByText(/12 to 128 characters/)).toHaveTextContent('met');
    expect(screen.getByText(/One special character/)).toHaveTextContent('met');
  });

  it('rejects weak, reused, and mismatched passwords before making a request', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Current password'), currentPassword);
    await user.type(screen.getByLabelText('New password'), 'weak');
    await user.type(screen.getByLabelText('Confirm new password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Password must be at least 12 characters.')).toBeInTheDocument();
    expect(screen.getByText('Password confirmation must match.')).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('New password'), currentPassword);
    await user.type(screen.getByLabelText('Confirm new password'), currentPassword);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(
      await screen.findByText('New password must be different from the current password.'),
    ).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it('submits once, shows success feedback, and clears every password field', async () => {
    apiRequestMock.mockResolvedValue({
      success: true,
      message: 'Password changed successfully.',
    } as never);
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/auth/change-password',
        {
          method: 'PATCH',
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword: newPassword,
          }),
        },
        'access-token',
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed successfully.');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('disables submission while the request is pending', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    apiRequestMock.mockImplementation(
      () => new Promise((resolve) => (resolveRequest = resolve)) as never,
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);

    const submit = screen.getByRole('button', { name: 'Change password' });
    await user.click(submit);
    expect(screen.getByRole('button', { name: 'Changing password…' })).toBeDisabled();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest?.({ success: true, message: 'Password changed successfully.' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed successfully.');
  });

  it('shows a secure API error without clearing the entered fields', async () => {
    apiRequestMock.mockRejectedValue(new ApiError('Current password is incorrect.', 400));
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
    expect(screen.getByLabelText('Current password')).toHaveValue(currentPassword);
    expect(screen.getByLabelText('New password')).toHaveValue(newPassword);
  });
});
