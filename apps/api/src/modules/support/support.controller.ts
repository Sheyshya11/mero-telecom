import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UploadedPrivateFile } from '../../common/files/private-file.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { asCustomerContext, type AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AttachmentSignatureQueryDto,
  CreateSupportCaseDto,
  CreateSupportMessageDto,
  CreatePublicEnquiryDto,
  LinkSupportCustomerDto,
  ResolveSupportCaseDto,
  SupportCaseQueryDto,
  UpdateSupportPriorityDto,
  UpdateSupportStatusDto,
} from './dto/support.dto';
import { SupportAttachmentsService } from './support-attachments.service';
import { SupportService } from './support.service';

const supportUpload = FilesInterceptor('files', 5, {
  limits: { files: 5, fileSize: 25 * 1024 * 1024 },
});

@ApiTags('public support')
@Controller('support/public/enquiries')
export class PublicSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  create(
    @Body() input: CreatePublicEnquiryDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.support.createPublicEnquiry(input, idempotencyKey);
  }
}

@ApiTags('customer support')
@ApiBearerAuth()
@Controller('customer/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class CustomerSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly attachments: SupportAttachmentsService,
  ) {}

  @Post()
  @UseInterceptors(supportUpload)
  create(
    @Body() input: CreateSupportCaseDto,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedPrivateFile[] = [],
  ) {
    return this.support.create(input, asCustomerContext(actor), files);
  }

  @Get()
  findMine(@Query() query: SupportCaseQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.support.findMine(query, asCustomerContext(actor));
  }

  @Get(':caseNumber')
  findMineOne(@Param('caseNumber') caseNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.support.findMineOne(caseNumber, asCustomerContext(actor));
  }

  @Post(':caseNumber/messages')
  @UseInterceptors(supportUpload)
  reply(
    @Param('caseNumber') caseNumber: string,
    @Body() input: CreateSupportMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedPrivateFile[] = [],
  ) {
    return this.support.replyAsCustomer(caseNumber, input.body, asCustomerContext(actor), files);
  }

  @Get(':caseNumber/attachments/:attachmentId/access')
  accessAttachment(
    @Param('caseNumber') caseNumber: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.accessUrl(
      caseNumber,
      attachmentId,
      asCustomerContext(actor),
      `/api/v1/support/${caseNumber}/attachments/${attachmentId}/file`,
    );
  }
}

@ApiTags('staff support')
@ApiBearerAuth()
@Controller('staff/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN)
export class StaffSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly attachments: SupportAttachmentsService,
  ) {}

  @Get()
  findAll(@Query() query: SupportCaseQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.support.findAll(query, actor);
  }

  @Get('summary')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.support.summary(actor);
  }

  @Get(':caseNumber')
  findOne(@Param('caseNumber') caseNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.support.findOne(caseNumber, actor);
  }

  @Post(':caseNumber/take')
  take(@Param('caseNumber') caseNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.support.take(caseNumber, actor);
  }

  @Post(':caseNumber/messages')
  @UseInterceptors(supportUpload)
  reply(
    @Param('caseNumber') caseNumber: string,
    @Body() input: CreateSupportMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: UploadedPrivateFile[] = [],
  ) {
    return this.support.replyAsStaff(caseNumber, input.body, actor, files);
  }

  @Post(':caseNumber/internal-notes')
  addInternalNote(
    @Param('caseNumber') caseNumber: string,
    @Body() input: CreateSupportMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.addInternalNote(caseNumber, input.body, actor);
  }

  @Post(':caseNumber/link-customer')
  linkCustomer(
    @Param('caseNumber') caseNumber: string,
    @Body() input: LinkSupportCustomerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.linkProspectToCustomer(caseNumber, input.customerNumber, actor);
  }

  @Patch(':caseNumber/status')
  changeStatus(
    @Param('caseNumber') caseNumber: string,
    @Body() input: UpdateSupportStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.changeStatus(caseNumber, input.status, actor);
  }

  @Patch(':caseNumber/priority')
  changePriority(
    @Param('caseNumber') caseNumber: string,
    @Body() input: UpdateSupportPriorityDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.changePriority(caseNumber, input.priority, actor);
  }

  @Post(':caseNumber/resolve')
  resolve(
    @Param('caseNumber') caseNumber: string,
    @Body() input: ResolveSupportCaseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.resolve(caseNumber, input.resolutionNote, actor);
  }

  @Get(':caseNumber/attachments/:attachmentId/access')
  accessAttachment(
    @Param('caseNumber') caseNumber: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.accessUrl(
      caseNumber,
      attachmentId,
      actor,
      `/api/v1/support/${caseNumber}/attachments/${attachmentId}/file`,
    );
  }
}

@ApiTags('support attachments')
@Controller('support')
export class SupportAttachmentAccessController {
  constructor(private readonly attachments: SupportAttachmentsService) {}

  @Get(':caseNumber/attachments/:attachmentId/file')
  async file(
    @Param('caseNumber') caseNumber: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Query() query: AttachmentSignatureQueryDto,
    @Res() response: Response,
  ) {
    const { attachment, buffer } = await this.attachments.readLocal(
      caseNumber,
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
