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
import type { SuperAdminDashboard } from './dashboard.types';

const statusColors = {
  ACTIVE: '#0b8791',
  CANCELLATION_PENDING: '#d97706',
  DISCONNECTION_PENDING: '#ea580c',
  PENDING: '#55bcc3',
  SUSPENDED: '#e49a26',
  CANCELLED: '#94a3b8',
};

const quickActions: Array<{
  href: string;
  icon: LandingIconName;
  label: string;
  description: string;
}> = [
  {
    href: '/control-centre/internal-requests?currentLevel=SUPER_ADMIN',
    icon: 'shield',
    label: 'Review escalations',
    description: 'Review internal requests requiring Super Admin attention',
  },
  {
    href: '/admin/users',
    icon: 'shield',
    label: 'Manage admins',
    description: 'Review privileged accounts and roles',
  },
  {
    href: '/admin/users',
    icon: 'users',
    label: 'Manage staff',
    description: 'Invite and manage internal team members',
  },
  {
    href: '/admin/users',
    icon: 'eye',
    label: 'View audit logs',
    description: 'Inspect privileged security activity',
  },
  {
    href: '/admin/customers',
    icon: 'user',
    label: 'Manage customers',
    description: 'Find and manage customer accounts',
  },
  {
    href: '/admin/refunds',
    icon: 'credit-card',
    label: 'Review refunds',
    description: 'Review requests and restricted overrides',
  },
  {
    href: '/admin/subscriptions',
    icon: 'activity',
    label: 'View subscriptions',
    description: 'Monitor active and restricted services',
  },
  {
    href: '/admin/plans',
    icon: 'gauge',
    label: 'Manage plans',
    description: 'Control available internet plans',
  },
  {
    href: '/admin/billing/reports',
    icon: 'layers',
    label: 'View billing',
    description: 'Open business billing reports',
  },
];

export function SuperAdminDashboardView() {
  const { accessToken, isLoading, user } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ['super-admin-dashboard'],
    queryFn: () => apiRequest<SuperAdminDashboard>('/dashboard/super-admin', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'SUPER_ADMIN'),
  });
  const escalationSummary = useQuery({
    queryKey: ['super-admin-internal-request-summary'],
    queryFn: () =>
      apiRequest<{
        awaitingReview: number;
        assignedToMe: number;
        inReview: number;
        needsInformation: number;
        highPriority: number;
      }>('/super-admin/internal-requests/summary', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'SUPER_ADMIN'),
  });

  if (isLoading) return <SuperAdminDashboardSkeleton />;
  if (!user) return <Status message="Sign in to view the dashboard." />;
  if (user.role !== 'SUPER_ADMIN') {
    return <Status message="Super Administrator access is required." />;
  }
  if (dashboardQuery.isPending) return <SuperAdminDashboardSkeleton />;
  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <Status
        message="We couldn't load the Super Admin overview."
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
    ? Math.round((dashboard.business.activeSubscriptions / subscriptionTotal) * 100)
    : 0;
  const pendingEscalations = escalationSummary.data?.awaitingReview ?? 0;
  const highPriorityEscalations = escalationSummary.data?.highPriority ?? 0;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={`${styles.hero} ${styles.superAdminHero}`}>
          <span aria-hidden="true" className={styles.heroGlow} />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Super Admin control centre</p>
            <h1>Platform, organisation and business overview</h1>
            <p className={styles.heroDescription}>
              Monitor business performance, internal access, operational exceptions and system
              health.
            </p>
          </div>
          <div className={styles.heroAside}>
            <p className={styles.heroAsideLabel}>Signed in as</p>
            <p className={styles.heroAsideValue}>{user.email}</p>
          </div>
        </section>

        <section aria-label="Business health" className={styles.metricGrid}>
          <Metric
            icon="users"
            label="Total customers"
            value={String(dashboard.business.customerCount)}
            detail="Customer accounts"
          />
          <Metric
            icon="activity"
            label="Active subscriptions"
            value={String(dashboard.business.activeSubscriptions)}
            detail="Currently active services"
          />
          <Metric
            icon="gauge"
            label="Monthly recurring revenue"
            value={formatMoney(dashboard.business.monthlyRecurringRevenueCents)}
            detail="Current active plan value"
          />
          <Metric
            icon="credit-card"
            label="Outstanding balance"
            value={formatMoney(dashboard.business.outstandingInvoiceCents)}
            detail={`${dashboard.business.outstandingInvoiceCount} unpaid ${plural(dashboard.business.outstandingInvoiceCount, 'invoice')}`}
            warning={dashboard.business.outstandingInvoiceCount > 0}
          />
          <Metric
            icon="credit-card"
            label="Pending refunds"
            value={String(dashboard.business.pendingRefunds)}
            detail={
              dashboard.business.pendingRefunds
                ? `${formatMoney(dashboard.business.pendingRefundAmountCents)} awaiting review`
                : 'No requests awaiting review'
            }
            warning={dashboard.business.pendingRefunds > 0}
          />
          <Metric
            icon="shield"
            label="Failed payments"
            value={String(dashboard.business.failedPaymentCount)}
            detail={
              dashboard.business.failedPaymentCount
                ? 'Linked to unpaid invoices'
                : 'No failed payments'
            }
            warning={dashboard.business.failedPaymentCount > 0}
          />
        </section>

        <section aria-labelledby="organisation-heading" className={styles.dashboardSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="organisation-heading">Organisation</h2>
              <p>Internal access and invitation health. Customer accounts are excluded.</p>
            </div>
          </div>
          <div className={styles.organisationGrid}>
            <CompactMetric
              label="Active admins"
              value={dashboard.organisation.activeAdmins}
              icon="shield"
              detail={`${dashboard.organisation.activeSuperAdmins} active Super ${plural(dashboard.organisation.activeSuperAdmins, 'Admin')}`}
            />
            <CompactMetric
              label="Active staff"
              value={dashboard.organisation.activeStaff}
              icon="users"
              detail="Verified internal accounts"
            />
            <CompactMetric
              label="Restricted accounts"
              value={dashboard.organisation.restrictedInternalAccounts}
              icon="user"
              detail={
                dashboard.organisation.restrictedInternalAccounts
                  ? 'Suspended or deactivated'
                  : 'No suspended internal accounts'
              }
              warning={dashboard.organisation.restrictedInternalAccounts > 0}
            />
            <CompactMetric
              label="Pending invitations"
              value={dashboard.organisation.pendingInvitations}
              icon="layers"
              detail={
                dashboard.organisation.pendingInvitations
                  ? 'Valid invitations awaiting acceptance'
                  : 'No pending invitations'
              }
              warning={dashboard.organisation.pendingInvitations > 0}
            />
          </div>
        </section>

        <section aria-labelledby="super-attention-heading" className={styles.dashboardSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="super-attention-heading">Needs attention</h2>
              <p>High-priority business, access and governance exceptions.</p>
            </div>
          </div>
          {dashboard.attention.length || pendingEscalations ? (
            <div className={styles.adminAttentionList}>
              {pendingEscalations ? (
                <article
                  className={styles.adminAttentionItem}
                  data-severity={highPriorityEscalations ? 'critical' : 'warning'}
                >
                  <span aria-hidden="true" className={styles.attentionIcon}>
                    <LandingIcon name="shield" size={17} />
                  </span>
                  <div className={styles.attentionCopy}>
                    <h3>Escalations awaiting review</h3>
                    <p>
                      {pendingEscalations} request{pendingEscalations === 1 ? '' : 's'} awaiting
                      Super Admin review
                      {highPriorityEscalations ? ` · ${highPriorityEscalations} high priority` : ''}
                    </p>
                  </div>
                  <Link
                    className={styles.attentionAction}
                    href="/control-centre/internal-requests?status=PENDING&currentLevel=SUPER_ADMIN"
                  >
                    Review escalations
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
              No critical issues require your attention right now.
            </p>
          )}
        </section>

        <section className={styles.contentGrid}>
          <Panel meta="Issued invoice totals · last six months" title="Billing & revenue trend">
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
                      contentStyle={tooltipStyle}
                      cursor={{ fill: 'rgba(11, 135, 145, 0.06)' }}
                      formatter={(value) => [formatMoney(Number(value ?? 0) * 100), 'Billed']}
                    />
                    <Bar dataKey="totalDollars" fill="#0b8791" radius={[7, 7, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyPanel message="No invoice value is available for the last six months." />
            )}
          </Panel>

          <Panel meta="Current service status mix" title="Subscription health">
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
                      <Tooltip contentStyle={tooltipStyle} />
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

        <section className={styles.superHealthGrid}>
          <Panel
            meta={`Readiness observed ${formatDateTime(dashboard.observedAt)}`}
            title="System health"
          >
            <div className={styles.systemHealthList}>
              {dashboard.systemHealth.map((service) => (
                <article className={styles.systemHealthItem} key={service.name}>
                  <span
                    aria-hidden="true"
                    className={styles.healthIndicator}
                    data-status={service.status}
                  />
                  <div>
                    <h3>{service.name}</h3>
                    <p>{service.description}</p>
                  </div>
                  <span className={styles.healthBadge} data-status={service.status}>
                    {friendlyStatus(service.status)}
                  </span>
                </article>
              ))}
            </div>
          </Panel>

          <Panel meta="Security and access events backed by audit records" title="Governance">
            <dl className={styles.governanceGrid}>
              <GovernanceFact
                label="Active Super Admins"
                value={dashboard.organisation.activeSuperAdmins}
              />
              <GovernanceFact
                label="Role changes · 30 days"
                value={dashboard.governance.recentRoleChanges}
              />
              <GovernanceFact
                label="Privileged actions today"
                value={dashboard.governance.privilegedActionsToday}
              />
              <GovernanceFact
                label="Denied actions · 24 hours"
                value={dashboard.governance.deniedPrivilegedActionsLast24Hours}
                warning={dashboard.governance.deniedPrivilegedActionsLast24Hours > 0}
              />
            </dl>
          </Panel>
        </section>

        <section className={styles.superActivityGrid}>
          <Panel
            meta="Latest security-sensitive internal actions"
            title="Recent privileged activity"
          >
            {dashboard.recentPrivilegedActivity.length ? (
              <ActivityList items={dashboard.recentPrivilegedActivity} privileged />
            ) : (
              <EmptyPanel message="No recent privileged activity." compact />
            )}
          </Panel>
          <Panel
            meta="Latest meaningful customer and billing events"
            title="Recent business activity"
          >
            {dashboard.recentBusinessActivity.length ? (
              <ActivityList items={dashboard.recentBusinessActivity} />
            ) : (
              <EmptyPanel message="No recent business activity." compact />
            )}
          </Panel>
        </section>

        <section aria-labelledby="quick-actions-heading" className={styles.dashboardSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="quick-actions-heading">Quick actions</h2>
              <p>Open existing Super Admin and operational controls.</p>
            </div>
          </div>
          <div className={styles.superQuickActionGrid}>
            {quickActions.map((action) => (
              <Link className={styles.quickAction} href={action.href} key={action.label}>
                <span aria-hidden="true" className={styles.quickActionIcon}>
                  <LandingIcon name={action.icon} size={17} />
                </span>
                <span className={styles.quickActionCopy}>
                  <strong>{action.label}</strong>
                  <span>{action.description}</span>
                </span>
                <LandingIcon name="arrow" size={14} />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ActivityList({
  items,
  privileged = false,
}: Readonly<{
  items: Array<{
    id: string;
    title: string;
    description: string;
    occurredAt: string;
    href: string;
    tone: 'positive' | 'warning' | 'neutral';
    amountCents?: number | null;
    kind?: string;
  }>;
  privileged?: boolean;
}>) {
  return (
    <ul className={styles.activityList}>
      {items.map((activity) => (
        <li key={activity.id}>
          <Link className={styles.activityItem} href={activity.href}>
            <span aria-hidden="true" className={styles.activityMarker} data-tone={activity.tone}>
              <LandingIcon name={privileged ? 'shield' : activityIcon(activity.kind)} size={15} />
            </span>
            <span className={styles.activityCopy}>
              <strong>{activity.title}</strong>
              <span>{activity.description}</span>
            </span>
            <span className={styles.activityMeta}>
              {activity.amountCents === null || activity.amountCents === undefined ? null : (
                <strong>{formatMoney(activity.amountCents)}</strong>
              )}
              <time dateTime={activity.occurredAt}>{formatDateTime(activity.occurredAt)}</time>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
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

function CompactMetric({
  label,
  value,
  detail,
  icon,
  warning = false,
}: Readonly<{
  label: string;
  value: number;
  detail: string;
  icon: LandingIconName;
  warning?: boolean;
}>) {
  return (
    <article className={styles.organisationMetric} data-warning={warning}>
      <span aria-hidden="true" className={styles.metricIcon}>
        <LandingIcon name={icon} size={16} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

function GovernanceFact({
  label,
  value,
  warning = false,
}: Readonly<{ label: string; value: number; warning?: boolean }>) {
  return (
    <div className={styles.governanceFact} data-warning={warning}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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

function SuperAdminDashboardSkeleton() {
  return (
    <main aria-label="Loading Super Admin overview" className={styles.page}>
      <div className={styles.shell}>
        <div className={`${styles.skeletonHero} ${styles.adminSkeletonHero}`} />
        <div className={styles.adminSkeletonMetrics}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} />
          ))}
        </div>
        <div className={styles.superSkeletonOrganisation}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} />
          ))}
        </div>
        <div className={styles.adminSkeletonAttention} />
        <div className={styles.adminSkeletonCharts}>
          <div />
          <div />
        </div>
        <div className={styles.superSkeletonHealth}>
          <div />
          <div />
        </div>
        <div className={styles.superSkeletonActivity}>
          <div />
          <div />
        </div>
        <div className={styles.skeletonActions}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} />
          ))}
        </div>
      </div>
    </main>
  );
}

function Status({ message, onRetry }: Readonly<{ message: string; onRetry?: () => void }>) {
  return (
    <main className={styles.statusPage}>
      <div className={styles.statusCard}>
        <span className={styles.statusMark}>
          <LandingIcon name="shield" size={20} />
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

function plural(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
}

function activityIcon(kind?: string): LandingIconName {
  if (kind === 'CUSTOMER') return 'user';
  if (kind === 'PAYMENT' || kind === 'REFUND') return 'credit-card';
  if (kind === 'INVOICE') return 'layers';
  if (kind === 'PLAN_CHANGE') return 'gauge';
  return 'activity';
}

const tooltipStyle = {
  border: '1px solid #dbe4e7',
  borderRadius: 12,
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.1)',
  fontSize: 12,
};
