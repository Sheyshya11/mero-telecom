'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  DataTableControls,
  DataTablePagination,
  SortHeader,
  TableSkeleton,
  useTableQueryParams,
} from '../../components/data-table';

import { useAuth } from '../auth/auth-provider';
import { usePlanOptions } from '../plans/use-plan-options';
import { ApiError } from '../../lib/api/client';
import {
  createCustomer,
  getCustomers,
  resendCustomerInvitation,
  updateCustomer,
} from './customer.api';
import { CustomerForm } from './customer-form';
import type { CustomerFormValues } from './customer.schemas';
import type { Customer } from './customer.types';

export function CustomerManagement() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const table = useTableQueryParams([
    'status',
    'subscriptionStatus',
    'planId',
    'state',
    'postcode',
    'createdFrom',
    'createdTo',
  ]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const planOptions = usePlanOptions(accessToken, isAdmin || user?.role === 'STAFF');

  const queryKey = ['customers', table.query];
  const customersQuery = useQuery({
    queryKey,
    queryFn: () => getCustomers(accessToken ?? '', table.page, table.values.search, table.query),
    placeholderData: keepPreviousData,
    enabled: Boolean(accessToken && (isAdmin || user?.role === 'STAFF')),
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
  const resendMutation = useMutation({
    mutationFn: (customerId: string) => resendCustomerInvitation(accessToken ?? '', customerId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      setError(null);
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

  if (!isAdmin && user.role !== 'STAFF') {
    return <StatusMessage message="Customer management requires staff access." />;
  }

  const result = customersQuery.data;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">
            CUSTOMER OPERATIONS ·{' '}
            {user.role === 'SUPER_ADMIN' ? 'SUPER ADMIN' : isAdmin ? 'ADMIN' : 'STAFF'}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            {isAdmin ? 'Customers' : 'Staff workspace'}
          </h1>
          <p className="mt-2 text-slate-600">
            Search and update customer account records
            {isAdmin ? ', or create a new customer.' : '.'}
          </p>
        </div>
        {isAdmin ? (
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
        ) : null}
      </header>

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-950">Customer accounts</h2>
            <p className="mt-1 text-sm text-slate-500">
              Find a customer to review or update their details.
            </p>
          </div>
          {result ? (
            <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">
              {result.meta.total}{' '}
              {Object.entries(table.values).some(
                ([key, value]) => !['page', 'limit', 'sortBy', 'sortOrder'].includes(key) && value,
              )
                ? 'results'
                : 'total'}
            </span>
          ) : null}
        </div>
        <DataTableControls
          state={table}
          placeholder="Search customers by name, email, phone or account number..."
          sorts={['createdAt', 'updatedAt', 'firstName', 'lastName', 'email', 'status']}
          fields={[
            {
              key: 'status',
              label: 'Account status',
              options: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'INVITATION_PENDING'],
            },
            {
              key: 'subscriptionStatus',
              label: 'Subscription status',
              options: ['ACTIVE', 'PENDING', 'SUSPENDED', 'CANCELLED', 'NO_SUBSCRIPTION'],
            },
            { key: 'planId', label: 'Plan', options: planOptions },
            {
              key: 'state',
              label: 'State',
              options: ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'],
            },
            { key: 'postcode', label: 'Postcode' },
            { key: 'createdFrom', label: 'Created from', type: 'date' },
            { key: 'createdTo', label: 'Created to', type: 'date' },
          ]}
        />

        {customersQuery.isPending ? <TableSkeleton /> : null}
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
                    <th className="px-3 py-3">
                      <SortHeader state={table} field="lastName">
                        Customer
                      </SortHeader>
                    </th>
                    <th className="px-3 py-3">
                      <SortHeader state={table} field="email">
                        Contact
                      </SortHeader>
                    </th>
                    <th className="px-3 py-3">Address</th>
                    <th className="px-3 py-3">Subscription</th>
                    <th className="px-3 py-3">
                      <SortHeader state={table} field="status">
                        Account
                      </SortHeader>
                    </th>
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
                        <StatusBadge status={customer.accountStatus ?? customer.status} />
                        {customer.invitationStatus ? (
                          <p className="mt-1 text-xs text-slate-500">
                            Invitation {customer.invitationStatus.toLowerCase()}
                          </p>
                        ) : null}
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
                          {isAdmin && customer.accountStatus === 'INVITATION_PENDING' ? (
                            <button
                              className="button-secondary"
                              disabled={resendMutation.isPending}
                              onClick={() => resendMutation.mutate(customer.id)}
                              type="button"
                            >
                              Resend invitation
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.data.length === 0 ? (
              <p className="py-8 text-slate-500">
                {table.values.search
                  ? 'No customers match your search.'
                  : [
                        'status',
                        'subscriptionStatus',
                        'planId',
                        'state',
                        'postcode',
                        'createdFrom',
                        'createdTo',
                      ].some((key) => table.values[key])
                    ? 'No customers match the selected filters.'
                    : 'No customers have been created yet.'}
              </p>
            ) : null}
            <DataTablePagination
              state={table}
              meta={result.meta}
              busy={customersQuery.isFetching}
              noun="customers"
            />
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
                canEditIdentity={isAdmin}
                canManageStatus={isAdmin}
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
              <StatusBadge status={selectedCustomer.accountStatus ?? selectedCustomer.status} />
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

function StatusBadge({
  status,
}: Readonly<{ status: Customer['status'] | NonNullable<Customer['accountStatus']> }>) {
  const colors = {
    INVITATION_PENDING: 'bg-sky-100 text-sky-800',
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    INACTIVE: 'bg-slate-100 text-slate-700',
    SUSPENDED: 'bg-amber-100 text-amber-800',
    DEACTIVATED: 'bg-slate-200 text-slate-700',
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
