import { describe, expect, it } from 'vitest';

import { categoryLabel, statusLabel, validateSupportFiles } from './support.types';

describe('support presentation rules', () => {
  it('uses customer-friendly category and waiting labels', () => {
    expect(categoryLabel('INTERNET_CONNECTION')).toBe('Internet / Connection');
    expect(statusLabel('WAITING_FOR_CUSTOMER', true)).toBe('Waiting for you');
    expect(statusLabel('WAITING_FOR_CUSTOMER', false)).toBe('Waiting for customer');
  });

  it('accepts safe files within the support limits', () => {
    const file = new File(['%PDF-1.7'], 'statement.pdf', {
      type: 'application/pdf',
    });
    expect(validateSupportFiles([file])).toBeNull();
  });

  it('rejects unsupported files and too many attachments', () => {
    const executable = new File(['unsafe'], 'run.exe', {
      type: 'application/x-msdownload',
    });
    expect(validateSupportFiles([executable])).toMatch(/Only images/);
    const pdf = new File(['pdf'], 'file.pdf', { type: 'application/pdf' });
    expect(validateSupportFiles([pdf, pdf, pdf, pdf])).toMatch(/up to 3/);
  });
});
