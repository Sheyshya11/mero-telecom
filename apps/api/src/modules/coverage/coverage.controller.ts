import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CoverageService } from './coverage.service';
import {
  AddressSuggestionQueryDto,
  AddressSuggestionsResponseDto,
  CoverageCheckDto,
  CoverageResponseDto,
} from './dto/coverage.dto';

@ApiTags('coverage')
@Controller('coverage')
export class CoverageController {
  constructor(private readonly coverage: CoverageService) {}

  @Get('address-suggestions')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Autocomplete an Australian address through the configured provider.' })
  @ApiOkResponse({ type: AddressSuggestionsResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'The provider or trusted-selection cache is unavailable.',
  })
  suggestions(@Query() query: AddressSuggestionQueryDto) {
    return this.coverage.addressSuggestions(query.query);
  }

  @Post('check')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Estimate serviceability for a server-trusted selected address.' })
  @ApiOkResponse({ type: CoverageResponseDto })
  check(@Body() input: CoverageCheckDto) {
    return this.coverage.check(input.selectionToken);
  }
}
