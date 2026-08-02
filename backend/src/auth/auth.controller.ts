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
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
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
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @HttpCode(200)
  @Post('refresh')
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
