import { describe, expect, it } from 'vitest';

import {
  canAccessRoute,
  getDashboardRoute,
  getPostLoginRoute,
  isSafeInternalRedirect,
} from './auth-navigation';
import type { AppRole, SessionUser } from './auth-provider';

const user = (role: AppRole, roles: AppRole[] = [role]): SessionUser => ({
  id: 'user-id',
  email: 'user@example.com',
  role,
  roles,
});

describe('auth navigation', () => {
  it.each([
    ['CUSTOMER', '/customer/dashboard'],
    ['STAFF', '/control-centre/dashboard'],
    ['ADMIN', '/control-centre/dashboard'],
    ['SUPER_ADMIN', '/control-centre/dashboard'],
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
    expect(canAccessRoute(user('CUSTOMER'), '/customer/profile')).toBe(true);
    expect(canAccessRoute(user('STAFF'), '/customer/profile')).toBe(false);
    expect(canAccessRoute(user('ADMIN'), '/admin/users')).toBe(true);
    expect(canAccessRoute(user('STAFF'), '/admin/users')).toBe(false);
    expect(canAccessRoute(user('SUPER_ADMIN'), '/staff/coverage')).toBe(true);
    expect(canAccessRoute(user('CUSTOMER'), '/plans')).toBe(true);
    expect(canAccessRoute(user('STAFF', ['CUSTOMER', 'STAFF']), '/customer/invoices')).toBe(true);
    expect(canAccessRoute(user('STAFF', ['CUSTOMER', 'STAFF']), '/control-centre/customers')).toBe(
      true,
    );
  });

  it('requires workspace selection for a customer with an internal role', () => {
    expect(getPostLoginRoute(user('STAFF', ['CUSTOMER', 'STAFF']), null)).toBe('/choose-workspace');
  });
});
