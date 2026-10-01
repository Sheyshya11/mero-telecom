'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(128),
    newPassword: z
      .string()
      .min(12, 'Password must be at least 12 characters.')
      .max(128, 'Password must be no more than 128 characters.')
      .regex(/[a-z]/, 'Password must include a lowercase letter.')
      .regex(/[A-Z]/, 'Password must include an uppercase letter.')
      .regex(/\d/, 'Password must include a number.')
      .regex(/[^A-Za-z0-9]/, 'Password must include a symbol.'),
    confirmPassword: z.string().min(1, 'Confirm your new password.').max(128),
  })
  .superRefine((values, context) => {
    if (values.newPassword === values.currentPassword) {
      context.addIssue({
        code: 'custom',
        message: 'New password must be different from the current password.',
        path: ['newPassword'],
      });
    }
    if (values.confirmPassword !== values.newPassword) {
      context.addIssue({
        code: 'custom',
        message: 'Password confirmation must match.',
        path: ['confirmPassword'],
      });
    }
  });

type PasswordValues = z.infer<typeof passwordSchema>;

interface ChangePasswordResponse {
  success: true;
  message: string;
}

export function ChangePasswordForm() {
  const { accessToken } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const newPassword = form.watch('newPassword');

  const changePassword = useMutation({
    mutationFn: (values: PasswordValues) =>
      apiRequest<ChangePasswordResponse>(
        '/auth/change-password',
        { method: 'PATCH', body: JSON.stringify(values) },
        accessToken,
      ),
    onSuccess: (response) => {
      form.reset();
      setToast(response.message);
    },
  });

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  return (
    <>
      <form
        className="grid gap-5"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          setToast(null);
          changePassword.reset();
          changePassword.mutate(values);
        })}
      >
        <PasswordField
          autoComplete="current-password"
          error={form.formState.errors.currentPassword?.message}
          id="current-password"
          label="Current password"
          registration={form.register('currentPassword')}
        />
        <PasswordField
          autoComplete="new-password"
          error={form.formState.errors.newPassword?.message}
          id="new-password"
          label="New password"
          registration={form.register('newPassword')}
        />
        <PasswordRequirements password={newPassword} />
        <PasswordField
          autoComplete="new-password"
          error={form.formState.errors.confirmPassword?.message}
          id="confirm-new-password"
          label="Confirm new password"
          registration={form.register('confirmPassword')}
        />
        {changePassword.error ? (
          <p
            className="rounded-md border border-destructive-border bg-destructive-subtle p-3 text-sm text-destructive-foreground"
            role="alert"
          >
            {changePassword.error instanceof ApiError
              ? changePassword.error.message
              : 'Unable to change your password. Please try again.'}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            className="button-primary"
            disabled={changePassword.isPending || !accessToken}
            type="submit"
          >
            {changePassword.isPending ? 'Changing password…' : 'Change password'}
          </button>
        </div>
      </form>
      {toast ? (
        <div
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 rounded-lg border border-success-border bg-success-subtle px-4 py-3 text-sm font-medium text-success-foreground shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </>
  );
}

function PasswordField({
  autoComplete,
  error,
  id,
  label,
  registration,
}: Readonly<{
  autoComplete: 'current-password' | 'new-password';
  error?: string;
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
}>) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          {...registration}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          autoComplete={autoComplete}
          className="field pr-20"
          id={id}
          type={visible ? 'text' : 'password'}
        />
        <button
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? (
        <span className="text-xs text-destructive-foreground" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function PasswordRequirements({ password }: Readonly<{ password: string }>) {
  const requirements = [
    ['12 to 128 characters', password.length >= 12 && password.length <= 128],
    ['One uppercase letter', /[A-Z]/.test(password)],
    ['One lowercase letter', /[a-z]/.test(password)],
    ['One number', /\d/.test(password)],
    ['One special character', /[^A-Za-z0-9]/.test(password)],
  ] as const;

  return (
    <div className="rounded-lg border border-border bg-muted/45 p-4">
      <p className="text-sm font-semibold text-foreground">Password requirements</p>
      <ul aria-label="Password requirements" className="mt-2 grid gap-1 sm:grid-cols-2">
        {requirements.map(([label, met]) => (
          <li
            className={met ? 'text-sm text-success-foreground' : 'text-sm text-muted-foreground'}
            key={label}
          >
            <span aria-hidden="true" className="mr-2 font-bold">
              {met ? '✓' : '○'}
            </span>
            {label}
            <span className="sr-only">: {met ? 'met' : 'not met'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
