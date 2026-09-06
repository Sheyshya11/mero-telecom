export interface UploadedRefundFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface FileScanResult {
  clean: boolean;
  reason?: string;
}

export interface FileSecurityScanner {
  scan(file: UploadedRefundFile): Promise<FileScanResult>;
}
