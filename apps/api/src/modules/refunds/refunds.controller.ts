import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { asCustomerContext, type AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ApproveRefundDto,
  CancelRefundDto,
  CreateAdminRefundDto,
  RefundQueryDto,
  RejectRefundDto,
  RequestRefundDto,
  RequestMoreInformationDto,
  ReviewRefundDto,
} from './dto/refund.dto';
import type { UploadedRefundFile } from './refund-attachment.types';
import { RefundAttachmentsService } from './refund-attachments.service';
import type { Response } from 'express';
import { RefundsService } from './refunds.service';

@ApiTags('refunds')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerRefundsController {
  constructor(
    private readonly refunds: RefundsService,
    private readonly attachments: RefundAttachmentsService,
  ) {}

  @Post('payments/:paymentId/refund-requests')
  @Roles(Role.CUSTOMER)
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { files: 20, fileSize: 100 * 1024 * 1024 } }),
  )
  @ApiOperation({ summary: 'Request administrative review of an owned payment refund' })
  @ApiResponse({ status: 201, description: 'Refund request recorded; no money is moved yet.' })
  request(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Body() input: RequestRefundDto,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedRefundFile[] = [],
  ) {
    return this.refunds.request(paymentId, input, asCustomerContext(actor), files);
  }

  @Get('me/refunds')
  @Roles(Role.CUSTOMER)
  findMine(@Query() query: RefundQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.refunds.findMine(query, asCustomerContext(actor));
  }

  @Get('me/refunds/:refundId')
  @Roles(Role.CUSTOMER)
  findMineOne(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.findMineOne(id, asCustomerContext(actor));
  }

  @Get('me/refunds/:refundId/attachments')
  @Roles(Role.CUSTOMER)
  listMineAttachments(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.list(id, asCustomerContext(actor));
  }

  @Post('me/refunds/:refundId/attachments')
  @Roles(Role.CUSTOMER)
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { files: 20, fileSize: 100 * 1024 * 1024 } }),
  )
  addMineAttachments(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedRefundFile[] = [],
  ) {
    return this.attachments.add(id, files, asCustomerContext(actor));
  }

  @Get('me/refunds/:refundId/attachments/:attachmentId/access')
  @Roles(Role.CUSTOMER)
  accessMineAttachment(
    @Param('refundId', new ParseUUIDPipe()) refundId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.accessUrl(
      refundId,
      attachmentId,
      asCustomerContext(actor),
      `/api/v1/refunds/${refundId}/attachments/${attachmentId}/file`,
    );
  }

  @Delete('me/refunds/:refundId/attachments/:attachmentId')
  @Roles(Role.CUSTOMER)
  async removeMineAttachment(
    @Param('refundId', new ParseUUIDPipe()) refundId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.attachments.remove(refundId, attachmentId, asCustomerContext(actor));
  }

  @Post('me/refunds/:refundId/cancel')
  @Roles(Role.CUSTOMER)
  cancelMine(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @Body() input: CancelRefundDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.cancel(id, input, asCustomerContext(actor));
  }
}

@ApiTags('admin refunds')
@ApiBearerAuth()
@Controller('admin/refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminRefundsController {
  constructor(
    private readonly refunds: RefundsService,
    private readonly attachments: RefundAttachmentsService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() input: CreateAdminRefundDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.refunds.createAdministrative(input, actor);
  }

  @Get()
  @Roles(Role.ADMIN, Role.STAFF)
  findAll(@Query() query: RefundQueryDto) {
    return this.refunds.findAll(query);
  }

  @Get(':refundId')
  @Roles(Role.ADMIN, Role.STAFF)
  findOne(@Param('refundId', new ParseUUIDPipe()) id: string) {
    return this.refunds.findOne(id);
  }

  @Get(':refundId/attachments')
  @Roles(Role.ADMIN, Role.STAFF)
  listAttachments(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.list(id, actor);
  }

  @Post(':refundId/attachments')
  @Roles(Role.ADMIN, Role.STAFF)
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { files: 20, fileSize: 100 * 1024 * 1024 } }),
  )
  addAttachments(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedRefundFile[] = [],
  ) {
    return this.attachments.add(id, files, actor);
  }

  @Get(':refundId/attachments/:attachmentId/access')
  @Roles(Role.ADMIN, Role.STAFF)
  accessAttachment(
    @Param('refundId', new ParseUUIDPipe()) refundId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.accessUrl(
      refundId,
      attachmentId,
      actor,
      `/api/v1/refunds/${refundId}/attachments/${attachmentId}/file`,
    );
  }

  @Post(':refundId/review')
  @Roles(Role.ADMIN, Role.STAFF)
  review(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @Body() input: ReviewRefundDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.review(id, input, actor);
  }

  @Post(':refundId/request-more-information')
  @Roles(Role.ADMIN, Role.STAFF)
  requestMoreInformation(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @Body() input: RequestMoreInformationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.requestMoreInformation(id, input.message, actor);
  }

  @Post(':refundId/approve')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Approve a full remaining-balance or partial refund' })
  approve(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @Body() input: ApproveRefundDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.approve(id, input, actor);
  }

  @Post(':refundId/reject')
  @Roles(Role.ADMIN)
  reject(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @Body() input: RejectRefundDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.reject(id, input, actor);
  }

  @Post(':refundId/process')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Submit an approved refund to Stripe using an idempotency key' })
  process(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.process(id, actor);
  }

  @Post(':refundId/retry')
  @Roles(Role.ADMIN)
  retry(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.process(id, actor);
  }

  @Post(':refundId/cancel')
  @Roles(Role.ADMIN)
  cancel(
    @Param('refundId', new ParseUUIDPipe()) id: string,
    @Body() input: CancelRefundDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refunds.cancel(id, input, actor);
  }
}

@ApiTags('refund attachments')
@Controller('refunds')
export class RefundAttachmentAccessController {
  constructor(private readonly attachments: RefundAttachmentsService) {}

  @Get(':refundId/attachments/:attachmentId/file')
  async file(
    @Param('refundId', new ParseUUIDPipe()) refundId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Query('expires') expiresValue: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ) {
    const expires = Number(expiresValue);
    const { attachment, buffer } = await this.attachments.readLocal(
      refundId,
      attachmentId,
      expires,
      signature,
    );
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Length', buffer.length);
    const safeFilename = attachment.originalName.replace(/[\r\n"]/g, '');
    response.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(buffer);
  }
}
