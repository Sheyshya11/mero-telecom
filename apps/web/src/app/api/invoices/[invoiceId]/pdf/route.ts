import type { NextRequest } from 'next/server';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return Response.json({ message: 'Authentication is required.' }, { status: 401 });
  }

  const { invoiceId } = await context.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)
  ) {
    return Response.json({ message: 'A valid invoice identifier is required.' }, { status: 400 });
  }

  const upstream = await fetch(`${apiUrl}/invoices/${invoiceId}/pdf`, {
    headers: { Accept: 'application/pdf', Authorization: authorization },
    cache: 'no-store',
  });
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
  });
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) headers.set('Content-Disposition', disposition);

  return new Response(upstream.body, { status: upstream.status, headers });
}
