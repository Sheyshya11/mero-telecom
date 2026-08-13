import { Module } from '@nestjs/common';

import { CustomerOwnershipGuard } from './guards/customer-ownership.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  providers: [RolesGuard, CustomerOwnershipGuard],
  exports: [RolesGuard, CustomerOwnershipGuard],
})
export class AuthorizationModule {}
