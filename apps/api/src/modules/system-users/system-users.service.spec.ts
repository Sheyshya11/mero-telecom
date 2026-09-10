import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import { SystemUserPolicyService } from './system-user-policy.service';
import { SystemUsersService } from './system-users.service';

const now = Math.floor(Date.now() / 1000);
const superAdmin = {
  id: 'actor-super',
  email: 'owner@example.com',
  role: Role.SUPER_ADMIN,
  authenticatedAt: now,
};
const admin = { id: 'actor-admin', email: 'admin@example.com', role: Role.ADMIN };
const context = { requestId: 'request-123' };
const staffUser = {
  id: 'target-staff',
  displayName: 'Staff User',
  email: 'staff@example.com',
  role: Role.STAFF,
  status: UserStatus.ACTIVE,
  isActive: true,
  emailVerifiedAt: new Date(),
  passwordHash: 'hash',
  createdAt: new Date(),
  customer: null,
};

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: {
      findUnique: jest.fn().mockResolvedValue(staffUser),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...staffUser,
          ...data,
          roles: data.roles?.create
            ? [
                ...(staffUser.role === Role.CUSTOMER ? [{ role: Role.CUSTOMER }] : []),
                { role: data.roles.create.role },
              ]
            : [{ role: staffUser.role }],
        }),
      ),
    },
    refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

function serviceFor(tx: ReturnType<typeof transaction>) {
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue({ enhancedAuthMaxAgeSeconds: 600 }),
  };
  const policy = new SystemUserPolicyService(config as never);
  return {
    prisma,
    service: new SystemUsersService(prisma as unknown as PrismaService, policy),
  };
}

describe('SystemUsersService', () => {
  it('blocks staff and administrators from assigning privileged roles', async () => {
    const { service } = serviceFor(transaction());
    await expect(
      service.changeRole(
        staffUser.id,
        { role: Role.ADMIN },
        { ...admin, role: Role.STAFF },
        context,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.changeRole(staffUser.id, { role: Role.ADMIN }, admin, context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks self role changes and audits the attempt', async () => {
    const tx = transaction();
    tx.user.findUnique.mockResolvedValue({
      ...staffUser,
      id: superAdmin.id,
      role: Role.SUPER_ADMIN,
    });
    const { prisma, service } = serviceFor(tx);
    await expect(
      service.changeRole(superAdmin.id, { role: Role.ADMIN }, superAdmin, context),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'SYSTEM_ROLE_CHANGE_DENIED' }),
      }),
    );
  });

  it('lets a verified super administrator promote staff and revokes target sessions', async () => {
    const tx = transaction();
    const { service } = serviceFor(tx);
    const updated = await service.changeRole(
      staffUser.id,
      { role: Role.ADMIN },
      superAdmin,
      context,
    );
    expect(updated.role).toBe(Role.ADMIN);
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: staffUser.id }) }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ADMIN_PROMOTED' }) }),
    );
  });

  it('allows an administrator to suspend staff but not administrators', async () => {
    const tx = transaction();
    const { service } = serviceFor(tx);
    await expect(
      service.changeStatus(staffUser.id, { status: UserStatus.SUSPENDED }, admin, context),
    ).resolves.toEqual(expect.objectContaining({ status: UserStatus.SUSPENDED, isActive: false }));

    tx.user.findUnique.mockResolvedValue({ ...staffUser, role: Role.ADMIN });
    await expect(
      service.changeStatus(staffUser.id, { status: UserStatus.SUSPENDED }, admin, context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents demotion or deactivation of the final active super administrator', async () => {
    const lastSuper = { ...staffUser, id: 'last-super', role: Role.SUPER_ADMIN };
    const tx = transaction();
    tx.user.findUnique.mockResolvedValue(lastSuper);
    tx.user.count.mockResolvedValue(0);
    const { service } = serviceFor(tx);
    await expect(
      service.changeStatus(lastSuper.id, { status: UserStatus.DEACTIVATED }, superAdmin, context),
    ).rejects.toThrow('final active super administrator');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('adds an internal role to a customer identity without creating another account', async () => {
    const tx = transaction();
    tx.user.findUnique.mockResolvedValue({
      ...staffUser,
      role: Role.CUSTOMER,
      roles: [{ role: Role.CUSTOMER }],
      customer: { id: 'customer-profile', firstName: 'A', lastName: 'Customer' },
    });
    const { service } = serviceFor(tx);
    await expect(
      service.changeRole(staffUser.id, { role: Role.ADMIN }, superAdmin, context),
    ).resolves.toEqual(expect.objectContaining({ roles: expect.arrayContaining([Role.ADMIN]) }));
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          roles: {
            deleteMany: { role: { in: [Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF] } },
            create: { role: Role.ADMIN, assignedBy: superAdmin.id },
          },
        },
      }),
    );
  });

  it('uses a serialized advisory lock before final-super-admin checks', async () => {
    const lastSuper = { ...staffUser, id: 'last-super', role: Role.SUPER_ADMIN };
    const tx = transaction();
    tx.user.findUnique.mockResolvedValue(lastSuper);
    tx.user.count.mockResolvedValue(0);
    const { service } = serviceFor(tx);
    await expect(
      service.changeRole(lastSuper.id, { role: Role.ADMIN }, superAdmin, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.count).toHaveBeenCalledTimes(1);
  });
});
