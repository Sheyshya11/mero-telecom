import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GenerateInvoiceDto, InvoiceQueryDto, UpdateInvoiceStatusDto } from './dto/invoice.dto';
import { InvoiceEmailService } from './invoice-email.service';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly invoiceEmail: InvoiceEmailService,
  ) {}
  @Get() @Roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER) findAll(
    @Query() query: InvoiceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.findAll(query, user);
  }
  @Get('me') @Roles(Role.CUSTOMER) findOwn(
    @Query() query: InvoiceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.findAll(query, user);
  }
  @Get(':invoiceId/pdf') @Roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER) async downloadPdf(
    @Param('invoiceId', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { pdf, invoiceNumber } = await this.invoices.renderPdf(id, user);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('Content-Disposition', `attachment; filename="${invoiceNumber}.pdf"`);
    response.setHeader('Content-Length', String(pdf.length));
    response.send(pdf);
  }
  @Get(':invoiceId') @Roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER) findOne(
    @Param('invoiceId', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.findOne(id, user);
  }
  @Post('generate') @Roles(Role.ADMIN, Role.STAFF) generate(@Body() input: GenerateInvoiceDto) {
    return this.invoices.generate(input);
  }
  @Post(':invoiceId/send') @Roles(Role.ADMIN, Role.STAFF) sendEmail(
    @Param('invoiceId', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoiceEmail.send(id, user);
  }
  @Patch(':invoiceId/status') @Roles(Role.ADMIN) updateStatus(
    @Param('invoiceId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateInvoiceStatusDto,
  ) {
    return this.invoices.updateStatus(id, input);
  }
}
