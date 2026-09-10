import { Injectable } from '@nestjs/common';

import {
  ALLOWED_PRIVATE_FILE_MIME_TYPES,
  PrivateFileSecurityService,
} from '../../common/files/private-file-security.service';

export const ALLOWED_REFUND_MIME_TYPES = ALLOWED_PRIVATE_FILE_MIME_TYPES;

@Injectable()
export class RefundFileSecurityService extends PrivateFileSecurityService {}
