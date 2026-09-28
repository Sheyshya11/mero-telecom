import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { StripeModule } from '../payments/stripe.module';
@Module({
  imports: [AuthModule, AuthorizationModule, StripeModule],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
