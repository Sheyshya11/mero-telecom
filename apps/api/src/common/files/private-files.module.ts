import { Module } from '@nestjs/common';

import { PrivateAttachmentStorageService } from './private-attachment-storage.service';
import { PrivateFileSecurityService } from './private-file-security.service';

@Module({
  providers: [PrivateAttachmentStorageService, PrivateFileSecurityService],
  exports: [PrivateAttachmentStorageService, PrivateFileSecurityService],
})
export class PrivateFilesModule {}
