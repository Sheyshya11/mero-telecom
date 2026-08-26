import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CoverageManagementService } from './coverage-management.service';
import {
  AddressOverrideQueryDto,
  CoverageAnalyticsQueryDto,
  CreateAddressOverrideDto,
  CreateAddressOverrideFromSelectionDto,
  CreateOperatingRegionDto,
  CreatePlanCoverageRuleDto,
  CreatePostcodeCoverageDto,
  OperatingRegionQueryDto,
  PlanCoverageRuleQueryDto,
  PostcodeCoverageQueryDto,
  UpdateAddressOverrideDto,
  UpdateOperatingRegionDto,
  UpdatePlanCoverageRuleDto,
  UpdatePostcodeCoverageDto,
} from './dto/coverage-management.dto';

@ApiTags('coverage management')
@ApiBearerAuth()
@Controller('coverage-management')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class CoverageManagementController {
  constructor(private readonly management: CoverageManagementService) {}

  @Get('regions')
  @ApiOperation({ summary: 'List and filter Australian operating regions.' })
  listRegions(@Query() query: OperatingRegionQueryDto) {
    return this.management.listRegions(query);
  }

  @Post('regions')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an Australian operating region.' })
  createRegion(@Body() input: CreateOperatingRegionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.management.createRegion(input, actor);
  }

  @Patch('regions/:regionId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update, activate, or disable an operating region.' })
  updateRegion(
    @Param('regionId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateOperatingRegionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.management.updateRegion(id, input, actor);
  }

  @Get('postcodes')
  @ApiOperation({ summary: 'List and filter exact postcode coverage records.' })
  listPostcodes(@Query() query: PostcodeCoverageQueryDto) {
    return this.management.listPostcodes(query);
  }

  @Post('postcodes')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an exact postcode coverage record.' })
  createPostcode(
    @Body() input: CreatePostcodeCoverageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.management.createPostcode(input, actor);
  }

  @Patch('postcodes/:postcodeCoverageId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update or disable exact postcode coverage.' })
  updatePostcode(
    @Param('postcodeCoverageId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePostcodeCoverageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.management.updatePostcode(id, input, actor);
  }

  @Get('address-overrides')
  @ApiOperation({ summary: 'List and filter exact-address coverage overrides.' })
  listOverrides(@Query() query: AddressOverrideQueryDto) {
    return this.management.listOverrides(query);
  }

  @Post('address-overrides')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an exact-address coverage override.' })
  createOverride(@Body() input: CreateAddressOverrideDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.management.createOverride(input, actor);
  }

  @Post('address-overrides/from-selection')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create an exact-address override from a trusted autocomplete selection.',
  })
  createOverrideFromSelection(
    @Body() input: CreateAddressOverrideFromSelectionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.management.createOverrideFromSelection(input, actor);
  }

  @Patch('address-overrides/:overrideId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update or disable an exact-address coverage override.' })
  updateOverride(
    @Param('overrideId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateAddressOverrideDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.management.updateOverride(id, input, actor);
  }

  @Get('plan-rules')
  @ApiOperation({ summary: 'List plan compatibility rules by technology and scope.' })
  listPlanRules(@Query() query: PlanCoverageRuleQueryDto) {
    return this.management.listPlanRules(query);
  }

  @Post('plan-rules')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Associate an existing plan with technology and optional region scope.',
  })
  createPlanRule(
    @Body() input: CreatePlanCoverageRuleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.management.createPlanRule(input, actor);
  }

  @Patch('plan-rules/:ruleId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update or disable a plan compatibility rule.' })
  updatePlanRule(
    @Param('ruleId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePlanCoverageRuleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.management.updatePlanRule(id, input, actor);
  }

  @Get('analytics')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'View privacy-safe coverage-search analytics.' })
  analytics(@Query() query: CoverageAnalyticsQueryDto) {
    return this.management.analytics(query);
  }
}
