import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CustomerOwnership } from '../../common/decorators/customer-ownership.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CustomerOwnershipGuard } from '../../common/guards/customer-ownership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('access control')
@ApiBearerAuth()
@Controller('access-control')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccessControlController {
  @Get('admin')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ description: 'Confirms access to an Admin-only API resource.' })
  @ApiForbiddenResponse({ description: 'The authenticated user is not an administrator.' })
  getAdminAccess(@CurrentUser() user: AuthenticatedUser): { access: true; role: Role } {
    return { access: true, role: user.role };
  }

  @Get('customer/:customerId')
  @Roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)
  @CustomerOwnership('customerId')
  @UseGuards(CustomerOwnershipGuard)
  @ApiOkResponse({ description: 'Confirms access to a customer-owned resource.' })
  @ApiForbiddenResponse({ description: 'The customer resource is not owned by the user.' })
  getCustomerAccess(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): { access: true; customerId: string; role: Role } {
    return { access: true, customerId, role: user.role };
  }
}
