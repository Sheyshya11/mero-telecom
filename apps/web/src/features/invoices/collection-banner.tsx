'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuth } from '../auth/auth-provider';
import { apiRequest } from '../../lib/api/client';
export type CollectionSummary = {
  overdueCents: number;
  suspended: boolean;
  paymentProcessing: boolean;
  suspensionDate: string | null;
  invoiceId: string | null;
  restorationProcessing?: boolean;
};
export function CollectionBanner() {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ['customer-collections'],
    queryFn: () => apiRequest<CollectionSummary>('/collections/me', {}, accessToken),
    enabled: Boolean(accessToken),
    refetchInterval: 60_000,
  });
  if (!query.data || (!(query.data.overdueCents > 0) && !query.data.restorationProcessing))
    return null;
  if (query.data.restorationProcessing)
    return (
      <section
        className="my-5 rounded-xl border border-border bg-card p-5"
        role="status"
        aria-label="Service restoration"
      >
        <h2 className="font-semibold">Payment received</h2>
        <p>We have received your payment. Your service restoration is being processed.</p>
        <Link className="button-secondary mt-3" href="/customer/subscription">
          View service
        </Link>
      </section>
    );
  const { overdueCents, suspended, paymentProcessing, suspensionDate, invoiceId } = query.data;
  const amount = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(
    overdueCents / 100,
  );
  const href = `/customer/invoices?invoiceId=${invoiceId ?? ''}`;
  return (
    <section
      className={`my-5 rounded-xl border p-5 ${suspended ? 'border-destructive bg-destructive-subtle text-destructive-foreground' : 'border-warning bg-warning-subtle text-foreground'}`}
      aria-label="Overdue payment"
      role={suspended ? 'alert' : 'status'}
    >
      <h2 className="font-semibold">{suspended ? 'Service suspended' : 'Payment overdue'}</h2>
      <p className="mt-2">
        {suspended
          ? 'Your service has been suspended because an overdue balance remains unpaid.'
          : `${amount} is overdue.`}
      </p>
      {suspended ? <p>Outstanding balance: {amount}</p> : null}
      {paymentProcessing ? (
        <p>Your payment or account is being reviewed before any suspension.</p>
      ) : suspensionDate && !suspended ? (
        <p>
          Please pay by{' '}
          {new Intl.DateTimeFormat('en-AU', {
            dateStyle: 'long',
            timeZone: 'Australia/Adelaide',
          }).format(new Date(suspensionDate))}{' '}
          to avoid service suspension.
        </p>
      ) : null}
      <div className="mt-3 flex gap-3">
        <Link className="button-primary" href={href}>
          Pay now
        </Link>
        <Link className="button-secondary" href={href}>
          View invoice
        </Link>
      </div>
    </section>
  );
}
