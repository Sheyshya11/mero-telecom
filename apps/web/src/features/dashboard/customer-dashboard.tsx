'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { LandingIcon, type LandingIconName } from '../../components/landing/landing-icons';
import { apiDownload, apiRequest } from '../../lib/api/client';
import { hasRole } from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import { StripeCheckoutButton } from '../payments/stripe-checkout-button';
import styles from './dashboard.module.css';
import type { CustomerDashboard, CustomerInvoice } from './customer-dashboard.types';

const quickActions: Array<{
  title: string;
  description: string;
  href: string;
  icon: LandingIconName;
}> = [
  {
    title: 'Manage plan',
    description: 'View or change your internet plan',
    href: '/customer/subscription',
    icon: 'wifi',
  },
  {
    title: 'View billing',
    description: 'Invoices and payments',
    href: '/customer/invoices',
    icon: 'credit-card',
  },
  {
    title: 'Request refund',
    description: 'Submit or track a refund request',
    href: '/customer/refunds',
    icon: 'activity',
  },
  {
    title: 'My profile',
    description: 'Manage your account details',
    href: '/customer/profile',
    icon: 'user',
  },
];

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function friendlyStatus(status: string) {
  return status
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

export function CustomerDashboardView() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [paymentReturn, setPaymentReturn] = useState<'success' | 'cancelled' | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    setPaymentReturn(payment === 'success' || payment === 'cancelled' ? payment : null);
    setCheckoutSessionId(params.get('sessionId'));
  }, []);

  const checkoutReconciliation = useQuery({
    queryKey: ['checkout-reconciliation', checkoutSessionId],
    queryFn: () =>
      apiRequest<{
        paymentStatus: string;
        invoiceStatus: string;
        subscription: { status: string; plan: { name: string } } | null;
      }>(
        `/payments/checkout-status?sessionId=${encodeURIComponent(checkoutSessionId!)}`,
        {},
        accessToken,
      ),
    enabled: Boolean(
      accessToken &&
      user &&
      hasRole(user, 'CUSTOMER') &&
      paymentReturn === 'success' &&
      checkoutSessionId,
    ),
    retry: 1,
  });
  const dashboardQuery = useQuery({
    queryKey: ['customer-dashboard'],
    queryFn: () => apiRequest<CustomerDashboard>('/dashboard/customer', {}, accessToken),
    enabled: Boolean(accessToken && user && hasRole(user, 'CUSTOMER')),
  });

  useEffect(() => {
    if (!checkoutReconciliation.data) return;
    void queryClient.invalidateQueries({ queryKey: ['customer-dashboard'] });
  }, [checkoutReconciliation.data, queryClient]);

  if (isLoading) return <Status message="Restoring your session…" />;
  if (!user) return <Status message="Sign in to view your account." />;
  if (!hasRole(user, 'CUSTOMER')) return <Status message="Customer access is required." />;
  if (dashboardQuery.isPending) return <DashboardSkeleton />;
  if (dashboardQuery.isError || !dashboardQuery.data)
    return (
      <Status
        message="We couldn't load your dashboard information."
        onRetry={() => void dashboardQuery.refetch()}
      />
    );

  const dashboard = dashboardQuery.data;
  const paymentStatus = dashboard.latestInvoice?.payment?.status ?? null;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={`${styles.hero} ${styles.customerHero}`}>
          <span aria-hidden="true" className={styles.heroGlow} />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Customer overview</p>
            <h1>Welcome back, {dashboard.profile.firstName}</h1>
            <p className={styles.heroDescription}>
              Here&apos;s an overview of your Mero Telecom service.
            </p>
          </div>
        </section>

        {paymentReturn ? (
          <p
            className={styles.notice}
            data-error={checkoutReconciliation.isError}
            role={checkoutReconciliation.isError ? 'alert' : 'status'}
          >
            {paymentReturn === 'cancelled'
              ? 'Stripe Checkout was closed without changing this invoice.'
              : checkoutReconciliation.isPending && checkoutSessionId
                ? 'Payment received. Verifying the Checkout and updating your invoice…'
                : checkoutReconciliation.isError
                  ? 'Stripe returned a successful payment, but reconciliation could not finish. Do not pay again; retry or contact support.'
                  : checkoutReconciliation.data?.invoiceStatus === 'PAID'
                    ? 'Payment verified. Your invoice is paid.'
                    : 'Payment verification is still processing.'}
          </p>
        ) : null}

        <section aria-label="Service and payment summary" className={styles.dashboardSummary}>
          <Panel
            className={styles.serviceCard}
            meta="Current connection"
            title="Your internet service"
          >
            {dashboard.subscription ? (
              <>
                <div className={styles.serviceLayout}>
                  <div>
                    <p className={styles.planName}>{dashboard.subscription.plan.name}</p>
                    <div className={styles.speedList}>
                      <span className={styles.speedPill}>
                        <LandingIcon name="wifi" size={14} />
                        {dashboard.subscription.plan.downloadMbps} Mbps download
                      </span>
                      <span className={styles.speedPill}>
                        <LandingIcon name="zap" size={14} />
                        {dashboard.subscription.plan.uploadMbps} Mbps upload
                      </span>
                    </div>
                    <p className={styles.serviceMeta}>
                      Service started {formatDate(dashboard.subscription.startDate)}
                    </p>
                  </div>
                  <div className={styles.priceBlock}>
                    <StatusBadge status={dashboard.subscription.status} />
                    <p className={styles.price}>
                      {formatMoney(dashboard.subscription.plan.monthlyCents)}
                    </p>
                    <p className={styles.priceMeta}>per month, GST included</p>
                  </div>
                </div>
                <div className={styles.panelActionRow}>
                  <Link className="button-secondary" href="/customer/subscription">
                    Manage plan
                  </Link>
                </div>
              </>
            ) : (
              <div>
                <p className={styles.emptyState}>You do not have a current internet service.</p>
                <Link className="button-primary mt-4 inline-flex" href="/customer/subscription">
                  Choose a plan
                </Link>
              </div>
            )}
          </Panel>

          <Panel className={styles.nextPaymentCard} meta="Upcoming billing" title="Next payment">
            {dashboard.billing.nextPaymentAmountCents !== null &&
            dashboard.billing.nextBillingDate ? (
              <>
                <p className={styles.nextPaymentAmount}>
                  {formatMoney(dashboard.billing.nextPaymentAmountCents)}
                </p>
                <p className={styles.nextPaymentDate}>
                  {formatLongDate(dashboard.billing.nextBillingDate)}
                </p>
              </>
            ) : (
              <p className={styles.noUpcomingPayment}>No upcoming payment available</p>
            )}
            <dl className={styles.paymentFacts}>
              <div>
                <dt>Outstanding balance</dt>
                <dd>{formatMoney(dashboard.billing.outstandingInvoiceCents)}</dd>
              </div>
              {dashboard.billing.latestPaymentStatus ? (
                <div>
                  <dt>Latest payment</dt>
                  <dd>{friendlyStatus(dashboard.billing.latestPaymentStatus)}</dd>
                </div>
              ) : null}
            </dl>
            <div className={styles.panelActionRow}>
              <Link className="button-secondary" href="/customer/invoices">
                View billing
              </Link>
            </div>
          </Panel>
        </section>

        {dashboard.pendingAction ? (
          <section
            aria-labelledby="customer-action-title"
            className={styles.attentionCard}
            data-severity={dashboard.pendingAction.severity}
            role={dashboard.pendingAction.severity === 'critical' ? 'alert' : 'status'}
          >
            <span aria-hidden="true" className={styles.attentionIcon}>
              <LandingIcon
                name={dashboard.pendingAction.type === 'SERVICE' ? 'wifi' : 'activity'}
                size={20}
              />
            </span>
            <div className={styles.attentionCopy}>
              <h2 id="customer-action-title">{dashboard.pendingAction.title}</h2>
              <p>{dashboard.pendingAction.description}</p>
            </div>
            <Link className={styles.attentionAction} href={dashboard.pendingAction.actionUrl}>
              {dashboard.pendingAction.actionLabel}
              <LandingIcon name="arrow" size={15} />
            </Link>
          </section>
        ) : null}

        <section aria-labelledby="quick-actions-title" className={styles.dashboardSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="quick-actions-title">Quick actions</h2>
              <p>Manage the most common parts of your account.</p>
            </div>
          </div>
          <div className={styles.quickActionGrid}>
            {quickActions.map((action) => (
              <Link className={styles.quickAction} href={action.href} key={action.href}>
                <span className={styles.quickActionIcon}>
                  <LandingIcon name={action.icon} size={19} />
                </span>
                <span className={styles.quickActionCopy}>
                  <strong>{action.title}</strong>
                  <span>{action.description}</span>
                </span>
                <LandingIcon name="arrow" size={16} />
              </Link>
            ))}
          </div>
        </section>

        <div className={styles.activityBillingGrid}>
          <Panel meta="Latest updates across your account" title="Recent activity">
            {dashboard.recentActivity.length ? (
              <ol className={styles.activityList}>
                {dashboard.recentActivity.map((activity) => (
                  <li key={activity.id}>
                    <Link className={styles.activityItem} href={activity.href}>
                      <span className={styles.activityMarker} data-tone={activity.tone}>
                        <LandingIcon name={activityIcon(activity.kind)} size={16} />
                      </span>
                      <span className={styles.activityCopy}>
                        <strong>{activity.title}</strong>
                        <span>{activity.description}</span>
                      </span>
                      <span className={styles.activityMeta}>
                        {activity.amountCents !== null ? (
                          <strong>{formatMoney(activity.amountCents)}</strong>
                        ) : null}
                        <time dateTime={activity.occurredAt}>
                          {formatDate(activity.occurredAt)}
                        </time>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.emptyState}>No recent account activity is available.</p>
            )}
          </Panel>

          <Panel meta="Most recent billing record" title="Latest invoice">
            {dashboard.latestInvoice ? (
              <div className={styles.latestInvoice}>
                <div className={styles.latestInvoiceTop}>
                  <div>
                    <p className={styles.summaryLabel}>Invoice</p>
                    <p className={styles.latestInvoiceNumber}>
                      {dashboard.latestInvoice.invoiceNumber}
                    </p>
                    <p className={styles.summaryMeta}>
                      Due {formatDate(dashboard.latestInvoice.dueDate)}
                    </p>
                  </div>
                  <p className={styles.latestInvoiceAmount}>
                    {formatMoney(dashboard.latestInvoice.totalCents)}
                  </p>
                </div>
                <div className={styles.invoiceStatusGrid}>
                  <div>
                    <p className={styles.summaryLabel}>Invoice status</p>
                    <StatusBadge status={dashboard.latestInvoice.status} />
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Payment status</p>
                    {paymentStatus ? (
                      <StatusBadge status={paymentStatus} />
                    ) : (
                      <p className={styles.noPaymentStatus}>No payment recorded</p>
                    )}
                  </div>
                </div>
                {dashboard.latestInvoice.payment?.refundedCents ? (
                  <p className={styles.refundSummary}>
                    {formatMoney(dashboard.latestInvoice.payment.refundedCents)} refunded
                  </p>
                ) : null}
                <div className={styles.invoiceActions}>
                  {['ISSUED', 'OVERDUE'].includes(dashboard.latestInvoice.status) ? (
                    <StripeCheckoutButton invoiceId={dashboard.latestInvoice.id} />
                  ) : null}
                  <Link className="button-secondary" href="/customer/invoices">
                    View all invoices
                  </Link>
                </div>
              </div>
            ) : (
              <p className={styles.emptyState}>You do not have an invoice yet.</p>
            )}
          </Panel>
        </div>

        <section className={styles.tablePanel}>
          <div className={styles.tableHeader}>
            <div>
              <h2>Recent invoices</h2>
              <p>Your three most recent invoices</p>
            </div>
            <Link className={styles.tableLink} href="/customer/invoices">
              View all invoices
            </Link>
          </div>
          {dashboard.invoices.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Issue date</th>
                    <th>Invoice status</th>
                    <th>Payment status</th>
                    <th className={styles.alignRight}>Total</th>
                    <th className={styles.alignRight}>Document</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.invoices.map((invoice) => (
                    <InvoiceRow invoice={invoice} key={invoice.id} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.tableEmpty}>You do not have any invoices yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}

export function InvoiceRow({ invoice }: Readonly<{ invoice: CustomerInvoice }>) {
  const { accessToken } = useAuth();
  const [downloadError, setDownloadError] = useState(false);
  const paymentStatus = invoice.payment?.status ?? invoice.paymentStatus;

  async function download() {
    if (!accessToken) return;
    setDownloadError(false);
    try {
      await apiDownload(
        `/invoices/me/${invoice.id}/pdf`,
        accessToken,
        `${invoice.invoiceNumber}.pdf`,
      );
    } catch {
      setDownloadError(true);
    }
  }

  return (
    <tr className={styles.invoiceRow}>
      <td className={`${styles.invoiceCell} ${styles.tableStrong}`}>{invoice.invoiceNumber}</td>
      <td className={`${styles.invoiceCell} ${styles.tableMuted}`}>
        {formatDate(invoice.issueDate)}
      </td>
      <td className={styles.invoiceCell}>
        <StatusBadge status={invoice.status} />
      </td>
      <td className={styles.invoiceCell}>
        {paymentStatus ? (
          <>
            <StatusBadge status={paymentStatus} />
            {invoice.payment?.refundedCents ? (
              <p className={styles.invoiceRefundAmount}>
                {formatMoney(invoice.payment.refundedCents)} refunded
              </p>
            ) : null}
          </>
        ) : (
          <p className={styles.noPaymentStatus}>No payment recorded</p>
        )}
      </td>
      <td className={`${styles.invoiceCell} ${styles.tableStrong} ${styles.alignRight}`}>
        {formatMoney(invoice.totalCents)}
      </td>
      <td className={`${styles.invoiceCell} ${styles.alignRight}`}>
        <button
          className={`button-secondary ${styles.downloadButton}`}
          onClick={() => void download()}
          type="button"
        >
          {downloadError ? 'Retry PDF' : 'Download PDF'}
        </button>
      </td>
    </tr>
  );
}

function Panel({
  title,
  meta,
  className,
  children,
}: Readonly<{
  title: string;
  meta: string;
  className?: string;
  children: React.ReactNode;
}>) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`}>
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>{title}</h2>
          <p className={styles.panelMeta}>{meta}</p>
        </div>
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  return (
    <span className={styles.badge} data-status={status}>
      {friendlyStatus(status)}
    </span>
  );
}

function activityIcon(kind: CustomerDashboard['recentActivity'][number]['kind']): LandingIconName {
  switch (kind) {
    case 'PAYMENT':
      return 'credit-card';
    case 'INVOICE':
      return 'layers';
    case 'REFUND':
      return 'activity';
    case 'PLAN_CHANGE':
      return 'zap';
    default:
      return 'wifi';
  }
}

function DashboardSkeleton() {
  return (
    <main aria-busy="true" aria-label="Loading your dashboard" className={styles.page}>
      <div className={styles.skeletonHero} />
      <div className={styles.skeletonSummary}>
        <div />
        <div />
      </div>
      <div className={styles.skeletonActions}>
        <div />
        <div />
        <div />
        <div />
      </div>
      <span className="sr-only">Loading your dashboard…</span>
    </main>
  );
}

function Status({ message, onRetry }: Readonly<{ message: string; onRetry?: () => void }>) {
  return (
    <main className={styles.statusPage}>
      <div className={styles.statusCard}>
        <span className={styles.statusMark}>
          <LandingIcon name="wifi" size={20} />
        </span>
        <p>{message}</p>
        {onRetry ? (
          <button className="button-secondary" onClick={onRetry} type="button">
            Try again
          </button>
        ) : null}
      </div>
    </main>
  );
}
