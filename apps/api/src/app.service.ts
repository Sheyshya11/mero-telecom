import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus(): { service: string; status: string } {
    return {
      service: 'mero-telecom-api',
      status: 'running',
    };
  }
}
