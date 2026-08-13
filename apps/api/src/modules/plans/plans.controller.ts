import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
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
  ) {
    return this.plans.create(input);
  }
  @Patch(':planId') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN) @ApiBearerAuth() update(
    @Param('planId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePlanDto,
  ) {
    return this.plans.update(id, input);
  }

  @Delete(':planId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  remove(@Param('planId', new ParseUUIDPipe()) id: string) {
    return this.plans.remove(id);
  }
}
