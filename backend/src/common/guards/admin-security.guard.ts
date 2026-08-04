import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminSecurityGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (this.config.get<string>('ADMIN_MFA_REQUIRED') !== 'true') return true;
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (request.user?.role !== UserRole.ADMIN) return true;
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { mfaEnabled: true, mustChangePassword: true },
    });
    if (!user || user.mustChangePassword) {
      throw new ForbiddenException('Сначала смените временный пароль администратора');
    }
    if (!user.mfaEnabled) {
      throw new ForbiddenException('Для финансовых действий администратора требуется MFA');
    }
    return true;
  }
}
