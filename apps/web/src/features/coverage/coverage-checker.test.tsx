import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { CoverageChecker } from './coverage-checker';
import type { AddressSuggestion, CoverageResult } from './coverage.types';

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ user: null }),
}));
const routerPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

const apiRequestMock = vi.mocked(apiRequest);
const suggestions: AddressSuggestion[] = [
  {
    selectionToken: 'a'.repeat(43),
    formattedAddress: '1 North Terrace, Adelaide SA 5000, Australia',
    suburb: 'Adelaide',
    state: 'South Australia',
    stateCode: 'SA',
    postcode: '5000',
  },
  {
    selectionToken: 'b'.repeat(43),
    formattedAddress: '2 North Terrace, Adelaide SA 5000, Australia',
    suburb: 'Adelaide',
    state: 'South Australia',
    stateCode: 'SA',
    postcode: '5000',
  },
];
const available: CoverageResult = {
  available: true,
  status: 'AVAILABLE',
  message: 'Estimated availability. This is not official nbn confirmation.',
  address: {
    formattedAddress: suggestions[0].formattedAddress,
    suburb: 'Adelaide',
    stateCode: 'SA',
    postcode: '5000',
  },
  qualification: {
    technology: 'FTTP',
    maximumSpeedMbps: 100,
    source: 'DATABASE_ESTIMATE',
    checkedAt: '2026-08-25T00:00:00.000Z',
  },
  plans: [
    {
      id: 'plan-id',
      name: 'Essential 50',
      description: null,
      downloadMbps: 50,
      uploadMbps: 20,
      monthlyCents: 6900,
    },
  ],
  qualificationToken: 'q'.repeat(43),
};

function renderChecker() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CoverageChecker />
    </QueryClientProvider>,
  );
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function showSuggestions() {
  const input = screen.getByRole('combobox', { name: 'Australian street address' });
  fireEvent.change(input, { target: { value: 'North Terrace' } });
  await advance(400);
  await advance(0);
  expect(screen.getAllByRole('option')).toHaveLength(2);
  return input;
}

describe('CoverageChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    routerPush.mockClear();
    apiRequestMock.mockImplementation(async (path) => {
      if (path.startsWith('/coverage/address-suggestions')) return { suggestions } as never;
      if (path === '/coverage/check') return available as never;
      if (path === '/payments/public-checkout-context') {
        return {
          planId: 'plan-id',
          serviceAddress: available.address,
          qualification: available.qualification,
          expiresAt: '2026-08-25T00:30:00.000Z',
        } as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires three characters and debounces address lookup for 400 ms', async () => {
    renderChecker();
    const input = screen.getByRole('combobox', { name: 'Australian street address' });

    fireEvent.change(input, { target: { value: 'ab' } });
    await advance(400);
    expect(apiRequestMock).not.toHaveBeenCalled();
    expect(screen.getByText('Enter at least three characters.')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'abc' } });
    await advance(399);
    expect(apiRequestMock).not.toHaveBeenCalled();
    await advance(1);
    await advance(0);
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard navigation and requires a suggestion selection', async () => {
    renderChecker();
    const checkButton = screen.getByRole('button', { name: 'Check coverage' });
    expect(checkButton).toBeDisabled();
    const input = await showSuggestions();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue(suggestions[1].formattedAddress);
    expect(checkButton).toBeEnabled();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows loading and safe provider-error states', async () => {
    let rejectRequest: (reason: Error) => void = () => undefined;
    apiRequestMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    renderChecker();
    const input = screen.getByRole('combobox', { name: 'Australian street address' });
    fireEvent.change(input, { target: { value: 'Adelaide' } });
    await advance(400);
    expect(screen.getByText('Searching addresses…')).toBeInTheDocument();

    await act(async () => rejectRequest(new Error('provider details')));
    await advance(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Address suggestions are unavailable.');
    expect(screen.queryByText('provider details')).not.toBeInTheDocument();
  });

  it('displays compatible plans and clears a result when the address changes', async () => {
    renderChecker();
    const input = await showSuggestions();
    fireEvent.mouseDown(screen.getAllByRole('option')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Check coverage' }));
    await advance(0);

    expect(screen.getByText('Service is estimated to be available')).toBeInTheDocument();
    expect(screen.getByText('Essential 50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose plan' }));
    await advance(0);
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/payments/public-checkout-context',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(routerPush).toHaveBeenCalledWith('/checkout?planId=plan-id');

    fireEvent.change(input, { target: { value: 'Different address' } });
    expect(screen.queryByText('Service is estimated to be available')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check coverage' })).toBeDisabled();
  });

  it.each([
    ['COMING_SOON', 'Mero Telecom is coming soon'],
    ['OUTSIDE_OPERATING_REGION', 'Outside our current operating region'],
    ['MANUAL_REVIEW', 'This address needs manual review'],
  ] as const)('renders the %s outcome without orderable plans', async (status, title) => {
    apiRequestMock.mockImplementation(async (path) => {
      if (path.startsWith('/coverage/address-suggestions')) return { suggestions } as never;
      return { ...available, available: false, status, plans: [] } as never;
    });
    renderChecker();
    await showSuggestions();
    fireEvent.mouseDown(screen.getAllByRole('option')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Check coverage' }));
    await advance(0);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose plan' })).not.toBeInTheDocument();
  });
});
