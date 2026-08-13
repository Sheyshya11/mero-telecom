import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { TrustedOriginGuard } from './trusted-origin.guard';

function context(origin?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { origin } }) }),
  } as unknown as ExecutionContext;
}

describe('TrustedOriginGuard', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue({ frontendUrl: 'http://localhost:3000' }),
  };
  const guard = new TrustedOriginGuard(config as never);

  it('allows the configured frontend origin and non-browser clients', () => {
    expect(guard.canActivate(context('http://localhost:3000'))).toBe(true);
    expect(guard.canActivate(context())).toBe(true);
  });

  it('rejects an untrusted browser origin', () => {
    expect(() => guard.canActivate(context('https://evil.example'))).toThrow(ForbiddenException);
  });
});
