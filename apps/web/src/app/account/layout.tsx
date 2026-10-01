import { AuthRouteGuard } from '../../features/auth/auth-route-guard';
import { PortalShell } from '../../features/dashboard/portal-shell';

export default function AccountLayout({ children }: LayoutProps<'/account'>) {
  return (
    <AuthRouteGuard allowedRoles={['CUSTOMER', 'STAFF', 'ADMIN', 'SUPER_ADMIN']}>
      <PortalShell>{children}</PortalShell>
    </AuthRouteGuard>
  );
}
