const stateNames = new Map<string, string>([
  ['act', 'ACT'],
  ['australian capital territory', 'ACT'],
  ['nsw', 'NSW'],
  ['new south wales', 'NSW'],
  ['nt', 'NT'],
  ['northern territory', 'NT'],
  ['qld', 'QLD'],
  ['queensland', 'QLD'],
  ['sa', 'SA'],
  ['south australia', 'SA'],
  ['tas', 'TAS'],
  ['tasmania', 'TAS'],
  ['vic', 'VIC'],
  ['victoria', 'VIC'],
  ['wa', 'WA'],
  ['western australia', 'WA'],
]);

export function normalizeAustralianStateCode(
  stateCode: string | null | undefined,
  stateName: string | null | undefined,
): string | null {
  for (const value of [stateCode, stateName]) {
    const normalized = value?.trim().toLowerCase();
    if (normalized && stateNames.has(normalized)) return stateNames.get(normalized) ?? null;
  }
  return null;
}
