'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { getHomeRoute, hasRole } from './auth-navigation';
import { type AppRole, useAuth } from './auth-provider';

export function AuthRouteGuard({
  allowedRoles,
  children,
}: Readonly<{ allowedRoles: AppRole[]; children: React.ReactNode }>) {
  const { isLoading, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isAllowed = Boolean(user && hasRole(user, ...allowedRoles));

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      const currentPath = `${pathname}${window.location.search}`;
      router.replace(`/login?returnTo=${encodeURIComponent(currentPath)}`);
      return;
    }
    if (!hasRole(user, ...allowedRoles)) router.replace(getHomeRoute(user));
  }, [allowedRoles, isLoading, pathname, router, user]);

  if (isLoading || !isAllowed) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-600">
        Restoring your session…
      </main>
    );
  }

  return children;
}
