'use client';
import { useState } from 'react';
export function RequestReviewControls({
  kind,
  busy,
  onDecision,
}: {
  kind: 'Cancellation' | 'Move';
  busy: boolean;
  onDecision: (
    decision: 'approve' | 'reject',
    body: { reviewNotes?: string; reason?: string },
  ) => void;
}) {
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  return (
    <section
      className="my-5 rounded-xl border border-warning-border bg-warning-subtle p-5"
      aria-label={`${kind} employee review`}
    >
      <h3 className="font-semibold">Awaiting employee review</h3>
      <p className="mt-2 text-sm">
        Approval allows operational processing to begin. Rejection keeps the existing service
        unchanged.
      </p>
      <label className="mt-4 block text-sm">
        Internal review notes
        <textarea
          className="field mt-1 w-full"
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <button
        className="button-primary mt-3"
        disabled={busy}
        type="button"
        onClick={() => onDecision('approve', { reviewNotes: notes.trim() || undefined })}
      >
        Approve {kind}
      </button>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && reason.trim().length >= 3)
            onDecision('reject', { reason: reason.trim(), reviewNotes: notes.trim() || undefined });
        }}
      >
        <label className="block text-sm">
          Customer-safe rejection reason
          <textarea
            className="field mt-1 w-full"
            required
            minLength={3}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <button
          className="button-secondary mt-3"
          disabled={busy || reason.trim().length < 3}
          type="submit"
        >
          Reject Request
        </button>
      </form>
    </section>
  );
}
