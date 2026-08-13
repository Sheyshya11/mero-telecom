'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { customerSchema, type CustomerFormValues } from './customer.schemas';
import type { Customer } from './customer.types';

interface CustomerFormProps {
  customer?: Customer | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (values: CustomerFormValues) => Promise<void>;
}

const emptyValues: CustomerFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  suburb: '',
  state: 'NSW',
  postcode: '',
};

export function CustomerForm({ customer, isSubmitting, onCancel, onSubmit }: CustomerFormProps) {
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: emptyValues,
  });

  useEffect(() => {
    form.reset(
      customer
        ? {
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
            addressLine1: customer.addressLine1,
            addressLine2: customer.addressLine2 ?? '',
            suburb: customer.suburb,
            state: customer.state,
            postcode: customer.postcode,
            status: customer.status,
          }
        : emptyValues,
    );
  }, [customer, form]);

  return (
    <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={form.formState.errors.firstName?.message}>
          <input className="field" {...form.register('firstName')} />
        </Field>
        <Field label="Last name" error={form.formState.errors.lastName?.message}>
          <input className="field" {...form.register('lastName')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" error={form.formState.errors.email?.message}>
          <input className="field" type="email" {...form.register('email')} />
        </Field>
        <Field label="Mobile" error={form.formState.errors.phone?.message}>
          <input className="field" placeholder="0400 000 000" {...form.register('phone')} />
        </Field>
      </div>
      <Field label="Address" error={form.formState.errors.addressLine1?.message}>
        <input className="field" {...form.register('addressLine1')} />
      </Field>
      <Field label="Address line 2" error={form.formState.errors.addressLine2?.message}>
        <input className="field" {...form.register('addressLine2')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Suburb" error={form.formState.errors.suburb?.message}>
          <input className="field" {...form.register('suburb')} />
        </Field>
        <Field label="State" error={form.formState.errors.state?.message}>
          <input className="field" {...form.register('state')} />
        </Field>
        <Field label="Postcode" error={form.formState.errors.postcode?.message}>
          <input className="field" inputMode="numeric" {...form.register('postcode')} />
        </Field>
      </div>
      {customer ? (
        <Field label="Account status" error={form.formState.errors.status?.message}>
          <select className="field" {...form.register('status')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </Field>
      ) : null}
      <div className="flex justify-end gap-3 pt-2">
        <button className="button-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="button-primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Saving…' : customer ? 'Save changes' : 'Create customer'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: Readonly<{ label: string; error?: string; children: React.ReactNode }>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      {children}
      {error ? <span className="text-xs font-normal text-rose-700">{error}</span> : null}
    </label>
  );
}
