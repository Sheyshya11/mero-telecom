import { CancellationType, Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CustomerCancellationsController } from './cancellations.controller';

describe('CustomerCancellationsController', () => {
  it('forces a multi-role actor through customer ownership context', () => {
    const cancellations = { preview: jest.fn() };
    const controller = new CustomerCancellationsController(cancellations as never);
    const actor: AuthenticatedUser = {
      id: 'user-id',
      email: 'user@example.test',
      role: Role.ADMIN,
      roles: [Role.ADMIN, Role.CUSTOMER],
    };

    controller.preview(
      '42db7bed-11d5-4c16-a014-f9bad329ecbd',
      { type: CancellationType.IMMEDIATE },
      actor,
    );

    expect(cancellations.preview).toHaveBeenCalledWith(
      '42db7bed-11d5-4c16-a014-f9bad329ecbd',
      CancellationType.IMMEDIATE,
      expect.objectContaining({ role: Role.CUSTOMER, id: actor.id }),
    );
  });
});
