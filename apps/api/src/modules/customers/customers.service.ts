import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountInvitationReason,
  AddressType,
  CustomerStatus,
  Prisma,
  Role,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import { AccountInvitationsService } from '../auth/account-invitations.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { UpdateCustomerDto, UpdateOwnCustomerDto } from './dto/update-customer.dto';
import {
  type CustomerResponse,
  type PaginatedCustomersResponse,
  toCustomerResponse,
} from './customers.types';

const customerAccountInclude = {
  user: {
    select: {
      status: true,
      invitations: {
        select: { status: true, expiresAt: true },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
      },
    },
  },
} satisfies Prisma.CustomerInclude;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardCache: AdminDashboardCacheService,
    private readonly invitations: AccountInvitationsService,
  ) {}

  async create(input: CreateCustomerDto, actor: AuthenticatedUser): Promise<CustomerResponse> {
    const email = this.normalizeEmail(input.email);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async (transaction) => {
          const [existingUser, existingCustomer] = await Promise.all([
            transaction.user.findUnique({ where: { email }, select: { id: true } }),
            transaction.customer.findUnique({ where: { email }, select: { id: true } }),
          ]);
          if (existingUser || existingCustomer) {
            throw new ConflictException('A customer with this email already exists.');
          }

          const user = await transaction.user.create({
            data: {
              email,
              passwordHash: null,
              role: Role.CUSTOMER,
              isActive: false,
              status: UserStatus.INVITATION_PENDING,
            },
          });
          const residential = this.residentialAddress(input);
          const service = input.serviceAddress ?? residential;
          const billing = input.billingAddress ?? residential;
          const customer = await transaction.customer.create({
            data: {
              userId: user.id,
              customerNumber: this.createCustomerNumber(),
              firstName: input.firstName.trim(),
              lastName: input.lastName.trim(),
              email,
              phone: input.phone,
              ...residential,
              state: residential.state.toUpperCase(),
              status: CustomerStatus.INVITATION_PENDING,
              addresses: {
                create: [
                  this.addressData(AddressType.RESIDENTIAL, residential),
                  this.addressData(AddressType.SERVICE, service),
                  this.addressData(AddressType.BILLING, billing),
                ],
              },
            },
          });
          const invitation = await this.invitations.issueWithinTransaction(transaction, {
            userId: user.id,
            reason: AccountInvitationReason.ADMIN_CREATED,
            createdByUserId: actor.id,
          });
          await transaction.auditLog.create({
            data: {
              actorUserId: actor.id,
              action: 'CUSTOMER_CREATED',
              entityType: 'Customer',
              entityId: customer.id,
              metadata: { source: 'ADMIN_CREATED', accountStatus: 'INVITATION_PENDING' },
            },
          });
          const responseCustomer = await transaction.customer.findUniqueOrThrow({
            where: { id: customer.id },
            include: customerAccountInclude,
          });
          return { customer: responseCustomer, invitation };
        });

        await this.invitations.queueDelivery(result.invitation);
        await this.dashboardCache.invalidate();
        return toCustomerResponse(result.customer);
      } catch (error) {
        if (error instanceof ConflictException) throw error;
        if (this.isUniqueConstraintError(error) && attempt < 2) continue;
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('A customer with this email already exists.');
        }
        throw error;
      }
    }

    throw new ConflictException('Unable to allocate a unique customer number.');
  }

  async resendInvitation(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<{ queued: boolean }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    if (!customer.user || customer.user.status !== UserStatus.INVITATION_PENDING) {
      throw new ConflictException('This customer does not have a pending account invitation.');
    }
    return this.invitations.issueAndQueue({
      userId: customer.user.id,
      reason: AccountInvitationReason.RESEND,
      createdByUserId: actor.id,
    });
  }

  async findAll(query: PaginationQueryDto): Promise<PaginatedCustomersResponse> {
    const search = query.search?.trim();
    const where: Prisma.CustomerWhereInput = search
      ? {
          OR: [
            { customerNumber: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const skip = (query.page - 1) * query.limit;
    const [customers, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: {
          ...customerAccountInclude,
          subscriptions: {
            where: {
              status: {
                in: [
                  SubscriptionStatus.ACTIVE,
                  SubscriptionStatus.PENDING,
                  SubscriptionStatus.SUSPENDED,
                ],
              },
            },
            select: { status: true, plan: { select: { id: true, name: true } } },
            orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
            take: 1,
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: customers.map(toCustomerResponse),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async findOne(customerId: string): Promise<CustomerResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: customerAccountInclude,
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    return toCustomerResponse(customer);
  }

  async findOwn(userId: string): Promise<CustomerResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      include: customerAccountInclude,
    });
    if (!customer) throw new NotFoundException('No customer profile is linked to this account.');
    return toCustomerResponse(customer);
  }

  async update(
    customerId: string,
    actor: AuthenticatedUser,
    input: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    const existing = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { user: true },
    });
    if (!existing) throw new NotFoundException('Customer not found.');
    const data = this.getUpdateData(actor.role, input);

    try {
      const customer = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.customer.update({ where: { id: customerId }, data });
        if (existing.user && actor.role === Role.ADMIN) {
          const userUpdate = this.userUpdateForCustomer(existing.user, input);
          if (Object.keys(userUpdate).length > 0) {
            await transaction.user.update({ where: { id: existing.user.id }, data: userUpdate });
          }
        }
        if (
          input.addressLine1 !== undefined ||
          input.addressLine2 !== undefined ||
          input.suburb !== undefined ||
          input.state !== undefined ||
          input.postcode !== undefined
        ) {
          await transaction.customerAddress.upsert({
            where: { customerId_type: { customerId, type: AddressType.RESIDENTIAL } },
            create: { customerId, ...this.addressData(AddressType.RESIDENTIAL, updated) },
            update: this.addressData(AddressType.RESIDENTIAL, updated),
          });
        }
        return transaction.customer.findUniqueOrThrow({
          where: { id: customerId },
          include: customerAccountInclude,
        });
      });
      await this.dashboardCache.invalidate();
      return toCustomerResponse(customer);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A customer with this email already exists.');
      }
      throw error;
    }
  }

  async updateOwn(userId: string, input: UpdateOwnCustomerDto): Promise<CustomerResponse> {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundException('No customer profile is linked to this account.');

    const updatedCustomer = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.customer.update({
        where: { id: customer.id },
        data: input,
      });
      if (
        input.addressLine1 !== undefined ||
        input.addressLine2 !== undefined ||
        input.suburb !== undefined ||
        input.state !== undefined ||
        input.postcode !== undefined
      ) {
        await transaction.customerAddress.upsert({
          where: {
            customerId_type: { customerId: customer.id, type: AddressType.RESIDENTIAL },
          },
          create: {
            customerId: customer.id,
            ...this.addressData(AddressType.RESIDENTIAL, updated),
          },
          update: this.addressData(AddressType.RESIDENTIAL, updated),
        });
      }
      return transaction.customer.findUniqueOrThrow({
        where: { id: customer.id },
        include: customerAccountInclude,
      });
    });

    return toCustomerResponse(updatedCustomer);
  }

  private getUpdateData(role: Role, input: UpdateCustomerDto): Prisma.CustomerUpdateInput {
    if (role === Role.ADMIN) {
      return {
        ...input,
        email: input.email ? this.normalizeEmail(input.email) : undefined,
        state: input.state?.toUpperCase(),
      };
    }
    const { phone, addressLine1, addressLine2, suburb, state, postcode } = input;
    return { phone, addressLine1, addressLine2, suburb, state: state?.toUpperCase(), postcode };
  }

  private userUpdateForCustomer(
    user: { passwordHash: string | null; emailVerifiedAt: Date | null },
    input: UpdateCustomerDto,
  ): Prisma.UserUpdateInput {
    const data: Prisma.UserUpdateInput = {};
    if (input.email) data.email = this.normalizeEmail(input.email);
    if (input.status === CustomerStatus.SUSPENDED) {
      data.status = UserStatus.SUSPENDED;
      data.isActive = false;
    } else if (input.status === CustomerStatus.INACTIVE) {
      data.status = UserStatus.DEACTIVATED;
      data.isActive = false;
    } else if (input.status === CustomerStatus.INVITATION_PENDING) {
      data.status = UserStatus.INVITATION_PENDING;
      data.isActive = false;
    } else if (input.status === CustomerStatus.ACTIVE) {
      const canActivate = Boolean(user.passwordHash && user.emailVerifiedAt);
      data.status = canActivate ? UserStatus.ACTIVE : UserStatus.INVITATION_PENDING;
      data.isActive = canActivate;
    }
    return data;
  }

  private residentialAddress(input: CreateCustomerDto) {
    return {
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      suburb: input.suburb,
      state: input.state.toUpperCase(),
      postcode: input.postcode,
    };
  }

  private addressData(
    type: AddressType,
    address: {
      addressLine1: string;
      addressLine2?: string | null;
      suburb: string;
      state: string;
      postcode: string;
    },
  ) {
    return {
      type,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 || null,
      suburb: address.suburb,
      state: address.state.toUpperCase(),
      postcode: address.postcode,
    };
  }

  private createCustomerNumber(): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `CUST-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
