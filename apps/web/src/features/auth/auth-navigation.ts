import type { AppRole, SessionUser } from './auth-provider';

export const PUBLIC_WEBSITE_ROUTE = '/website';

const ROLE_HOME: Record<AppRole, string> = {
  CUSTOMER: '/customer/dashboard',
  STAFF: '/staff/customers',
  ADMIN: '/admin/dashboard',
  SUPER_ADMIN: '/admin/dashboard',
};

export function getDashboardRoute(role: AppRole): string {
  return ROLE_HOME[role];
}

export function getHomeRoute(user: SessionUser | null): string {
  return user ? getDashboardRoute(user.role) : '/';
}

export function isSafeInternalRedirect(value: string | null): value is string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return false;

  try {
    const parsed = new URL(value, 'https://merotelecom.invalid');
    return (
      parsed.origin === 'https://merotelecom.invalid' &&
      !parsed.pathname.startsWith('/login') &&
      !parsed.pathname.startsWith('/forgot-password')
    );
  } catch {
    return false;
  }
}

export function canAccessRoute(role: AppRole, pathname: string): boolean {
  if (pathname === '/customer' || pathname.startsWith('/customer/')) return role === 'CUSTOMER';
  if (pathname === '/staff' || pathname.startsWith('/staff/')) {
    return role === 'STAFF' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
  }
  return true;
}

export function getPostLoginRoute(user: SessionUser, returnTo: string | null): string {
  if (isSafeInternalRedirect(returnTo)) {
    const pathname = new URL(returnTo, 'https://merotelecom.invalid').pathname;
    if (canAccessRoute(user.role, pathname)) return returnTo;
  }
  return getDashboardRoute(user.role);
}
