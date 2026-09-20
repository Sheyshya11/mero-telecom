import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { auditContextFromRequest } from '../system-users/system-users.types';
import {
  CreatePlanDto,
  DeletePlanDto,
  UpdatePlanDto,
  UpdatePlanHighlightsDto,
} from './dto/plan.dto';
import { PlansService } from './plans.service';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}
  @Get('public') getPublicPlans() {
    return this.plans.findActive();
  }
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF)
  @ApiBearerAuth()
  getPlans() {
    return this.plans.findAll();
  }
  @Get(':planId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF)
  @ApiBearerAuth()
  getPlan(@Param('planId', new ParseUUIDPipe()) id: string) {
    return this.plans.findOne(id);
  }
  @Post() @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN) @ApiBearerAuth() create(
    @Body() input: CreatePlanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.plans.create(input, actor, auditContextFromRequest(request));
  }
  @Patch(':planId/highlights')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF)
  @ApiBearerAuth()
  updateHighlights(
    @Param('planId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePlanHighlightsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.plans.updateHighlights(id, input, actor, auditContextFromRequest(request));
  }
  @Patch(':planId') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN) @ApiBearerAuth() update(
    @Param('planId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePlanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.plans.update(id, input, actor, auditContextFromRequest(request));
  }

  @Delete(':planId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  remove(
    @Param('planId', new ParseUUIDPipe()) id: string,
    @Query() input: DeletePlanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.plans.remove(id, input, actor, auditContextFromRequest(request));
  }
}
