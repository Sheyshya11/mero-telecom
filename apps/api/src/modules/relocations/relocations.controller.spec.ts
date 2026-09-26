import { Role } from '@prisma/client';

import { ROLES_KEY } from '../../common/constants/authorization.constants';
import { RelocationsController, SubscriptionRelocationsController } from './relocations.controller';

function rolesFor(target: object, method: string): Role[] {
  return Reflect.getMetadata(
    ROLES_KEY,
    Object.getOwnPropertyDescriptor(target, method)?.value,
  ) as Role[];
}

describe('Relocation controller authorization', () => {
  it('limits customer qualification and creation to the customer role', () => {
    expect(rolesFor(SubscriptionRelocationsController.prototype, 'qualify')).toEqual([
      Role.CUSTOMER,
    ]);
    expect(rolesFor(SubscriptionRelocationsController.prototype, 'create')).toEqual([
      Role.CUSTOMER,
    ]);
  });

  it('allows staff and admins to inspect relocations but reserves retry for admins', () => {
    expect(rolesFor(RelocationsController.prototype, 'list')).toEqual([Role.STAFF, Role.ADMIN]);
    expect(rolesFor(RelocationsController.prototype, 'findOne')).toEqual([
      Role.CUSTOMER,
      Role.STAFF,
      Role.ADMIN,
    ]);
    expect(rolesFor(RelocationsController.prototype, 'retry')).toEqual([Role.ADMIN]);
    expect(rolesFor(RelocationsController.prototype, 'retryProvisioning')).toEqual([Role.ADMIN]);
    expect(rolesFor(RelocationsController.prototype, 'retryDisconnection')).toEqual([Role.ADMIN]);
    expect(rolesFor(RelocationsController.prototype, 'addNote')).toEqual([Role.STAFF, Role.ADMIN]);
  });

  it('reserves workflow overrides and escalation resolution for Super Admin', () => {
    expect(rolesFor(RelocationsController.prototype, 'override')).toEqual([Role.SUPER_ADMIN]);
    expect(rolesFor(RelocationsController.prototype, 'resolveEscalation')).toEqual([
      Role.SUPER_ADMIN,
    ]);
  });
});
