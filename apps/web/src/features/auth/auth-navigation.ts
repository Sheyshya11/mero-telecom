import type { AppRole, SessionUser } from './auth-provider';

export const PUBLIC_WEBSITE_ROUTE = '/website';

const ROLE_HOME: Record<AppRole, string> = {
  CUSTOMER: '/customer/dashboard',
  STAFF: '/control-centre/dashboard',
  ADMIN: '/control-centre/dashboard',
  SUPER_ADMIN: '/control-centre/dashboard',
};

export function hasRole(user: Pick<SessionUser, 'roles' | 'role'>, ...roles: AppRole[]): boolean {
  return (user.roles ?? [user.role]).some((role) => roles.includes(role));
}

export function isMultiWorkspaceUser(user: SessionUser): boolean {
  return hasRole(user, 'CUSTOMER') && hasRole(user, 'STAFF', 'ADMIN', 'SUPER_ADMIN');
}

export function getDashboardRoute(role: AppRole): string {
  return ROLE_HOME[role];
}

export function getHomeRoute(user: SessionUser | null): string {
  if (!user) return '/';
  return isMultiWorkspaceUser(user) ? '/choose-workspace' : getDashboardRoute(user.role);
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

export function canAccessRoute(user: SessionUser, pathname: string): boolean {
  if (pathname === '/customer' || pathname.startsWith('/customer/'))
    return hasRole(user, 'CUSTOMER');
  if (pathname === '/control-centre' || pathname.startsWith('/control-centre/')) {
    return hasRole(user, 'STAFF', 'ADMIN', 'SUPER_ADMIN');
  }
  if (pathname === '/staff' || pathname.startsWith('/staff/')) {
    return hasRole(user, 'STAFF', 'ADMIN', 'SUPER_ADMIN');
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return hasRole(user, 'ADMIN', 'SUPER_ADMIN');
  }
  return true;
}

export function getPostLoginRoute(user: SessionUser, returnTo: string | null): string {
  if (isSafeInternalRedirect(returnTo)) {
    const pathname = new URL(returnTo, 'https://merotelecom.invalid').pathname;
    if (canAccessRoute(user, pathname)) return returnTo;
  }
  return getHomeRoute(user);
}
