import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OfferStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BrandAccessService } from '../brand-access/brand-access.service';
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
  private readonly offerInclude = {
    brand: true,
    currentManager: {
      select: {
        id: true,
        managerProfile: { select: { displayName: true } },
      },
    },
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly brands: BrandAccessService,
  ) {}

  async create(userId: string, dto: CreateOfferDto, activeBrandId?: string) {
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    const manager = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
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
    const offer = await this.prisma.offer.create({
      data: {
        ...dto,
        brandId: brand.id,
        ...(manager?.role === 'MANAGER'
          ? { createdByManagerId: userId, currentManagerId: userId }
          : {}),
        platformCommissionBps,
        status: OfferStatus.DRAFT,
      },
      include: this.offerInclude,
    });
    return this.withManagerIdentity(offer);
  }

  async listOwn(userId: string, activeBrandId?: string) {
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    const offers = await this.prisma.offer.findMany({
      where: { brandId: brand.id },
      include: this.offerInclude,
      orderBy: { createdAt: 'desc' },
    });
    return offers.map((offer) => this.withManagerIdentity(offer));
  }

  async getOwn(userId: string, offerId: string, activeBrandId?: string) {
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: this.offerInclude,
    });
    if (!offer) throw new NotFoundException('Оффер не найден');
    if (offer.brandId !== brand.id) throw new ForbiddenException('Нет доступа к этому офферу');
    return this.withManagerIdentity(offer);
  }

  async updateOwn(userId: string, offerId: string, dto: UpdateOfferDto, activeBrandId?: string) {
    const offer = await this.getOwn(userId, offerId, activeBrandId);
    if (offer.status === OfferStatus.ARCHIVED) {
      throw new BadRequestException('Архивированный оффер нельзя редактировать');
    }
    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: dto,
      include: this.offerInclude,
    });
    if (
      dto.creatorCommissionBps !== undefined &&
      dto.creatorCommissionBps !== offer.creatorCommissionBps
    ) {
      await this.audit.record({
        actorUserId: userId,
        action: 'OFFER_COMMISSION_RATE_CHANGED',
        entityType: 'Offer',
        entityId: offer.id,
        metadata: {
          previousCreatorCommissionBps: offer.creatorCommissionBps,
          nextCreatorCommissionBps: dto.creatorCommissionBps,
        },
      });
    }
    return this.withManagerIdentity(updated);
  }

  async transition(userId: string, offerId: string, target: OfferStatus, activeBrandId?: string) {
    const offer = await this.getOwn(userId, offerId, activeBrandId);
    if (!ALLOWED_TRANSITIONS[offer.status].includes(target)) {
      throw new BadRequestException(`Переход ${offer.status} → ${target} недоступен`);
    }
    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: { status: target },
      include: this.offerInclude,
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'OFFER_STATUS_CHANGED',
      entityType: 'Offer',
      entityId: offer.id,
      metadata: { previousStatus: offer.status, nextStatus: target },
    });
    return this.withManagerIdentity(updated);
  }

  async updateResponsibility(
    userId: string,
    offerId: string,
    activeBrandId: string,
    managerId: string | null,
  ) {
    const offer = await this.getOwn(userId, offerId, activeBrandId);
    if (managerId) await this.brands.assertManagerAssignedToBrand(managerId, offer.brandId);
    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: { currentManagerId: managerId },
      include: this.offerInclude,
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'OFFER_RESPONSIBILITY_CHANGED',
      entityType: 'Offer',
      entityId: offer.id,
      metadata: {
        previousManagerId: offer.currentManagerId,
        newManagerId: managerId,
      },
    });
    return this.withManagerIdentity(updated);
  }

  async listPublished() {
    const offers = await this.prisma.offer.findMany({
      where: { status: OfferStatus.PUBLISHED },
      include: this.offerInclude,
      orderBy: { createdAt: 'desc' },
    });
    return offers.map((offer) => this.withManagerIdentity(offer));
  }

  async getPublished(offerId: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
      include: this.offerInclude,
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    return this.withManagerIdentity(offer);
  }

  private withManagerIdentity<T extends { currentManager?: { id: string; managerProfile: { displayName: string } | null } | null }>(
    offer: T,
  ) {
    const { currentManager, ...rest } = offer;
    return {
      ...rest,
      currentManager: currentManager
        ? {
            id: currentManager.id,
            displayName: currentManager.managerProfile?.displayName ?? null,
          }
        : null,
    };
  }
}
