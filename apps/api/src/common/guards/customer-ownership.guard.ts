import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { isUUID } from 'class-validator';

import { CUSTOMER_OWNERSHIP_PARAM_KEY } from '../constants/authorization.constants';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedRequest } from '../../modules/auth/auth.types';

@Injectable()
export class CustomerOwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.user.role === Role.ADMIN || request.user.role === Role.STAFF) {
      return true;
    }

    const parameterName =
      this.reflector.getAllAndOverride<string>(CUSTOMER_OWNERSHIP_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'customerId';
    const customerId = request.params[parameterName];

    if (!customerId || Array.isArray(customerId)) {
      throw new ForbiddenException('Customer ownership could not be determined.');
    }
    if (!isUUID(customerId)) {
      throw new BadRequestException('Customer ID must be a valid UUID.');
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        userId: request.user.id,
      },
      select: { id: true },
    });

    if (!customer) {
      throw new ForbiddenException('You do not have access to this customer resource.');
    }

    return true;
  }
}
