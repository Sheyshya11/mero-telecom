'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { LandingIcon } from '../../components/landing/landing-icons';
import { apiDownload, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import { StripeCheckoutButton } from '../payments/stripe-checkout-button';
import styles from './dashboard.module.css';
import type { CustomerDashboard, CustomerInvoice } from './customer-dashboard.types';

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-AU');
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
      accessToken && user?.role === 'CUSTOMER' && paymentReturn === 'success' && checkoutSessionId,
    ),
    retry: 1,
  });
  const dashboardQuery = useQuery({
    queryKey: ['customer-dashboard'],
    queryFn: () => apiRequest<CustomerDashboard>('/dashboard/customer', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });

  useEffect(() => {
    if (!checkoutReconciliation.data) return;
    void queryClient.invalidateQueries({ queryKey: ['customer-dashboard'] });
  }, [checkoutReconciliation.data, queryClient]);

  if (isLoading) return <Status message="Restoring your session…" />;
  if (!user) return <Status message="Sign in to view your account." />;
  if (user.role !== 'CUSTOMER') return <Status message="Customer access is required." />;
  if (dashboardQuery.isPending) return <Status message="Loading your dashboard…" />;
  if (dashboardQuery.isError || !dashboardQuery.data)
    return (
      <Status
        message="Unable to load your account information."
        onRetry={() => void dashboardQuery.refetch()}
      />
    );

  const dashboard = dashboardQuery.data;
  const customerName = `${dashboard.profile.firstName} ${dashboard.profile.lastName}`;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <span aria-hidden="true" className={styles.heroGlow} />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Your Mero Telecom account</p>
            <h1>Welcome back, {dashboard.profile.firstName}</h1>
            <p className={styles.heroDescription}>
              Manage your internet service, invoices and account details in one place.
            </p>
          </div>
          <div className={styles.heroAside}>
            <p className={styles.heroAsideLabel}>Account number</p>
            <p className={styles.heroAsideValue}>{dashboard.profile.customerNumber}</p>
            <p className={styles.heroAsideLabel} style={{ marginTop: '0.8rem' }}>
              Email
            </p>
            <p className={styles.heroAsideValue}>{dashboard.profile.email}</p>
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

        <section className={styles.customerGrid}>
          <Panel
            className={styles.serviceCard}
            meta="Current connection"
            title="Your internet service"
          >
            {dashboard.subscription ? (
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
            ) : (
              <div>
                <p className={styles.emptyState}>You do not have a current internet service.</p>
                <Link className="button-primary mt-4 inline-flex" href="/customer/subscription">
                  Choose a plan
                </Link>
              </div>
            )}
          </Panel>

          <Panel meta="Contact and identity" title="Account details">
            <dl className={styles.detailsList}>
              <div className={styles.detailRow}>
                <dt>Account holder</dt>
                <dd>{customerName}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Phone</dt>
                <dd>{dashboard.profile.phone}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Account number</dt>
                <dd>{dashboard.profile.customerNumber}</dd>
              </div>
            </dl>
          </Panel>
        </section>

        <section className={styles.billingGrid}>
          <Panel meta="Issued and overdue invoices" title="Outstanding balance">
            <p className={styles.balance}>{formatMoney(dashboard.outstandingInvoiceCents)}</p>
          </Panel>

          <Panel meta="Most recent billing record" title="Latest invoice">
            {dashboard.latestInvoice ? (
              <div className={styles.summaryGrid}>
                <div>
                  <p className={styles.summaryLabel}>Invoice</p>
                  <p className={styles.summaryValue}>{dashboard.latestInvoice.invoiceNumber}</p>
                  <p className={styles.summaryMeta}>
                    Due {formatDate(dashboard.latestInvoice.dueDate)}
                  </p>
                </div>
                <div>
                  <p className={styles.summaryLabel}>Invoice status</p>
                  <div className={styles.summaryValue}>
                    <StatusBadge status={dashboard.latestInvoice.status} />
                  </div>
                </div>
                <div className={styles.summaryRight}>
                  <p className={styles.summaryValue}>
                    {formatMoney(dashboard.latestInvoice.totalCents)}
                  </p>
                  <p className={styles.summaryMeta}>
                    Payment: {dashboard.latestInvoice.payment?.status ?? 'No payment recorded'}
                  </p>
                  {['ISSUED', 'OVERDUE'].includes(dashboard.latestInvoice.status) ? (
                    <StripeCheckoutButton invoiceId={dashboard.latestInvoice.id} />
                  ) : null}
                </div>
              </div>
            ) : (
              <p className={styles.emptyState}>You do not have an invoice yet.</p>
            )}
          </Panel>
        </section>

        <section className={styles.tablePanel}>
          <div className={styles.tableHeader}>
            <div>
              <h2>Invoice history</h2>
              <p>Your five most recent invoices</p>
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
            <p className={styles.emptyState} style={{ padding: '1.5rem' }}>
              You do not have any invoices yet.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

export function InvoiceRow({ invoice }: Readonly<{ invoice: CustomerInvoice }>) {
  const { accessToken } = useAuth();
  const [downloadError, setDownloadError] = useState(false);

  async function download() {
    if (!accessToken) return;
    setDownloadError(false);
    try {
      await apiDownload(`/invoices/${invoice.id}/pdf`, accessToken, `${invoice.invoiceNumber}.pdf`);
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
      <td className={`${styles.invoiceCell} ${styles.tableMuted}`}>
        <p>{invoice.paymentStatus?.replaceAll('_', ' ') ?? 'No payment recorded'}</p>
        {invoice.payment?.refundedCents ? (
          <p className="mt-1 text-xs">
            Refunded: {formatMoney(invoice.payment.refundedCents)} · Net:{' '}
            {formatMoney(invoice.payment.amountCents - invoice.payment.refundedCents)}
          </p>
        ) : null}
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
      {status}
    </span>
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
            Retry
          </button>
        ) : null}
      </div>
    </main>
  );
}
