import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UploadedPrivateFile } from '../../common/files/private-file.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateInternalRequestDto,
  CreateInternalRequestMessageDto,
  EscalateInternalRequestDto,
  InternalRequestAttachmentSignatureQueryDto,
  InternalRequestContextQueryDto,
  InternalRequestQueryDto,
  OptionalInternalRequestCommentDto,
  RequiredInternalRequestCommentDto,
} from './dto/internal-request.dto';
import { InternalRequestAttachmentsService } from './internal-request-attachments.service';
import { InternalRequestsService } from './internal-requests.service';

const internalRequestUpload = FilesInterceptor('files', 3, {
  limits: { files: 3, fileSize: 25 * 1024 * 1024 },
});

@ApiTags('staff internal requests')
@ApiBearerAuth()
@Controller('staff/internal-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STAFF)
export class StaffInternalRequestsController {
  constructor(
    private readonly internalRequests: InternalRequestsService,
    private readonly attachments: InternalRequestAttachmentsService,
  ) {}

  @Post()
  create(@Body() input: CreateInternalRequestDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.create(input, actor);
  }

  @Get()
  findMine(@Query() query: InternalRequestQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.findMine(query, actor);
  }

  @Get('summary')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.staffSummary(actor);
  }

  @Get('context-options')
  contextOptions(@Query() query: InternalRequestContextQueryDto) {
    return this.internalRequests.contextOptions(query);
  }

  @Get(':requestNumber')
  findMineOne(
    @Param('requestNumber') requestNumber: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.findMineOne(requestNumber, actor);
  }

  @Post(':requestNumber/messages')
  @UseInterceptors(internalRequestUpload)
  reply(
    @Param('requestNumber') requestNumber: string,
    @Body() input: CreateInternalRequestMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedPrivateFile[] = [],
  ) {
    return this.internalRequests.replyAsStaff(requestNumber, input.body, actor, files);
  }

  @Get(':requestNumber/attachments/:attachmentId/access')
  accessAttachment(
    @Param('requestNumber') requestNumber: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.accessUrl(
      requestNumber,
      attachmentId,
      actor,
      `/api/v1/internal-requests/${requestNumber}/attachments/${attachmentId}/file`,
    );
  }
}

@ApiTags('admin internal requests')
@ApiBearerAuth()
@Controller('admin/internal-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminInternalRequestsController {
  constructor(
    private readonly internalRequests: InternalRequestsService,
    private readonly attachments: InternalRequestAttachmentsService,
  ) {}

  @Get()
  findAll(@Query() query: InternalRequestQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.findAll(query, actor);
  }

  @Get('summary')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.adminSummary(actor);
  }

  @Get('requesters')
  requesters() {
    return this.internalRequests.requesters();
  }

  @Get(':requestNumber')
  findOne(@Param('requestNumber') requestNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.findOne(requestNumber, actor);
  }

  @Post(':requestNumber/take')
  take(@Param('requestNumber') requestNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.take(requestNumber, actor);
  }

  @Post(':requestNumber/messages')
  @UseInterceptors(internalRequestUpload)
  reply(
    @Param('requestNumber') requestNumber: string,
    @Body() input: CreateInternalRequestMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedPrivateFile[] = [],
  ) {
    return this.internalRequests.replyAsAdmin(requestNumber, input.body, actor, files);
  }

  @Post(':requestNumber/start-review')
  startReview(
    @Param('requestNumber') requestNumber: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.startReview(requestNumber, actor);
  }

  @Post(':requestNumber/request-info')
  requestInformation(
    @Param('requestNumber') requestNumber: string,
    @Body() input: RequiredInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.requestInformation(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/approve')
  approve(
    @Param('requestNumber') requestNumber: string,
    @Body() input: OptionalInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.approve(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/reject')
  reject(
    @Param('requestNumber') requestNumber: string,
    @Body() input: RequiredInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.reject(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/escalate')
  escalate(
    @Param('requestNumber') requestNumber: string,
    @Body() input: EscalateInternalRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.escalate(requestNumber, input, actor);
  }

  @Post(':requestNumber/resolve')
  resolve(
    @Param('requestNumber') requestNumber: string,
    @Body() input: RequiredInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.resolve(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/close')
  close(
    @Param('requestNumber') requestNumber: string,
    @Body() input: OptionalInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.close(requestNumber, input.comment, actor);
  }

  @Get(':requestNumber/attachments/:attachmentId/access')
  accessAttachment(
    @Param('requestNumber') requestNumber: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.accessUrl(
      requestNumber,
      attachmentId,
      actor,
      `/api/v1/internal-requests/${requestNumber}/attachments/${attachmentId}/file`,
    );
  }
}

@ApiTags('super admin internal request escalations')
@ApiBearerAuth()
@Controller('super-admin/internal-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class SuperAdminInternalRequestsController {
  constructor(
    private readonly internalRequests: InternalRequestsService,
    private readonly attachments: InternalRequestAttachmentsService,
  ) {}

  @Get()
  findAll(@Query() query: InternalRequestQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.findEscalations(query, actor);
  }

  @Get('summary')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.superAdminSummary(actor);
  }

  @Get('requesters')
  requesters() {
    return this.internalRequests.requesters();
  }

  @Get(':requestNumber')
  findOne(@Param('requestNumber') requestNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.findEscalation(requestNumber, actor);
  }

  @Post(':requestNumber/take')
  take(@Param('requestNumber') requestNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.internalRequests.takeEscalation(requestNumber, actor);
  }

  @Post(':requestNumber/messages')
  @UseInterceptors(internalRequestUpload)
  reply(
    @Param('requestNumber') requestNumber: string,
    @Body() input: CreateInternalRequestMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedPrivateFile[] = [],
  ) {
    return this.internalRequests.replyAsSuperAdmin(requestNumber, input.body, actor, files);
  }

  @Post(':requestNumber/start-review')
  startReview(
    @Param('requestNumber') requestNumber: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.startSuperAdminReview(requestNumber, actor);
  }

  @Post(':requestNumber/request-info')
  requestInformation(
    @Param('requestNumber') requestNumber: string,
    @Body() input: RequiredInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.requestSuperAdminInformation(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/approve')
  approve(
    @Param('requestNumber') requestNumber: string,
    @Body() input: OptionalInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.superAdminApprove(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/reject')
  reject(
    @Param('requestNumber') requestNumber: string,
    @Body() input: RequiredInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.superAdminReject(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/return-to-admin')
  returnToAdmin(
    @Param('requestNumber') requestNumber: string,
    @Body() input: RequiredInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.returnToAdmin(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/resolve')
  resolve(
    @Param('requestNumber') requestNumber: string,
    @Body() input: OptionalInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.superAdminResolve(requestNumber, input.comment, actor);
  }

  @Post(':requestNumber/close')
  close(
    @Param('requestNumber') requestNumber: string,
    @Body() input: OptionalInternalRequestCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.internalRequests.superAdminClose(requestNumber, input.comment, actor);
  }

  @Get(':requestNumber/attachments/:attachmentId/access')
  accessAttachment(
    @Param('requestNumber') requestNumber: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.accessUrl(
      requestNumber,
      attachmentId,
      actor,
      `/api/v1/internal-requests/${requestNumber}/attachments/${attachmentId}/file`,
    );
  }
}

@ApiTags('internal request attachments')
@Controller('internal-requests')
export class InternalRequestAttachmentAccessController {
  constructor(private readonly attachments: InternalRequestAttachmentsService) {}

  @Get(':requestNumber/attachments/:attachmentId/file')
  async file(
    @Param('requestNumber') requestNumber: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Query() query: InternalRequestAttachmentSignatureQueryDto,
    @Res() response: Response,
  ) {
    const { attachment, buffer } = await this.attachments.readLocal(
      requestNumber,
      attachmentId,
      query.expires,
      query.signature,
    );
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Length', buffer.length);
    const filename = attachment.originalName.replace(/[\r\n"]/g, '');
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(buffer);
  }
}
