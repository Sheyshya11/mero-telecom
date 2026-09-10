export interface UploadedPrivateFile {
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
  scan(file: UploadedPrivateFile): Promise<FileScanResult>;
}
