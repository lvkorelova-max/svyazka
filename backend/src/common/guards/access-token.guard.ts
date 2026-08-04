import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { Request } from 'express';
import { AccessTokenPayload, AuthenticatedUser } from '../../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Требуется вход');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
      if (payload.tokenType !== 'access') throw new UnauthorizedException('Некорректный токен');
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          sessionVersion: true,
          mustChangePassword: true,
          mfaEnabled: true,
        },
      });
      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        user.sessionVersion !== payload.sessionVersion
      ) {
        throw new UnauthorizedException('Аккаунт недоступен');
      }
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Сессия истекла');
    }
  }
}
