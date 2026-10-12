import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

function request(query = 'format=pdf', authorization = 'Bearer admin-token') {
  return new Request(`http://localhost:3000/api/admin/billing/reports/revenue/export?${query}`, {
    headers: authorization ? { Authorization: authorization } : {},
  });
}
const context = { params: Promise.resolve({ reportType: 'revenue' }) };

afterEach(() => vi.unstubAllGlobals());

describe('billing report export proxy', () => {
  it.each([
    ['pdf', 'application/pdf', '%PDF-1.3\nreport'],
    ['csv', 'text/csv', 'Period,Amount\n2026-10,7900'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK workbook'],
  ])(
    'streams %s exports with the original filters and browser-safe transfer headers',
    async (format, contentType, body) => {
      const disposition = `attachment; filename="revenue-2026-10.${format}"`;
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(body, {
          headers: { 'Content-Type': contentType, 'Content-Disposition': disposition },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const query = `preset=custom&from=2026-10-01&to=2026-10-11&search=Home+plan&format=${format}`;
      const response = await GET(request(query), context);
      expect(fetchMock).toHaveBeenCalledWith(
        `http://localhost:3001/api/v1/admin/billing/reports/revenue/export?${query}`,
        { headers: { Accept: '*/*', Authorization: 'Bearer admin-token' }, cache: 'no-store' },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('x-report-content-type')).toBe(contentType);
      // Download-manager extensions must not consume the fetch response as an attachment.
      expect(response.headers.get('content-disposition')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).toBe(body);
    },
  );

  it('does not contact the API without authentication', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request('format=pdf', ''), context);
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid report paths before contacting the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request(), {
      params: Promise.resolve({ reportType: '../customers' }),
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 500])('preserves API errors with status %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message: 'API export error' }, { status })),
    );
    const response = await GET(request(), context);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ message: 'API export error' });
  });

  it('returns a useful error when the reporting API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const response = await GET(request(), context);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message: 'The report service could not be reached. Please try again.',
    });
  });
});
