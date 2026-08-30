import { AuthRouteGuard } from '../../features/auth/auth-route-guard';

export default function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthRouteGuard allowedRoles={['CUSTOMER']}>{children}</AuthRouteGuard>;
}
