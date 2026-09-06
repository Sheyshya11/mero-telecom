import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  BillingReportType,
  BillingReportQueryDto,
  ExportReportDto,
} from './dto/billing-report-query.dto';
import { BillingReportsService } from './billing-reports.service';

@ApiTags('billing reports')
@ApiBearerAuth()
@Controller('admin/billing/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class BillingReportsController {
  constructor(private readonly reports: BillingReportsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get billing KPI summary for a reporting period' })
  summary(@Query() query: BillingReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.summary(query, actor);
  }

  @Get('revenue')
  revenue(@Query() query: BillingReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.revenue(query, actor);
  }

  @Get('invoices')
  invoices(@Query() query: BillingReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.invoices(query, actor);
  }

  @Get('payments')
  payments(@Query() query: BillingReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.payments(query, actor);
  }

  @Get('receivables')
  receivables(@Query() query: BillingReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.receivables(query, actor);
  }

  @Get('refunds')
  refunds(@Query() query: BillingReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.refunds(query, actor);
  }

  @Get('subscriptions')
  subscriptions(@Query() query: BillingReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.subscriptions(query, actor);
  }

  @Get('reconciliation')
  reconciliation(@Query() query: BillingReportQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.reconciliation(query, actor);
  }

  @Get(':reportType/export')
  @ApiOperation({ summary: 'Export a filtered billing report' })
  async export(
    @Param('reportType') reportType: BillingReportType,
    @Query() query: ExportReportDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ) {
    if (!Object.values(BillingReportType).includes(reportType)) {
      response.status(400).json({ message: 'Invalid report type.' });
      return;
    }
    const result = await this.reports.export(reportType, query, actor, query.format);
    response.setHeader('Content-Type', result.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="mero-telecom-${reportType}-${new Date().toISOString().slice(0, 10)}.${result.extension}"`,
    );
    response.send(result.buffer);
  }
}
