import type { NextConfig } from 'next';

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
const isVercelBuild = process.env.VERCEL === '1';

if (isVercelBuild && !configuredApiUrl) {
  throw new Error('NEXT_PUBLIC_API_URL is required for Vercel builds.');
}

const apiUrl = new URL(configuredApiUrl ?? 'http://localhost:3001/api/v1');
if (
  isVercelBuild &&
  apiUrl.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(apiUrl.hostname)
) {
  throw new Error('NEXT_PUBLIC_API_URL must use HTTPS for Vercel deployments.');
}

const apiOrigin = apiUrl.origin;
const developmentScriptPolicy = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${developmentScriptPolicy}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${apiOrigin}`,
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
