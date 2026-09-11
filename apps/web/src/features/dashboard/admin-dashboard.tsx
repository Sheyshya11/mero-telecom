'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { LandingIcon, type LandingIconName } from '../../components/landing/landing-icons';
import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import styles from './dashboard.module.css';
import type { AdminDashboard } from './dashboard.types';
import { SuperAdminDashboardView } from './super-admin-dashboard';

const statusColors = {
  ACTIVE: '#0b8791',
  PAST_DUE: '#d97706',
  CANCELLATION_PENDING: '#d97706',
  DISCONNECTION_PENDING: '#ea580c',
  PENDING: '#55bcc3',
  SUSPENDED: '#e49a26',
  CANCELLED: '#94a3b8',
  TERMINATED: '#475569',
};

const quickActions: Array<{
  href: string;
  icon: LandingIconName;
  label: string;
  description: string;
}> = [
  {
    href: '/admin/customers',
    icon: 'users',
    label: 'View customers',
    description: 'Find and manage customer accounts',
  },
  {
    href: '/admin/refunds',
    icon: 'credit-card',
    label: 'Review refunds',
    description: 'Process open refund requests',
  },
  {
    href: '/admin/invoices',
    icon: 'layers',
    label: 'View invoices',
    description: 'Review billing records and balances',
  },
  {
    href: '/admin/subscriptions',
    icon: 'activity',
    label: 'Manage subscriptions',
    description: 'Review active and paused services',
  },
  {
    href: '/admin/plans',
    icon: 'gauge',
    label: 'Manage plans',
    description: 'Update available internet plans',
  },
  {
    href: '/admin/users',
    icon: 'shield',
    label: 'Manage staff',
    description: 'Invite and manage staff accounts',
  },
];

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Adelaide',
  }).format(new Date(value));
}

function friendlyStatus(status: string) {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function AdminDashboardView() {
  const { accessToken, isLoading, user } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiRequest<AdminDashboard>('/dashboard/admin', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'ADMIN'),
  });
  const internalRequestSummary = useQuery({
    queryKey: ['admin-internal-request-summary'],
    queryFn: () =>
      apiRequest<{
        awaitingReview: number;
        assignedToMe: number;
        needsInformation: number;
        highPriority: number;
        escalated: number;
      }>('/admin/internal-requests/summary', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'ADMIN'),
  });

  if (isLoading) return <AdminDashboardSkeleton />;
  if (!user) return <Status message="Sign in to view the dashboard." />;
  if (user.role === 'SUPER_ADMIN') return <SuperAdminDashboardView />;
  if (user.role !== 'ADMIN') {
    return <Status message="Administrator access is required." />;
  }
  if (dashboardQuery.isPending) return <AdminDashboardSkeleton />;
  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <Status
        message="We couldn't load the admin overview."
        onRetry={() => void dashboardQuery.refetch()}
      />
    );
  }

  const dashboard = dashboardQuery.data;
  const trend = dashboard.invoiceTrend.map((point) => ({
    ...point,
    totalDollars: point.totalCents / 100,
  }));
  const hasBillingTrend = dashboard.invoiceTrend.some((point) => point.totalCents > 0);
  const subscriptionTotal = dashboard.subscriptionsByStatus.reduce(
    (total, entry) => total + entry.count,
    0,
  );
  const activePercentage = subscriptionTotal
    ? Math.round((dashboard.metrics.activeSubscriptions / subscriptionTotal) * 100)
    : 0;
  const internalAttention = internalRequestSummary.data?.awaitingReview ?? 0;
  const highPriorityInternal = internalRequestSummary.data?.highPriority ?? 0;
  const escalatedInternal = internalRequestSummary.data?.escalated ?? 0;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={`${styles.hero} ${styles.adminHero}`}>
          <span aria-hidden="true" className={styles.heroGlow} />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Admin control centre</p>
            <h1>Business dashboard</h1>
            <p className={styles.heroDescription}>
              A current operational view of customers, active services, revenue and invoices.
            </p>
          </div>
          <div className={styles.heroAside}>
            <p className={styles.heroAsideLabel}>Signed in as</p>
            <p className={styles.heroAsideValue}>{user.email}</p>
          </div>
        </section>

        <section aria-label="Business metrics" className={styles.metricGrid}>
          <Metric
            detail="Customer accounts"
            icon="users"
            label="Total customers"
            value={String(dashboard.metrics.customerCount)}
          />
          <Metric
            detail="Currently active services"
            icon="activity"
            label="Active subscriptions"
            value={String(dashboard.metrics.activeSubscriptions)}
          />
          <Metric
            detail="Current active plan value"
            icon="gauge"
            label="Monthly recurring revenue"
            value={formatMoney(dashboard.metrics.monthlyRecurringRevenueCents)}
          />
          <Metric
            detail={`${dashboard.metrics.outstandingInvoiceCount} unpaid ${dashboard.metrics.outstandingInvoiceCount === 1 ? 'invoice' : 'invoices'}`}
            icon="credit-card"
            label="Outstanding balance"
            value={formatMoney(dashboard.metrics.outstandingInvoiceCents)}
          />
          <Metric
            detail={
              dashboard.metrics.overdueInvoiceCount ? 'Requires follow-up' : 'No overdue invoices'
            }
            icon="shield"
            label="Overdue invoices"
            value={String(dashboard.metrics.overdueInvoiceCount)}
            warning={dashboard.metrics.overdueInvoiceCount > 0}
          />
          <Metric
            detail={
              dashboard.metrics.pendingRefunds
                ? `${formatMoney(dashboard.metrics.pendingRefundAmountCents)} awaiting action`
                : 'No requests awaiting review'
            }
            icon="credit-card"
            label="Pending refunds"
            value={String(dashboard.metrics.pendingRefunds)}
            warning={dashboard.metrics.pendingRefunds > 0}
          />
        </section>

        <section aria-labelledby="attention-heading" className={styles.dashboardSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="attention-heading">Needs attention</h2>
              <p>Operational items that may require admin follow-up.</p>
            </div>
          </div>
          {dashboard.attention.length || internalAttention || escalatedInternal ? (
            <div className={styles.adminAttentionList}>
              {internalAttention ? (
                <article
                  className={styles.adminAttentionItem}
                  data-severity={highPriorityInternal ? 'critical' : 'warning'}
                >
                  <span aria-hidden="true" className={styles.attentionIcon}>
                    <LandingIcon name={highPriorityInternal ? 'shield' : 'activity'} size={17} />
                  </span>
                  <div className={styles.attentionCopy}>
                    <h3>Staff requests awaiting review</h3>
                    <p>
                      {internalAttention} pending request{internalAttention === 1 ? '' : 's'}
                      {highPriorityInternal ? ` · ${highPriorityInternal} high priority` : ''}
                    </p>
                  </div>
                  <Link
                    className={styles.attentionAction}
                    href="/control-centre/internal-requests?status=PENDING"
                  >
                    Review requests
                    <LandingIcon name="arrow" size={14} />
                  </Link>
                </article>
              ) : null}
              {escalatedInternal ? (
                <article className={styles.adminAttentionItem} data-severity="warning">
                  <span aria-hidden="true" className={styles.attentionIcon}>
                    <LandingIcon name="shield" size={17} />
                  </span>
                  <div className={styles.attentionCopy}>
                    <h3>Requests with Super Admin</h3>
                    <p>
                      {escalatedInternal} unresolved escalation{escalatedInternal === 1 ? '' : 's'}{' '}
                      awaiting a decision or return.
                    </p>
                  </div>
                  <Link
                    className={styles.attentionAction}
                    href="/control-centre/internal-requests?currentLevel=SUPER_ADMIN"
                  >
                    Follow escalations
                    <LandingIcon name="arrow" size={14} />
                  </Link>
                </article>
              ) : null}
              {dashboard.attention.map((item) => (
                <article
                  className={styles.adminAttentionItem}
                  data-severity={item.severity}
                  key={item.type}
                >
                  <span aria-hidden="true" className={styles.attentionIcon}>
                    <LandingIcon
                      name={item.severity === 'critical' ? 'shield' : 'activity'}
                      size={17}
                    />
                  </span>
                  <div className={styles.attentionCopy}>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                  <Link className={styles.attentionAction} href={item.actionUrl}>
                    {item.actionLabel}
                    <LandingIcon name="arrow" size={14} />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.attentionEmpty}>
              <LandingIcon name="check" size={17} />
              No urgent issues require your attention right now.
            </p>
          )}
        </section>

        <section className={styles.contentGrid}>
          <Panel meta="Issued invoice totals · last six months" title="Billing trend">
            {hasBillingTrend ? (
              <div className={styles.chart}>
                <ResponsiveContainer height="100%" width="100%">
                  <BarChart data={trend} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                    <XAxis
                      axisLine={false}
                      dataKey="label"
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickFormatter={(value: number) => `$${value}`}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={{
                        border: '1px solid #dbe4e7',
                        borderRadius: 12,
                        boxShadow: '0 12px 28px rgba(15, 23, 42, 0.1)',
                        fontSize: 12,
                      }}
                      cursor={{ fill: 'rgba(11, 135, 145, 0.06)' }}
                      formatter={(value) => [
                        formatMoney(Number(value ?? 0) * 100),
                        'Invoice value',
                      ]}
                    />
                    <Bar dataKey="totalDollars" fill="#0b8791" radius={[7, 7, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyPanel message="No invoice value is available for the last six months." />
            )}
          </Panel>

          <Panel meta="Current service mix" title="Subscriptions by status">
            {subscriptionTotal ? (
              <>
                <div className={styles.chartSummary}>
                  <span>
                    <strong>{subscriptionTotal}</strong> total subscriptions
                  </span>
                  <span>
                    <strong>{activePercentage}%</strong> active
                  </span>
                </div>
                <div className={styles.chart}>
                  <ResponsiveContainer height="100%" width="100%">
                    <PieChart>
                      <Pie
                        cx="50%"
                        cy="48%"
                        data={dashboard.subscriptionsByStatus}
                        dataKey="count"
                        innerRadius={50}
                        nameKey="status"
                        outerRadius={82}
                        paddingAngle={3}
                      >
                        {dashboard.subscriptionsByStatus.map((entry) => (
                          <Cell fill={statusColors[entry.status]} key={entry.status} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          border: '1px solid #dbe4e7',
                          borderRadius: 12,
                          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.1)',
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul aria-label="Subscription status totals" className={styles.chartLegend}>
                  {dashboard.subscriptionsByStatus.map((entry) => (
                    <li key={entry.status}>
                      <span aria-hidden="true" style={{ background: statusColors[entry.status] }} />
                      {friendlyStatus(entry.status)}: <strong>{entry.count}</strong>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyPanel message="No subscriptions are available yet." />
            )}
          </Panel>
        </section>

        <section className={styles.adminOperationsGrid}>
          <Panel meta="Latest meaningful business events" title="Recent activity">
            {dashboard.recentActivity.length ? (
              <ul className={styles.activityList}>
                {dashboard.recentActivity.map((activity) => (
                  <li key={activity.id}>
                    <Link className={styles.activityItem} href={activity.href}>
                      <span
                        aria-hidden="true"
                        className={styles.activityMarker}
                        data-tone={activity.tone}
                      >
                        <LandingIcon name={activityIcon(activity.kind)} size={15} />
                      </span>
                      <span className={styles.activityCopy}>
                        <strong>{activity.title}</strong>
                        <span>{activity.description}</span>
                      </span>
                      <span className={styles.activityMeta}>
                        {activity.amountCents === null ? null : (
                          <strong>{formatMoney(activity.amountCents)}</strong>
                        )}
                        <time dateTime={activity.occurredAt}>
                          {formatDateTime(activity.occurredAt)}
                        </time>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyPanel message="No recent activity." compact />
            )}
          </Panel>

          <Panel meta="Common admin tasks" title="Quick actions">
            <div className={styles.adminQuickActions}>
              {quickActions.map((action) => (
                <Link className={styles.adminQuickAction} href={action.href} key={action.href}>
                  <span aria-hidden="true" className={styles.quickActionIcon}>
                    <LandingIcon name={action.icon} size={16} />
                  </span>
                  <span className={styles.quickActionCopy}>
                    <strong>{action.label}</strong>
                    <span>{action.description}</span>
                  </span>
                  <LandingIcon name="arrow" size={14} />
                </Link>
              ))}
            </div>
          </Panel>
        </section>

        <section className={styles.tablePanel}>
          <div className={styles.tableHeader}>
            <div>
              <h2>Recent invoices</h2>
              <p>Latest five billing records</p>
            </div>
            <Link className={styles.tableLink} href="/admin/invoices">
              View all invoices
            </Link>
          </div>
          {dashboard.recentInvoices.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Issue date</th>
                    <th>Invoice status</th>
                    <th>Payment status</th>
                    <th className={styles.alignRight}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recentInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className={styles.tableStrong}>{invoice.invoiceNumber}</td>
                      <td>{invoice.customerName}</td>
                      <td className={styles.tableMuted}>
                        {new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC' }).format(
                          new Date(invoice.issueDate),
                        )}
                      </td>
                      <td>
                        <StatusBadge status={invoice.status} />
                      </td>
                      <td>
                        {invoice.paymentStatus ? (
                          <StatusBadge status={invoice.paymentStatus} />
                        ) : (
                          <span className={styles.tableMuted}>No payment</span>
                        )}
                      </td>
                      <td className={`${styles.tableStrong} ${styles.alignRight}`}>
                        {formatMoney(invoice.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.tableEmpty}>No recent invoices.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function activityIcon(kind: AdminDashboard['recentActivity'][number]['kind']): LandingIconName {
  switch (kind) {
    case 'CUSTOMER':
      return 'user';
    case 'SUBSCRIPTION':
      return 'activity';
    case 'INVOICE':
      return 'layers';
    case 'PAYMENT':
    case 'REFUND':
      return 'credit-card';
    case 'PLAN_CHANGE':
      return 'gauge';
  }
}

function Metric({
  label,
  value,
  detail,
  icon,
  warning = false,
}: Readonly<{
  label: string;
  value: string;
  detail: string;
  icon: LandingIconName;
  warning?: boolean;
}>) {
  return (
    <article className={styles.metric} data-warning={warning}>
      <div className={styles.metricTop}>
        <p className={styles.metricLabel}>{label}</p>
        <span className={styles.metricIcon}>
          <LandingIcon name={icon} size={17} />
        </span>
      </div>
      <p className={styles.metricValue}>{value}</p>
      <p className={styles.metricDetail}>{detail}</p>
    </article>
  );
}

function Panel({
  title,
  meta,
  children,
}: Readonly<{ title: string; meta: string; children: React.ReactNode }>) {
  return (
    <section className={styles.panel}>
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

function EmptyPanel({
  message,
  compact = false,
}: Readonly<{ message: string; compact?: boolean }>) {
  return <p className={compact ? styles.emptyState : styles.chartEmpty}>{message}</p>;
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  return (
    <span className={styles.badge} data-status={status}>
      {friendlyStatus(status)}
    </span>
  );
}

function AdminDashboardSkeleton() {
  return (
    <main aria-label="Loading admin overview" className={styles.page}>
      <div className={styles.shell}>
        <div className={`${styles.skeletonHero} ${styles.adminSkeletonHero}`} />
        <div className={styles.adminSkeletonMetrics}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} />
          ))}
        </div>
        <div className={styles.adminSkeletonAttention} />
        <div className={styles.adminSkeletonCharts}>
          <div />
          <div />
        </div>
        <div className={styles.adminSkeletonOperations}>
          <div />
          <div />
        </div>
        <div className={styles.adminSkeletonTable} />
      </div>
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
            Try Again
          </button>
        ) : null}
      </div>
    </main>
  );
}
