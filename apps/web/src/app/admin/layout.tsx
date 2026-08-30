import { AuthRouteGuard } from '../../features/auth/auth-route-guard';

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthRouteGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']}>{children}</AuthRouteGuard>;
}
