export type CancellationTimelineStatus =
  | 'REQUESTED'
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'DISCONNECTION_PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVOKED';

export function CancellationTimeline({
  status,
  requestedAt,
  effectiveAt,
  completedAt,
}: Readonly<{
  status: CancellationTimelineStatus;
  requestedAt: string;
  effectiveAt: string;
  completedAt: string | null;
}>) {
  const requested = true;
  const scheduled = status === 'SCHEDULED';
  const processing = ['PROCESSING', 'DISCONNECTION_PENDING', 'COMPLETED', 'FAILED'].includes(
    status,
  );
  const completed = status === 'COMPLETED';
  return (
    <ol className="mt-5 space-y-4" aria-label="Cancellation progress">
      <TimelineItem
        complete={requested}
        label="Cancellation requested"
        detail={formatDateTime(requestedAt)}
      />
      {scheduled ? (
        <TimelineItem
          complete
          label="Cancellation scheduled"
          detail={`Service end: ${formatDate(effectiveAt)}`}
        />
      ) : (
        <TimelineItem
          complete={processing}
          label="Service cancellation processing"
          detail={processing ? 'Processing started' : 'Pending'}
        />
      )}
      <TimelineItem
        complete={completed}
        failed={status === 'FAILED'}
        label="Service cancellation"
        detail={
          completed
            ? `Completed ${formatDateTime(completedAt ?? effectiveAt)}`
            : status === 'FAILED'
              ? 'Operational review required'
              : 'Pending'
        }
      />
    </ol>
  );
}

function TimelineItem({
  complete,
  failed = false,
  label,
  detail,
}: Readonly<{ complete: boolean; failed?: boolean; label: string; detail: string }>) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-3">
      <span
        aria-hidden="true"
        className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
          failed
            ? 'bg-destructive-subtle text-destructive-foreground'
            : complete
              ? 'bg-success-subtle text-success-foreground'
              : 'bg-secondary text-muted-foreground/70'
        }`}
      >
        {failed ? '!' : complete ? '✓' : '○'}
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'long' }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
