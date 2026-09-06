import { AuthRouteGuard } from '../../features/auth/auth-route-guard';
import { PortalShell } from '../../features/dashboard/portal-shell';

export default function StaffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthRouteGuard allowedRoles={['STAFF', 'ADMIN', 'SUPER_ADMIN']}>
      <PortalShell>{children}</PortalShell>
    </AuthRouteGuard>
  );
}
