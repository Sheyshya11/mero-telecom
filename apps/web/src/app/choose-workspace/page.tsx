'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { MeroTelecomLogo } from '../../components/brand/mero-telecom-logo';
import { hasRole, isMultiWorkspaceUser } from '../../features/auth/auth-navigation';
import { useAuth } from '../../features/auth/auth-provider';

const WORKSPACE_KEY = 'mero-telecom-workspace';

export default function ChooseWorkspacePage() {
  const { isLoading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) return router.replace('/login');
    if (isMultiWorkspaceUser(user)) return;
    router.replace(hasRole(user, 'CUSTOMER') ? '/customer/dashboard' : '/control-centre/dashboard');
  }, [isLoading, router, user]);

  if (isLoading || !user || !isMultiWorkspaceUser(user)) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-slate-600">
        Preparing your workspace…
      </main>
    );
  }

  function remember(workspace: 'CUSTOMER' | 'CONTROL_CENTRE') {
    window.sessionStorage.setItem(WORKSPACE_KEY, workspace);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 py-12">
      <section aria-labelledby="workspace-title" className="w-full max-w-3xl">
        <Link aria-label="Mero Telecom home" className="inline-flex" href="/">
          <MeroTelecomLogo alt="" preload size="compact" />
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-950" id="workspace-title">
          Choose how you want to continue
        </h1>
        <p className="mt-2 text-slate-600">
          Your selection changes the interface only. Your assigned roles continue to control every
          API request.
        </p>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <Link
            className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:border-sky-400 hover:shadow-md"
            href="/customer/dashboard"
            onClick={() => remember('CUSTOMER')}
          >
            <h2 className="text-xl font-semibold text-slate-950">Customer Portal</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Manage your own account, internet service, invoices and billing.
            </p>
          </Link>
          <Link
            className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:border-sky-400 hover:shadow-md"
            href="/control-centre/dashboard"
            onClick={() => remember('CONTROL_CENTRE')}
          >
            <h2 className="text-xl font-semibold text-slate-950">Staff Control Centre</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Manage customers and the business operations permitted by your internal role.
            </p>
          </Link>
        </div>
      </section>
    </main>
  );
}
