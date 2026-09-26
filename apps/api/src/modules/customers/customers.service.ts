import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { buildPaginationMeta, dateRange } from '../../common/pagination';
import { AccountInvitationsService } from '../auth/account-invitations.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { UpdateCustomerDto, UpdateOwnCustomerDto } from './dto/update-customer.dto';
import {
  type CustomerResponse,
  type CustomerCreationResponse,
  type PaginatedCustomersResponse,
  toCustomerResponse,
} from './customers.types';

const currentSubscriptionStatuses = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.PENDING,
  SubscriptionStatus.CANCELLATION_PENDING,
  SubscriptionStatus.DISCONNECTION_PENDING,
  SubscriptionStatus.SUSPENDED,
] as const;

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
  addresses: {
    select: {
      type: true,
      addressLine1: true,
      addressLine2: true,
      suburb: true,
      state: true,
      postcode: true,
    },
  },
  subscriptions: {
    where: { status: { in: [...currentSubscriptionStatuses] } },
    select: {
      status: true,
      plan: { select: { id: true, name: true } },
      currentServiceAddress: {
        select: {
          addressLine1: true,
          addressLine2: true,
          suburb: true,
          state: true,
          postcode: true,
        },
      },
    },
    orderBy: [{ startDate: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 1,
  },
} satisfies Prisma.CustomerInclude;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardCache: AdminDashboardCacheService,
    private readonly invitations: AccountInvitationsService,
  ) {}

  async create(
    input: CreateCustomerDto,
    actor: AuthenticatedUser,
  ): Promise<CustomerCreationResponse> {
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
              roles: { create: { role: Role.CUSTOMER, assignedBy: actor.id } },
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
              firstName: this.requiredText(input.firstName, 'First name'),
              lastName: this.requiredText(input.lastName, 'Last name'),
              email,
              phone: input.phone.trim(),
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

        const invitationQueued = await this.invitations.queueDelivery(result.invitation);
        await this.dashboardCache.invalidate();
        return { ...toCustomerResponse(result.customer), invitationQueued };
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
    if (query.status) where.status = query.status;
    if (query.accountStatus) where.user = { is: { status: query.accountStatus } };
    if (query.state) where.state = query.state;
    if (query.postcode) where.postcode = query.postcode;
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) where.createdAt = createdAt;
    if (query.subscriptionStatus === 'NO_SUBSCRIPTION') {
      if (query.planId) {
        throw new BadRequestException('A plan cannot be combined with the no-subscription filter.');
      }
      where.subscriptions = { none: { status: { in: [...currentSubscriptionStatuses] } } };
    } else if (query.subscriptionStatus || query.planId) {
      where.subscriptions = {
        some: {
          status: query.subscriptionStatus ?? { in: [...currentSubscriptionStatuses] },
          ...(query.planId ? { planId: query.planId } : {}),
        },
      };
    }
    const skip = (query.page - 1) * query.limit;
    const [customers, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: customerAccountInclude,
        orderBy: [{ [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' }, { id: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: customers.map(toCustomerResponse),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
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
    const requestedData = this.getUpdateData(actor.role, input);

    try {
      const customer = await this.prisma.$transaction(async (transaction) => {
        const userUpdate =
          existing.user && (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN)
            ? this.userUpdateForCustomer(existing.user, input)
            : {};
        const data: Prisma.CustomerUpdateInput = {
          ...requestedData,
          ...(userUpdate.status
            ? { status: this.customerStatusForUserStatus(userUpdate.status) }
            : {}),
        };
        const updated = await transaction.customer.update({ where: { id: customerId }, data });
        if (existing.user && (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN)) {
          if (Object.keys(userUpdate).length > 0) {
            await transaction.user.update({ where: { id: existing.user.id }, data: userUpdate });
          }
          if (userUpdate.status && userUpdate.status !== existing.user.status) {
            await transaction.refreshSession.updateMany({
              where: { userId: existing.user.id, revokedAt: null },
              data: { revokedAt: new Date() },
            });
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
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      include: {
        addresses: { where: { type: AddressType.BILLING }, take: 1 },
      },
    });
    if (!customer) throw new NotFoundException('No customer profile is linked to this account.');

    const updatedCustomer = await this.prisma.$transaction(async (transaction) => {
      const addressChanged =
        input.addressLine1 !== undefined ||
        input.addressLine2 !== undefined ||
        input.suburb !== undefined ||
        input.state !== undefined ||
        input.postcode !== undefined;
      const currentContactAddress = customer.addresses[0] ?? customer;
      const contactAddress = {
        addressLine1: input.addressLine1 ?? currentContactAddress.addressLine1,
        addressLine2:
          input.addressLine2 === undefined
            ? currentContactAddress.addressLine2
            : input.addressLine2,
        suburb: input.suburb ?? currentContactAddress.suburb,
        state: input.state ?? currentContactAddress.state,
        postcode: input.postcode ?? currentContactAddress.postcode,
      };
      await transaction.customer.update({
        where: { id: customer.id },
        data: {
          phone: input.phone?.trim(),
          ...(addressChanged
            ? {
                addressLine1: contactAddress.addressLine1,
                addressLine2: contactAddress.addressLine2?.trim() || null,
                suburb: contactAddress.suburb,
                state: contactAddress.state.toUpperCase(),
                postcode: contactAddress.postcode,
              }
            : {}),
        },
      });
      if (addressChanged) {
        await transaction.customerAddress.upsert({
          where: {
            customerId_type: { customerId: customer.id, type: AddressType.BILLING },
          },
          create: {
            customerId: customer.id,
            ...this.addressData(AddressType.BILLING, contactAddress),
          },
          update: this.addressData(AddressType.BILLING, contactAddress),
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
    if (role === Role.SUPER_ADMIN || role === Role.ADMIN) {
      return {
        firstName:
          input.firstName === undefined
            ? undefined
            : this.requiredText(input.firstName, 'First name'),
        lastName:
          input.lastName === undefined ? undefined : this.requiredText(input.lastName, 'Last name'),
        email: input.email ? this.normalizeEmail(input.email) : undefined,
        phone: input.phone?.trim(),
        addressLine1:
          input.addressLine1 === undefined
            ? undefined
            : this.requiredText(input.addressLine1, 'Address'),
        addressLine2:
          input.addressLine2 === undefined ? undefined : input.addressLine2?.trim() || null,
        suburb: input.suburb === undefined ? undefined : this.requiredText(input.suburb, 'Suburb'),
        state: input.state?.toUpperCase(),
        postcode: input.postcode?.trim(),
        status: input.status,
      };
    }
    const { phone, addressLine1, addressLine2, suburb, state, postcode } = input;
    return {
      phone: phone?.trim(),
      addressLine1:
        addressLine1 === undefined ? undefined : this.requiredText(addressLine1, 'Address'),
      addressLine2: addressLine2 === undefined ? undefined : addressLine2?.trim() || null,
      suburb: suburb === undefined ? undefined : this.requiredText(suburb, 'Suburb'),
      state: state?.toUpperCase(),
      postcode: postcode?.trim(),
    };
  }

  private userUpdateForCustomer(
    user: { passwordHash: string | null; emailVerifiedAt: Date | null },
    input: UpdateCustomerDto,
  ): { email?: string; status?: UserStatus; isActive?: boolean } {
    const data: { email?: string; status?: UserStatus; isActive?: boolean } = {};
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
      addressLine1: this.requiredText(input.addressLine1, 'Address'),
      addressLine2: input.addressLine2?.trim() || null,
      suburb: this.requiredText(input.suburb, 'Suburb'),
      state: input.state.toUpperCase(),
      postcode: input.postcode.trim(),
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
      addressLine1: this.requiredText(address.addressLine1, 'Address'),
      addressLine2: address.addressLine2?.trim() || null,
      suburb: this.requiredText(address.suburb, 'Suburb'),
      state: address.state.toUpperCase(),
      postcode: address.postcode.trim(),
    };
  }

  private customerStatusForUserStatus(status: UserStatus): CustomerStatus {
    if (status === UserStatus.DEACTIVATED) return CustomerStatus.INACTIVE;
    return status as CustomerStatus;
  }

  private requiredText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException(`${label} is required.`);
    return normalized;
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
