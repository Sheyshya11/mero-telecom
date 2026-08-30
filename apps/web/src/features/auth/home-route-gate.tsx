'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { getDashboardRoute } from './auth-navigation';
import { useAuth } from './auth-provider';

export function HomeRouteGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const { isLoading, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isWebsiteRoute = pathname === '/website';

  useEffect(() => {
    if (!isWebsiteRoute && !isLoading && user) router.replace(getDashboardRoute(user.role));
  }, [isLoading, isWebsiteRoute, router, user]);

  if (!isWebsiteRoute && (isLoading || user)) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-600">
        Loading Mero Telecom…
      </main>
    );
  }

  return children;
}
