import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { isUUID } from 'class-validator';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { BrandContextRequest } from './brand-context';

@Injectable()
export class BrandContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; activeBrandId?: string }>();
    const user = request.user;
    if (!user || user.role !== UserRole.MANAGER) return true;
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Аккаунт недоступен');

    const brandId = request.header('x-active-brand-id');
    if (!brandId || !isUUID(brandId, '4')) {
      throw new ForbiddenException('Требуется явный активный бренд');
    }

    const assignment = await this.prisma.brandManagerAssignment.findFirst({
      where: { brandId, managerId: user.id, removedAt: null },
      select: { brandId: true },
    });
    if (!assignment) throw new ForbiddenException('Нет активного доступа к бренду');

    request.activeBrandId = brandId;
    return true;
  }
}

export type RequestWithBrandContext = BrandContextRequest & {
  user: AuthenticatedUser;
};
