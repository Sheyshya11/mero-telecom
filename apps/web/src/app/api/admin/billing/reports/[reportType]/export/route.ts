const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const reportTypes = new Set([
  'revenue',
  'invoices',
  'payments',
  'receivables',
  'refunds',
  'subscriptions',
  'reconciliation',
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ reportType: string }> },
): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return Response.json({ message: 'Authentication is required.' }, { status: 401, headers });
  }
  const { reportType } = await context.params;
  if (!reportTypes.has(reportType)) {
    return Response.json({ message: 'Invalid report type.' }, { status: 400, headers });
  }

  const upstreamUrl = new URL(
    `${apiUrl.replace(/\/+$/, '')}/admin/billing/reports/${reportType}/export`,
  );
  upstreamUrl.search = new URL(request.url).search;
  try {
    // Keep browser downloads on the web origin. The API still validates the
    // access token and reporting permissions before generating any export.
    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { Accept: request.headers.get('accept') ?? '*/*', Authorization: authorization },
      cache: 'no-store',
    });
    const responseHeaders = new Headers(headers);
    // This response is consumed by fetch; the client creates the downloadable
    // Blob. Attachment/PDF headers here let download-manager extensions consume
    // the response before JavaScript receives it.
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    responseHeaders.set('Content-Type', upstream.ok ? 'application/octet-stream' : contentType);
    if (upstream.ok) responseHeaders.set('X-Report-Content-Type', contentType);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json(
      { message: 'The report service could not be reached. Please try again.' },
      { status: 502, headers },
    );
  }
}
