import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CancellationTimeline } from './cancellation-timeline';

describe('CancellationTimeline', () => {
  const dates = {
    requestedAt: '2026-09-10T04:45:00.000Z',
    effectiveAt: '2026-10-09T00:00:00.000Z',
    completedAt: null,
  };

  it('shows a scheduled service end without claiming cancellation is complete', () => {
    render(<CancellationTimeline {...dates} status="SCHEDULED" />);

    expect(screen.getByText('Cancellation scheduled')).toBeInTheDocument();
    expect(screen.getByText(/Service end:/)).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText(/Completed/)).not.toBeInTheDocument();
  });

  it('marks a provider failure for operational review', () => {
    render(<CancellationTimeline {...dates} status="FAILED" />);

    expect(screen.getByText('Operational review required')).toBeInTheDocument();
  });
});
