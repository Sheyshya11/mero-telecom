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
  collectionStage?: string;
  recoveryFinalWarning?: boolean;
  collectionOnHold?: boolean;
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
  const stage = suspended ? 'SUSPENDED' : query.data.collectionStage;
  const recovery = Boolean(query.data.recoveryFinalWarning);
  const final = recovery || stage === 'FINAL_WARNING' || stage === 'SUSPENSION_SCHEDULED';
  const urgent = stage === 'SECOND_REMINDER';
  const held = Boolean(query.data.collectionOnHold);
  const critical = suspended || (final && !held);
  const title = suspended
    ? 'SERVICE SUSPENDED'
    : held
      ? 'Collection on hold'
      : final
        ? 'FINAL PAYMENT NOTICE'
        : urgent
          ? 'Payment required'
          : 'Payment overdue';
  return (
    <section
      className={`my-5 rounded-xl border p-5 ${critical ? 'border-destructive border-l-4 bg-destructive-subtle text-destructive-foreground' : urgent ? 'border-warning border-l-4 bg-warning-subtle text-warning-foreground' : 'border-warning bg-warning-subtle text-foreground'}`}
      aria-label="Overdue payment"
      data-collection-stage={stage ?? 'NONE'}
      role={critical ? 'alert' : 'status'}
    >
      <h2 className={critical ? 'text-lg font-bold' : 'font-semibold'}>{title}</h2>
      <p className="mt-2">
        {held && !suspended
          ? `Your overdue balance of ${amount} remains outstanding. Automated collection reminders and billing suspension are paused.`
          : suspended
            ? `Your service has been suspended because of an outstanding balance of ${amount}. Make payment to begin service restoration.`
            : final
              ? `${amount} remains unpaid.`
              : urgent
                ? `Your ${amount} balance remains unpaid. Please pay promptly to avoid service interruption.`
                : `${amount} is overdue.`}
      </p>
      {paymentProcessing ? (
        <p>Your payment or account is being reviewed before any suspension.</p>
      ) : suspensionDate && !suspended && !held ? (
        <p>
          {recovery
            ? 'Your original payment grace period has ended. Your service will remain active until'
            : final
              ? 'Your service is scheduled for suspension on'
              : urgent
                ? 'Please pay by'
                : 'Payment deadline:'}{' '}
          {new Intl.DateTimeFormat('en-AU', {
            dateStyle: 'long',
            timeStyle: recovery ? 'short' : undefined,
            timeZone: 'Australia/Adelaide',
          }).format(new Date(suspensionDate))}{' '}
          {recovery
            ? 'Please pay before this deadline to avoid service suspension.'
            : final
              ? 'unless payment is received.'
              : urgent
                ? 'to avoid service interruption.'
                : ''}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <Link className="button-primary" href={href}>
          {suspended ? 'Pay Outstanding Balance' : 'Pay Now'}
        </Link>
        <Link className="button-secondary" href={href}>
          View Invoice
        </Link>
      </div>
    </section>
  );
}
