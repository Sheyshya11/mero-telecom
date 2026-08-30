import { describe, expect, it } from 'vitest';

import {
  canAccessRoute,
  getDashboardRoute,
  getPostLoginRoute,
  isSafeInternalRedirect,
} from './auth-navigation';
import type { AppRole, SessionUser } from './auth-provider';

const user = (role: AppRole): SessionUser => ({ id: 'user-id', email: 'user@example.com', role });

describe('auth navigation', () => {
  it.each([
    ['CUSTOMER', '/customer/dashboard'],
    ['STAFF', '/staff/customers'],
    ['ADMIN', '/admin/dashboard'],
    ['SUPER_ADMIN', '/admin/dashboard'],
  ] as const)('maps %s to its supported home', (role, expected) => {
    expect(getDashboardRoute(role)).toBe(expected);
  });

  it('accepts only local return paths', () => {
    expect(isSafeInternalRedirect('/customer/invoices?year=2026')).toBe(true);
    expect(isSafeInternalRedirect('https://example.com')).toBe(false);
    expect(isSafeInternalRedirect('//example.com')).toBe(false);
    expect(isSafeInternalRedirect('/\\example.com')).toBe(false);
    expect(isSafeInternalRedirect('/login')).toBe(false);
    expect(isSafeInternalRedirect('/forgot-password')).toBe(false);
  });

  it('uses a return path only when the signed-in role may access it', () => {
    expect(getPostLoginRoute(user('CUSTOMER'), '/customer/invoices')).toBe('/customer/invoices');
    expect(getPostLoginRoute(user('CUSTOMER'), '/admin/dashboard')).toBe('/customer/dashboard');
    expect(getPostLoginRoute(user('STAFF'), '/staff/coverage')).toBe('/staff/coverage');
    expect(getPostLoginRoute(user('ADMIN'), '/staff/customers')).toBe('/staff/customers');
  });

  it('enforces protected route families and leaves public pages available', () => {
    expect(canAccessRoute('CUSTOMER', '/customer/profile')).toBe(true);
    expect(canAccessRoute('STAFF', '/customer/profile')).toBe(false);
    expect(canAccessRoute('ADMIN', '/admin/users')).toBe(true);
    expect(canAccessRoute('STAFF', '/admin/users')).toBe(false);
    expect(canAccessRoute('SUPER_ADMIN', '/staff/coverage')).toBe(true);
    expect(canAccessRoute('CUSTOMER', '/plans')).toBe(true);
  });
});
