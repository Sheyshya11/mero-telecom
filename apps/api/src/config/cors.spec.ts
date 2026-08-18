import { createCorsOptions } from './cors';

describe('CORS configuration', () => {
  const corsOptions = createCorsOptions('https://app.example.com/path');

  async function isAllowed(origin: string | undefined): Promise<boolean> {
    if (typeof corsOptions.origin !== 'function') throw new Error('Expected a CORS delegate.');

    return new Promise<boolean>((resolve, reject) => {
      corsOptions.origin?.(origin, (error, allowed) => {
        if (error) reject(error);
        else resolve(Boolean(allowed));
      });
    });
  }

  it('allows the configured normalized origin and credentialed requests', async () => {
    await expect(isAllowed('https://app.example.com')).resolves.toBe(true);
    expect(corsOptions.credentials).toBe(true);
  });

  it('does not grant CORS permission to another origin', async () => {
    await expect(isAllowed('https://untrusted.example.com')).resolves.toBe(false);
  });

  it('allows requests without an Origin header', async () => {
    await expect(isAllowed(undefined)).resolves.toBe(true);
  });
});
