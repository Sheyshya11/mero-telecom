'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import {
  formatNotificationTime,
  isSafeInternalNotificationAction,
  type AppNotification,
  type NotificationPage,
} from './notification.types';
import styles from './notification-bell.module.css';

const notificationQueryKey = ['notifications'] as const;

export function NotificationBell() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const unread = useQuery({
    queryKey: [...notificationQueryKey, 'unread-count'],
    queryFn: () => apiRequest<{ count: number }>('/notifications/unread-count', {}, accessToken),
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  });
  const recent = useQuery({
    queryKey: [...notificationQueryKey, 'recent'],
    queryFn: () => apiRequest<NotificationPage>('/notifications?page=1&limit=10', {}, accessToken),
    enabled: Boolean(accessToken && open),
    refetchInterval: open ? 30_000 : false,
  });
  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiRequest<AppNotification>(
        '/notifications/' + id + '/read',
        { method: 'PATCH' },
        accessToken,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationQueryKey }),
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

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function openNotification(notification: AppNotification) {
    if (!notification.isRead) await markRead.mutateAsync(notification.id);
    setOpen(false);
    if (isSafeInternalNotificationAction(notification.actionUrl)) {
      router.push(notification.actionUrl);
    }
  }

  const count = unread.data?.count ?? 0;
  return (
    <div className={styles.root} ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Notifications"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <BellIcon />
        {count > 0 ? <span className={styles.badge}>{count > 99 ? '99+' : count}</span> : null}
      </button>
      {open ? (
        <section aria-label="Recent notifications" className={styles.panel} role="dialog">
          <div className={styles.panelHeader}>
            <h2 className={styles.heading}>Notifications</h2>
            <button
              className={styles.textButton}
              disabled={count === 0 || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
              type="button"
            >
              Mark all as read
            </button>
          </div>
          <div className={styles.list}>
            {recent.isPending ? <p className={styles.state}>Loading notifications...</p> : null}
            {recent.isError ? (
              <p className={styles.state}>Notifications could not be loaded.</p>
            ) : null}
            {recent.data?.data.length === 0 ? (
              <p className={styles.state}>You're all caught up.</p>
            ) : null}
            {recent.data?.data.map((notification) => (
              <button
                aria-label={notification.title + ': ' + notification.message}
                className={[styles.item, notification.isRead ? '' : styles.unread].join(' ')}
                key={notification.id}
                onClick={() => void openNotification(notification)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={styles.dot}
                  data-severity={notification.severity}
                />
                <span>
                  <span className={styles.itemTitle}>{notification.title}</span>
                  <span className={styles.message}>{notification.message}</span>
                  <span className={styles.time}>
                    {formatNotificationTime(notification.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className={styles.panelFooter}>
            <Link className={styles.viewAll} href="/notifications" onClick={() => setOpen(false)}>
              View all notifications
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BellIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
