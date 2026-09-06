import { Role } from '@prisma/client';

import { billingReportPermissions, hasBillingReportPermission } from './billing-report-permissions';

describe('billing report permissions', () => {
  it('grants all report permissions to super administrators and administrators', () => {
    for (const permission of billingReportPermissions) {
      expect(hasBillingReportPermission(Role.SUPER_ADMIN, permission)).toBe(true);
      expect(hasBillingReportPermission(Role.ADMIN, permission)).toBe(true);
    }
  });

  it('does not grant financial report permissions to staff or customers by default', () => {
    expect(hasBillingReportPermission(Role.STAFF, 'billing.reports.view')).toBe(false);
    expect(hasBillingReportPermission(Role.CUSTOMER, 'billing.reports.view')).toBe(false);
  });
});
