import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AppConfig } from '../../config/configuration';
import type { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { AccountInvitationsService } from './account-invitations.service';
import {
  ActivateAccountDto,
  ResendAccountInvitationDto,
  VerifyAccountActivationDto,
} from './dto/account-activation.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  ValidatePasswordResetDto,
} from './dto/password-reset.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  FORGOT_PASSWORD_RESPONSE,
  PasswordResetService,
  type PasswordResetRequestContext,
} from './password-reset.service';
import { TrustedOriginGuard } from './trusted-origin.guard';

interface AuthResponse {
  accessToken: string;
  user: AuthenticatedUser;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly refreshCookieName = 'refresh_token';

  constructor(
    private readonly authService: AuthService,
    private readonly invitations: AccountInvitationsService,
    private readonly passwordResets: PasswordResetService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Post('forgot-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset without disclosing account existence.' })
  @ApiOkResponse({ description: 'The generic password-reset acknowledgement.' })
  async forgotPassword(
    @Body() input: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    await this.passwordResets.request(input.email, this.getRequestContext(request));
    return { message: FORGOT_PASSWORD_RESPONSE };
  }

  @Post('reset-password/validate')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a password reset token without consuming it.' })
  validatePasswordReset(@Body() input: ValidatePasswordResetDto): Promise<{ valid: boolean }> {
    return this.passwordResets.validate(input.token);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Consume a one-time token and set a new password.' })
  async resetPassword(
    @Body() input: ResetPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.passwordResets.reset(
      input.token,
      input.newPassword,
      this.getRequestContext(request),
    );
    response.clearCookie(this.refreshCookieName, this.getRefreshCookieOptions());
  }

  @Post('activation/verify')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a customer account activation token.' })
  verifyActivation(@Body() input: VerifyAccountActivationDto): Promise<{ valid: boolean }> {
    return this.invitations.verify(input.token);
  }

  @Post('activation')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Use a single-use invitation to create a customer password.' })
  async activate(@Body() input: ActivateAccountDto): Promise<void> {
    await this.invitations.activate(input.token, input.password);
  }

  @Post('activation/resend')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Request a replacement customer activation email.' })
  async resendActivation(@Body() input: ResendAccountInvitationDto): Promise<void> {
    await this.invitations.resendByEmail(input.email);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and issue an access token and refresh cookie.' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ description: 'Authentication succeeded.' })
  @ApiUnauthorizedResponse({ description: 'Credentials are invalid.' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const { tokens, user } = await this.authService.login(loginDto);

    response.cookie(this.refreshCookieName, tokens.refreshToken, this.getRefreshCookieOptions());

    return { accessToken: tokens.accessToken, user };
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a valid refresh cookie and issue a new access token.' })
  @ApiCookieAuth('refresh_token')
  @ApiOkResponse({ description: 'Token refresh succeeded.' })
  @ApiUnauthorizedResponse({ description: 'Refresh session is invalid or expired.' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse | undefined> {
    const refreshToken = request.cookies?.[this.refreshCookieName] ?? '';
    if (!refreshToken) return undefined;
    const { tokens, user } = await this.authService.refresh(refreshToken);

    response.cookie(this.refreshCookieName, tokens.refreshToken, this.getRefreshCookieOptions());

    return { accessToken: tokens.accessToken, user };
  }

  @Post('logout')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current refresh session and clear its cookie.' })
  @ApiCookieAuth('refresh_token')
  @ApiNoContentResponse({ description: 'Logout completed.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = request.cookies?.[this.refreshCookieName];
    await this.authService.logout(refreshToken);
    response.clearCookie(this.refreshCookieName, this.getRefreshCookieOptions());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the currently authenticated user.' })
  @ApiOkResponse({ description: 'Current user returned.' })
  @ApiUnauthorizedResponse({ description: 'Access token is missing, invalid, or expired.' })
  getMe(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  private getRefreshCookieOptions(): CookieOptions {
    const isProduction = this.configService.getOrThrow('app').environment === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/api/v1/auth',
      maxAge: this.authService.getRefreshTokenLifetimeMilliseconds(),
    };
  }

  private getRequestContext(request: Request): PasswordResetRequestContext {
    const requestId = request.headers['x-request-id'];
    return {
      requestId: Array.isArray(requestId) ? requestId[0] : requestId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
