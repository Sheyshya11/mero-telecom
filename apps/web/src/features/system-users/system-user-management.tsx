'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { ApiError } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import {
  changeSystemUserRole,
  changeSystemUserStatus,
  inviteSystemUser,
  listStaffInvitations,
  listSecurityAuditLogs,
  listSystemUsers,
  resendSystemInvitation,
  revokeSystemInvitation,
} from './system-users.api';
import type { StaffInvitation, SystemUser } from './system-users.types';
import {
  canChangeTargetStatus,
  canControlInvitation,
  invitationRolesFor,
} from './system-user-permissions';

const invitationSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a name.').max(200),
  email: z.email('Enter a valid email address.'),
  role: z.enum(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
});
type InvitationValues = z.infer<typeof invitationSchema>;

type PendingAction =
  | { kind: 'role'; user: SystemUser; value: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' }
  | { kind: 'status'; user: SystemUser; value: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' }
  | { kind: 'resend'; invitation: StaffInvitation }
  | { kind: 'revoke'; invitation: StaffInvitation };

export function SystemUserManagement() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const form = useForm<InvitationValues>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { displayName: '', email: '', role: 'STAFF' },
  });
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isAdministrator = isSuperAdmin || user?.role === 'ADMIN';
  const invitationRoles = user ? invitationRolesFor(user.role) : [];

  const users = useQuery({
    queryKey: ['system-users', search, roleFilter, statusFilter],
    queryFn: () =>
      listSystemUsers(accessToken ?? '', {
        search: search.trim() || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined,
      }),
    enabled: Boolean(accessToken && isAdministrator),
  });
  const invitations = useQuery({
    queryKey: ['staff-invitations'],
    queryFn: () => listStaffInvitations(accessToken ?? ''),
    enabled: Boolean(accessToken && isAdministrator),
  });
  const auditLogs = useQuery({
    queryKey: ['security-audit-logs'],
    queryFn: () => listSecurityAuditLogs(accessToken ?? ''),
    enabled: Boolean(accessToken && isSuperAdmin),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['system-users'] }),
      queryClient.invalidateQueries({ queryKey: ['staff-invitations'] }),
      queryClient.invalidateQueries({ queryKey: ['security-audit-logs'] }),
    ]);
  };
  const invite = useMutation({
    mutationFn: (values: InvitationValues) => inviteSystemUser(accessToken ?? '', values),
    onSuccess: async () => {
      form.reset();
      setFeedback('Invitation queued successfully.');
      await refresh();
    },
    onError: (error) => setFeedback(errorMessage(error)),
  });
  const action = useMutation({
    mutationFn: async (value: PendingAction) => {
      if (value.kind === 'role')
        return changeSystemUserRole(accessToken ?? '', value.user.id, value.value);
      if (value.kind === 'status')
        return changeSystemUserStatus(accessToken ?? '', value.user.id, value.value);
      if (value.kind === 'resend')
        return resendSystemInvitation(accessToken ?? '', value.invitation.id);
      return revokeSystemInvitation(accessToken ?? '', value.invitation.id);
    },
    onSuccess: async () => {
      setFeedback('The requested change was completed.');
      setPending(null);
      await refresh();
    },
    onError: (error) => {
      setFeedback(errorMessage(error));
      setPending(null);
    },
  });

  if (isLoading) return <PageStatus message="Restoring your session…" />;
  if (!user) return <PageStatus message="Sign in to manage system users." />;
  if (!isAdministrator) return <PageStatus message="Administrator access is required." />;
  const activeSuperAdmins =
    users.data?.data.filter(
      (item) => item.role === 'SUPER_ADMIN' && item.status === 'ACTIVE' && item.isActive,
    ).length ?? 0;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">
            MERO TELECOM · {isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN'}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Team and access</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Invite operational users and control their role and account access. Customer identities
            remain read-only here.
          </p>
        </div>
        <Link className="button-secondary self-start" href="/admin/dashboard">
          Back to dashboard
        </Link>
      </header>

      {feedback ? (
        <p className="mt-5 rounded-lg bg-sky-50 p-3 text-sm text-sky-900" role="status">
          {feedback}
        </p>
      ) : null}

      <section className="mt-7 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-950">Invite a system user</h2>
        <p className="mt-1 text-sm text-slate-600">
          The recipient verifies their email and creates their own password from a single-use link.
        </p>
        <form
          className="mt-5 grid gap-4 md:grid-cols-[1fr_1.3fr_0.7fr_auto] md:items-start"
          onSubmit={form.handleSubmit((values) => invite.mutate(values))}
        >
          <Field label="Name" error={form.formState.errors.displayName?.message}>
            <input className="field" autoComplete="name" {...form.register('displayName')} />
          </Field>
          <Field label="Email" error={form.formState.errors.email?.message}>
            <input
              className="field"
              type="email"
              autoComplete="email"
              {...form.register('email')}
            />
          </Field>
          <Field label="System role" error={form.formState.errors.role?.message}>
            <select className="field" {...form.register('role')}>
              {invitationRoles.map((role) => (
                <option key={role} value={role}>
                  {role.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <button className="button-primary md:mt-6" disabled={invite.isPending} type="submit">
            {invite.isPending ? 'Inviting…' : 'Send invitation'}
          </button>
        </form>
      </section>

      <section className="mt-7 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Users</h2>
            <p className="mt-1 text-sm text-slate-600">
              Passwords, tokens, and security secrets are never returned.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Search
              <input
                className="field"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <Filter
              label="Role"
              value={roleFilter}
              onChange={setRoleFilter}
              values={['SUPER_ADMIN', 'ADMIN', 'STAFF', 'CUSTOMER']}
            />
            <Filter
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              values={['INVITATION_PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']}
            />
          </div>
        </div>
        {users.isPending ? <InlineStatus message="Loading users…" /> : null}
        {users.isError ? <InlineStatus message="Unable to load users." /> : null}
        {users.data?.data.length === 0 ? (
          <InlineStatus message="No users match these filters." />
        ) : null}
        {users.data?.data.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-220 text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3">User</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Created</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.data.map((item) => {
                  const finalSuperAdmin =
                    item.role === 'SUPER_ADMIN' &&
                    item.status === 'ACTIVE' &&
                    activeSuperAdmins <= 1;
                  const immutable =
                    item.isCustomer || item.id === user.id || item.status === 'INVITATION_PENDING';
                  const canManageStatus = canChangeTargetStatus(user, item);
                  return (
                    <tr className="border-b border-slate-100 align-top last:border-0" key={item.id}>
                      <td className="px-3 py-4">
                        <p className="font-medium text-slate-900">
                          {item.displayName ?? 'Name not set'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{item.email}</p>
                      </td>
                      <td className="px-3 py-4">
                        <Badge value={item.role} />
                      </td>
                      <td className="px-3 py-4">
                        <Badge value={item.status} />
                      </td>
                      <td className="px-3 py-4 text-slate-600">{date(item.createdAt)}</td>
                      <td className="px-3 py-4">
                        <div className="flex justify-end gap-2">
                          {isSuperAdmin && !immutable && item.role === 'STAFF' ? (
                            <button
                              className="button-secondary"
                              onClick={() =>
                                setPending({ kind: 'role', user: item, value: 'ADMIN' })
                              }
                              type="button"
                            >
                              Promote
                            </button>
                          ) : null}
                          {isSuperAdmin && !immutable && item.role === 'ADMIN' ? (
                            <button
                              className="button-secondary"
                              onClick={() =>
                                setPending({ kind: 'role', user: item, value: 'SUPER_ADMIN' })
                              }
                              type="button"
                            >
                              Make super admin
                            </button>
                          ) : null}
                          {isSuperAdmin && !immutable && item.role === 'ADMIN' ? (
                            <button
                              className="button-secondary"
                              onClick={() =>
                                setPending({ kind: 'role', user: item, value: 'STAFF' })
                              }
                              type="button"
                            >
                              Demote
                            </button>
                          ) : null}
                          {isSuperAdmin && !immutable && item.role === 'SUPER_ADMIN' ? (
                            <button
                              className="button-secondary"
                              disabled={finalSuperAdmin}
                              onClick={() =>
                                setPending({ kind: 'role', user: item, value: 'ADMIN' })
                              }
                              type="button"
                            >
                              Demote to admin
                            </button>
                          ) : null}
                          {canManageStatus && item.status === 'ACTIVE' ? (
                            <button
                              className="button-secondary"
                              disabled={finalSuperAdmin}
                              onClick={() =>
                                setPending({ kind: 'status', user: item, value: 'SUSPENDED' })
                              }
                              type="button"
                            >
                              Suspend
                            </button>
                          ) : null}
                          {canManageStatus &&
                          (item.status === 'SUSPENDED' || item.status === 'DEACTIVATED') ? (
                            <button
                              className="button-secondary"
                              onClick={() =>
                                setPending({ kind: 'status', user: item, value: 'ACTIVE' })
                              }
                              type="button"
                            >
                              Reactivate
                            </button>
                          ) : null}
                          {canManageStatus && item.status !== 'DEACTIVATED' ? (
                            <button
                              className="button-secondary"
                              disabled={finalSuperAdmin}
                              onClick={() =>
                                setPending({ kind: 'status', user: item, value: 'DEACTIVATED' })
                              }
                              type="button"
                            >
                              Deactivate
                            </button>
                          ) : null}
                          {item.isCustomer ? (
                            <span className="text-xs text-slate-500">Manage in Customers</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="mt-7 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-950">Invitations</h2>
        {invitations.isPending ? <InlineStatus message="Loading invitations…" /> : null}
        {invitations.isError ? <InlineStatus message="Unable to load invitations." /> : null}
        {invitations.data?.data.length === 0 ? (
          <InlineStatus message="No invitations have been issued." />
        ) : null}
        {invitations.data?.data.length ? (
          <div className="mt-5 grid gap-3">
            {invitations.data.data.map((invitation) => (
              <article
                className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 p-4 md:flex-row md:items-center"
                key={invitation.id}
              >
                <div>
                  <p className="font-medium text-slate-900">{invitation.email}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {invitation.role} · expires {dateTime(invitation.expiresAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={invitation.status} />
                  {canControlInvitation(user.role, invitation.role) &&
                  (invitation.status === 'PENDING' || invitation.status === 'EXPIRED') ? (
                    <button
                      className="button-secondary"
                      onClick={() => setPending({ kind: 'resend', invitation })}
                      type="button"
                    >
                      Resend
                    </button>
                  ) : null}
                  {canControlInvitation(user.role, invitation.role) &&
                  invitation.status === 'PENDING' ? (
                    <button
                      className="button-secondary"
                      onClick={() => setPending({ kind: 'revoke', invitation })}
                      type="button"
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {isSuperAdmin ? (
        <section className="mt-7 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-slate-950">Security audit history</h2>
          <p className="mt-1 text-sm text-slate-600">
            Restricted to super administrators. Entries include the actor, target, and assurance
            metadata.
          </p>
          {auditLogs.isPending ? <InlineStatus message="Loading security events…" /> : null}
          {auditLogs.isError ? <InlineStatus message="Unable to load security events." /> : null}
          <div className="mt-5 grid gap-3">
            {auditLogs.data?.data.map((log) => (
              <article className="rounded-lg border border-slate-200 p-4" key={log.id}>
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-medium text-slate-900">{log.action.replaceAll('_', ' ')}</p>
                  <time className="text-xs text-slate-500">{dateTime(log.createdAt)}</time>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {log.actor?.email ?? 'System command'} · {log.entityType} {log.entityId}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <Confirmation
        action={pending}
        busy={action.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && action.mutate(pending)}
      />
    </main>
  );
}

function Confirmation({
  action,
  busy,
  onCancel,
  onConfirm,
}: Readonly<{
  action: PendingAction | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const subject =
    action && 'user' in action
      ? action.user.email
      : action && 'invitation' in action
        ? action.invitation.email
        : '';
  const verb =
    action?.kind === 'role'
      ? `change the role to ${action.value}`
      : action?.kind === 'status'
        ? `change the status to ${action.value}`
        : (action?.kind ?? 'change');
  return (
    <AlertDialog open={Boolean(action)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm privileged change</AlertDialogTitle>
          <AlertDialogDescription>
            Confirm that you want to {verb} for {subject}. This action is recorded in the audit log.
            {action?.kind === 'role' &&
            (action.user.role === 'SUPER_ADMIN' || action.value === 'SUPER_ADMIN')
              ? ' Recent sign-in verification is required; all of the target sessions will be revoked.'
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={onConfirm}>
            {busy ? 'Saving…' : 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Field({
  label,
  error,
  children,
}: Readonly<{ label: string; error?: string; children: React.ReactNode }>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      {children}
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </label>
  );
}
function Filter({
  label,
  value,
  onChange,
  values,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  values: string[];
}>) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-slate-600">
      {label}
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {item.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}
function Badge({ value }: Readonly<{ value: string }>) {
  const color =
    value === 'ACTIVE' || value === 'ACCEPTED'
      ? 'bg-emerald-100 text-emerald-800'
      : value === 'SUPER_ADMIN'
        ? 'bg-fuchsia-100 text-fuchsia-900'
        : value === 'ADMIN'
          ? 'bg-violet-100 text-violet-800'
          : value === 'SUSPENDED' || value === 'EXPIRED'
            ? 'bg-amber-100 text-amber-800'
            : value === 'DEACTIVATED' || value === 'REVOKED'
              ? 'bg-rose-100 text-rose-800'
              : 'bg-sky-100 text-sky-800';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>
      {value.replaceAll('_', ' ')}
    </span>
  );
}
function InlineStatus({ message }: Readonly<{ message: string }>) {
  return <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{message}</p>;
}
function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      {message}
    </main>
  );
}
function date(value: string) {
  return new Date(value).toLocaleDateString('en-AU');
}
function dateTime(value: string) {
  return new Date(value).toLocaleString('en-AU');
}
function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'The request could not be completed.';
}
