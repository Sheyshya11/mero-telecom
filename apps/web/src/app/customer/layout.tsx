import { AuthRouteGuard } from '../../features/auth/auth-route-guard';
import { PortalShell } from '../../features/dashboard/portal-shell';

export default function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthRouteGuard allowedRoles={['CUSTOMER']}>
      <PortalShell>{children}</PortalShell>
    </AuthRouteGuard>
  );
}
