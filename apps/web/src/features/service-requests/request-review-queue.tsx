'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
export function RequestReviewQueue() {
  const { accessToken, user } = useAuth();
  const queue = useQuery({
    queryKey: ['service-request-review-queue'],
    queryFn: () =>
      apiRequest<{ cancellations: number; relocations: number; refunds: number }>(
        '/dashboard/service-requests',
        {},
        accessToken,
      ),
    enabled: Boolean(accessToken && user && ['STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)),
    refetchInterval: 30_000,
  });
  return (
    <section
      className="mt-6 rounded-xl border border-border bg-card p-5"
      aria-label="Requests awaiting employee review"
    >
      <h2 className="text-lg font-semibold">Action required</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Requests awaiting employee review. Reading a notification does not review the request.
      </p>
      {queue.isError ? (
        <p role="alert" className="mt-3 text-sm">
          Unable to load pending requests.{' '}
          <button type="button" className="underline" onClick={() => void queue.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            {
              label: 'Cancellation',
              count: queue.data?.cancellations,
              href: '/control-centre/cancellations?status=PENDING_REVIEW',
            },
            {
              label: 'Move home',
              count: queue.data?.relocations,
              href: '/control-centre/relocations?status=PENDING_REVIEW',
            },
            {
              label: 'Refund',
              count: queue.data?.refunds,
              href: '/control-centre/refunds?status=REQUESTED',
            },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center justify-between rounded-lg border border-border p-4 hover:border-primary"
            >
              <span>{item.label}</span>
              <strong>{queue.isPending ? '…' : (item.count ?? 0)}</strong>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
