import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AddressSuggestion,
  CoverageResult,
  PublicCheckoutContext,
} from '../../features/coverage/coverage.types';
import { ApiError, apiRequest } from '../../lib/api/client';
import CheckoutPage from './page';

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});
vi.mock('../../features/auth/auth-provider', () => ({
  useAuth: () => ({ isLoading: false, user: null }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'planId' ? 'plan-id' : null) }),
}));

const apiRequestMock = vi.mocked(apiRequest);
const plan = {
  id: 'plan-id',
  name: 'Essential 50',
  description: null,
  downloadMbps: 50,
  uploadMbps: 20,
  monthlyCents: 6900,
};
const serviceSuggestion: AddressSuggestion = {
  selectionToken: 's'.repeat(43),
  formattedAddress: '1 North Terrace, Adelaide SA 5000, Australia',
  suburb: 'Adelaide',
  state: 'South Australia',
  stateCode: 'SA',
  postcode: '5000',
};
const checkoutContext: PublicCheckoutContext = {
  planId: plan.id,
  serviceAddress: {
    formattedAddress: serviceSuggestion.formattedAddress,
    suburb: 'Adelaide',
    stateCode: 'SA',
    postcode: '5000',
  },
  qualification: {
    technology: 'FTTP',
    maximumSpeedMbps: 1000,
    source: 'DATABASE_ESTIMATE',
    checkedAt: '2026-08-25T00:00:00.000Z',
  },
  expiresAt: '2026-08-25T00:30:00.000Z',
};
const coverage: CoverageResult = {
  available: true,
  status: 'AVAILABLE',
  message: 'Estimated service is available.',
  address: checkoutContext.serviceAddress,
  qualification: checkoutContext.qualification,
  plans: [plan],
  qualificationToken: 'q'.repeat(43),
};

function renderCheckout() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CheckoutPage />
    </QueryClientProvider>,
  );
}

async function advance(milliseconds = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe('guest checkout address verification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiRequestMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires and carries a trusted service qualification for a direct guest visit', async () => {
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/plans/public') return [plan] as never;
      if (path === '/payments/public-checkout-context' && options?.method !== 'POST') {
        throw new ApiError('Context expired.', 410);
      }
      if (path.startsWith('/coverage/address-suggestions')) {
        return { suggestions: [serviceSuggestion] } as never;
      }
      if (path === '/coverage/check') return coverage as never;
      if (path === '/payments/public-checkout-context' && options?.method === 'POST') {
        return checkoutContext as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderCheckout();
    await advance();
    expect(screen.getByText('Confirm where internet is required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue to secure payment' })).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Service street address' }), {
      target: { value: 'North Terrace' },
    });
    await advance(400);
    await advance();
    fireEvent.mouseDown(screen.getByRole('option'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm service availability' }));
    await advance();

    expect(screen.getByText('CONFIRMED SERVICE ADDRESS')).toBeInTheDocument();
    expect(screen.getByText(serviceSuggestion.formattedAddress)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeInTheDocument();
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/payments/public-checkout-context',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('submits independent trusted residential and billing tokens without address objects', async () => {
    let checkoutBody: Record<string, unknown> | null = null;
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/plans/public') return [plan] as never;
      if (path === '/payments/public-checkout-context' && !options?.method) {
        return checkoutContext as never;
      }
      if (path.startsWith('/coverage/address-suggestions')) {
        const residential = path.includes('Residential');
        const suggestion = {
          ...serviceSuggestion,
          selectionToken: (residential ? 'r' : 'b').repeat(43),
          formattedAddress: residential
            ? '2 Residential Road, Adelaide SA 5000, Australia'
            : '3 Billing Road, Adelaide SA 5000, Australia',
        };
        return { suggestions: [suggestion] } as never;
      }
      if (path === '/payments/public-plan-checkout-session') {
        checkoutBody = JSON.parse(String(options?.body)) as Record<string, unknown>;
        return new Promise<never>(() => undefined);
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderCheckout();
    await advance();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Residential address is the same as the confirmed service address',
      }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Billing address is the same as residential address' }),
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Residential street address' }), {
      target: { value: 'Residential' },
    });
    await advance(400);
    await advance();
    fireEvent.mouseDown(screen.getByRole('option'));

    fireEvent.change(screen.getByRole('combobox', { name: 'Billing street address' }), {
      target: { value: 'Billing' },
    });
    await advance(400);
    await advance();
    fireEvent.mouseDown(screen.getByRole('option'));

    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), {
      target: { value: 'New' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), {
      target: { value: 'Customer' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'new.customer@example.com' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Mobile' }), {
      target: { value: '0400000009' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the terms of service/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the privacy policy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));
    await advance();

    expect(checkoutBody).toEqual(
      expect.objectContaining({
        planId: plan.id,
        residentialSameAsService: false,
        residentialAddressToken: 'r'.repeat(43),
        billingSameAsResidential: false,
        billingAddressToken: 'b'.repeat(43),
      }),
    );
    expect(checkoutBody).not.toHaveProperty('residentialAddress');
    expect(checkoutBody).not.toHaveProperty('serviceAddress');
    expect(checkoutBody).not.toHaveProperty('billingAddress');
  });

  it('clears a hidden separate-address selection when same-as-service is restored', async () => {
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/plans/public') return [plan] as never;
      if (path === '/payments/public-checkout-context' && !options?.method) {
        return checkoutContext as never;
      }
      if (path.startsWith('/coverage/address-suggestions')) {
        return {
          suggestions: [
            {
              ...serviceSuggestion,
              selectionToken: 'r'.repeat(43),
              formattedAddress: '2 Residential Road, Adelaide SA 5000, Australia',
            },
          ],
        } as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderCheckout();
    await advance();
    const residentialSameCheckbox = screen.getByRole('checkbox', {
      name: 'Residential address is the same as the confirmed service address',
    });
    fireEvent.click(residentialSameCheckbox);
    fireEvent.change(screen.getByRole('combobox', { name: 'Residential street address' }), {
      target: { value: 'Residential' },
    });
    await advance(400);
    await advance();
    fireEvent.mouseDown(screen.getByRole('option'));
    fireEvent.click(residentialSameCheckbox);
    fireEvent.click(residentialSameCheckbox);

    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), {
      target: { value: 'New' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), {
      target: { value: 'Customer' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'new.customer@example.com' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Mobile' }), {
      target: { value: '0400000009' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the terms of service/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the privacy policy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));
    await advance();

    expect(
      screen.getByText('Select a residential address from the suggestions.'),
    ).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      '/payments/public-plan-checkout-session',
      expect.anything(),
    );
  });
});
