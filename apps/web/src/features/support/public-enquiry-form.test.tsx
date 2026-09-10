import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicEnquiryForm } from './public-enquiry-form';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('../../lib/api/client', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../../lib/api/client')>();
  return { ...original, apiRequest: mocks.apiRequest };
});

describe('PublicEnquiryForm', () => {
  beforeEach(() => {
    mocks.apiRequest.mockResolvedValue({
      referenceNumber: 'MT-E-2026-00042',
      message: 'Thanks for contacting Mero Telecom.',
    });
  });

  it('submits a pre-sales enquiry without authentication and shows its reference', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PublicEnquiryForm />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Name *'), 'Jamie Prospect');
    await user.type(screen.getByLabelText('Email *'), 'jamie@example.test');
    await user.selectOptions(
      screen.getByLabelText('What do you need help with? *'),
      'ADDRESS_CHECK',
    );
    await user.type(screen.getByLabelText('Subject *'), 'Check my address');
    await user.type(
      screen.getByLabelText('Message *'),
      'Please check whether Mero Telecom is available at my address.',
    );
    await user.click(screen.getByRole('button', { name: 'Send Enquiry' }));

    expect(await screen.findByText('MT-E-2026-00042')).toBeInTheDocument();
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/support/public/enquiries',
      expect.objectContaining({ method: 'POST', headers: expect.any(Object) }),
    );
    expect(JSON.parse(mocks.apiRequest.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({
        name: 'Jamie Prospect',
        email: 'jamie@example.test',
        category: 'ADDRESS_CHECK',
      }),
    );
  });

  it('keeps invalid input on the client and does not call the API', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PublicEnquiryForm />
      </QueryClientProvider>,
    );
    await user.type(screen.getByLabelText('Email *'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Send Enquiry' }));
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
