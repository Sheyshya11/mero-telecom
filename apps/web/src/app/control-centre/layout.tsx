import { AuthRouteGuard } from '../../features/auth/auth-route-guard';
import { PortalShell } from '../../features/dashboard/portal-shell';

export default function ControlCentreLayout({ children }: LayoutProps<'/control-centre'>) {
  return (
    <AuthRouteGuard allowedRoles={['STAFF', 'ADMIN', 'SUPER_ADMIN']}>
      <PortalShell>{children}</PortalShell>
    </AuthRouteGuard>
  );
}
