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
import { BrandContextRequest } from './brand-context';
import { BrandAccessService } from './brand-access.service';

@Injectable()
export class BrandContextGuard implements CanActivate {
  constructor(private readonly brands: BrandAccessService) {}

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

    await this.brands.getActiveBrandForManager(user.id, brandId);
    request.activeBrandId = brandId;
    return true;
  }
}

export type RequestWithBrandContext = BrandContextRequest & {
  user: AuthenticatedUser;
};
