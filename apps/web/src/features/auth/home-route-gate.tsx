'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { MeroTelecomLogo } from '../../components/brand/mero-telecom-logo';
import { getHomeRoute } from './auth-navigation';
import { useAuth } from './auth-provider';

export function HomeRouteGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const { isLoading, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isWebsiteRoute = pathname === '/website';

  useEffect(() => {
    if (!isWebsiteRoute && !isLoading && user) router.replace(getHomeRoute(user));
  }, [isLoading, isWebsiteRoute, router, user]);

  if (!isWebsiteRoute && (isLoading || user)) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-sm text-slate-600">
        <div className="grid justify-items-center gap-5 text-center">
          <MeroTelecomLogo preload size="auth" />
          <p>Loading your workspace…</p>
        </div>
      </main>
    );
  }

  return children;
}
