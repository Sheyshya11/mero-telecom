'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import type { RelocationStatus, ServiceAddress, ServiceRelocation } from './relocation.types';

const statuses: Array<{ label: string; value: '' | RelocationStatus }> = [
  { label: 'All statuses', value: '' },
  { label: 'Awaiting confirmation', value: 'AWAITING_CONFIRMATION' },
  { label: 'Provisioning', value: 'PROVISIONING' },
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'Partially completed', value: 'PARTIALLY_COMPLETED' },
  { label: 'Manual review', value: 'MANUAL_REVIEW_REQUIRED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'Force closed', value: 'FORCE_CLOSED' },
];

export function RelocationManagement() {
  const { accessToken, user } = useAuth();
  const pathname = usePathname();
  const basePath = `${pathname.split('/relocations')[0]}/relocations`;
  const [status, setStatus] = useState<'' | RelocationStatus>('');
  const [provisioningStatus, setProvisioningStatus] = useState('');
  const [disconnectionStatus, setDisconnectionStatus] = useState('');
  const [search, setSearch] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ limit: '20', page: String(page) });
  if (status) params.set('status', status);
  if (provisioningStatus) params.set('provisioningStatus', provisioningStatus);
  if (disconnectionStatus) params.set('disconnectionStatus', disconnectionStatus);
  if (search.trim()) params.set('search', search.trim());
  if (createdFrom) params.set('createdFrom', createdFrom);
  if (createdTo) params.set('createdTo', createdTo);

  const relocations = useQuery({
    queryKey: [
      'relocations',
      status,
      provisioningStatus,
      disconnectionStatus,
      search,
      createdFrom,
      createdTo,
      page,
    ],
    queryFn: () =>
      apiRequest<{
        data: ServiceRelocation[];
        meta: { total: number; page: number; totalPages: number };
      }>(`/relocations?${params.toString()}`, {}, accessToken),
    enabled: Boolean(accessToken && user),
  });

  const resetPage = () => setPage(1);

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-4 py-10 sm:px-6">
      <header className="border-b border-border pb-6">
        <p className="text-sm font-semibold tracking-wide text-primary">SERVICE OPERATIONS</p>
        <h1 className="mt-2 text-3xl font-bold">Relocations</h1>
        <p className="mt-2 text-muted-foreground">
          Manage qualification, new-service activation and old-service disconnection separately.
        </p>
      </header>

      <section className="mt-6 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-2 xl:grid-cols-6">
        <label className="grid gap-1 text-sm font-medium xl:col-span-2">
          Search
          <input
            className="field"
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
            placeholder="Customer, email or relocation ID"
            value={search}
          />
        </label>
        <Filter
          label="Status"
          onChange={(value) => {
            setStatus(value as RelocationStatus | '');
            resetPage();
          }}
          value={status}
        >
          {statuses.map((item) => (
            <option key={item.label} value={item.value}>
              {item.label}
            </option>
          ))}
        </Filter>
        <Filter
          label="Provisioning"
          onChange={(value) => {
            setProvisioningStatus(value);
            resetPage();
          }}
          value={provisioningStatus}
        >
          <option value="">All provisioning</option>
          <option value="PENDING">Pending</option>
          <option value="COMPLETED">Active</option>
          <option value="FAILED">Failed</option>
        </Filter>
        <Filter
          label="Disconnection"
          onChange={(value) => {
            setDisconnectionStatus(value);
            resetPage();
          }}
          value={disconnectionStatus}
        >
          <option value="">All disconnections</option>
          <option value="PENDING">Pending</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="MANUAL_REVIEW_REQUIRED">Manual review</option>
        </Filter>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm font-medium">
            Created from
            <input
              className="field"
              onChange={(event) => {
                setCreatedFrom(event.target.value);
                resetPage();
              }}
              type="date"
              value={createdFrom}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Created to
            <input
              className="field"
              onChange={(event) => {
                setCreatedTo(event.target.value);
                resetPage();
              }}
              type="date"
              value={createdTo}
            />
          </label>
        </div>
      </section>

      {relocations.isPending ? (
        <p className="mt-6 text-muted-foreground">Loading relocations…</p>
      ) : null}
      {relocations.isError ? (
        <p className="mt-6 rounded-lg bg-destructive-subtle p-4 text-destructive-foreground">
          Unable to load relocations.
        </p>
      ) : null}
      {relocations.data ? (
        <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {[
                    'Relocation',
                    'Customer',
                    'Current address',
                    'New address',
                    'Plan',
                    'Overall',
                    'Qualification',
                    'New service',
                    'Old service',
                    'Requested',
                    'Created',
                    '',
                  ].map((heading) => (
                    <th className="px-4 py-3 font-semibold" key={heading}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {relocations.data.data.map((relocation) => (
                  <tr className="align-top hover:bg-muted/20" key={relocation.id}>
                    <td className="px-4 py-4 font-mono text-xs">
                      {relocation.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-semibold">
                        {relocation.customer.firstName} {relocation.customer.lastName}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {relocation.customer.email}
                      </span>
                    </td>
                    <td className="max-w-48 px-4 py-4">
                      {formatAddress(relocation.oldServiceAddress)}
                    </td>
                    <td className="max-w-48 px-4 py-4">
                      {formatAddress(relocation.newServiceAddress)}
                    </td>
                    <td className="px-4 py-4">{relocation.requestedPlan.name}</td>
                    <td className="px-4 py-4">
                      <StatusBadge value={relocation.status} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={relocation.qualificationStatus} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={newServiceStatus(relocation)} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge
                        value={relocation.oldServiceDisconnectionStatus ?? 'NOT_STARTED'}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      {formatDate(relocation.requestedMoveDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      {formatDate(relocation.createdAt)}
                    </td>
                    <td className="px-4 py-4">
                      <Link
                        className="button-secondary whitespace-nowrap"
                        href={`${basePath}/${relocation.id}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {relocations.data.data.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              No relocations match these filters.
            </p>
          ) : null}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <span>
              {relocations.data.meta.total} relocation{relocations.data.meta.total === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button
                className="button-secondary"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
                type="button"
              >
                Previous
              </button>
              <span className="self-center text-muted-foreground">
                Page {page} of {Math.max(1, relocations.data.meta.totalPages)}
              </span>
              <button
                className="button-secondary"
                disabled={page >= relocations.data.meta.totalPages}
                onClick={() => setPage((value) => value + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </footer>
        </section>
      ) : null}
    </main>
  );
}

function Filter({
  children,
  label,
  onChange,
  value,
}: Readonly<{
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}>) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select className="field" onChange={(event) => onChange(event.target.value)} value={value}>
        {children}
      </select>
    </label>
  );
}

export function StatusBadge({ value }: Readonly<{ value: string }>) {
  const tone =
    value.includes('FAILED') || value === 'FORCE_CLOSED'
      ? 'bg-destructive-subtle text-destructive-foreground'
      : value.includes('COMPLETED') || value === 'ACTIVE' || value === 'AVAILABLE'
        ? 'bg-success-subtle text-success-foreground'
        : value.includes('MANUAL') || value.includes('PENDING') || value === 'SCHEDULED'
          ? 'bg-warning-subtle text-warning-foreground'
          : 'bg-primary-subtle text-primary-hover';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
      {friendly(value)}
    </span>
  );
}

export function formatAddress(address: ServiceAddress) {
  return [
    address.addressLine2,
    address.addressLine1,
    address.suburb,
    address.state,
    address.postcode,
  ]
    .filter(Boolean)
    .join(', ');
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Adelaide',
  }).format(new Date(value));
}

export function friendly(value: string) {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function newServiceStatus(relocation: ServiceRelocation) {
  if (relocation.newServiceActivatedAt) return 'ACTIVE';
  return relocation.provisioningStatus ?? 'NOT_STARTED';
}
