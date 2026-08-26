import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TrustedOriginGuard } from '../auth/trusted-origin.guard';
import {
  CreateCheckoutSessionDto,
  CreatePlanCheckoutSessionDto,
  CreatePublicPlanCheckoutSessionDto,
  PreparePublicCheckoutContextDto,
  PublicCheckoutStatusQueryDto,
} from './dto/create-checkout-session.dto';
import { PaymentsService } from './payments.service';
import { PublicCheckoutContextService } from './public-checkout-context.service';

type StripeRawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly publicCheckoutContext: PublicCheckoutContextService,
  ) {}

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

  @Post('public-checkout-context')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  async preparePublicCheckoutContext(
    @Body() input: PreparePublicCheckoutContextDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const prepared = await this.publicCheckoutContext.prepare(
      input.planId,
      input.qualificationToken,
    );
    response.cookie(
      this.publicCheckoutContext.cookieName,
      prepared.contextToken,
      this.publicCheckoutContext.cookieOptions(),
    );
    return prepared.context;
  }

  @Get('public-checkout-context')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getPublicCheckoutContext(@Req() request: Request) {
    return this.publicCheckoutContext.get(this.checkoutContextToken(request));
  }

  @Post('public-checkout-context/clear')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  async clearPublicCheckoutContext(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.publicCheckoutContext.clear(this.checkoutContextToken(request));
    response.clearCookie(
      this.publicCheckoutContext.cookieName,
      this.publicCheckoutContext.clearCookieOptions(),
    );
  }

  @Post('public-plan-checkout-session')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  createPublicPlanCheckoutSession(
    @Body() input: CreatePublicPlanCheckoutSessionDto,
    @Req() request: Request,
  ) {
    return this.payments.createPublicPlanCheckoutSession(input, this.checkoutContextToken(request));
  }

  @Get('public-checkout-status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getPublicCheckoutStatus(@Query() query: PublicCheckoutStatusQueryDto) {
    return this.payments.getPublicCheckoutStatus(query.sessionId);
  }

  @Get('checkout-status')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  getCheckoutStatus(
    @Query() query: PublicCheckoutStatusQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.getAuthenticatedCheckoutStatus(query.sessionId, user);
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

  @Post('plan-checkout-session')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  createPlanCheckoutSession(
    @Body() input: CreatePlanCheckoutSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.createPlanCheckoutSession(input.planId, user);
  }

  private checkoutContextToken(request: Request): string | undefined {
    const value = (request.cookies as Record<string, unknown> | undefined)?.[
      this.publicCheckoutContext.cookieName
    ];
    return typeof value === 'string' ? value : undefined;
  }
}
