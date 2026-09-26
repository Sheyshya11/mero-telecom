export const AUSTRALIAN_STATE_CODES = [
  'ACT',
  'NSW',
  'NT',
  'QLD',
  'SA',
  'TAS',
  'VIC',
  'WA',
] as const;

export type AustralianStateCode = (typeof AUSTRALIAN_STATE_CODES)[number];

type PostcodeRange = readonly [minimum: number, maximum: number];

// Australia Post allocates ordinary delivery and postal-box ranges by state.
// This intentionally stays local and range-based: it is suitable for demo data
// validation, but is not a service-qualification source.
const POSTCODE_RANGES: Record<AustralianStateCode, readonly PostcodeRange[]> = {
  ACT: [
    [200, 299],
    [2600, 2618],
    [2900, 2920],
  ],
  NSW: [
    [1000, 2599],
    [2619, 2899],
    [2921, 2999],
  ],
  NT: [
    [800, 899],
    [900, 999],
  ],
  QLD: [
    [4000, 4999],
    [9000, 9999],
  ],
  SA: [
    [5000, 5799],
    [5800, 5999],
  ],
  TAS: [
    [7000, 7799],
    [7800, 7999],
  ],
  VIC: [
    [3000, 3999],
    [8000, 8999],
  ],
  WA: [
    [6000, 6797],
    [6800, 6999],
  ],
};

export function isAustralianStateCode(value: string): value is AustralianStateCode {
  return (AUSTRALIAN_STATE_CODES as readonly string[]).includes(value);
}

export function validatePostcodeForState(postcode: string, stateCode: string): boolean {
  if (!/^\d{4}$/.test(postcode) || !isAustralianStateCode(stateCode)) return false;

  const numericPostcode = Number(postcode);
  return POSTCODE_RANGES[stateCode].some(
    ([minimum, maximum]) => numericPostcode >= minimum && numericPostcode <= maximum,
  );
}
