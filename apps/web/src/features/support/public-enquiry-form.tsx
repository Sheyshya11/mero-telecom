'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest } from '../../lib/api/client';
import { prospectSupportCategories, type SupportCategory } from './support.types';

const categoryValues = prospectSupportCategories.map((item) => item.value) as [
  SupportCategory,
  ...SupportCategory[],
];

const enquirySchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(200),
  email: z.string().trim().email('Enter a valid email address.').max(320),
  phone: z.string().trim().max(32).optional(),
  category: z.enum(categoryValues),
  subject: z.string().trim().min(3, 'Enter a short subject.').max(200),
  address: z.string().trim().max(300).optional(),
  message: z.string().trim().min(10, 'Tell us a little more so we can help.').max(5000),
  website: z.string().max(0).optional(),
});

type EnquiryValues = z.infer<typeof enquirySchema>;

interface EnquiryResponse {
  referenceNumber: string;
  message: string;
}

export function PublicEnquiryForm() {
  const form = useForm<EnquiryValues>({
    resolver: zodResolver(enquirySchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      category: 'PLANS_AND_PRICING',
      subject: '',
      address: '',
      message: '',
      website: '',
    },
  });
  const submit = useMutation({
    mutationFn: (values: EnquiryValues) =>
      apiRequest<EnquiryResponse>('/support/public/enquiries', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(values),
      }),
  });

  if (submit.data) {
    return (
      <section
        aria-live="polite"
        className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 shadow-sm sm:p-8"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Enquiry received
        </p>
        <h2 className="mt-2 text-2xl font-bold">Thanks for contacting Mero Telecom.</h2>
        <p className="mt-3">Our support team will review your request and reply by email.</p>
        <div className="mt-5 rounded-xl border border-emerald-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Your enquiry reference
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-950">
            {submit.data.referenceNumber}
          </p>
        </div>
        <button
          className="button-secondary mt-5"
          onClick={() => {
            submit.reset();
            form.reset();
          }}
          type="button"
        >
          Send another enquiry
        </button>
      </section>
    );
  }

  const error =
    submit.error instanceof ApiError
      ? submit.error.statusCode === 429
        ? 'Too many enquiries were submitted from this connection. Please wait a minute and try again.'
        : submit.error.message
      : submit.isError
        ? "We couldn't send your enquiry. Please try again."
        : null;

  return (
    <form
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8"
      noValidate
      onSubmit={form.handleSubmit((values) => submit.mutate(values))}
    >
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Contact us</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">Send an enquiry</h2>
        <p className="mt-2 text-sm text-slate-600">
          No account or internet plan is required. Fields marked * are required.
        </p>
      </div>

      {error ? (
        <p className="mt-5 rounded-lg bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Field label="Name *" error={form.formState.errors.name?.message}>
          <input autoComplete="name" className="field" maxLength={200} {...form.register('name')} />
        </Field>
        <Field label="Email *" error={form.formState.errors.email?.message}>
          <input
            autoComplete="email"
            className="field"
            inputMode="email"
            maxLength={320}
            type="email"
            {...form.register('email')}
          />
        </Field>
        <Field label="Phone (optional)" error={form.formState.errors.phone?.message}>
          <input
            autoComplete="tel"
            className="field"
            inputMode="tel"
            maxLength={32}
            {...form.register('phone')}
          />
        </Field>
        <Field
          label="What do you need help with? *"
          error={form.formState.errors.category?.message}
        >
          <select className="field" {...form.register('category')}>
            {prospectSupportCategories.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5 grid gap-5">
        <Field label="Subject *" error={form.formState.errors.subject?.message}>
          <input className="field" maxLength={200} {...form.register('subject')} />
        </Field>
        <Field
          label="Address or postcode (optional)"
          error={form.formState.errors.address?.message}
        >
          <input
            autoComplete="street-address"
            className="field"
            maxLength={300}
            placeholder="Useful for address or NBN availability questions"
            {...form.register('address')}
          />
        </Field>
        <Field label="Message *" error={form.formState.errors.message?.message}>
          <textarea
            className="field min-h-36 resize-y"
            maxLength={5000}
            {...form.register('message')}
          />
        </Field>
      </div>

      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Website
          <input autoComplete="off" tabIndex={-1} {...form.register('website')} />
        </label>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-xs leading-5 text-slate-500">
          Please do not include passwords, full card details, or other sensitive credentials.
        </p>
        <button className="button-primary shrink-0" disabled={submit.isPending} type="submit">
          {submit.isPending ? 'Sending enquiry…' : 'Send Enquiry'}
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
    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
      {label}
      {children}
      {error ? <span className="text-xs font-normal text-rose-700">{error}</span> : null}
    </label>
  );
}
