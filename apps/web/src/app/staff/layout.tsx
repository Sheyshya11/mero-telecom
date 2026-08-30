import { AuthRouteGuard } from '../../features/auth/auth-route-guard';

export default function StaffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthRouteGuard allowedRoles={['STAFF', 'ADMIN', 'SUPER_ADMIN']}>{children}</AuthRouteGuard>
  );
}
