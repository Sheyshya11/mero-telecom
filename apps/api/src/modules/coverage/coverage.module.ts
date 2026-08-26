import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { AddressSelectionService } from './address-selection.service';
import { CoverageController } from './coverage.controller';
import { CoverageManagementController } from './coverage-management.controller';
import { CoverageManagementService } from './coverage-management.service';
import { CoverageService } from './coverage.service';
import { DatabaseCoverageQualificationProvider } from './database-qualification.provider';
import { ADDRESS_LOOKUP_PROVIDER, COVERAGE_QUALIFICATION_PROVIDER } from './coverage.types';
import { GeoapifyAddressProvider } from './geoapify-address.provider';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [CoverageController, CoverageManagementController],
  providers: [
    CoverageService,
    CoverageManagementService,
    AddressSelectionService,
    GeoapifyAddressProvider,
    DatabaseCoverageQualificationProvider,
    { provide: ADDRESS_LOOKUP_PROVIDER, useExisting: GeoapifyAddressProvider },
    {
      provide: COVERAGE_QUALIFICATION_PROVIDER,
      useExisting: DatabaseCoverageQualificationProvider,
    },
  ],
  exports: [CoverageService, AddressSelectionService],
})
export class CoverageModule {}
