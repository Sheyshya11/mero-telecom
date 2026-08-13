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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AppConfig } from '../../config/configuration';
import type { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
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
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Post('login')
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
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a valid refresh cookie and issue a new access token.' })
  @ApiCookieAuth('refresh_token')
  @ApiOkResponse({ description: 'Token refresh succeeded.' })
  @ApiUnauthorizedResponse({ description: 'Refresh session is invalid or expired.' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const refreshToken = request.cookies?.[this.refreshCookieName] ?? '';
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
}
