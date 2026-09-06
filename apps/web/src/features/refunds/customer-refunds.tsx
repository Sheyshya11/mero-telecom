'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { absoluteApiUrl, ApiError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import {
  formatRefundMoney,
  humanizeRefundValue,
  refundReasons,
  type RefundList,
  type RefundAttachment,
  type RefundReason,
} from './refund.types';

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

interface BillingInvoice {
  id: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  payments: Array<{
    id: string;
    amountCents: number;
    refundedCents: number;
    currency: string;
    status: string;
    paidAt: string | null;
  }>;
}

export function CustomerRefunds() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [reason, setReason] = useState<RefundReason>('SERVICE_UNAVAILABLE');
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ['customer-invoices', 'refund-options'],
    queryFn: () =>
      apiRequest<{ data: BillingInvoice[] }>('/invoices/me?limit=100', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });
  const refunds = useQuery({
    queryKey: ['customer-refunds'],
    queryFn: () => apiRequest<RefundList>('/me/refunds?limit=100', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });
  const requestRefund = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('reason', reason);
      if (details.trim()) body.append('details', details.trim());
      files.forEach((file) => body.append('files', file));
      return apiRequest(
        `/payments/${paymentId}/refund-requests`,
        { method: 'POST', body },
        accessToken,
      );
    },
    onSuccess: async () => {
      setError(null);
      setNotice('Your refund request was received and is waiting for review.');
      setPaymentId(null);
      setDetails('');
      setFiles([]);
      setFileError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customer-refunds'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-dashboard'] }),
      ]);
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof ApiError ? cause.message : 'The refund request could not be sent.');
    },
  });

  if (isLoading) return <Status message="Restoring your session…" />;
  if (user?.role !== 'CUSTOMER') return <Status message="Customer access is required." />;
  if (invoices.isPending || refunds.isPending) return <Status message="Loading billing history…" />;
  if (invoices.isError || refunds.isError || !invoices.data || !refunds.data) {
    return <Status message="Unable to load refund information." />;
  }

  const activePaymentIds = new Set(
    refunds.data.data
      .filter((refund) =>
        [
          'REQUESTED',
          'UNDER_REVIEW',
          'MORE_INFORMATION_REQUIRED',
          'APPROVED',
          'PROCESSING',
        ].includes(refund.status),
      )
      .map((refund) => refund.paymentId),
  );
  const payments = invoices.data.data.flatMap((invoice) =>
    invoice.payments.map((payment) => ({ ...payment, invoiceNumber: invoice.invoiceNumber })),
  );

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-6xl px-6 py-10 text-slate-950">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM · BILLING</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Refunds</h1>
          <p className="mt-2 text-slate-600">
            Request a review and track refunds for your payments.
          </p>
        </div>
      </header>

      {notice ? (
        <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Payment history</h2>
        <p className="mt-1 text-sm text-slate-600">
          A request is reviewed by our team and does not automatically issue money.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-180 text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-3">Invoice</th>
                <th>Paid</th>
                <th>Status</th>
                <th>Original</th>
                <th>Refunded</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const eligible =
                  ['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status) &&
                  payment.refundedCents < payment.amountCents &&
                  !activePaymentIds.has(payment.id);
                return (
                  <tr className="border-b border-slate-100" key={payment.id}>
                    <td className="py-4 font-semibold">{payment.invoiceNumber}</td>
                    <td>
                      {payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('en-AU') : '—'}
                    </td>
                    <td>{humanizeRefundValue(payment.status)}</td>
                    <td>{formatRefundMoney(payment.amountCents, payment.currency)}</td>
                    <td>{formatRefundMoney(payment.refundedCents, payment.currency)}</td>
                    <td className="text-right">
                      <button
                        className="button-secondary"
                        disabled={!eligible}
                        onClick={() => setPaymentId(payment.id)}
                        type="button"
                      >
                        {activePaymentIds.has(payment.id)
                          ? 'Under review'
                          : payment.status === 'REFUNDED'
                            ? 'Refunded'
                            : 'Request refund'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!payments.length ? (
            <p className="py-6 text-slate-600">No completed payments are available.</p>
          ) : null}
        </div>
      </section>

      {paymentId ? (
        <section
          className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-6"
          aria-label="Refund request form"
        >
          <h2 className="text-lg font-semibold">Request refund review</h2>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">
              Reason
              <select
                className="field"
                onChange={(event) => setReason(event.target.value as RefundReason)}
                value={reason}
              >
                {refundReasons
                  .filter((item) => item.value !== 'GOODWILL')
                  .map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Additional details (optional)
              <textarea
                className="field min-h-28"
                maxLength={2000}
                onChange={(event) => setDetails(event.target.value)}
                value={details}
              />
            </label>
            <div className="grid gap-2 text-sm">
              <div>
                <p className="font-medium">Supporting documents</p>
                <p className="mt-1 text-slate-600">
                  Optional: Attach supporting evidence such as receipts, invoices, payment
                  screenshots or other documents.
                </p>
              </div>
              <label
                className={`grid cursor-pointer place-items-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-sky-500 bg-sky-100' : 'border-sky-200 bg-white hover:border-sky-400'}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragging(false);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(event.dataTransfer.files, files, setFiles, setFileError);
                }}
              >
                <span className="font-semibold text-sky-700">Drop files here or Browse files</span>
                <span className="mt-1 text-xs text-slate-500">
                  JPG, PNG, WEBP, PDF, DOC, DOCX · 10 MB each · 5 files
                </span>
                <input
                  accept={ACCEPTED_TYPES.join(',')}
                  className="sr-only"
                  multiple
                  onChange={(event) => {
                    addFiles(event.target.files, files, setFiles, setFileError);
                    event.currentTarget.value = '';
                  }}
                  type="file"
                />
              </label>
              {fileError ? (
                <p className="text-sm text-rose-700" role="alert">
                  {fileError}
                </p>
              ) : null}
              {files.length ? (
                <ul className="grid gap-2">
                  {files.map((file, index) => (
                    <SelectedFile
                      key={`${file.name}-${file.lastModified}-${index}`}
                      file={file}
                      onRemove={() =>
                        setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                      }
                    />
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-slate-500">
                {files.length} of {MAX_FILES} files attached
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="button-primary"
                disabled={requestRefund.isPending}
                onClick={() => requestRefund.mutate()}
                type="button"
              >
                {requestRefund.isPending ? 'Sending…' : 'Send request'}
              </button>
              <button className="button-secondary" onClick={() => setPaymentId(null)} type="button">
                Cancel
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Your refund requests</h2>
        <div className="mt-5 grid gap-3">
          {refunds.data.data.map((refund) => (
            <article className="rounded-lg border border-slate-200 p-4" key={refund.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {refund.invoice?.invoiceNumber ?? 'Payment refund'}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {humanizeRefundValue(refund.reason)} · Requested{' '}
                    {new Date(refund.requestedAt).toLocaleDateString('en-AU')}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">
                  {humanizeRefundValue(refund.status)}
                </span>
              </div>
              <div className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
                <p>
                  Original:{' '}
                  <strong>{formatRefundMoney(refund.originalAmountCents, refund.currency)}</strong>
                </p>
                <p>
                  Requested:{' '}
                  <strong>{formatRefundMoney(refund.refundAmountCents, refund.currency)}</strong>
                </p>
                <p>
                  Net after completed refunds:{' '}
                  <strong>
                    {formatRefundMoney(
                      refund.payment.amountCents - refund.payment.refundedCents,
                      refund.currency,
                    )}
                  </strong>
                </p>
              </div>
              {refund.customerMessage ? (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>More information required:</strong> {refund.customerMessage}
                </p>
              ) : null}
              <AttachmentList
                attachments={refund.attachments ?? []}
                refundId={refund.id}
                accessPath="/me/refunds"
                accessToken={accessToken}
              />
              {refund.status === 'MORE_INFORMATION_REQUIRED' ? (
                <AdditionalEvidence
                  refundId={refund.id}
                  accessPath="/me/refunds"
                  accessToken={accessToken}
                  onComplete={() =>
                    void queryClient.invalidateQueries({ queryKey: ['customer-refunds'] })
                  }
                />
              ) : null}
            </article>
          ))}
          {!refunds.data.data.length ? (
            <p className="text-slate-600">You have not requested a refund.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function addFiles(
  incoming: FileList | null,
  current: File[],
  setFiles: (files: File[]) => void,
  setError: (message: string | null) => void,
) {
  if (!incoming?.length) return;
  const next = [...current];
  for (const file of Array.from(incoming)) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(`${file.name} is not a supported file type.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`${file.name} exceeds the maximum file size of 10 MB.`);
      return;
    }
    if (next.length >= MAX_FILES) {
      setError(`You can upload a maximum of ${MAX_FILES} files.`);
      return;
    }
    if (next.reduce((total, item) => total + item.size, 0) + file.size > MAX_TOTAL_SIZE) {
      setError('Your attachments exceed the total 25 MB limit.');
      return;
    }
    next.push(file);
  }
  setFiles(next);
  setError(null);
}

function SelectedFile({ file, onRemove }: Readonly<{ file: File; onRemove: () => void }>) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2">
      {preview ? (
        <img alt="" className="h-10 w-10 rounded object-cover" src={preview} />
      ) : (
        <span
          aria-hidden="true"
          className="grid h-10 w-10 place-items-center rounded bg-slate-100 text-xs font-bold text-slate-500"
        >
          {file.type === 'application/pdf' ? 'PDF' : 'DOC'}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {file.name} <small className="text-slate-500">({formatBytes(file.size)})</small>
      </span>
      <button
        className="text-xs font-semibold text-rose-700 hover:underline"
        onClick={onRemove}
        type="button"
      >
        Remove
      </button>
    </li>
  );
}

function AttachmentList({
  attachments,
  refundId,
  accessPath,
  accessToken,
}: Readonly<{
  attachments: RefundAttachment[];
  refundId: string;
  accessPath: string;
  accessToken: string | null;
}>) {
  if (!attachments.length) return null;
  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <h3 className="text-sm font-semibold">Supporting evidence</h3>
      <ul className="mt-2 grid gap-2">
        {attachments.map((attachment) => (
          <li className="flex items-center gap-2 text-sm" key={attachment.id}>
            <span className="min-w-0 flex-1 truncate">
              {attachment.originalName}{' '}
              <small className="text-slate-500">· {formatBytes(attachment.fileSize)}</small>
            </span>
            <AttachmentView
              attachment={attachment}
              refundId={refundId}
              accessPath={accessPath}
              accessToken={accessToken}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttachmentView({
  attachment,
  refundId,
  accessPath,
  accessToken,
}: Readonly<{
  attachment: RefundAttachment;
  refundId: string;
  accessPath: string;
  accessToken: string | null;
}>) {
  const [loading, setLoading] = useState(false);
  async function view() {
    setLoading(true);
    try {
      const result = await apiRequest<{ url: string }>(
        `${accessPath}/${refundId}/attachments/${attachment.id}/access`,
        {},
        accessToken,
      );
      window.open(absoluteApiUrl(result.url), '_blank', 'noopener,noreferrer');
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      className="text-xs font-semibold text-sky-700 hover:underline"
      disabled={loading}
      onClick={() => void view()}
      type="button"
    >
      {loading ? 'Opening…' : 'View'}
    </button>
  );
}

function AdditionalEvidence({
  refundId,
  accessPath,
  accessToken,
  onComplete,
}: Readonly<{
  refundId: string;
  accessPath: string;
  accessToken: string | null;
  onComplete: () => void;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit() {
    if (!files.length) return;
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      files.forEach((file) => body.append('files', file));
      await apiRequest(
        `${accessPath}/${refundId}/attachments`,
        { method: 'POST', body },
        accessToken,
      );
      setFiles([]);
      onComplete();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The evidence could not be uploaded.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900">Upload additional evidence</p>
      <input
        ref={inputRef}
        accept={ACCEPTED_TYPES.join(',')}
        className="mt-2 block w-full text-xs"
        multiple
        onChange={(event) => {
          addFiles(event.target.files, [], setFiles, setError);
        }}
        type="file"
      />
      <button
        className="button-primary mt-3"
        disabled={!files.length || pending}
        onClick={() => void submit()}
        type="button"
      >
        {pending ? 'Uploading…' : 'Upload evidence'}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Status({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <p>{message}</p>
    </main>
  );
}
