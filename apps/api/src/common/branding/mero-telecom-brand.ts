import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const canonicalLogoRelativePath = 'apps/web/public/brand/mero-telecom-logo.jpg';

export function loadMeroTelecomLogo(): Buffer {
  const candidates = [
    resolve(process.cwd(), canonicalLogoRelativePath),
    resolve(process.cwd(), '..', 'web', 'public', 'brand', 'mero-telecom-logo.jpg'),
  ];
  const logoPath = candidates.find((candidate) => existsSync(candidate));
  if (!logoPath) {
    throw new Error(`Canonical Mero Telecom logo is unavailable at ${canonicalLogoRelativePath}.`);
  }
  return readFileSync(logoPath);
}
