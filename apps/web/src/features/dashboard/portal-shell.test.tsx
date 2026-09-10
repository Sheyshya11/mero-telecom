import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppRole } from '../auth/auth-provider';
import { PortalShell } from './portal-shell';

const mocks = vi.hoisted(() => ({
  pathname: '/staff/customers',
  role: 'STAFF' as AppRole,
  logout: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({
    user: { role: mocks.role, email: 'viewer@example.test' },
    logout: mocks.logout,
  }),
}));

describe('PortalShell navigation', () => {
  beforeEach(() => {
    mocks.role = 'STAFF';
    mocks.pathname = '/staff/customers';
  });

  it('keeps staff navigation inside staff routes and exposes highlights and refunds', () => {
    render(
      <PortalShell>
        <main>Customer records</main>
      </PortalShell>,
    );
    const nav = within(screen.getByRole('navigation'));
    expect(screen.getByRole('link', { name: 'Mero Telecom dashboard' })).toContainElement(
      document.querySelector('img[src="/brand/mero-telecom-logo.jpg"]'),
    );
    expect(nav.getByRole('link', { name: 'Plan highlights' })).toHaveAttribute(
      'href',
      '/staff/plans',
    );
    expect(nav.getByRole('link', { name: 'Refunds' })).toHaveAttribute('href', '/staff/refunds');
    expect(nav.getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page');
    for (const link of nav.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/staff\//);
    }
    expect(screen.getByText('Customer records')).toBeInTheDocument();
  });

  it('keeps the refund tab active on a detail route', () => {
    mocks.pathname = '/staff/refunds/request-id';
    render(
      <PortalShell>
        <main>Refund detail</main>
      </PortalShell>,
    );
    expect(
      within(screen.getByRole('navigation')).getByRole('link', { name: 'Refunds' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('provides all operational links for %s', (role) => {
    mocks.role = role;
    mocks.pathname = '/admin/plans';
    render(
      <PortalShell>
        <main>Plan editor</main>
      </PortalShell>,
    );
    const nav = within(screen.getByRole('navigation'));
    expect(nav.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/admin/users');
    expect(nav.getByRole('link', { name: 'Plans' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/admin/dashboard');
  });

  it('provides only customer account links to customers', () => {
    mocks.role = 'CUSTOMER';
    mocks.pathname = '/customer/invoices';
    render(
      <PortalShell>
        <main>My invoices</main>
      </PortalShell>,
    );
    const nav = within(screen.getByRole('navigation'));
    expect(nav.getByRole('link', { name: 'My Internet' })).toHaveAttribute(
      'href',
      '/customer/subscription',
    );
    expect(nav.getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');
    for (const link of nav.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/customer\//);
    }
  });
});
