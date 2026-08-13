import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, SubscriptionStatus } from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../database/prisma.service';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { UpdateCustomerDto, UpdateOwnCustomerDto } from './dto/update-customer.dto';
import {
  PaginatedCustomersResponse,
  CustomerResponse,
  toCustomerResponse,
} from './customers.types';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardCache: AdminDashboardCacheService,
  ) {}

  async create(input: CreateCustomerDto): Promise<CustomerResponse> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const customer = await this.prisma.customer.create({
          data: {
            ...input,
            email: input.email.toLowerCase(),
            state: input.state.toUpperCase(),
            customerNumber: this.createCustomerNumber(),
          },
        });

        await this.dashboardCache.invalidate();
        return toCustomerResponse(customer);
      } catch (error) {
        if (this.isUniqueConstraintError(error) && attempt < 2) {
          continue;
        }

        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('A customer with this email already exists.');
        }

        throw error;
      }
    }

    throw new ConflictException('Unable to allocate a unique customer number.');
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
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });

    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }

    return toCustomerResponse(customer);
  }

  async findOwn(userId: string): Promise<CustomerResponse> {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });

    if (!customer) {
      throw new NotFoundException('No customer profile is linked to this account.');
    }

    return toCustomerResponse(customer);
  }

  async update(
    customerId: string,
    actor: AuthenticatedUser,
    input: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    await this.findOne(customerId);
    const data = this.getUpdateData(actor.role, input);
    let customer;
    try {
      customer = await this.prisma.customer.update({ where: { id: customerId }, data });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A customer with this email already exists.');
      }
      throw error;
    }

    await this.dashboardCache.invalidate();
    return toCustomerResponse(customer);
  }

  async updateOwn(userId: string, input: UpdateOwnCustomerDto): Promise<CustomerResponse> {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });

    if (!customer) {
      throw new NotFoundException('No customer profile is linked to this account.');
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customer.id },
      data: input,
    });

    return toCustomerResponse(updatedCustomer);
  }

  private getUpdateData(role: Role, input: UpdateCustomerDto): Prisma.CustomerUpdateInput {
    if (role === Role.ADMIN) {
      return {
        ...input,
        email: input.email?.toLowerCase(),
        state: input.state?.toUpperCase(),
      };
    }

    const { phone, addressLine1, addressLine2, suburb, state, postcode } = input;

    return {
      phone,
      addressLine1,
      addressLine2,
      suburb,
      state: state?.toUpperCase(),
      postcode,
    };
  }

  private createCustomerNumber(): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `CUST-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
