export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export function absoluteApiUrl(path: string): string {
  const base = new URL(apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`);
  const relativePath = path.replace(/^\/+/, '');
  const basePath = base.pathname.replace(/^\/+|\/+$/g, '');

  // API endpoints passed by the client are relative to `/api/v1`, while
  // locally signed attachment links already include that prefix. Handle
  // both forms without allowing URL resolution to drop or duplicate it.
  if (basePath && (relativePath === basePath || relativePath.startsWith(`${basePath}/`))) {
    return new URL(`/${relativePath}`, base.origin).toString();
  }
  return new URL(relativePath, base).toString();
}

type RefreshAccessToken = () => Promise<string | null>;
let refreshAccessToken: RefreshAccessToken | null = null;

export function setAccessTokenRefreshHandler(handler: RefreshAccessToken | null): void {
  refreshAccessToken = handler;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
  retryUnauthorized = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  if (options.body && !(typeof FormData !== 'undefined' && options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  if (response.status === 401 && accessToken && retryUnauthorized && refreshAccessToken) {
    const renewedToken = await refreshAccessToken();
    if (renewedToken) return apiRequest<T>(path, options, renewedToken, false);
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const responseMessage =
      typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
    const message =
      typeof responseMessage === 'string'
        ? responseMessage
        : Array.isArray(responseMessage) &&
            responseMessage.every((item) => typeof item === 'string')
          ? responseMessage.join(' ')
          : 'The request could not be completed.';
    throw new ApiError(message, response.status);
  }

  return body as T;
}

export async function apiDownload(
  path: string,
  accessToken: string,
  suggestedFilename: string,
  retryUnauthorized = true,
): Promise<void> {
  const response = await fetch(`/api${path}`, {
    headers: { Accept: 'application/pdf', Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });

  if (response.status === 401 && retryUnauthorized && refreshAccessToken) {
    const renewedToken = await refreshAccessToken();
    if (renewedToken) return apiDownload(path, renewedToken, suggestedFilename, false);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new ApiError(body?.message ?? 'The file could not be downloaded.', response.status);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new ApiError('The PDF download was empty. Please try again.', 502);
  }
  if (
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  ) {
    throw new ApiError('The downloaded file was not a valid PDF.', 502);
  }

  const blob = new Blob([bytes], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = suggestedFilename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
}
