import { Role } from '@prisma/client';

export const billingReportPermissions = [
  'billing.reports.view',
  'billing.reports.export',
  'billing.reports.financial-summary.view',
  'billing.reconciliation.view',
  'billing.refunds.view',
  'billing.tax-reports.view',
] as const;

export type BillingReportPermission = (typeof billingReportPermissions)[number];

/** Roles are the current grant source; this boundary is ready for per-user grants later. */
export function hasBillingReportPermission(
  role: Role,
  permission: BillingReportPermission,
): boolean {
  if (role === Role.SUPER_ADMIN) return true;
  if (role !== Role.ADMIN) return false;
  return permission !== 'billing.reconciliation.view' || role === Role.ADMIN;
}
