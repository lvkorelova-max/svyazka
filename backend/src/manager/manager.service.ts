import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateManagerProfileDto } from './dto/update-manager-profile.dto';

@Injectable()
export class ManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getProfile(userId: string) {
    const manager = await this.requireActiveManager(userId);
    const profile = await this.prisma.managerProfile.findUnique({ where: { userId } });
    if (!profile) {
      return this.prisma.managerProfile.create({
        data: { userId, displayName: manager.email },
      });
    }
    return profile;
  }

  async updateProfile(userId: string, dto: UpdateManagerProfileDto) {
    await this.requireActiveManager(userId);
    return this.prisma.managerProfile.upsert({
      where: { userId },
      create: {
        userId,
        displayName: dto.displayName.trim(),
        jobTitle: dto.jobTitle?.trim() || null,
      },
      update: {
        displayName: dto.displayName.trim(),
        jobTitle: dto.jobTitle?.trim() || null,
      },
    });
  }

  async listBrandManagers(adminUserId: string, brandId: string) {
    await this.requireAdmin(adminUserId);
    await this.requireBrand(brandId);
    return this.prisma.brandManagerAssignment.findMany({
      where: { brandId, removedAt: null },
      orderBy: { assignedAt: 'asc' },
      include: {
        manager: {
          select: {
            id: true,
            email: true,
            status: true,
            managerProfile: true,
          },
        },
      },
    });
  }

  async listEligibleManagers(adminUserId: string) {
    await this.requireAdmin(adminUserId);
    return this.prisma.user.findMany({
      where: { role: UserRole.MANAGER, status: UserStatus.ACTIVE },
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        status: true,
        managerProfile: true,
      },
    });
  }

  async assignManager(adminUserId: string, brandId: string, managerId: string) {
    await this.requireAdmin(adminUserId);
    await this.requireBrand(brandId);
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      include: { managerProfile: true },
    });
    if (!manager || manager.role !== UserRole.MANAGER || manager.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Активный пользователь-менеджер не найден');
    }

    return this.prisma.$transaction(async (tx) => {
      const active = await tx.brandManagerAssignment.findFirst({
        where: { brandId, managerId, removedAt: null },
      });
      if (active) throw new ConflictException('Менеджер уже назначен на бренд');

      await tx.managerProfile.upsert({
        where: { userId: manager.id },
        create: { userId: manager.id, displayName: manager.email },
        update: {},
      });

      const assignment = await tx.brandManagerAssignment.create({
        data: { brandId, managerId, assignedBy: adminUserId },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'BRAND_MANAGER_ASSIGNED',
          entityType: 'BrandManagerAssignment',
          entityId: assignment.id,
          requestId: this.audit.requestId(),
          metadata: { brandId, managerId },
        },
      });
      return assignment;
    });
  }

  async removeManager(adminUserId: string, brandId: string, managerId: string) {
    await this.requireAdmin(adminUserId);
    await this.requireBrand(brandId);
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.brandManagerAssignment.findFirst({
        where: { brandId, managerId, removedAt: null },
      });
      if (!active) throw new NotFoundException('Активное назначение не найдено');
      const removedAt = new Date();
      const assignment = await tx.brandManagerAssignment.update({
        where: { id: active.id },
        data: { removedAt, removedBy: adminUserId },
      });
      await tx.offer.updateMany({
        where: { brandId, currentManagerId: managerId },
        data: { currentManagerId: null },
      });
      await tx.affiliateRelationship.updateMany({
        where: { offer: { brandId }, currentManagerId: managerId },
        data: { currentManagerId: null },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'BRAND_MANAGER_REMOVED',
          entityType: 'BrandManagerAssignment',
          entityId: assignment.id,
          requestId: this.audit.requestId(),
          metadata: {
            brandId,
            managerId,
            responsibilitiesCleared: true,
          },
        },
      });
      return assignment;
    });
  }

  async listBrands(userId: string) {
    await this.requireActiveManager(userId);
    const assignments = await this.prisma.brandManagerAssignment.findMany({
      where: { managerId: userId, removedAt: null },
      orderBy: { assignedAt: 'asc' },
      include: {
        brand: {
          select: {
            id: true,
            brandName: true,
            legalName: true,
            logoUrl: true,
            verificationStatus: true,
          },
        },
      },
    });
    return assignments.map(({ brand, assignedAt }) => ({ ...brand, assignedAt }));
  }

  private async requireActiveManager(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== UserRole.MANAGER || user.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('Профиль менеджера не найден');
    }
    return user;
  }

  private async requireAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== UserRole.ADMIN || user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Администратор не найден');
    }
  }

  private async requireBrand(brandId: string) {
    const brand = await this.prisma.brandProfile.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Бренд не найден');
    return brand;
  }
}
