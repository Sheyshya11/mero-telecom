'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '../../features/auth/auth-provider';
import {
  formatNotificationTime,
  isSafeInternalNotificationAction,
  notificationSeverityLabel,
  notificationTypeOptions,
  type AppNotification,
  type NotificationPage,
} from '../../features/notifications/notification.types';
import { apiRequest } from '../../lib/api/client';

const notificationQueryKey = ['notifications'] as const;

export default function NotificationsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [status, setStatus] = useState<'all' | 'unread'>('all');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const parameters = new URLSearchParams({
    page: String(page),
    limit: '20',
    status,
  });
  if (type) parameters.set('type', type);

  const notifications = useQuery({
    queryKey: [...notificationQueryKey, 'history', page, status, type],
    queryFn: () =>
      apiRequest<NotificationPage>('/notifications?' + parameters.toString(), {}, accessToken),
    enabled: Boolean(accessToken),
  });
  const markRead = useMutation({
    mutationFn: ({ id }: { id: string; actionUrl?: string | null }) =>
      apiRequest<AppNotification>(
        '/notifications/' + id + '/read',
        { method: 'PATCH' },
        accessToken,
      ),
    onSuccess: async (_notification, variables) => {
      await queryClient.invalidateQueries({ queryKey: notificationQueryKey });
      const actionUrl = variables.actionUrl ?? null;
      if (isSafeInternalNotificationAction(actionUrl)) {
        router.push(actionUrl);
      }
    },
  });
  const markAllRead = useMutation({
    mutationFn: () =>
      apiRequest<{ updatedCount: number }>(
        '/notifications/read-all',
        { method: 'PATCH' },
        accessToken,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationQueryKey }),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>('/notifications/' + id, { method: 'DELETE' }, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationQueryKey }),
  });

  function changeStatus(next: 'all' | 'unread') {
    setStatus(next);
    setPage(1);
  }

  return (
    <main className="workspace-page">
      <header>
        <div>
          <p>ACCOUNT � NOTIFICATIONS</p>
          <h1>Notifications</h1>
          <p>Important account, billing, service and support activity in one place.</p>
        </div>
        <button
          className="button-secondary"
          disabled={markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
          type="button"
        >
          {markAllRead.isPending ? 'Updating...' : 'Mark all as read'}
        </button>
      </header>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div aria-label="Notification status" className="flex gap-2" role="group">
            {(['all', 'unread'] as const).map((value) => (
              <button
                aria-pressed={status === value}
                className={status === value ? 'button-primary' : 'button-secondary'}
                key={value}
                onClick={() => changeStatus(value)}
                type="button"
              >
                {value === 'all' ? 'All' : 'Unread'}
              </button>
            ))}
          </div>
          <label className="grid gap-1 text-sm font-medium">
            Type
            <select
              className="field min-w-56"
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
              value={type}
            >
              <option value="">All activity</option>
              {notificationTypeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="mt-5 grid gap-3" aria-live="polite">
        {notifications.isPending ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
            Loading notifications...
          </div>
        ) : null}
        {notifications.isError ? (
          <div className="rounded-xl border border-destructive-border bg-destructive-subtle p-6 text-destructive-foreground">
            Notifications could not be loaded. Please try again.
          </div>
        ) : null}
        {notifications.data?.data.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
            <h2 className="text-lg font-bold">You're all caught up</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              You don't have any notifications matching these filters.
            </p>
          </div>
        ) : null}
        {notifications.data?.data.map((notification) => (
          <article
            className={[
              'rounded-xl border bg-card p-5 shadow-sm',
              notification.isRead ? 'border-border' : 'border-primary/30',
            ].join(' ')}
            key={notification.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <span className={severityClasses(notification.severity)}>
                  {notificationSeverityLabel(notification.severity)}
                </span>
                <h2 className="mt-2 text-base font-bold">{notification.title}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {notification.message}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatNotificationTime(notification.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!notification.isRead ? (
                  <button
                    className="button-secondary"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate({ id: notification.id })}
                    type="button"
                  >
                    Mark as read
                  </button>
                ) : null}
                {isSafeInternalNotificationAction(notification.actionUrl) ? (
                  <button
                    className="button-primary"
                    disabled={markRead.isPending}
                    onClick={() =>
                      markRead.mutate({ id: notification.id, actionUrl: notification.actionUrl })
                    }
                    type="button"
                  >
                    Open
                  </button>
                ) : null}
                <button
                  className="button-secondary"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(notification.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>

      {notifications.data && notifications.data.meta.totalPages > 1 ? (
        <nav aria-label="Notification pages" className="mt-5 flex items-center justify-between">
          <button
            className="button-secondary"
            disabled={!notifications.data.meta.hasPreviousPage || notifications.isFetching}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            type="button"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            Page {notifications.data.meta.page} of {notifications.data.meta.totalPages}
          </span>
          <button
            className="button-secondary"
            disabled={!notifications.data.meta.hasNextPage || notifications.isFetching}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            Next
          </button>
        </nav>
      ) : null}
    </main>
  );
}

function severityClasses(severity: AppNotification['severity']): string {
  const base = 'inline-flex rounded-full px-2.5 py-1 text-xs font-bold tracking-wide';
  if (severity === 'SUCCESS') return base + ' bg-success-subtle text-success-foreground';
  if (severity === 'CRITICAL') return base + ' bg-destructive-subtle text-destructive-foreground';
  if (severity === 'WARNING' || severity === 'ACTION_REQUIRED') {
    return base + ' bg-warning-subtle text-warning-foreground';
  }
  return base + ' bg-primary-subtle text-primary';
}
