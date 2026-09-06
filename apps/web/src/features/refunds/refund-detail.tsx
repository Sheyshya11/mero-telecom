'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { absoluteApiUrl, ApiError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import {
  formatRefundMoney,
  humanizeRefundValue,
  partialRefundAmountCents,
  refundReasons,
  type RefundRecord,
  type RefundReason,
  type RefundType,
  type RefundAttachment,
} from './refund.types';

const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export function RefundDetail({
  refundId,
  basePath,
}: Readonly<{ refundId: string; basePath: '/admin/refunds' | '/staff/refunds' }>) {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [type, setType] = useState<RefundType>('FULL');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<RefundReason>('SERVICE_UNAVAILABLE');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmProcess, setConfirmProcess] = useState(false);
  const [moreInfoMessage, setMoreInfoMessage] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const permitted = user && ['SUPER_ADMIN', 'ADMIN', 'STAFF'].includes(user.role);
  const canApprove = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const refund = useQuery({
    queryKey: ['admin-refund', refundId],
    queryFn: () => apiRequest<RefundRecord>(`/admin/refunds/${refundId}`, {}, accessToken),
    enabled: Boolean(accessToken && permitted),
  });
  const refresh = async (message: string) => {
    setError(null);
    setNotice(message);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-refund', refundId] }),
      queryClient.invalidateQueries({ queryKey: ['admin-refunds'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] }),
    ]);
  };
  const action = useMutation({
    mutationFn: ({ name, body }: { name: string; body?: object }) =>
      apiRequest(
        `/admin/refunds/${refundId}/${name}`,
        { method: 'POST', body: body ? JSON.stringify(body) : undefined },
        accessToken,
      ),
    onSuccess: async (_, variables) => {
      setConfirmProcess(false);
      const message =
        variables.name === 'process'
          ? 'Refund was submitted for processing.'
          : variables.name === 'request-more-information'
            ? 'The customer was asked for more information.'
            : `Refund was ${variables.name}ed.`;
      await refresh(message);
    },
    onError: (cause) => {
      setConfirmProcess(false);
      setNotice(null);
      setError(cause instanceof ApiError ? cause.message : 'The refund action failed.');
    },
  });
  const uploadEvidence = useMutation({
    mutationFn: () => {
      const body = new FormData();
      evidenceFiles.forEach((file) => body.append('files', file));
      return apiRequest(
        `/admin/refunds/${refundId}/attachments`,
        { method: 'POST', body },
        accessToken,
      );
    },
    onSuccess: async () => {
      setEvidenceFiles([]);
      await refresh('Supporting evidence uploaded.');
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : 'The evidence could not be uploaded.'),
  });
  if (isLoading || refund.isPending) return <Status message="Loading refund…" />;
  if (!permitted) return <Status message="Staff or administrator access is required." />;
  if (refund.isError || !refund.data) return <Status message="Unable to load this refund." />;
  const data = refund.data;
  const maximum = data.refundableSummary?.remainingCents ?? 0;
  const partialAmount = partialRefundAmountCents(amount, maximum);
  const approvalAmount = type === 'FULL' ? maximum : partialAmount;
  const approvalInvalid = type === 'PARTIAL' && approvalAmount === null;
  const canReview = ['REQUESTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'].includes(
    data.status,
  );
  const canRequestMoreInfo = canReview && data.status !== 'MORE_INFORMATION_REQUIRED';
  const canDecide = canApprove && ['REQUESTED', 'UNDER_REVIEW'].includes(data.status);
  const canProcess = canApprove && data.status === 'APPROVED';
  const canRetry = canApprove && data.status === 'FAILED';
  return (
    <main className="workspace-page mx-auto min-h-screen max-w-6xl px-6 py-10 text-slate-950">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">
            REFUND {data.id.slice(0, 8).toUpperCase()}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Refund details</h1>
          <p className="mt-2 text-slate-600">
            {data.customer?.firstName} {data.customer?.lastName} ·{' '}
            {data.invoice?.invoiceNumber ?? 'Payment'}
          </p>
        </div>
        <Link className="button-secondary" href={basePath}>
          Back to refunds
        </Link>
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
      <section className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {[
          ['Status', humanizeRefundValue(data.status)],
          ['Original payment', formatRefundMoney(data.originalAmountCents, data.currency)],
          ['Approved/requested refund', formatRefundMoney(data.refundAmountCents, data.currency)],
          ['Remaining available', formatRefundMoney(maximum, data.currency)],
        ].map(([label, value]) => (
          <article
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            key={label}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-bold">{value}</p>
          </article>
        ))}
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Request and billing</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <Detail
              label="Customer"
              value={`${data.customer?.firstName} ${data.customer?.lastName} (${data.customer?.email})`}
            />
            <Detail label="Invoice" value={data.invoice?.invoiceNumber ?? 'Not linked'} />
            <Detail label="Plan" value={data.subscription?.plan.name ?? 'Not linked'} />
            <Detail label="Reason" value={humanizeRefundValue(data.reason)} />
            <Detail
              label="Customer details"
              value={data.customerReason ?? 'No additional details'}
            />
            {data.customerMessage ? (
              <Detail label="Message to customer" value={data.customerMessage} />
            ) : null}
            <Detail label="Payment status" value={humanizeRefundValue(data.payment.status)} />
            <Detail label="Stripe Payment" value={data.stripePaymentIntentId ?? '—'} />
            <Detail label="Stripe Refund" value={data.stripeRefundId ?? 'Not submitted'} />
          </dl>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Controlled actions</h2>
          <label className="mt-4 grid gap-1 text-sm font-medium">
            Internal note
            <textarea
              className="field min-h-24"
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </label>
          {canRequestMoreInfo ? (
            <button
              className="button-secondary mt-3"
              disabled={action.isPending || (data.status === 'UNDER_REVIEW' && !note.trim())}
              onClick={() =>
                action.mutate({ name: 'review', body: { internalNote: note || undefined } })
              }
              type="button"
            >
              {data.status === 'UNDER_REVIEW' ? 'Add review note' : 'Start review'}
            </button>
          ) : null}
          {canReview ? (
            <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4">
              <label className="grid gap-1 text-sm font-medium">
                Request more information
                <textarea
                  className="field min-h-20"
                  maxLength={2000}
                  onChange={(event) => setMoreInfoMessage(event.target.value)}
                  placeholder="Tell the customer what evidence is needed."
                  value={moreInfoMessage}
                />
              </label>
              <button
                className="button-secondary"
                disabled={action.isPending || !moreInfoMessage.trim()}
                onClick={() =>
                  action.mutate({
                    name: 'request-more-information',
                    body: { message: moreInfoMessage.trim() },
                  })
                }
                type="button"
              >
                Request More Information
              </button>
            </div>
          ) : null}
          {canDecide ? (
            <div className="mt-5 grid gap-3 border-t border-slate-200 pt-5">
              <label className="grid gap-1 text-sm font-medium">
                Refund type
                <select
                  className="field"
                  onChange={(event) => setType(event.target.value as RefundType)}
                  value={type}
                >
                  <option value="FULL">Full remaining balance</option>
                  <option value="PARTIAL">Partial amount</option>
                </select>
              </label>
              {type === 'PARTIAL' ? (
                <label className="grid gap-1 text-sm font-medium">
                  Refund amount (AUD)
                  <input
                    className="field"
                    inputMode="decimal"
                    min="0.01"
                    onChange={(event) => setAmount(event.target.value)}
                    step="0.01"
                    type="number"
                    value={amount}
                  />
                  <span className="text-xs text-slate-500">
                    Maximum {formatRefundMoney(maximum, data.currency)}
                  </span>
                </label>
              ) : null}
              <label className="grid gap-1 text-sm font-medium">
                Reason
                <select
                  className="field"
                  onChange={(event) => setReason(event.target.value as RefundReason)}
                  value={reason}
                >
                  {refundReasons.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="button-primary"
                  disabled={action.isPending || approvalInvalid}
                  onClick={() =>
                    action.mutate({
                      name: 'approve',
                      body: {
                        type,
                        amountCents: type === 'PARTIAL' ? (partialAmount ?? undefined) : undefined,
                        reason,
                        internalNote: note || undefined,
                      },
                    })
                  }
                  type="button"
                >
                  Approve refund
                </button>
                <button
                  className="button-secondary"
                  disabled={action.isPending || !note.trim()}
                  onClick={() => action.mutate({ name: 'reject', body: { internalNote: note } })}
                  type="button"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}
          {canProcess ? (
            <button
              className="button-primary mt-5"
              onClick={() => setConfirmProcess(true)}
              type="button"
            >
              Process approved refund
            </button>
          ) : null}
          {canRetry ? (
            <button
              className="button-primary mt-5"
              onClick={() => setConfirmProcess(true)}
              type="button"
            >
              Retry failed refund
            </button>
          ) : null}
        </section>
      </div>
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Supporting Evidence</h2>
        <p className="mt-1 text-sm text-slate-600">
          Private files are available through short-lived authorized links.
        </p>
        <AttachmentList
          attachments={data.attachments ?? []}
          refundId={data.id}
          accessToken={accessToken}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <input
            accept={ACCEPTED_TYPES.join(',')}
            multiple
            onChange={(event) => setEvidenceFiles(Array.from(event.target.files ?? []).slice(0, 5))}
            type="file"
          />
          <button
            className="button-secondary"
            disabled={!evidenceFiles.length || uploadEvidence.isPending}
            onClick={() => uploadEvidence.mutate()}
            type="button"
          >
            {uploadEvidence.isPending ? 'Uploading…' : 'Upload supporting files'}
          </button>
        </div>
      </section>
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Audit timeline</h2>
        <ol className="mt-4 grid gap-3">
          {data.auditTimeline?.map((event) => (
            <li className="border-l-2 border-sky-300 pl-4" key={event.id}>
              <p className="font-semibold">{humanizeRefundValue(event.action)}</p>
              <p className="text-sm text-slate-600">
                {new Date(event.createdAt).toLocaleString('en-AU')} ·{' '}
                {event.actor?.displayName || event.actor?.email || 'System'}
              </p>
            </li>
          ))}
        </ol>
      </section>
      <AlertDialog onOpenChange={setConfirmProcess} open={confirmProcess}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This submits {formatRefundMoney(data.refundAmountCents, data.currency)} to Stripe for
              the original payment method. A webhook will confirm the final result.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={action.isPending}
              onClick={() => action.mutate({ name: canRetry ? 'retry' : 'process' })}
            >
              Confirm refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function AttachmentList({
  attachments,
  refundId,
  accessToken,
}: Readonly<{ attachments: RefundAttachment[]; refundId: string; accessToken: string | null }>) {
  if (!attachments.length)
    return <p className="mt-4 text-sm text-slate-500">No supporting evidence has been uploaded.</p>;
  return (
    <ul className="mt-4 grid gap-2">
      {attachments.map((attachment) => (
        <li
          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm"
          key={attachment.id}
        >
          <span className="min-w-0 flex-1 truncate">
            <strong>{attachment.originalName}</strong>
            <span className="ml-2 text-slate-500">
              {attachment.mimeType} · {formatBytes(attachment.fileSize)} ·{' '}
              {attachment.uploadedBy?.displayName ??
                attachment.uploadedBy?.email ??
                attachment.uploadedByRole}
            </span>
          </span>
          <AttachmentLink attachment={attachment} refundId={refundId} accessToken={accessToken} />
        </li>
      ))}
    </ul>
  );
}

function AttachmentLink({
  attachment,
  refundId,
  accessToken,
}: Readonly<{ attachment: RefundAttachment; refundId: string; accessToken: string | null }>) {
  const [pending, setPending] = useState(false);
  async function open() {
    setPending(true);
    try {
      const result = await apiRequest<{ url: string }>(
        `/admin/refunds/${refundId}/attachments/${attachment.id}/access`,
        {},
        accessToken,
      );
      window.open(absoluteApiUrl(result.url), '_blank', 'noopener,noreferrer');
    } finally {
      setPending(false);
    }
  }
  return (
    <button
      className="text-xs font-semibold text-sky-700 hover:underline"
      disabled={pending}
      onClick={() => void open()}
      type="button"
    >
      {pending ? 'Opening…' : 'View'}
    </button>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-all">{value}</dd>
    </div>
  );
}
function Status({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <p>{message}</p>
    </main>
  );
}
