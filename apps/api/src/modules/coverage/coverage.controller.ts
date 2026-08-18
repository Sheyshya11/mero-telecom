import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CoverageService } from './coverage.service';
import { CoverageQueryDto } from './dto/coverage-query.dto';

@ApiTags('coverage')
@Controller('coverage')
export class CoverageController {
  constructor(private readonly coverage: CoverageService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check prototype service availability by Australian postcode.' })
  @ApiOkResponse({ description: 'Coverage status and available plans returned.' })
  lookup(@Query() query: CoverageQueryDto) {
    return this.coverage.lookup(query.postcode);
  }
}
