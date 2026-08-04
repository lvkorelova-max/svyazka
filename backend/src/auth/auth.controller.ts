import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import {
  BeginMfaEnrollmentDto,
  ConfirmMfaEnrollmentDto,
  VerifyMfaLoginDto,
} from './dto/mfa.dto';
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  RequestPasswordResetDto,
} from './dto/password.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @RateLimit({ scope: 'auth-register', limit: 20, windowSeconds: 900 })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(dto, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @HttpCode(200)
  @Post('login')
  @RateLimit({ scope: 'auth-login', limit: 50, windowSeconds: 900 })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto, this.metadata(request));
    if ('mfaRequired' in result) return result;
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @HttpCode(200)
  @Post('refresh')
  @RateLimit({ scope: 'auth-refresh', limit: 60, windowSeconds: 300 })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.refresh(
      request.cookies?.[this.cookieName()],
      this.metadata(request),
    );
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @HttpCode(204)
  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[this.cookieName()]);
    response.clearCookie(this.cookieName(), this.cookieOptions());
  }

  @HttpCode(200)
  @Post('password-reset/request')
  @RateLimit({ scope: 'password-reset-request', limit: 5, windowSeconds: 3600 })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset(dto);
  }

  @HttpCode(200)
  @Post('password-reset/confirm')
  @RateLimit({ scope: 'password-reset-confirm', limit: 10, windowSeconds: 900 })
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.auth.confirmPasswordReset(dto);
  }

  @HttpCode(200)
  @Post('password/change')
  @UseGuards(AccessTokenGuard)
  @RateLimit({ scope: 'password-change', limit: 5, windowSeconds: 900 })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, dto);
  }

  @Post('admin/mfa/enroll')
  @UseGuards(AccessTokenGuard)
  @RateLimit({ scope: 'mfa-enroll', limit: 5, windowSeconds: 900 })
  beginMfaEnrollment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BeginMfaEnrollmentDto,
  ) {
    return this.auth.beginMfaEnrollment(user.id, dto);
  }

  @Post('admin/mfa/confirm')
  @UseGuards(AccessTokenGuard)
  @RateLimit({ scope: 'mfa-confirm', limit: 10, windowSeconds: 900 })
  confirmMfaEnrollment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmMfaEnrollmentDto,
  ) {
    return this.auth.confirmMfaEnrollment(user.id, dto);
  }

  @HttpCode(200)
  @Post('admin/mfa/verify')
  @RateLimit({ scope: 'mfa-verify', limit: 10, windowSeconds: 900 })
  async verifyMfaLogin(
    @Body() dto: VerifyMfaLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyMfaLogin(dto, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  private metadata(request: Request) {
    return {
      userAgent: request.get('user-agent')?.slice(0, 500),
      ipAddress: request.ip?.slice(0, 64),
    };
  }

  private cookieName() {
    return this.config.get<string>('REFRESH_COOKIE_NAME') ?? 'svyazka_refresh';
  }

  private cookieOptions() {
    const configuredSameSite = this.config.get<string>('COOKIE_SAME_SITE') ?? 'lax';
    if (!['lax', 'strict', 'none'].includes(configuredSameSite)) {
      throw new Error('COOKIE_SAME_SITE must be lax, strict or none');
    }
    const sameSite = configuredSameSite as 'lax' | 'strict' | 'none';
    const domain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    return {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      sameSite,
      domain,
      path: '/api/auth',
    } as const;
  }

  private setRefreshCookie(response: Response, token: string) {
    const ttlDays = Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 30);
    response.cookie(this.cookieName(), token, {
      ...this.cookieOptions(),
      maxAge: ttlDays * 86_400_000,
    });
  }
}
