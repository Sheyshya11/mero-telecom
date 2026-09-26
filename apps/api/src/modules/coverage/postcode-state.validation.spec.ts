import { validatePostcodeForState } from './postcode-state.validation';

describe('validatePostcodeForState', () => {
  it.each([
    ['0200', 'ACT'],
    ['2000', 'NSW'],
    ['0800', 'NT'],
    ['4000', 'QLD'],
    ['5000', 'SA'],
    ['7000', 'TAS'],
    ['3000', 'VIC'],
    ['6000', 'WA'],
  ])('accepts postcode %s for supported state %s', (postcode, stateCode) => {
    expect(validatePostcodeForState(postcode, stateCode)).toBe(true);
  });

  it.each(['50A0', '500', '50000'])('rejects invalid postcode format %s', (postcode) => {
    expect(validatePostcodeForState(postcode, 'SA')).toBe(false);
  });

  it('rejects a postcode/state mismatch', () => {
    expect(validatePostcodeForState('2000', 'SA')).toBe(false);
  });

  it('preserves and validates leading-zero postcodes as strings', () => {
    expect(validatePostcodeForState('0800', 'NT')).toBe(true);
  });

  it('rejects unsupported state codes', () => {
    expect(validatePostcodeForState('5000', 'XX')).toBe(false);
  });
});
