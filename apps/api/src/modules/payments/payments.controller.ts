import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { PaymentsService } from './payments.service';

type StripeRawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('stripe/webhook')
  @HttpCode(200)
  async handleStripeWebhook(
    @Req() request: StripeRawBodyRequest,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!request.rawBody) throw new BadRequestException('Stripe webhook raw body is required.');
    await this.payments.processStripeWebhook(request.rawBody, signature);
    return { received: true };
  }

  @Post('checkout-session')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  createCheckoutSession(
    @Body() input: CreateCheckoutSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.createCheckoutSession(input.invoiceId, user);
  }
}
