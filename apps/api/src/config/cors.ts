import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function createCorsOptions(frontendUrl: string): CorsOptions {
  const trustedOrigin = new URL(frontendUrl).origin;

  return {
    credentials: true,
    origin(requestOrigin, callback) {
      callback(null, !requestOrigin || requestOrigin === trustedOrigin);
    },
  };
}
