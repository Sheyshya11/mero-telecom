const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

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

  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${apiUrl}${path}`, {
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
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
        ? body.message
        : 'The request could not be completed.';
    throw new ApiError(message, response.status);
  }

  return body as T;
}
