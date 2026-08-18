import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';

import { HealthService, type HealthResponse, type ReadinessResponse } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOkResponse({ description: 'Reports whether the API is running.' })
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'Reports whether PostgreSQL and Redis are ready.' })
  @ApiServiceUnavailableResponse({ description: 'A required managed service is unavailable.' })
  getReadiness(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }
}
