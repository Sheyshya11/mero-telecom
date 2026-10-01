import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const invoiceId = '6b34d995-21a6-4d36-8e28-1f465f93cc66';

describe('customer invoice PDF proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards an authenticated request to the customer-owned invoice endpoint', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(pdf, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="INV-2026-000001.pdf"',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = {
      headers: new Headers({ Authorization: 'Bearer customer-token' }),
    } as NextRequest;
    const response = await GET(request, { params: Promise.resolve({ invoiceId }) });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3001/api/v1/invoices/me/${invoiceId}/pdf`,
      {
        headers: { Accept: 'application/pdf', Authorization: 'Bearer customer-token' },
        cache: 'no-store',
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="INV-2026-000001.pdf"',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
  });

  it('rejects requests without an access token before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const request = { headers: new Headers() } as NextRequest;
    const response = await GET(request, { params: Promise.resolve({ invoiceId }) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: 'Authentication is required.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
