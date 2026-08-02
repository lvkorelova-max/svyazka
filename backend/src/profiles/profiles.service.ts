import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async getBrand(userId: string) {
    const profile = await this.prisma.brandProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Профиль бренда не найден');
    return profile;
  }

  async updateBrand(userId: string, dto: UpdateBrandProfileDto) {
    await this.getBrand(userId);
    return this.prisma.brandProfile.update({ where: { userId }, data: dto });
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
