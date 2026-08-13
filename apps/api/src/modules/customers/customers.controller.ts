import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CustomerOwnership } from '../../common/decorators/customer-ownership.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CustomerOwnershipGuard } from '../../common/guards/customer-ownership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { UpdateCustomerDto, UpdateOwnCustomerDto } from './dto/update-customer.dto';
import { CustomersService } from './customers.service';
import type { CustomerResponse, PaginatedCustomersResponse } from './customers.types';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a customer account record.' })
  @ApiCreatedResponse({ description: 'Customer created.' })
  create(@Body() input: CreateCustomerDto): Promise<CustomerResponse> {
    return this.customersService.create(input);
  }

  @Get()
  @Roles(Role.ADMIN, Role.STAFF)
  @ApiOperation({ summary: 'List and search customers with pagination.' })
  @ApiOkResponse({ description: 'Paginated customer list returned.' })
  findAll(@Query() query: PaginationQueryDto): Promise<PaginatedCustomersResponse> {
    return this.customersService.findAll(query);
  }

  @Get('me')
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Return the authenticated customer profile.' })
  @ApiOkResponse({ description: 'Customer profile returned.' })
  @ApiNotFoundResponse({ description: 'No customer profile is linked to the account.' })
  findOwn(@CurrentUser() user: AuthenticatedUser): Promise<CustomerResponse> {
    return this.customersService.findOwn(user.id);
  }

  @Patch('me')
  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update approved fields on the authenticated customer profile.' })
  @ApiOkResponse({ description: 'Customer profile updated.' })
  updateOwn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateOwnCustomerDto,
  ): Promise<CustomerResponse> {
    return this.customersService.updateOwn(user.id, input);
  }

  @Get(':customerId')
  @Roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)
  @CustomerOwnership('customerId')
  @UseGuards(CustomerOwnershipGuard)
  @ApiOperation({ summary: 'Return a customer by ID, subject to ownership controls.' })
  @ApiOkResponse({ description: 'Customer returned.' })
  @ApiForbiddenResponse({ description: 'Customer ownership verification failed.' })
  findOne(@Param('customerId', new ParseUUIDPipe()) customerId: string): Promise<CustomerResponse> {
    return this.customersService.findOne(customerId);
  }

  @Patch(':customerId')
  @Roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)
  @CustomerOwnership('customerId')
  @UseGuards(CustomerOwnershipGuard)
  @ApiOperation({ summary: 'Update a customer, subject to role and ownership controls.' })
  @ApiOkResponse({ description: 'Customer updated.' })
  update(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    return this.customersService.update(customerId, user, input);
  }
}
