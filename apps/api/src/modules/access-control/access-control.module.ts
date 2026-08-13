import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { AccessControlController } from './access-control.controller';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [AccessControlController],
})
export class AccessControlModule {}
