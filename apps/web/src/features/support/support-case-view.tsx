'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { absoluteApiUrl, ApiError, apiRequest } from '../../lib/api/client';
import { hasRole } from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import { StatusBadge } from './customer-support';
import {
  acceptedSupportFileTypes,
  categoryLabel,
  formatSupportDate,
  validateSupportFiles,
  type SupportAttachment,
  type SupportCase,
  type SupportPriority,
  type SupportStatus,
} from './support.types';

export function SupportCaseView({
  caseNumber,
  mode,
  basePath,
}: Readonly<{
  caseNumber: string;
  mode: 'customer' | 'staff';
  basePath: '/customer/support' | '/control-centre/support' | '/staff/support';
}>) {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [customerNumber, setCustomerNumber] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const permitted = Boolean(
    user &&
    (mode === 'customer'
      ? hasRole(user, 'CUSTOMER')
      : hasRole(user, 'STAFF', 'ADMIN', 'SUPER_ADMIN')),
  );
  const apiPath = `/${mode === 'customer' ? 'customer' : 'staff'}/support/${caseNumber}`;
  const supportCase = useQuery({
    queryKey: [mode, 'support-case', caseNumber],
    queryFn: () => apiRequest<SupportCase>(apiPath, {}, accessToken),
    enabled: Boolean(accessToken && permitted),
  });
  const refresh = async (message: string) => {
    setError(null);
    setNotice(message);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [mode, 'support-case', caseNumber] }),
      queryClient.invalidateQueries({ queryKey: [`${mode}-support`] }),
      queryClient.invalidateQueries({ queryKey: ['staff-support-summary'] }),
    ]);
  };
  const sendReply = useMutation({
    mutationFn: () => {
      if (mode === 'staff' && internalNote) {
        return apiRequest(
          `${apiPath}/internal-notes`,
          { method: 'POST', body: JSON.stringify({ body: reply.trim() }) },
          accessToken,
        );
      }
      const body = new FormData();
      body.append('body', reply.trim());
      files.forEach((file) => body.append('files', file));
      return apiRequest(`${apiPath}/messages`, { method: 'POST', body }, accessToken);
    },
    onSuccess: async () => {
      setReply('');
      setFiles([]);
      setFileError(null);
      await refresh(internalNote ? 'Internal note added.' : 'Your reply was recorded.');
    },
    onError: async (cause) => {
      showError(cause);
      await supportCase.refetch();
    },
  });
  const staffAction = useMutation({
    mutationFn: ({
      endpoint,
      method = 'POST',
      body,
    }: {
      endpoint: string;
      method?: 'POST' | 'PATCH';
      body?: object;
    }) =>
      apiRequest(
        `${apiPath}/${endpoint}`,
        { method, body: body ? JSON.stringify(body) : undefined },
        accessToken,
      ),
    onSuccess: async (_, variables) => {
      const message =
        variables.endpoint === 'take'
          ? 'This request is now assigned to you.'
          : variables.endpoint === 'resolve'
            ? 'The support request was resolved.'
            : 'The support request was updated.';
      await refresh(message);
    },
    onError: async (cause) => {
      showError(cause);
      await supportCase.refetch();
    },
  });
  const linkCustomer = useMutation({
    mutationFn: () =>
      apiRequest(
        `${apiPath}/link-customer`,
        { method: 'POST', body: JSON.stringify({ customerNumber: customerNumber.trim() }) },
        accessToken,
      ),
    onSuccess: async () => {
      setCustomerNumber('');
      await refresh('The verified customer was linked and the original enquiry history was kept.');
    },
    onError: async (cause) => {
      showError(cause);
      await supportCase.refetch();
    },
  });

  function showError(cause: Error) {
    setNotice(null);
    setError(
      cause instanceof ApiError
        ? cause.message
        : mode === 'customer'
          ? "We couldn't send your reply. Please try again."
          : "We couldn't update this support request. Please try again.",
    );
  }

  if (isLoading || supportCase.isPending) return <CaseSkeleton />;
  if (!permitted) return <PageStatus message="You do not have access to this support request." />;
  if (supportCase.isError || !supportCase.data) {
    return <PageStatus message="We couldn't load this support request." />;
  }
  const data = supportCase.data;
  const readOnly = data.status === 'CLOSED';

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-6xl px-4 py-8 text-slate-950 sm:px-6 sm:py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-sm font-semibold tracking-wide text-sky-700">
            {data.caseNumber}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{data.subject}</h1>
          <p className="mt-2 text-slate-600">
            {categoryLabel(data.category)} · Created {formatSupportDate(data.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === 'staff' &&
          user &&
          hasRole(user, 'STAFF') &&
          !data.workflow?.blockingInternalRequests.length ? (
            <Link
              className="button-primary"
              href={`/control-centre/internal-requests/new?supportCase=${encodeURIComponent(data.caseNumber)}${data.customer ? `&customerId=${encodeURIComponent(data.customer.id)}` : ''}`}
            >
              Request Admin Action
            </Link>
          ) : null}
          <Link className="button-secondary" href={basePath}>
            Back to support
          </Link>
        </div>
      </header>

      {notice ? (
        <p className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-5 rounded-lg bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      <section
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Support request details"
      >
        <Summary label="Status">
          <StatusBadge customer={mode === 'customer'} status={data.status} />
        </Summary>
        <Summary label="Priority">
          <span className="font-semibold capitalize">{data.priority.toLowerCase()}</span>
        </Summary>
        <Summary label="Last updated">
          <span>{formatSupportDate(data.updatedAt)}</span>
        </Summary>
        <Summary label="Assigned to">
          <span>
            {data.assignedTo?.displayName ||
              (mode === 'staff' ? data.assignedTo?.email : null) ||
              'Unassigned'}
          </span>
        </Summary>
      </section>

      {mode === 'staff' ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {data.requestType === 'PROSPECT_ENQUIRY' ? 'Prospective customer' : 'Customer'}
              </p>
              <p className="mt-2 font-semibold">
                {data.requestType === 'PROSPECT_ENQUIRY'
                  ? data.prospectName
                  : `${data.customer?.firstName ?? ''} ${data.customer?.lastName ?? ''}`.trim()}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {data.requestType === 'PROSPECT_ENQUIRY'
                  ? data.prospectEmail
                  : data.customer?.email}
                {data.prospectPhone || data.customer?.phone
                  ? ` · ${data.prospectPhone || data.customer?.phone}`
                  : ''}
              </p>
              {data.prospectAddress ? (
                <p className="mt-1 text-sm text-slate-600">{data.prospectAddress}</p>
              ) : null}
              {data.requestType === 'PROSPECT_ENQUIRY' && data.customer ? (
                <p className="mt-3 text-xs font-medium text-emerald-700">
                  Linked to verified customer {data.customer.firstName} {data.customer.lastName}
                  {data.linkedCustomerAt ? ` on ${formatSupportDate(data.linkedCustomerAt)}` : ''}.
                </p>
              ) : null}
            </div>
            {data.requestType === 'PROSPECT_ENQUIRY' && !data.customer ? (
              <form
                className="w-full max-w-sm rounded-lg bg-slate-50 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (customerNumber.trim().length >= 3) linkCustomer.mutate();
                }}
              >
                <label className="grid gap-1.5 text-sm font-semibold">
                  Link a verified customer
                  <input
                    className="field font-normal"
                    maxLength={32}
                    onChange={(event) => setCustomerNumber(event.target.value)}
                    placeholder="Customer number"
                    value={customerNumber}
                  />
                </label>
                <p className="mt-2 text-xs text-slate-500">
                  Verify identity first. Email matching never links an account automatically.
                </p>
                <button
                  className="button-secondary mt-3"
                  disabled={linkCustomer.isPending || customerNumber.trim().length < 3}
                  type="submit"
                >
                  {linkCustomer.isPending ? 'Linking…' : 'Link customer'}
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      {mode === 'staff' && data.workflow?.resolutionBlockedReason ? (
        <section
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">
            Awaiting{' '}
            {data.workflow.blockingInternalRequests[0]?.currentLevel === 'SUPER_ADMIN'
              ? 'Super Admin'
              : 'Admin'}{' '}
            review
          </p>
          <p className="mt-1">{data.workflow.resolutionBlockedReason}</p>
          <p className="mt-2 text-amber-800">
            You can continue the conversation, but this ticket cannot be resolved or closed until
            the internal workflow is complete.
          </p>
          {data.workflow.blockingInternalRequests[0] ? (
            <Link
              className="mt-3 inline-flex font-semibold text-amber-950 underline underline-offset-2"
              href={`/control-centre/internal-requests/${data.workflow.blockingInternalRequests[0].requestNumber}`}
            >
              Review {data.workflow.blockingInternalRequests[0].requestNumber}
            </Link>
          ) : null}
        </section>
      ) : null}

      {mode === 'staff' ? (
        <StaffControls
          data={data}
          pending={staffAction.isPending}
          run={(endpoint, method, body) => staffAction.mutate({ endpoint, method, body })}
        />
      ) : null}

      <section
        className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-6"
        aria-labelledby="conversation-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold" id="conversation-heading">
              Conversation
            </h2>
            <p className="mt-1 text-sm text-slate-600">Messages are shown oldest first.</p>
          </div>
          <span className="text-xs text-slate-500">{data.messages?.length ?? 0} messages</span>
        </div>
        <ol className="mt-6 grid gap-4">
          {data.messages?.map((message) => {
            const fromCustomer = message.senderRole === 'CUSTOMER';
            const isInternal = message.visibility === 'INTERNAL';
            const ownSide = mode === 'customer' ? fromCustomer : !fromCustomer;
            const senderLabel =
              mode === 'customer'
                ? fromCustomer
                  ? 'You'
                  : 'Mero Telecom Support'
                : fromCustomer
                  ? data.requestType === 'PROSPECT_ENQUIRY'
                    ? data.prospectName || 'Prospective customer'
                    : `${data.customer?.firstName ?? 'Customer'} ${data.customer?.lastName ?? ''}`.trim()
                  : 'You / Mero Telecom Support';
            return (
              <li className={`flex ${ownSide ? 'justify-end' : 'justify-start'}`} key={message.id}>
                <article
                  className={`max-w-3xl rounded-2xl border p-4 sm:p-5 ${isInternal ? 'border-amber-200 bg-amber-50' : ownSide ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white'}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 text-sm">
                    <strong>{isInternal ? `${senderLabel} · Internal note` : senderLabel}</strong>
                    <time className="text-xs text-slate-500" dateTime={message.createdAt}>
                      {formatSupportDate(message.createdAt)}
                    </time>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                    {message.body}
                  </p>
                  {mode === 'staff' && message.emailDeliveryStatus !== 'NOT_APPLICABLE' ? (
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      Email: {message.emailDeliveryStatus.toLowerCase()}
                    </p>
                  ) : null}
                  {message.attachments.length ? (
                    <ul className="mt-4 grid gap-2 border-t border-slate-200 pt-3">
                      {message.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          <AttachmentButton
                            accessToken={accessToken}
                            apiPath={apiPath}
                            attachment={attachment}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ol>

        {readOnly ? (
          <p className="mt-6 rounded-lg bg-slate-200 p-4 text-sm text-slate-700">
            This support request is closed and the conversation is read-only.
          </p>
        ) : (
          <form
            className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              const validationError = validateSupportFiles(files);
              setFileError(validationError);
              if (!reply.trim()) setError('Write a reply before sending.');
              else if (!validationError) sendReply.mutate();
            }}
          >
            {mode === 'staff' ? (
              <div className="mb-4 flex gap-2" role="group" aria-label="Message visibility">
                <button
                  className={internalNote ? 'button-secondary' : 'button-primary'}
                  onClick={() => setInternalNote(false)}
                  type="button"
                >
                  Reply to {data.requestType === 'PROSPECT_ENQUIRY' ? 'prospect' : 'customer'}
                </button>
                <button
                  className={internalNote ? 'button-primary' : 'button-secondary'}
                  onClick={() => {
                    setInternalNote(true);
                    setFiles([]);
                    setFileError(null);
                  }}
                  type="button"
                >
                  Internal note
                </button>
              </div>
            ) : null}
            <label className="grid gap-2 text-sm font-semibold">
              {internalNote ? 'Write an internal note' : 'Write a reply'}
              <textarea
                className="field min-h-28 resize-y font-normal"
                maxLength={5000}
                onChange={(event) => setReply(event.target.value)}
                value={reply}
              />
            </label>
            <div className="mt-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
              {!internalNote && data.requestType !== 'PROSPECT_ENQUIRY' ? (
                <label className="grid max-w-xl gap-1.5 text-sm font-medium">
                  Attach files (optional)
                  <input
                    accept={acceptedSupportFileTypes.join(',')}
                    className="field"
                    multiple
                    onChange={(event) => {
                      const selected = Array.from(event.target.files ?? []);
                      setFiles(selected);
                      setFileError(validateSupportFiles(selected));
                    }}
                    type="file"
                  />
                  <span className="text-xs font-normal text-slate-500">
                    Up to 3 safe image, PDF, or Word files.
                  </span>
                  {fileError ? (
                    <span className="text-xs font-normal text-rose-700">{fileError}</span>
                  ) : null}
                </label>
              ) : (
                <span />
              )}
              <button
                className="button-primary shrink-0"
                disabled={sendReply.isPending || !reply.trim()}
                type="submit"
              >
                {sendReply.isPending
                  ? 'Saving…'
                  : internalNote
                    ? 'Add Internal Note'
                    : 'Send Reply'}
              </button>
            </div>
          </form>
        )}
      </section>

      {mode === 'staff' && data.activity?.length ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">Activity</h2>
          <ol className="mt-5 border-l border-slate-200 pl-5">
            {data.activity.map((event) => (
              <li className="relative pb-5 last:pb-0" key={event.id}>
                <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-sky-600" />
                <p className="text-sm font-medium">{activityLabel(event.action)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {event.actorName} · {formatSupportDate(event.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}

function StaffControls({
  data,
  pending,
  run,
}: Readonly<{
  data: SupportCase;
  pending: boolean;
  run: (endpoint: string, method?: 'POST' | 'PATCH', body?: object) => void;
}>) {
  const [resolutionSummary, setResolutionSummary] = useState('');
  const capabilities = data.capabilities;
  const nextActions: Array<{ label: string; status: SupportStatus }> = [];
  if (capabilities?.canSetWaitingForCustomer)
    nextActions.push({
      label:
        data.requestType === 'PROSPECT_ENQUIRY' ? 'Waiting for Prospect' : 'Waiting for Customer',
      status: 'WAITING_FOR_CUSTOMER',
    });
  if (capabilities?.canReopen)
    nextActions.push({ label: 'Reopen / In Progress', status: 'IN_PROGRESS' });
  return (
    <section
      className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-label="Staff actions"
    >
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="font-semibold">Staff actions</h2>
          <p className="mt-1 text-sm text-slate-600">
            Assignment and status changes are recorded in the audit log.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {capabilities?.canTake ? (
            <button
              className="button-primary"
              disabled={pending}
              onClick={() => run('take')}
              type="button"
            >
              Take Request
            </button>
          ) : null}
          {nextActions.map((action) => (
            <button
              className="button-secondary"
              disabled={pending}
              key={action.status}
              onClick={() => run('status', 'PATCH', { status: action.status })}
              type="button"
            >
              {action.label}
            </button>
          ))}
          {capabilities?.canClose ? (
            <button
              className="button-secondary"
              disabled={pending}
              onClick={() => run('status', 'PATCH', { status: 'CLOSED' })}
              type="button"
            >
              Close Request
            </button>
          ) : null}
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Priority
            <select
              className="field py-2 text-sm"
              disabled={pending || !capabilities?.canChangePriority}
              onChange={(event) =>
                run('priority', 'PATCH', { priority: event.target.value as SupportPriority })
              }
              value={data.priority}
            >
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
            </select>
          </label>
        </div>
      </div>
      {capabilities?.canResolve ? (
        <form
          className="mt-5 grid gap-3 border-t border-slate-100 pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (resolutionSummary.trim()) {
              run('resolve', 'POST', { resolutionNote: resolutionSummary.trim() });
            }
          }}
        >
          <label className="grid gap-1.5 text-sm font-semibold">
            {data.requestType === 'PROSPECT_ENQUIRY'
              ? 'Prospect-facing resolution summary'
              : 'Customer-facing resolution summary'}
            <textarea
              className="field min-h-24 resize-y font-normal"
              maxLength={2000}
              onChange={(event) => setResolutionSummary(event.target.value)}
              placeholder="Explain what was completed and the outcome for the customer."
              value={resolutionSummary}
            />
          </label>
          <div className="flex justify-end">
            <button
              className="button-primary"
              disabled={pending || resolutionSummary.trim().length < 3}
              type="submit"
            >
              {pending ? 'Resolving…' : 'Resolve Request'}
            </button>
          </div>
        </form>
      ) : capabilities?.resolutionBlockedReason ? (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Resolution unavailable.</strong> {capabilities.resolutionBlockedReason}
        </p>
      ) : null}
      {data.customer ? (
        <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
          <strong className="text-slate-900">Customer:</strong> {data.customer.firstName}{' '}
          {data.customer.lastName} · {data.customer.email} · {data.customer.phone}
        </p>
      ) : null}
    </section>
  );
}

function Summary({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 text-sm">{children}</div>
    </article>
  );
}

function AttachmentButton({
  attachment,
  apiPath,
  accessToken,
}: Readonly<{ attachment: SupportAttachment; apiPath: string; accessToken: string | null }>) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function open() {
    setPending(true);
    setFailed(false);
    try {
      const result = await apiRequest<{ url: string }>(
        `${apiPath}/attachments/${attachment.id}/access`,
        {},
        accessToken,
      );
      window.open(absoluteApiUrl(result.url), '_blank', 'noopener,noreferrer');
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <button
      className="text-left text-xs font-semibold text-sky-700 hover:underline"
      disabled={pending}
      onClick={() => void open()}
      type="button"
    >
      {pending
        ? 'Opening…'
        : failed
          ? 'Try attachment again'
          : `${attachment.originalName} · ${formatBytes(attachment.fileSize)}`}
    </button>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    PROSPECT_ENQUIRY_CREATED: 'Enquiry submitted from the website',
    SUPPORT_CASE_CREATED: 'Customer support request created',
    SUPPORT_CASE_ASSIGNED: 'Request assigned',
    SUPPORT_CUSTOMER_REPLIED: 'Customer replied',
    SUPPORT_STAFF_REPLIED: 'Support replied',
    SUPPORT_INTERNAL_NOTE_ADDED: 'Internal note added',
    SUPPORT_STATUS_CHANGED: 'Status changed',
    SUPPORT_PRIORITY_CHANGED: 'Priority changed',
    SUPPORT_CASE_RESOLVED: 'Request resolved',
    PROSPECT_ENQUIRY_LINKED_TO_CUSTOMER: 'Enquiry linked to a verified customer',
    EMAIL_DELIVERY_SENT: 'Email delivered to the mail provider',
    EMAIL_DELIVERY_FAILED: 'Email delivery failed',
  };
  return labels[action] ?? action.replaceAll('_', ' ').toLowerCase();
}

function CaseSkeleton() {
  return (
    <main
      className="mx-auto min-h-screen max-w-6xl animate-pulse space-y-5 px-6 py-10 motion-reduce:animate-none"
      aria-label="Loading support request"
    >
      <div className="h-24 rounded-xl bg-slate-100" />
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="h-24 rounded-xl bg-slate-100" key={index} />
        ))}
      </div>
      <div className="h-96 rounded-xl bg-slate-100" />
    </main>
  );
}

function PageStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <p>{message}</p>
    </main>
  );
}
