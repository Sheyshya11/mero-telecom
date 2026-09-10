'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { absoluteApiUrl, ApiError, apiRequest } from '../../lib/api/client';
import { hasRole } from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import {
  formatInternalRequestDate,
  internalRequestLevelLabel,
  internalRequestTypeLabel,
  personLabel,
  type InternalRequestAttachment,
  type InternalRequest,
} from './internal-request.types';
import { InternalStatusBadge, PriorityBadge } from './internal-request-list';

type ReviewAction =
  | 'request-info'
  | 'approve'
  | 'reject'
  | 'resolve'
  | 'close'
  | 'escalate'
  | 'return-to-admin';

const reviewActions: Record<
  ReviewAction,
  { title: string; description: string; button: string; required: boolean }
> = {
  'request-info': {
    title: 'Request more information',
    description: 'Explain exactly what Staff needs to confirm.',
    button: 'Request Information',
    required: true,
  },
  approve: {
    title: 'Approve request',
    description: 'Approval records authorisation only; it will not execute the underlying action.',
    button: 'Approve Request',
    required: false,
  },
  reject: {
    title: 'Reject request',
    description: 'A rejection reason is required and will be visible to the Staff requester.',
    button: 'Reject Request',
    required: true,
  },
  resolve: {
    title: 'Resolve request',
    description:
      'Confirm what operational work was completed separately. This summary is kept in the private internal conversation.',
    button: 'Mark Resolved',
    required: true,
  },
  close: {
    title: 'Close request',
    description: 'Closing archives the internal conversation as read-only.',
    button: 'Close Request',
    required: false,
  },
  escalate: {
    title: 'Escalate to Super Admin',
    description:
      'Explain why this decision needs Super Admin authority. The same request and full history will continue.',
    button: 'Escalate Request',
    required: true,
  },
  'return-to-admin': {
    title: 'Return to Admin',
    description:
      'Provide clear direction for the Admin who will complete the operational follow-up.',
    button: 'Return to Admin',
    required: true,
  },
};

export function InternalRequestDetail({ requestNumber }: Readonly<{ requestNumber: string }>) {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [comment, setComment] = useState('');
  const [escalationNote, setEscalationNote] = useState('');
  const [escalationPriority, setEscalationPriority] = useState<'LOW' | 'NORMAL' | 'HIGH'>('HIGH');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const superAdminMode = Boolean(user && hasRole(user, 'SUPER_ADMIN'));
  const adminMode = Boolean(user && hasRole(user, 'ADMIN') && !superAdminMode);
  const staffMode = Boolean(user && hasRole(user, 'STAFF') && !adminMode && !superAdminMode);
  const permitted = adminMode || staffMode || superAdminMode;
  const mode = superAdminMode ? 'super-admin' : adminMode ? 'admin' : 'staff';
  const apiPrefix = `/${mode}/internal-requests`;
  const requestQuery = useQuery({
    queryKey: [`${mode}-internal-request`, requestNumber],
    queryFn: () => apiRequest<InternalRequest>(`${apiPrefix}/${requestNumber}`, {}, accessToken),
    enabled: Boolean(accessToken && permitted),
  });

  async function refresh(message: string) {
    setError(null);
    setNotice(message);
    setAction(null);
    setComment('');
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [`${mode}-internal-request`, requestNumber],
      }),
      queryClient.invalidateQueries({
        queryKey: [`${mode}-internal-requests`],
      }),
      queryClient.invalidateQueries({
        queryKey: [`${mode}-internal-request-summary`],
      }),
    ]);
  }

  function showError(cause: Error) {
    setNotice(null);
    setError(
      cause instanceof ApiError
        ? cause.message
        : "We couldn't update this internal request. Please try again.",
    );
  }

  const sendReply = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('body', reply.trim());
      files.forEach((file) => body.append('files', file));
      return apiRequest(
        `${apiPrefix}/${requestNumber}/messages`,
        { method: 'POST', body },
        accessToken,
      );
    },
    onSuccess: async () => {
      setReply('');
      setFiles([]);
      await refresh('Your message was sent.');
    },
    onError: async (cause) => {
      showError(cause);
      await requestQuery.refetch();
    },
  });
  const reviewAction = useMutation({
    mutationFn: ({ endpoint, comment: actionComment }: { endpoint: string; comment?: string }) =>
      apiRequest(
        `${apiPrefix}/${requestNumber}/${endpoint}`,
        {
          method: 'POST',
          body:
            endpoint === 'escalate'
              ? JSON.stringify({
                  reason: actionComment?.trim(),
                  priority: escalationPriority,
                  comment: escalationNote.trim() || undefined,
                })
              : actionComment === undefined
                ? undefined
                : JSON.stringify({ comment: actionComment.trim() || undefined }),
        },
        accessToken,
      ),
    onSuccess: async (_, variables) => {
      const messages: Record<string, string> = {
        take: 'This request is now assigned to you.',
        'start-review': 'Review started.',
        'request-info': 'More information was requested.',
        approve: 'The request was approved. No business action was executed automatically.',
        reject: 'The request was rejected.',
        resolve: 'The request was marked as resolved.',
        close: 'The request was closed.',
        escalate: 'The same request was escalated to Super Admin.',
        'return-to-admin': 'The request was returned to Admin.',
      };
      await refresh(messages[variables.endpoint] ?? 'The request was updated.');
    },
    onError: async (cause) => {
      showError(cause);
      await requestQuery.refetch();
    },
  });

  if (isLoading || requestQuery.isPending) return <DetailSkeleton />;
  if (!permitted) return <PageStatus message="You do not have access to Internal Requests." />;
  if (requestQuery.isError || !requestQuery.data) {
    return <PageStatus message="We couldn't load this internal request." />;
  }
  const data = requestQuery.data;
  const assignedMine = adminMode && data.assignedTo?.id === user?.id;
  const superAssignedMine = superAdminMode && data.superAdminAssignedTo?.id === user?.id;
  const staffReadOnly = staffMode && ['RESOLVED', 'CLOSED'].includes(data.status);
  const readOnly =
    data.status === 'CLOSED' ||
    staffReadOnly ||
    (superAdminMode && data.currentLevel !== 'SUPER_ADMIN');

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-6xl px-4 py-8 text-slate-950 sm:px-6 sm:py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-sm font-semibold tracking-wide text-sky-700">
            {data.requestNumber}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{data.title}</h1>
          <p className="mt-2 text-slate-600">
            {internalRequestTypeLabel(data.type)} · Created{' '}
            {formatInternalRequestDate(data.createdAt)}
          </p>
        </div>
        <Link className="button-secondary" href="/control-centre/internal-requests">
          Back to Internal Requests
        </Link>
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
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        aria-label="Internal request details"
      >
        <Summary label="Status">
          <InternalStatusBadge status={data.status} />
        </Summary>
        <Summary label="Priority">
          <PriorityBadge priority={data.priority} />
        </Summary>
        <Summary label="Currently with">
          <span className="font-semibold">{internalRequestLevelLabel(data.currentLevel)}</span>
        </Summary>
        <Summary label="Requested by">
          <span>{personLabel(data.requestedBy)}</span>
        </Summary>
        <Summary label="Assigned Admin">
          <span>{data.assignedTo ? personLabel(data.assignedTo) : 'Unassigned'}</span>
        </Summary>
        <Summary label="Next action">
          <span className="font-semibold">{nextActionLabel(data)}</span>
        </Summary>
        {data.currentLevel === 'SUPER_ADMIN' || data.escalatedAt ? (
          <Summary label="Super Admin">
            <span>
              {data.superAdminAssignedTo
                ? personLabel(data.superAdminAssignedTo)
                : 'Awaiting assignment'}
            </span>
          </Summary>
        ) : null}
      </section>

      {data.capabilities?.unavailableReason &&
      (data.currentLevel === 'SUPER_ADMIN' || data.status === 'MORE_INFO_REQUIRED') ? (
        <p className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>Workflow action required.</strong> {data.capabilities.unavailableReason}
        </p>
      ) : null}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Request</h2>
        <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
          {data.description}
        </p>
      </section>

      <RelatedRecords data={data} />

      {adminMode ? (
        <AdminControls
          action={action}
          assignedMine={assignedMine}
          comment={comment}
          data={data}
          pending={reviewAction.isPending}
          run={(endpoint, actionComment) =>
            reviewAction.mutate({ endpoint, comment: actionComment })
          }
          escalationNote={escalationNote}
          escalationPriority={escalationPriority}
          setAction={setAction}
          setComment={setComment}
          setEscalationNote={setEscalationNote}
          setEscalationPriority={setEscalationPriority}
        />
      ) : null}

      {superAdminMode ? (
        <SuperAdminControls
          action={action}
          assignedMine={superAssignedMine}
          comment={comment}
          data={data}
          pending={reviewAction.isPending}
          run={(endpoint, actionComment) =>
            reviewAction.mutate({ endpoint, comment: actionComment })
          }
          setAction={setAction}
          setComment={setComment}
        />
      ) : null}

      <section
        className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-6"
        aria-labelledby="internal-conversation-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold" id="internal-conversation-heading">
              Internal conversation
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Private between Staff and Administrators. Customers cannot access these messages.
            </p>
          </div>
          <span className="text-xs text-slate-500">{data.messages?.length ?? 0} messages</span>
        </div>
        {data.messages?.length ? (
          <ol className="mt-6 grid gap-4">
            {data.messages.map((message) => {
              const mine = message.sender.id === user?.id;
              return (
                <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`} key={message.id}>
                  <article
                    className={`max-w-3xl rounded-2xl border p-4 sm:p-5 ${mine ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white'}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 text-sm">
                      <strong>
                        {mine ? 'You' : personLabel(message.sender)} ·{' '}
                        {message.senderRole === 'SUPER_ADMIN'
                          ? 'Super Admin'
                          : message.senderRole === 'STAFF'
                            ? 'Staff'
                            : 'Admin'}
                      </strong>
                      <time className="text-xs text-slate-500" dateTime={message.createdAt}>
                        {formatInternalRequestDate(message.createdAt)}
                      </time>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                      {message.body}
                    </p>
                    {message.attachments?.length ? (
                      <ul className="mt-4 grid gap-2 border-t border-slate-200 pt-3">
                        {message.attachments.map((attachment) => (
                          <li key={attachment.id}>
                            <AttachmentButton
                              accessToken={accessToken}
                              apiPrefix={apiPrefix}
                              attachment={attachment}
                              requestNumber={requestNumber}
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
        ) : (
          <p className="mt-6 rounded-lg bg-white p-4 text-sm text-slate-600">
            No internal messages yet.
          </p>
        )}

        {readOnly ? (
          <p className="mt-6 rounded-lg bg-slate-200 p-4 text-sm text-slate-700">
            This request is read-only.
          </p>
        ) : adminMode && !data.capabilities?.canComment ? (
          <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            {data.currentLevel === 'SUPER_ADMIN'
              ? 'This request is with Super Admin. Review actions remain locked until it is returned.'
              : 'Take this request before sending an Admin reply.'}
          </p>
        ) : superAdminMode && !data.capabilities?.canComment ? (
          <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            Take this escalation before sending a Super Admin reply.
          </p>
        ) : (
          <form
            className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (reply.trim()) sendReply.mutate();
            }}
          >
            <label className="grid gap-2 text-sm font-semibold">
              Write an internal message
              <textarea
                className="field min-h-28 resize-y font-normal"
                maxLength={5000}
                onChange={(event) => setReply(event.target.value)}
                value={reply}
              />
            </label>
            <label className="mt-4 grid gap-2 text-sm font-semibold">
              Attach files (optional, up to 3)
              <input
                className="field font-normal"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 3))}
                type="file"
              />
            </label>
            <div className="mt-4 flex justify-end">
              <button
                className="button-primary"
                disabled={sendReply.isPending || !reply.trim()}
                type="submit"
              >
                {sendReply.isPending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </form>
        )}
      </section>

      <ActivityTimeline data={data} />
    </main>
  );
}

function AdminControls({
  action,
  assignedMine,
  comment,
  data,
  escalationNote,
  escalationPriority,
  pending,
  run,
  setAction,
  setComment,
  setEscalationNote,
  setEscalationPriority,
}: Readonly<{
  action: ReviewAction | null;
  assignedMine: boolean;
  comment: string;
  data: InternalRequest;
  escalationNote: string;
  escalationPriority: 'LOW' | 'NORMAL' | 'HIGH';
  pending: boolean;
  run: (endpoint: string, comment?: string) => void;
  setAction: (action: ReviewAction | null) => void;
  setComment: (comment: string) => void;
  setEscalationNote: (comment: string) => void;
  setEscalationPriority: (priority: 'LOW' | 'NORMAL' | 'HIGH') => void;
}>) {
  const capabilities = data.capabilities;
  const availableActions: Array<{ action: ReviewAction; label: string }> = [];
  if (capabilities?.canRequestInfo)
    availableActions.push({ action: 'request-info', label: 'Request More Information' });
  if (capabilities?.canApprove) availableActions.push({ action: 'approve', label: 'Approve' });
  if (capabilities?.canReject) availableActions.push({ action: 'reject', label: 'Reject' });
  if (capabilities?.canEscalate)
    availableActions.push({ action: 'escalate', label: 'Escalate to Super Admin' });
  if (capabilities?.canResolve) availableActions.push({ action: 'resolve', label: 'Resolve' });
  if (capabilities?.canClose) availableActions.push({ action: 'close', label: 'Close' });
  const actionDefinition = action ? reviewActions[action] : null;
  return (
    <section
      className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-label="Administrator actions"
    >
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="font-semibold">Administrator actions</h2>
          <p className="mt-1 text-sm text-slate-600">
            Decisions are audited and never execute the linked business action automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          {capabilities?.canStartReview ? (
            <button
              className="button-primary"
              disabled={pending}
              onClick={() => run('start-review')}
              type="button"
            >
              Start Review
            </button>
          ) : null}
          {assignedMine && data.currentLevel === 'ADMIN'
            ? availableActions.map((item) => (
                <button
                  className="button-secondary"
                  disabled={pending}
                  key={item.action}
                  onClick={() => {
                    setAction(item.action);
                    setComment('');
                  }}
                  type="button"
                >
                  {item.label}
                </button>
              ))
            : null}
        </div>
      </div>
      {data.assignedTo && !assignedMine ? (
        <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
          Owned by {personLabel(data.assignedTo)}. Only the assigned Administrator can act.
        </p>
      ) : null}
      {data.currentLevel === 'SUPER_ADMIN' ? (
        <p className="mt-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-900">
          Escalated to Super Admin. Admin controls are locked until the request is returned.
        </p>
      ) : null}
      {action && actionDefinition ? (
        <form
          className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!actionDefinition.required || comment.trim()) run(action, comment);
          }}
        >
          <h3 className="font-semibold">{actionDefinition.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{actionDefinition.description}</p>
          <label className="mt-4 grid gap-1.5 text-sm font-medium">
            {action === 'escalate'
              ? 'Reason for escalation (required)'
              : actionDefinition.required
                ? 'Comment (required)'
                : 'Comment (optional)'}
            <textarea
              className="field min-h-24 resize-y"
              maxLength={2000}
              onChange={(event) => setComment(event.target.value)}
              value={comment}
            />
          </label>
          {action === 'escalate' ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Escalation priority
                <select
                  className="field"
                  onChange={(event) =>
                    setEscalationPriority(event.target.value as 'LOW' | 'NORMAL' | 'HIGH')
                  }
                  value={escalationPriority}
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                Internal comment (optional)
                <textarea
                  className="field min-h-20 resize-y"
                  maxLength={2000}
                  onChange={(event) => setEscalationNote(event.target.value)}
                  value={escalationNote}
                />
              </label>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="button-secondary" onClick={() => setAction(null)} type="button">
              Cancel
            </button>
            <button
              className="button-primary"
              disabled={pending || (actionDefinition.required && !comment.trim())}
              type="submit"
            >
              {pending ? 'Updating…' : actionDefinition.button}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function SuperAdminControls({
  action,
  assignedMine,
  comment,
  data,
  pending,
  run,
  setAction,
  setComment,
}: Readonly<{
  action: ReviewAction | null;
  assignedMine: boolean;
  comment: string;
  data: InternalRequest;
  pending: boolean;
  run: (endpoint: string, comment?: string) => void;
  setAction: (action: ReviewAction | null) => void;
  setComment: (comment: string) => void;
}>) {
  const capabilities = data.capabilities;
  const available: Array<{ action: ReviewAction; label: string }> = [];
  if (capabilities?.canRequestInfo)
    available.push({ action: 'request-info', label: 'Request More Information' });
  if (capabilities?.canApprove) available.push({ action: 'approve', label: 'Approve' });
  if (capabilities?.canReject) available.push({ action: 'reject', label: 'Reject' });
  if (capabilities?.canReturnToAdmin) {
    available.push({ action: 'return-to-admin', label: 'Return to Admin' });
  }
  const definition = action ? reviewActions[action] : null;
  return (
    <section
      className="mt-6 rounded-xl border border-violet-200 bg-white p-5 shadow-sm"
      aria-label="Super Administrator actions"
    >
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="font-semibold">Super Administrator actions</h2>
          <p className="mt-1 text-sm text-slate-600">
            Decisions authorise work only. Linked billing, account, and service records remain
            unchanged.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {capabilities?.canTake ? (
            <button
              className="button-primary"
              disabled={pending}
              onClick={() => run('take')}
              type="button"
            >
              Take Escalation
            </button>
          ) : null}
          {capabilities?.canStartReview ? (
            <button
              className="button-primary"
              disabled={pending}
              onClick={() => run('start-review')}
              type="button"
            >
              Start Review
            </button>
          ) : null}
          {data.currentLevel === 'SUPER_ADMIN' && assignedMine
            ? available.map((item) => (
                <button
                  className="button-secondary"
                  disabled={pending}
                  key={item.action}
                  onClick={() => {
                    setAction(item.action);
                    setComment('');
                  }}
                  type="button"
                >
                  {item.label}
                </button>
              ))
            : null}
        </div>
      </div>
      {data.currentLevel === 'ADMIN' ? (
        <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
          This escalation was returned to Admin. Its context and timeline remain available here.
        </p>
      ) : data.superAdminAssignedTo && !assignedMine ? (
        <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
          Owned by {personLabel(data.superAdminAssignedTo)}. Only that Super Administrator can act.
        </p>
      ) : null}
      {action && definition ? (
        <form
          className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!definition.required || comment.trim()) run(action, comment);
          }}
        >
          <h3 className="font-semibold">{definition.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{definition.description}</p>
          <label className="mt-4 grid gap-1.5 text-sm font-medium">
            {definition.required ? 'Comment (required)' : 'Comment (optional)'}
            <textarea
              className="field min-h-24 resize-y"
              maxLength={2000}
              onChange={(event) => setComment(event.target.value)}
              value={comment}
            />
          </label>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="button-secondary" onClick={() => setAction(null)} type="button">
              Cancel
            </button>
            <button
              className="button-primary"
              disabled={pending || (definition.required && !comment.trim())}
              type="submit"
            >
              {pending ? 'Updating…' : definition.button}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ActivityTimeline({ data }: Readonly<{ data: InternalRequest }>) {
  if (!data.events?.length) return null;
  const labels: Record<NonNullable<InternalRequest['events']>[number]['eventType'], string> = {
    CREATED: 'created the request',
    ASSIGNED: 'took ownership',
    REVIEW_STARTED: 'started review',
    MESSAGE_SENT: 'sent an internal message',
    MORE_INFO_REQUESTED: 'requested more information',
    APPROVED: 'approved the request',
    REJECTED: 'rejected the request',
    ESCALATED: 'escalated the request to Super Admin',
    RETURNED: 'returned the request to Admin',
    RESOLVED: 'resolved the request',
    CLOSED: 'closed the request',
  };
  return (
    <section
      className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      aria-labelledby="activity-heading"
    >
      <h2 className="text-lg font-semibold" id="activity-heading">
        Internal activity
      </h2>
      <ol className="mt-5 border-l-2 border-slate-200 pl-5">
        {data.events.map((event) => (
          <li className="relative pb-5 last:pb-0" key={event.id}>
            <span className="absolute -left-[1.7rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-sky-600" />
            <p className="text-sm font-medium text-slate-900">
              {personLabel(event.actor)} {labels[event.eventType]}
            </p>
            {event.comment ? (
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{event.comment}</p>
            ) : null}
            <time className="mt-1 block text-xs text-slate-500" dateTime={event.createdAt}>
              {formatInternalRequestDate(event.createdAt)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function nextActionLabel(data: InternalRequest): string {
  if (data.status === 'CLOSED') return 'No further action';
  if (data.currentLevel === 'SUPER_ADMIN') {
    if (data.status === 'PENDING') return 'Super Admin to take and review';
    if (data.status === 'MORE_INFO_REQUIRED') return 'Staff or Admin to provide information';
    if (data.status === 'APPROVED' || data.status === 'REJECTED') {
      return 'Super Admin to return decision to Admin';
    }
    return 'Super Admin decision';
  }
  if (data.status === 'PENDING') return 'Admin to take and review';
  if (data.status === 'MORE_INFO_REQUIRED') return 'Staff to provide information';
  if (data.status === 'APPROVED') return 'Admin to complete and verify authorised work';
  if (data.status === 'REJECTED') return 'Admin to close or Staff to continue support';
  if (data.status === 'RESOLVED') return 'Admin to close';
  return 'Admin review';
}

function AttachmentButton({
  accessToken,
  apiPrefix,
  attachment,
  requestNumber,
}: Readonly<{
  accessToken: string | null;
  apiPrefix: string;
  attachment: InternalRequestAttachment;
  requestNumber: string;
}>) {
  const [opening, setOpening] = useState(false);
  return (
    <button
      className="text-left text-sm font-medium text-sky-700 hover:underline disabled:opacity-60"
      disabled={opening}
      onClick={async () => {
        setOpening(true);
        try {
          const result = await apiRequest<{ url: string }>(
            `${apiPrefix}/${requestNumber}/attachments/${attachment.id}/access`,
            {},
            accessToken,
          );
          window.open(absoluteApiUrl(result.url), '_blank', 'noopener,noreferrer');
        } finally {
          setOpening(false);
        }
      }}
      type="button"
    >
      {opening ? 'Opening…' : attachment.originalName} · {Math.ceil(attachment.fileSize / 1024)} KB
    </button>
  );
}

function RelatedRecords({ data }: Readonly<{ data: InternalRequest }>) {
  const related = [
    data.customer
      ? {
          label: 'Customer',
          value: `${data.customer.firstName} ${data.customer.lastName} · ${data.customer.customerNumber}`,
          href: `/control-centre/customers?search=${encodeURIComponent(data.customer.customerNumber)}`,
        }
      : null,
    data.supportCase
      ? {
          label: 'Support Case',
          value: `${data.supportCase.caseNumber} · ${data.supportCase.subject}`,
          href: `/control-centre/support/${data.supportCase.caseNumber}`,
        }
      : null,
    data.invoice
      ? {
          label: 'Invoice',
          value: `${data.invoice.invoiceNumber} · ${data.invoice.status}`,
          href: `/control-centre/invoices?search=${encodeURIComponent(data.invoice.invoiceNumber)}`,
        }
      : null,
    data.refund
      ? {
          label: 'Refund',
          value: `${data.refund.reason.replaceAll('_', ' ')} · ${data.refund.status}`,
          href: `/control-centre/refunds/${data.refund.id}`,
        }
      : null,
    data.subscription
      ? {
          label: 'Subscription',
          value: `${data.subscription.plan.name} · ${data.subscription.status}`,
          href: `/control-centre/services?search=${encodeURIComponent(data.subscription.plan.name)}`,
        }
      : null,
    data.payment
      ? {
          label: 'Payment',
          value: `${data.payment.providerPaymentId ?? 'Payment'} · ${data.payment.status}`,
        }
      : null,
    data.planChangeRequest
      ? {
          label: 'Plan change',
          value: `${data.planChangeRequest.type} to ${data.planChangeRequest.targetPlan.name} · ${data.planChangeRequest.status}`,
          href: `/control-centre/services?search=${encodeURIComponent(data.planChangeRequest.targetPlan.name)}`,
        }
      : null,
  ].filter((item): item is { label: string; value: string; href?: string } => Boolean(item));
  if (!related.length) return null;
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">Related records</h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {related.map((item) => (
          <div className="rounded-lg bg-slate-50 p-3" key={item.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {item.label}
            </dt>
            <dd className="mt-1 text-sm font-medium">
              {item.href ? (
                <Link className="text-sky-700 hover:underline" href={item.href}>
                  {item.value}
                </Link>
              ) : (
                item.value
              )}
            </dd>
          </div>
        ))}
      </dl>
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

function DetailSkeleton() {
  return (
    <main
      className="mx-auto min-h-screen max-w-6xl animate-pulse space-y-5 px-6 py-10 motion-reduce:animate-none"
      aria-label="Loading internal request"
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
