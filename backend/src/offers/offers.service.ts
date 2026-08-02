import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OfferStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';

const ALLOWED_TRANSITIONS: Record<string, OfferStatus[]> = {
  [OfferStatus.DRAFT]: [OfferStatus.PUBLISHED, OfferStatus.ARCHIVED],
  [OfferStatus.PUBLISHED]: [OfferStatus.PAUSED, OfferStatus.ARCHIVED],
  [OfferStatus.PAUSED]: [OfferStatus.PUBLISHED, OfferStatus.ARCHIVED],
  [OfferStatus.MODERATION]: [],
  [OfferStatus.ARCHIVED]: [],
};

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(userId: string, dto: CreateOfferDto) {
    const brand = await this.getBrandByUserId(userId);
    const platformCommissionBps = Number(
      this.config.get<string>('PLATFORM_COMMISSION_BPS') ?? 500,
    );
    if (
      !Number.isInteger(platformCommissionBps) ||
      platformCommissionBps < 0 ||
      platformCommissionBps > 10_000
    ) {
      throw new Error('PLATFORM_COMMISSION_BPS must be an integer from 0 to 10000');
    }
    return this.prisma.offer.create({
      data: {
        ...dto,
        brandId: brand.id,
        platformCommissionBps,
        status: OfferStatus.DRAFT,
      },
      include: { brand: true },
    });
  }

  async listOwn(userId: string) {
    const brand = await this.getBrandByUserId(userId);
    return this.prisma.offer.findMany({
      where: { brandId: brand.id },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOwn(userId: string, offerId: string) {
    const brand = await this.getBrandByUserId(userId);
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { brand: true },
    });
    if (!offer) throw new NotFoundException('Оффер не найден');
    if (offer.brandId !== brand.id) throw new ForbiddenException('Нет доступа к этому офферу');
    return offer;
  }

  async updateOwn(userId: string, offerId: string, dto: UpdateOfferDto) {
    const offer = await this.getOwn(userId, offerId);
    if (offer.status === OfferStatus.ARCHIVED) {
      throw new BadRequestException('Архивированный оффер нельзя редактировать');
    }
    return this.prisma.offer.update({
      where: { id: offer.id },
      data: dto,
      include: { brand: true },
    });
  }

  async transition(userId: string, offerId: string, target: OfferStatus) {
    const offer = await this.getOwn(userId, offerId);
    if (!ALLOWED_TRANSITIONS[offer.status].includes(target)) {
      throw new BadRequestException(`Переход ${offer.status} → ${target} недоступен`);
    }
    return this.prisma.offer.update({
      where: { id: offer.id },
      data: { status: target },
      include: { brand: true },
    });
  }

  listPublished() {
    return this.prisma.offer.findMany({
      where: { status: OfferStatus.PUBLISHED },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPublished(offerId: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
      include: { brand: true },
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    return offer;
  }

  private async getBrandByUserId(userId: string) {
    const brand = await this.prisma.brandProfile.findUnique({ where: { userId } });
    if (!brand) throw new ForbiddenException('Профиль бренда не найден');
    return brand;
  }
}
