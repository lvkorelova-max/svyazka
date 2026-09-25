import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BrandAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveBrand(userId: string, activeBrandId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Аккаунт недоступен');
    }

    if (user.role === UserRole.MANAGER) {
      if (!activeBrandId) throw new ForbiddenException('Требуется явный активный бренд');
      return this.getActiveBrandForManager(userId, activeBrandId);
    }
    if (user.role !== UserRole.BRAND) {
      throw new ForbiddenException('Недостаточно прав для бренда');
    }

    const brand = await this.prisma.brandProfile.findUnique({ where: { userId } });
    if (!brand) throw new ForbiddenException('Профиль бренда не найден');
    return brand;
  }

  async getActiveBrandForManager(userId: string, brandId: string) {
    const assignment = await this.prisma.brandManagerAssignment.findFirst({
      where: { brandId, managerId: userId, removedAt: null },
      select: { brandId: true },
    });
    if (!assignment) throw new ForbiddenException('Нет активного доступа к бренду');

    const brand = await this.prisma.brandProfile.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Бренд не найден');
    return brand;
  }
}
