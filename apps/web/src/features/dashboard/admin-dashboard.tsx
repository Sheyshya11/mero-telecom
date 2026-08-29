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

const statusColors = {
  ACTIVE: '#0b8791',
  PENDING: '#55bcc3',
  SUSPENDED: '#e49a26',
  CANCELLED: '#94a3b8',
};

const adminNav = [
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/plans', label: 'Plans' },
  { href: '/admin/subscriptions', label: 'Subscriptions' },
  { href: '/admin/invoices', label: 'Invoices' },
  { href: '/admin/coverage', label: 'Coverage' },
  { href: '/admin/users', label: 'Team' },
];

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function AdminDashboardView() {
  const { accessToken, isLoading, logout, user } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiRequest<AdminDashboard>('/dashboard/admin', {}, accessToken),
    enabled: Boolean(accessToken && (user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN')),
  });

  if (isLoading) return <Status message="Restoring your session…" />;
  if (!user) return <Status message="Sign in to view the dashboard." />;
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')
    return <Status message="Administrator access is required." />;
  if (dashboardQuery.isPending) return <Status message="Loading dashboard…" />;
  if (dashboardQuery.isError || !dashboardQuery.data)
    return (
      <Status
        message="Unable to load dashboard data."
        onRetry={() => void dashboardQuery.refetch()}
      />
    );

  const dashboard = dashboardQuery.data;
  const trend = dashboard.invoiceTrend.map((point) => ({
    ...point,
    totalDollars: point.totalCents / 100,
  }));

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Brand />
          <nav aria-label="Administrator navigation" className={styles.nav}>
            {adminNav.map((item) => (
              <Link className={styles.navLink} href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
            <button className={styles.signOut} onClick={() => void logout()} type="button">
              Sign out
            </button>
          </nav>
        </header>

        <section className={styles.hero}>
          <span aria-hidden="true" className={styles.heroGlow} />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>
              {user.role === 'SUPER_ADMIN' ? 'Super admin control centre' : 'Admin control centre'}
            </p>
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
            label="Customers"
            value={String(dashboard.metrics.customerCount)}
          />
          <Metric
            detail="Current subscriptions"
            icon="activity"
            label="Active services"
            value={String(dashboard.metrics.activeSubscriptions)}
          />
          <Metric
            detail="Active plan value"
            icon="gauge"
            label="Monthly recurring revenue"
            value={formatMoney(dashboard.metrics.monthlyRecurringRevenueCents)}
          />
          <Metric
            detail="Issued and overdue"
            icon="credit-card"
            label="Outstanding invoices"
            value={formatMoney(dashboard.metrics.outstandingInvoiceCents)}
          />
          <Metric
            detail="Requires follow-up"
            icon="shield"
            label="Overdue invoices"
            value={String(dashboard.metrics.overdueInvoiceCount)}
            warning
          />
        </section>

        <section className={styles.contentGrid}>
          <Panel meta="Issued invoice totals" title="Invoice value by month">
            <div className={styles.chart}>
              <ResponsiveContainer height="100%" width="100%">
                <BarChart data={trend} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
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
                  />
                  <Tooltip
                    contentStyle={{
                      border: '1px solid #dbe4e7',
                      borderRadius: 12,
                      boxShadow: '0 12px 28px rgba(15, 23, 42, 0.1)',
                      fontSize: 12,
                    }}
                    cursor={{ fill: 'rgba(11, 135, 145, 0.06)' }}
                    formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, 'Invoice value']}
                  />
                  <Bar dataKey="totalDollars" fill="#0b8791" radius={[7, 7, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel meta="Current service mix" title="Subscriptions by status">
            <div className={styles.chart}>
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie
                    cx="50%"
                    cy="48%"
                    data={dashboard.subscriptionsByStatus}
                    dataKey="count"
                    innerRadius={50}
                    label={({ name, value }) => `${name}: ${value}`}
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
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Issue date</th>
                  <th>Status</th>
                  <th className={styles.alignRight}>Total</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className={styles.tableStrong}>{invoice.invoiceNumber}</td>
                    <td>{invoice.customerName}</td>
                    <td className={styles.tableMuted}>
                      {new Date(invoice.issueDate).toLocaleDateString('en-AU')}
                    </td>
                    <td>
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className={`${styles.tableStrong} ${styles.alignRight}`}>
                      {formatMoney(invoice.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Brand() {
  return (
    <Link aria-label="Mero Telecom home" className={styles.brand} href="/">
      <span className={styles.brandMark}>
        <LandingIcon name="wifi" size={19} />
      </span>
      <span>
        Mero<span>Telecom</span>
      </span>
    </Link>
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
