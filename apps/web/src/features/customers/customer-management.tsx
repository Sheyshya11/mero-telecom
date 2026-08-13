'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import Link from 'next/link';

import { useAuth } from '../auth/auth-provider';
import { ApiError } from '../../lib/api/client';
import { createCustomer, getCustomers, updateCustomer } from './customer.api';
import { CustomerForm } from './customer-form';
import type { CustomerFormValues } from './customer.schemas';
import type { Customer } from './customer.types';

export function CustomerManagement() {
  const { accessToken, isLoading, logout, user } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(() => ['customers', page, search], [page, search]);
  const customersQuery = useQuery({
    queryKey,
    queryFn: () => getCustomers(accessToken ?? '', page, search),
    enabled: Boolean(accessToken && user?.role === 'ADMIN'),
  });

  const createMutation = useMutation({
    mutationFn: (values: CustomerFormValues) => createCustomer(accessToken ?? '', values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      closeForm();
    },
    onError: showError,
  });
  const updateMutation = useMutation({
    mutationFn: (values: CustomerFormValues) =>
      updateCustomer(accessToken ?? '', editingCustomer?.id ?? '', values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      closeForm();
    },
    onError: showError,
  });

  function showError(reason: Error) {
    setError(reason instanceof ApiError ? reason.message : 'Unable to save the customer.');
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingCustomer(null);
    setError(null);
  }

  async function submitForm(values: CustomerFormValues) {
    setError(null);
    if (editingCustomer) {
      await updateMutation.mutateAsync(values);
    } else {
      await createMutation.mutateAsync(values);
    }
  }

  if (isLoading) {
    return <StatusMessage message="Restoring your session…" />;
  }

  if (!user) {
    return <StatusMessage message="Sign in with the seeded admin account to manage customers." />;
  }

  if (user.role !== 'ADMIN') {
    return <StatusMessage message="Customer management is restricted to administrators." />;
  }

  const result = customersQuery.data;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM · ADMIN</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Customers</h1>
          <p className="mt-2 text-slate-600">
            Search, create, and update customer account records.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-slate-500 sm:inline">{user.email}</span>
          <Link className="button-secondary" href="/admin/dashboard">
            Dashboard
          </Link>
          <button className="button-secondary" onClick={() => void logout()} type="button">
            Sign out
          </button>
          <Link className="button-secondary" href="/admin/subscriptions">
            Subscriptions
          </Link>
          <button
            className="button-primary"
            onClick={() => {
              setEditingCustomer(null);
              setError(null);
              setIsFormOpen(true);
            }}
            type="button"
          >
            New customer
          </button>
        </div>
      </header>

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <form
          className="flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          <input
            className="field max-w-xl"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name, customer number, email, or phone"
            value={searchInput}
          />
          <button className="button-primary" type="submit">
            Search
          </button>
        </form>

        {customersQuery.isPending ? (
          <p className="py-10 text-slate-500">Loading customers…</p>
        ) : null}
        {customersQuery.isError ? (
          <div className="flex items-center gap-3 py-10 text-rose-700">
            <p>Unable to load customers.</p>
            <button
              className="button-secondary"
              onClick={() => void customersQuery.refetch()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : null}
        {result ? (
          <>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-200 text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Customer</th>
                    <th className="px-3 py-3">Contact</th>
                    <th className="px-3 py-3">Address</th>
                    <th className="px-3 py-3">Subscription</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((customer) => (
                    <tr className="border-b border-slate-100" key={customer.id}>
                      <td className="px-3 py-4">
                        <p className="font-semibold text-slate-900">
                          {customer.firstName} {customer.lastName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{customer.customerNumber}</p>
                      </td>
                      <td className="px-3 py-4 text-slate-700">
                        <p>{customer.email}</p>
                        <p className="mt-1 text-slate-500">{customer.phone}</p>
                      </td>
                      <td className="px-3 py-4 text-slate-700">
                        {customer.suburb}, {customer.state} {customer.postcode}
                      </td>
                      <td className="px-3 py-4 text-slate-700">
                        {customer.currentSubscription ? (
                          <>
                            <p>{customer.currentSubscription.plan.name}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {customer.currentSubscription.status}
                            </p>
                          </>
                        ) : (
                          <span className="text-slate-500">Not assigned</span>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <StatusBadge status={customer.status} />
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            className="button-secondary"
                            onClick={() => setSelectedCustomer(customer)}
                            type="button"
                          >
                            Details
                          </button>
                          <button
                            className="button-secondary"
                            onClick={() => {
                              setEditingCustomer(customer);
                              setError(null);
                              setIsFormOpen(true);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.data.length === 0 ? (
              <p className="py-8 text-slate-500">No customers found.</p>
            ) : null}
            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm text-slate-600">
              <span>
                {result.meta.total} customer{result.meta.total === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  className="button-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((currentPage) => currentPage - 1)}
                  type="button"
                >
                  Previous
                </button>
                <span>
                  Page {result.meta.page} of {result.meta.totalPages}
                </span>
                <button
                  className="button-secondary"
                  disabled={page >= result.meta.totalPages}
                  onClick={() => setPage((currentPage) => currentPage + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>

      {isFormOpen ? (
        <div className="fixed inset-0 z-10 grid place-items-center bg-slate-950/40 p-4">
          <section
            aria-modal="true"
            className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl"
            role="dialog"
          >
            <h2 className="text-xl font-bold text-slate-950">
              {editingCustomer ? 'Edit customer' : 'Create customer'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Customer numbers are allocated automatically.
            </p>
            {error ? (
              <p className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>
            ) : null}
            <div className="mt-5">
              <CustomerForm
                customer={editingCustomer}
                isSubmitting={createMutation.isPending || updateMutation.isPending}
                onCancel={closeForm}
                onSubmit={submitForm}
              />
            </div>
          </section>
        </div>
      ) : null}
      {selectedCustomer ? (
        <div className="fixed inset-0 z-10 grid place-items-center bg-slate-950/40 p-4">
          <section
            aria-modal="true"
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-wide text-sky-700">
                  {selectedCustomer.customerNumber}
                </p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">
                  {selectedCustomer.firstName} {selectedCustomer.lastName}
                </h2>
              </div>
              <StatusBadge status={selectedCustomer.status} />
            </div>
            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
              <Detail label="Email" value={selectedCustomer.email} />
              <Detail label="Mobile" value={selectedCustomer.phone} />
              <Detail
                label="Address"
                value={`${selectedCustomer.addressLine1}, ${selectedCustomer.suburb}, ${selectedCustomer.state} ${selectedCustomer.postcode}`}
              />
              <Detail
                label="Subscription"
                value={
                  selectedCustomer.currentSubscription
                    ? `${selectedCustomer.currentSubscription.plan.name} (${selectedCustomer.currentSubscription.status})`
                    : 'Not assigned'
                }
              />
            </dl>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="button-secondary"
                onClick={() => setSelectedCustomer(null)}
                type="button"
              >
                Close
              </button>
              <button
                className="button-primary"
                onClick={() => {
                  setEditingCustomer(selectedCustomer);
                  setSelectedCustomer(null);
                  setError(null);
                  setIsFormOpen(true);
                }}
                type="button"
              >
                Edit customer
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function StatusBadge({ status }: Readonly<{ status: Customer['status'] }>) {
  const colors = {
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    INACTIVE: 'bg-slate-100 text-slate-700',
    SUSPENDED: 'bg-amber-100 text-amber-800',
  };

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[status]}`}>
      {status}
    </span>
  );
}

function StatusMessage({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      {message}
    </main>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-900">{value}</dd>
    </div>
  );
}
