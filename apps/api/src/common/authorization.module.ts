import { Module } from '@nestjs/common';

import { CustomerOwnershipGuard } from './guards/customer-ownership.guard';
import { RolesGuard } from './guards/roles.guard';
import { TicketWorkflowPolicyService } from './workflow/ticket-workflow-policy.service';

@Module({
  providers: [RolesGuard, CustomerOwnershipGuard, TicketWorkflowPolicyService],
  exports: [RolesGuard, CustomerOwnershipGuard, TicketWorkflowPolicyService],
})
export class AuthorizationModule {}
