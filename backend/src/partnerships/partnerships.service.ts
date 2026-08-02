import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AffiliateRelationshipStatus,
  OfferApplicationStatus,
  OfferStatus,
  Prisma,
} from '@prisma/client';
import { createHmac, randomBytes, randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';

const PUBLIC_BRAND_SELECT = {
  id: true,
  brandName: true,
  website: true,
  description: true,
  logoUrl: true,
} satisfies Prisma.BrandProfileSelect;

const PUBLIC_CREATOR_SELECT = {
  id: true,
  displayName: true,
  description: true,
  socialLinks: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CreatorProfileSelect;

const APPLICATION_INCLUDE = {
  offer: { include: { brand: { select: PUBLIC_BRAND_SELECT } } },
  creator: { select: PUBLIC_CREATOR_SELECT },
  affiliateRelationship: true,
} satisfies Prisma.OfferApplicationInclude;

const RELATIONSHIP_INCLUDE = {
  offer: { include: { brand: { select: PUBLIC_BRAND_SELECT } } },
  creator: { select: PUBLIC_CREATOR_SELECT },
  application: {
    select: {
      id: true,
      message: true,
      status: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.AffiliateRelationshipInclude;

const PROMO_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RELATIONSHIP_TRANSITIONS: Record<AffiliateRelationshipStatus, AffiliateRelationshipStatus[]> = {
  ACTIVE: [AffiliateRelationshipStatus.PAUSED, AffiliateRelationshipStatus.REVOKED],
  PAUSED: [AffiliateRelationshipStatus.ACTIVE, AffiliateRelationshipStatus.REVOKED],
  REVOKED: [],
};

@Injectable()
export class PartnershipsService {
  private readonly logger = new Logger(PartnershipsService.name);
  private readonly clickRateWindows = new Map<string, { count: number; startedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createApplication(userId: string, offerId: string, dto: CreateApplicationDto) {
    const creator = await this.getCreator(userId);
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');

    const liveRelationship = await this.prisma.affiliateRelationship.findFirst({
      where: {
        offerId,
        creatorId: creator.id,
        status: { in: [AffiliateRelationshipStatus.ACTIVE, AffiliateRelationshipStatus.PAUSED] },
      },
    });
    if (liveRelationship) {
      throw new ConflictException('Партнёрская связь по этому офферу уже существует');
    }

    try {
      return await this.prisma.offerApplication.create({
        data: {
          offerId,
          creatorId: creator.id,
          message: dto.message?.trim() || null,
        },
        include: APPLICATION_INCLUDE,
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('Активная заявка на этот оффер уже существует');
      }
      throw error;
    }
  }

  async listCreatorApplications(userId: string) {
    const creator = await this.getCreator(userId);
    return this.prisma.offerApplication.findMany({
      where: { creatorId: creator.id },
      include: APPLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCreatorApplication(userId: string, applicationId: string) {
    const creator = await this.getCreator(userId);
    const application = await this.prisma.offerApplication.findFirst({
      where: { id: applicationId, creatorId: creator.id },
      include: APPLICATION_INCLUDE,
    });
    if (!application) throw new NotFoundException('Заявка не найдена');
    return application;
  }

  async cancelApplication(userId: string, applicationId: string) {
    const application = await this.getCreatorApplication(userId, applicationId);
    if (application.status === OfferApplicationStatus.CANCELLED) return application;
    if (application.status !== OfferApplicationStatus.PENDING) {
      throw new ConflictException('Отменить можно только ожидающую заявку');
    }
    return this.prisma.offerApplication.update({
      where: { id: application.id },
      data: { status: OfferApplicationStatus.CANCELLED },
      include: APPLICATION_INCLUDE,
    });
  }

  async listBrandApplications(userId: string, offerId: string) {
    const brand = await this.getBrand(userId);
    await this.assertOwnedOffer(brand.id, offerId);
    return this.prisma.offerApplication.findMany({
      where: { offerId },
      include: APPLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBrandApplication(userId: string, applicationId: string) {
    const brand = await this.getBrand(userId);
    const application = await this.prisma.offerApplication.findUnique({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
    if (!application) throw new NotFoundException('Заявка не найдена');
    if (application.offer.brandId !== brand.id) {
      throw new ForbiddenException('Нет доступа к этой заявке');
    }
    return application;
  }

  async approveApplication(userId: string, applicationId: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const affiliateCode = randomBytes(24).toString('base64url');
      const promoCode = this.generatePromoCode();
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const brand = await tx.brandProfile.findUnique({ where: { userId } });
            if (!brand) throw new ForbiddenException('Профиль бренда не найден');
            const application = await tx.offerApplication.findUnique({
              where: { id: applicationId },
              include: APPLICATION_INCLUDE,
            });
            if (!application) throw new NotFoundException('Заявка не найдена');
            if (application.offer.brandId !== brand.id) {
              throw new ForbiddenException('Нет доступа к этой заявке');
            }
            if (application.status === OfferApplicationStatus.APPROVED) {
              if (!application.affiliateRelationship) {
                throw new ConflictException('Одобренная заявка не содержит партнёрскую связь');
              }
              return application.affiliateRelationship;
            }
            if (application.status !== OfferApplicationStatus.PENDING) {
              throw new ConflictException('Заявку нельзя одобрить в текущем статусе');
            }
            if (!application.offer.productUrl) {
              throw new BadRequestException('Для одобрения у оффера должна быть ссылка на товар');
            }
            this.validateDestination(application.offer.productUrl);

            const liveRelationship = await tx.affiliateRelationship.findFirst({
              where: {
                offerId: application.offerId,
                creatorId: application.creatorId,
                status: {
                  in: [
                    AffiliateRelationshipStatus.ACTIVE,
                    AffiliateRelationshipStatus.PAUSED,
                  ],
                },
              },
            });
            if (liveRelationship) {
              throw new ConflictException(
                'Для креатора уже существует рабочая связь по этому офферу',
              );
            }

            const updated = await tx.offerApplication.updateMany({
              where: { id: application.id, status: OfferApplicationStatus.PENDING },
              data: {
                status: OfferApplicationStatus.APPROVED,
                reviewedAt: new Date(),
                reviewedByUserId: userId,
              },
            });
            if (updated.count !== 1) {
              throw new Prisma.PrismaClientKnownRequestError('Concurrent approval', {
                code: 'P2034',
                clientVersion: Prisma.prismaVersion.client,
              });
            }
            return tx.affiliateRelationship.create({
              data: {
                offerId: application.offerId,
                creatorId: application.creatorId,
                applicationId: application.id,
                affiliateCode,
                promoCode,
                destinationUrl: application.offer.productUrl,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return this.presentRelationship(result);
      } catch (error) {
        if (this.isRetryableApproval(error)) continue;
        throw error;
      }
    }
    throw new ConflictException('Не удалось создать уникальные партнёрские коды');
  }

  async rejectApplication(userId: string, applicationId: string) {
    const application = await this.getBrandApplication(userId, applicationId);
    if (application.status === OfferApplicationStatus.REJECTED) return application;
    if (application.status !== OfferApplicationStatus.PENDING) {
      throw new ConflictException('Заявку нельзя отклонить в текущем статусе');
    }
    return this.prisma.offerApplication.update({
      where: { id: application.id },
      data: {
        status: OfferApplicationStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedByUserId: userId,
      },
      include: APPLICATION_INCLUDE,
    });
  }

  async listCreatorRelationships(userId: string) {
    const creator = await this.getCreator(userId);
    const relationships = await this.prisma.affiliateRelationship.findMany({
      where: { creatorId: creator.id },
      include: RELATIONSHIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return relationships.map((relationship) => this.presentRelationship(relationship));
  }

  async getCreatorRelationship(userId: string, relationshipId: string) {
    const creator = await this.getCreator(userId);
    const relationship = await this.prisma.affiliateRelationship.findFirst({
      where: { id: relationshipId, creatorId: creator.id },
      include: RELATIONSHIP_INCLUDE,
    });
    if (!relationship) throw new NotFoundException('Партнёрская связь не найдена');
    return this.presentRelationship(relationship);
  }

  async listBrandRelationships(userId: string, offerId?: string) {
    const brand = await this.getBrand(userId);
    if (offerId) await this.assertOwnedOffer(brand.id, offerId);
    const relationships = await this.prisma.affiliateRelationship.findMany({
      where: {
        offer: { brandId: brand.id },
        ...(offerId ? { offerId } : {}),
      },
      include: RELATIONSHIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return relationships.map((relationship) => this.presentRelationship(relationship));
  }

  async transitionRelationship(
    userId: string,
    relationshipId: string,
    target: AffiliateRelationshipStatus,
  ) {
    const brand = await this.getBrand(userId);
    const relationship = await this.prisma.affiliateRelationship.findUnique({
      where: { id: relationshipId },
      include: RELATIONSHIP_INCLUDE,
    });
    if (!relationship) throw new NotFoundException('Партнёрская связь не найдена');
    if (relationship.offer.brandId !== brand.id) {
      throw new ForbiddenException('Нет доступа к этой партнёрской связи');
    }
    if (relationship.status === target) return this.presentRelationship(relationship);
    if (!RELATIONSHIP_TRANSITIONS[relationship.status].includes(target)) {
      throw new ConflictException(
        `Переход ${relationship.status} → ${target} недоступен`,
      );
    }
    const updated = await this.prisma.affiliateRelationship.update({
      where: { id: relationship.id },
      data: {
        status: target,
        ...(target === AffiliateRelationshipStatus.ACTIVE
          ? { activatedAt: new Date(), pausedAt: null }
          : {}),
        ...(target === AffiliateRelationshipStatus.PAUSED ? { pausedAt: new Date() } : {}),
        ...(target === AffiliateRelationshipStatus.REVOKED ? { revokedAt: new Date() } : {}),
      },
      include: RELATIONSHIP_INCLUDE,
    });
    return this.presentRelationship(updated);
  }

  async resolveRedirect(
    affiliateCode: string,
    context: { ip?: string; referrer?: string; userAgent?: string } = {},
  ) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(affiliateCode)) {
      throw new NotFoundException('Партнёрская ссылка не найдена');
    }
    const relationship = await this.prisma.affiliateRelationship.findUnique({
      where: { affiliateCode },
      include: { offer: true },
    });
    if (
      !relationship ||
      relationship.status !== AffiliateRelationshipStatus.ACTIVE ||
      relationship.offer.status !== OfferStatus.PUBLISHED
    ) {
      throw new NotFoundException('Партнёрская ссылка не найдена');
    }

    const clickId = randomUUID();
    const clickedAt = new Date();
    const ipHash = context.ip ? this.hashIp(context.ip) : null;
    const dedupeSeconds = this.getPositiveInteger('CLICK_DEDUPE_WINDOW_SECONDS', 5);
    const bucket = Math.floor(clickedAt.getTime() / (dedupeSeconds * 1000));
    const deduplicationKey = createHmac(
      'sha256',
      this.config.getOrThrow<string>('CLICK_IP_HASH_SALT'),
    )
      .update(
        [
          relationship.id,
          ipHash ?? 'no-ip',
          (context.userAgent ?? '').slice(0, 500),
          String(bucket),
        ].join('|'),
      )
      .digest('hex');

    let persistedClickId: string = clickId;
    if (this.withinClickRateLimit(ipHash ?? deduplicationKey)) {
      try {
        const click = await this.prisma.click.upsert({
          where: { deduplicationKey },
          update: {},
          create: {
            id: clickId,
            affiliateRelationshipId: relationship.id,
            affiliateCode: relationship.affiliateCode,
            offerId: relationship.offerId,
            creatorId: relationship.creatorId,
            clickedAt,
            landingUrl: relationship.destinationUrl,
            referrer: context.referrer?.slice(0, 2000) || null,
            userAgent: context.userAgent?.slice(0, 500) || null,
            ipHash,
            deduplicationKey,
          },
        });
        persistedClickId = click.id;
      } catch (error) {
        this.logger.error(
          `Click persistence failed for relationship ${relationship.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    } else {
      this.logger.warn(`Click rate limit reached for relationship ${relationship.id}`);
    }

    const url = new URL(relationship.destinationUrl);
    url.searchParams.set('click_id', persistedClickId);
    url.searchParams.set('affiliate_code', relationship.affiliateCode);
    url.searchParams.set('utm_source', 'svyazka');
    url.searchParams.set('utm_medium', 'affiliate');
    url.searchParams.set('utm_campaign', relationship.offerId);
    return url.toString();
  }

  private hashIp(ip: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('CLICK_IP_HASH_SALT'),
    )
      .update(ip)
      .digest('hex');
  }

  private withinClickRateLimit(key: string) {
    const now = Date.now();
    const limit = this.getPositiveInteger('CLICK_RATE_LIMIT_PER_MINUTE', 60);
    const current = this.clickRateWindows.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      this.clickRateWindows.set(key, { count: 1, startedAt: now });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  private getPositiveInteger(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private generatePromoCode(length = 10) {
    return Array.from(
      { length },
      () => PROMO_ALPHABET[randomInt(0, PROMO_ALPHABET.length)],
    ).join('');
  }

  private presentRelationship(relationship: any) {
    const publicBackendUrl = (
      this.config.get<string>('PUBLIC_BACKEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    return {
      ...relationship,
      affiliateUrl: `${publicBackendUrl}/go/${relationship.affiliateCode}`,
    };
  }

  private validateDestination(value: string) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      throw new BadRequestException('Ссылка на товар должна использовать HTTP или HTTPS');
    }
  }

  private async getCreator(userId: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!creator) throw new ForbiddenException('Профиль креатора не найден');
    return creator;
  }

  private async getBrand(userId: string) {
    const brand = await this.prisma.brandProfile.findUnique({ where: { userId } });
    if (!brand) throw new ForbiddenException('Профиль бренда не найден');
    return brand;
  }

  private async assertOwnedOffer(brandId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Оффер не найден');
    if (offer.brandId !== brandId) throw new ForbiddenException('Нет доступа к офферу');
    return offer;
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isRetryableApproval(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code === 'P2034') return true;
    if (error.code !== 'P2002') return false;
    const target = String(error.meta?.target ?? '');
    return target.includes('affiliateCode') || target.includes('promoCode');
  }
}
