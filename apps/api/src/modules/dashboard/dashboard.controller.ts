import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('admin') @Roles(Role.ADMIN) getAdminSummary() {
    return this.dashboard.getAdminSummary();
  }
  @Get('super-admin') @Roles(Role.SUPER_ADMIN) getSuperAdminSummary() {
    return this.dashboard.getSuperAdminSummary();
  }
  @Get('customer') @Roles(Role.CUSTOMER) getCustomerSummary(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.getCustomerSummary(user);
  }
}
