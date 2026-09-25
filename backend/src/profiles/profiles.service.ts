import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BrandAccessService } from '../brand-access/brand-access.service';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandAccessService,
  ) {}

  async getBrand(userId: string, activeBrandId?: string) {
    return this.brands.resolveBrand(userId, activeBrandId);
  }

  async updateBrand(userId: string, dto: UpdateBrandProfileDto, activeBrandId?: string) {
    const profile = await this.getBrand(userId, activeBrandId);
    return this.prisma.brandProfile.update({ where: { id: profile.id }, data: dto });
  }

  async getCreator(userId: string) {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Профиль креатора не найден');
    return profile;
  }

  async updateCreator(userId: string, dto: UpdateCreatorProfileDto) {
    await this.getCreator(userId);
    return this.prisma.creatorProfile.update({
      where: { userId },
      data: {
        ...dto,
        socialLinks: dto.socialLinks ? { ...dto.socialLinks } : undefined,
      },
    });
  }
}
