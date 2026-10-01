import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiDownload } from './client';

describe('apiDownload', () => {
  const createObjectURL = vi.fn(() => 'blob:invoice-pdf');
  const revokeObjectURL = vi.fn();
  let click: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps a valid PDF Blob available until after the browser starts the download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('%PDF-1.7\ninvoice', {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        }),
      ),
    );

    await apiDownload('/invoices/me/invoice-id/pdf', 'token', 'invoice.pdf');

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:invoice-pdf');
  });

  it('does not download an empty response as a PDF', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
        ),
    );

    await expect(
      apiDownload('/invoices/me/invoice-id/pdf', 'token', 'invoice.pdf'),
    ).rejects.toMatchObject({
      message: 'The PDF download was empty. Please try again.',
      statusCode: 502,
    });
    expect(click).not.toHaveBeenCalled();
  });

  it('does not download a non-PDF success response with a PDF filename', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Not a PDF</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );

    await expect(
      apiDownload('/invoices/me/invoice-id/pdf', 'token', 'invoice.pdf'),
    ).rejects.toMatchObject({
      message: 'The downloaded file was not a valid PDF.',
      statusCode: 502,
    });
    expect(click).not.toHaveBeenCalled();
  });
});
