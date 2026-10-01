import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrandVerificationStatus,
  CustomerDiscountType,
  OfferImageStatus,
  OfferStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { AuditService } from '../audit/audit.service';
import { BrandAccessService } from '../brand-access/brand-access.service';
import { CommercialTermsService } from '../commercial-terms/commercial-terms.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/storage.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { InitOfferImageUploadDto } from './dto/init-offer-image-upload.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { UpdateCommercialTermsDto } from './dto/update-commercial-terms.dto';

const ALLOWED_TRANSITIONS: Record<string, OfferStatus[]> = {
  [OfferStatus.DRAFT]: [OfferStatus.PUBLISHED, OfferStatus.ARCHIVED],
  [OfferStatus.PUBLISHED]: [OfferStatus.PAUSED, OfferStatus.ARCHIVED],
  [OfferStatus.PAUSED]: [OfferStatus.PUBLISHED, OfferStatus.ARCHIVED],
  [OfferStatus.MODERATION]: [],
  [OfferStatus.ARCHIVED]: [],
};

const OFFER_INCLUDE = {
  brand: true,
  image: true,
  currentVersion: true,
  currentCommercialTerms: true,
  creatorKit: { select: { activeRevisionId: true } },
  currentManager: {
    select: {
      id: true,
      managerProfile: { select: { displayName: true } },
    },
  },
} satisfies Prisma.OfferInclude;

type OfferWithImage = Prisma.OfferGetPayload<{ include: typeof OFFER_INCLUDE }>;

const OFFER_IMAGE_MIME_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};
const OFFER_IMAGE_MAX_BYTES = 26_214_400;

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);
  private readonly offerInclude = OFFER_INCLUDE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly brands: BrandAccessService,
    @Optional() private readonly commercialTerms?: CommercialTermsService,
    @Optional() private readonly storage?: S3StorageService,
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
    if (
      this.commercialTerms &&
      dto.creatorCommissionBps === undefined &&
      dto.totalCommissionPoolBps === undefined
    ) {
      throw new BadRequestException('Укажите общий commission pool');
    }
    if (
      this.commercialTerms &&
      dto.creatorCommissionBps !== undefined &&
      dto.totalCommissionPoolBps !== undefined
    ) {
      throw new BadRequestException(
        'Нельзя одновременно передать legacy creator rate и общий commission pool',
      );
    }
    if (this.commercialTerms) this.validateCustomerDiscount(dto);
    const {
      totalCommissionPoolBps,
      creatorCommissionBps: legacyCreatorCommissionBps,
      customerDiscountAmountMinor,
      ...content
    } = dto;
    const creatorCommissionBps =
      totalCommissionPoolBps === undefined
        ? legacyCreatorCommissionBps ?? 0
        : Number((BigInt(totalCommissionPoolBps) * 6500n + 5000n) / 10000n);
    const effectivePlatformBps =
      totalCommissionPoolBps === undefined
        ? platformCommissionBps
        : totalCommissionPoolBps - creatorCommissionBps;
    const createData = {
      ...content,
      customerDiscountAmountMinor:
        customerDiscountAmountMinor === undefined
          ? null
          : BigInt(customerDiscountAmountMinor),
      brandId: brand.id,
      creatorCommissionBps,
      ...(manager?.role === 'MANAGER'
        ? { createdByManagerId: userId, currentManagerId: userId }
        : {}),
      platformCommissionBps: effectivePlatformBps,
      status: OfferStatus.DRAFT,
    };
    const offer = this.commercialTerms && (this.prisma as any).$transaction
      ? await this.prisma.$transaction(async (tx) => {
          const created = await tx.offer.create({
            data: createData,
            include: { creatorKit: { select: { activeRevisionId: true } } },
          });
          await this.commercialTerms!.createInitialVersions(tx, created, userId, {
            totalCommissionPoolBps,
            legacyCreatorBps: legacyCreatorCommissionBps,
            legacyPlatformBps: effectivePlatformBps,
          });
          return tx.offer.findUniqueOrThrow({
            where: { id: created.id },
            include: this.offerInclude,
          });
        })
      : await this.prisma.offer.create({
          data: createData,
          include: this.offerInclude,
        });
    return this.presentOffer(offer);
  }

  async listOwn(userId: string, activeBrandId?: string) {
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    const offers = await this.prisma.offer.findMany({
      where: { brandId: brand.id },
      include: this.offerInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(offers.map((offer) => this.presentOffer(offer)));
  }

  async getOwn(userId: string, offerId: string, activeBrandId?: string) {
    return this.presentOffer(await this.getOwnedOffer(userId, offerId, activeBrandId));
  }

  async updateOwn(userId: string, offerId: string, dto: UpdateOfferDto, activeBrandId?: string) {
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    if (offer.status === OfferStatus.ARCHIVED) {
      throw new BadRequestException('Архивированный оффер нельзя редактировать');
    }
    const nextDiscountType = (dto as any).customerDiscountType ?? (offer as any).customerDiscountType;
    this.validateCustomerDiscount({
      customerDiscountType: nextDiscountType,
      customerDiscountBps: (dto as any).customerDiscountBps,
      customerDiscountAmountMinor: (dto as any).customerDiscountAmountMinor,
    });
    const {
      totalCommissionPoolBps: _totalCommissionPoolBps,
      creatorCommissionBps: _creatorCommissionBps,
      customerDiscountAmountMinor,
      ...contentUpdate
    } = dto as any;
    const normalizedContentUpdate = {
      ...contentUpdate,
      ...(customerDiscountAmountMinor !== undefined
        ? { customerDiscountAmountMinor: BigInt(customerDiscountAmountMinor) }
        : {}),
      ...((dto as any).customerDiscountType === CustomerDiscountType.NONE
        ? { customerDiscountBps: null, customerDiscountAmountMinor: null }
        : (dto as any).customerDiscountType === CustomerDiscountType.PERCENT
          ? { customerDiscountAmountMinor: null }
          : (dto as any).customerDiscountType === CustomerDiscountType.FIXED_AMOUNT
            ? { customerDiscountBps: null }
            : {}),
    };
    if (this.commercialTerms && (dto as any).totalCommissionPoolBps !== undefined) {
      await this.commercialTerms.updatePoolTerms(userId, offer.id, {
        totalCommissionPoolBps: (dto as any).totalCommissionPoolBps,
      });
    } else if (
      this.commercialTerms &&
      (dto as any).creatorCommissionBps !== undefined &&
      (dto as any).creatorCommissionBps !== offer.creatorCommissionBps
    ) {
      await this.commercialTerms.updateLegacyTerms(
        userId,
        offer.id,
        (dto as any).creatorCommissionBps,
      );
    }
    const updated =
      Object.keys(normalizedContentUpdate).length > 0 && this.commercialTerms
        ? await this.prisma.$transaction(async (tx) => {
            const changed = await tx.offer.update({
              where: { id: offer.id },
              data: normalizedContentUpdate,
              include: this.offerInclude,
            });
            const nextVersion = await this.commercialTerms!.createOfferVersion(
              tx,
              changed,
              userId,
            );
            return tx.offer.update({
              where: { id: changed.id },
              data: { currentOfferVersionId: nextVersion.id },
              include: this.offerInclude,
            });
          })
        : await this.prisma.offer.update({
            where: { id: offer.id },
            data: normalizedContentUpdate,
            include: this.offerInclude,
          });
    if (
      (dto as any).creatorCommissionBps !== undefined &&
      (dto as any).creatorCommissionBps !== offer.creatorCommissionBps
    ) {
      await this.audit.record({
        actorUserId: userId,
        action: 'OFFER_COMMISSION_RATE_CHANGED',
        entityType: 'Offer',
        entityId: offer.id,
        metadata: {
          previousCreatorCommissionBps: offer.creatorCommissionBps,
          nextCreatorCommissionBps: (dto as any).creatorCommissionBps,
        },
      });
    }
    return this.presentOffer(updated);
  }

  async transition(userId: string, offerId: string, target: OfferStatus, activeBrandId?: string) {
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    if (!ALLOWED_TRANSITIONS[offer.status].includes(target)) {
      throw new BadRequestException(`Переход ${offer.status} → ${target} недоступен`);
    }
    if (target === OfferStatus.PUBLISHED) {
      this.assertPublishableProductUrl(offer.productUrl);
    }
    const updated = this.commercialTerms && (this.prisma as any).$transaction
      ? await this.prisma.$transaction(async (tx) => {
          const changed = await tx.offer.update({
            where: { id: offer.id },
            data: { status: target },
            include: this.offerInclude,
          });
          const nextVersion = await this.commercialTerms!.createOfferVersion(tx, changed, userId);
          return tx.offer.update({
            where: { id: offer.id },
            data: { currentOfferVersionId: nextVersion.id },
            include: this.offerInclude,
          });
        })
      : await this.prisma.offer.update({
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
    return this.presentOffer(updated);
  }

  private assertPublishableProductUrl(productUrl: string | null | undefined) {
    if (!productUrl?.trim()) {
      throw new BadRequestException(
        'Для публикации у оффера должна быть ссылка на товар',
      );
    }
    try {
      const url = new URL(productUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      throw new BadRequestException(
        'Для публикации у оффера должна быть корректная ссылка на товар',
      );
    }
  }

  async updateResponsibility(
    userId: string,
    offerId: string,
    activeBrandId: string,
    managerId: string | null,
  ) {
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
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
    return this.presentOffer(updated);
  }

  async updateCommercialTerms(
    userId: string,
    offerId: string,
    dto: UpdateCommercialTermsDto,
    activeBrandId?: string,
  ) {
    if (!this.commercialTerms) throw new BadRequestException('Коммерческие условия недоступны');
    await this.getOwnedOffer(userId, offerId, activeBrandId);
    await this.commercialTerms.updatePoolTerms(userId, offerId, dto);
    return this.getOwn(userId, offerId, activeBrandId);
  }

  async initImageUpload(
    userId: string,
    offerId: string,
    dto: InitOfferImageUploadDto,
    activeBrandId?: string,
  ) {
    if (!this.storage) throw new BadRequestException('Хранилище изображений недоступно');
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    if (brand.verificationStatus !== BrandVerificationStatus.VERIFIED) {
      throw new ForbiddenException('Загрузка файлов доступна только подтверждённым брендам');
    }
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    if (offer.status === OfferStatus.ARCHIVED) {
      throw new BadRequestException('Архивированный оффер нельзя редактировать');
    }
    const { extension } = this.validateImageFile(dto);
    const uploadId = randomUUID();
    const objectKey = `brands/${offer.brandId}/offers/${offer.id}/image/${uploadId}/${randomUUID()}.${extension}`;
    const image = await this.prisma.offerImage.create({
      data: {
        id: uploadId,
        offerId: offer.id,
        originalFileName: dto.originalFileName,
        extension,
        mimeType: dto.mimeType.toLowerCase(),
        byteSize: BigInt(dto.byteSize),
        storageObjectKey: objectKey,
      },
    });
    return {
      upload: this.publicImage(image),
      uploadUrl: await this.storage.createUploadUrl(objectKey, image.mimeType),
      requiredHeaders: { 'Content-Type': image.mimeType },
    };
  }

  async completeImageUpload(
    userId: string,
    offerId: string,
    uploadId: string,
    activeBrandId?: string,
  ) {
    if (!this.storage) throw new BadRequestException('Хранилище изображений недоступно');
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    if (brand.verificationStatus !== BrandVerificationStatus.VERIFIED) {
      throw new ForbiddenException('Загрузка файлов доступна только подтверждённым брендам');
    }
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    const image = await this.prisma.offerImage.findFirst({
      where: { id: uploadId, offerId: offer.id },
    });
    if (!image) throw new NotFoundException('Загрузка изображения не найдена');
    if (image.status === OfferImageStatus.READY && offer.imageId === image.id) {
      return this.presentOffer(offer);
    }
    if (
      image.status !== OfferImageStatus.UPLOADING &&
      image.status !== OfferImageStatus.FAILED
    ) {
      throw new BadRequestException('Загрузку нельзя подтвердить в текущем статусе');
    }

    let completed!: {
      updated: OfferWithImage;
      previousImage: { id: string; storageObjectKey: string } | null;
    };
    try {
      const head = await this.storage.head(image.storageObjectKey);
      if (head.ContentLength === undefined || BigInt(head.ContentLength) !== image.byteSize) {
        throw new Error('Размер загруженного изображения не совпадает');
      }
      if ((head.ContentType ?? '').toLowerCase() !== image.mimeType) {
        throw new Error('MIME загруженного изображения не совпадает');
      }
      this.validateStoredImage(image.originalFileName, image.mimeType, Number(image.byteSize));

      completed = await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.offer.findUniqueOrThrow({
            where: { id: offer.id },
            include: { image: true },
          });
          const previousImage =
            current.image && current.image.id !== image.id
              ? {
                  id: current.image.id,
                  storageObjectKey: current.image.storageObjectKey,
                }
              : null;
          if (previousImage) {
            await tx.offerImage.update({
              where: { id: previousImage.id },
              data: { status: OfferImageStatus.SUPERSEDED },
            });
          }
          await tx.offerImage.update({
            where: { id: image.id },
            data: {
              status: OfferImageStatus.READY,
              completedAt: new Date(),
              deletedAt: null,
            },
          });
          const updated = await tx.offer.update({
            where: { id: offer.id },
            data: { imageId: image.id, imageUrl: null },
            include: this.offerInclude,
          });
          if (!this.commercialTerms) return { updated, previousImage };
          const version = await this.commercialTerms.createOfferVersion(
            tx,
            updated,
            userId,
          );
          const versioned = await tx.offer.update({
            where: { id: offer.id },
            data: { currentOfferVersionId: version.id },
            include: this.offerInclude,
          });
          return { updated: versioned, previousImage };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      await this.prisma.offerImage.updateMany({
        where: { id: image.id, status: { in: [OfferImageStatus.UPLOADING, OfferImageStatus.FAILED] } },
        data: { status: OfferImageStatus.FAILED },
      });
      throw new BadRequestException(error instanceof Error ? error.message : 'Изображение не прошло проверку');
    }

    await this.audit.record({
      actorUserId: userId,
      action: 'OFFER_IMAGE_UPLOADED',
      entityType: 'Offer',
      entityId: offer.id,
      metadata: {
        uploadId: image.id,
        mimeType: image.mimeType,
        byteSize: image.byteSize.toString(),
        replacedImage: Boolean(completed.previousImage),
      },
    });

    if (completed.previousImage) {
      await this.deleteSupersededImage(
        completed.previousImage.id,
        completed.previousImage.storageObjectKey,
      );
    }
    return this.presentOffer(completed.updated);
  }

  async listPublished() {
    const offers = await this.prisma.offer.findMany({
      where: { status: OfferStatus.PUBLISHED },
      include: this.offerInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(offers.map((offer) => this.presentOffer(offer, 'creator')));
  }

  async listPublicPublished() {
    return this.prisma.offer.findMany({
      where: { status: OfferStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        description: true,
        productUrl: true,
        productPriceKopecks: true,
        creatorCommissionBps: true,
        promotionWithoutProduct: true,
        category: true,
        imageUrl: true,
        productRequirementSales: true,
        allowedPromotionFormats: true,
        status: true,
        brand: {
          select: {
            id: true,
            brandName: true,
            website: true,
            description: true,
            logoUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPublished(offerId: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
      include: this.offerInclude,
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    return this.presentOffer(offer, 'creator');
  }

  private async presentOffer(
    offer: OfferWithImage,
    audience: 'brand' | 'creator' = 'brand',
  ) {
    const {
      image,
      currentManager,
      currentVersion,
      currentCommercialTerms,
      platformCommissionBps: legacyPlatformCommissionBps,
      ...rest
    } = offer;
    const imageUrl =
      image?.status === OfferImageStatus.READY && this.storage
        ? await this.storage.createViewUrl(image.storageObjectKey, image.mimeType)
        : rest.imageUrl;
    const creatorEffectiveBps =
      currentCommercialTerms?.creatorEffectiveGmvBps ??
      rest.creatorCommissionBps;
    const common = {
      ...rest,
      creatorCommissionBps: creatorEffectiveBps,
      creatorEffectiveBps,
      offerVersion: currentVersion?.version ?? null,
      commercialTermsVersion: currentCommercialTerms?.version ?? null,
      calculationPolicy:
        currentCommercialTerms?.calculationPolicy ?? 'LEGACY_DIRECT_RATES_V1',
      currency: currentCommercialTerms?.currency ?? 'RUB',
      imageUrl,
      currentManager: currentManager
        ? {
            id: currentManager.id,
            displayName: currentManager.managerProfile?.displayName ?? null,
          }
        : null,
    };
    if (audience === 'creator') return common;
    return {
      ...common,
      totalCommissionPoolBps:
        currentCommercialTerms?.totalCommissionPoolBps ??
        rest.creatorCommissionBps + legacyPlatformCommissionBps,
      creatorPoolShareBps: currentCommercialTerms?.creatorPoolShareBps ?? 0,
      platformPoolShareBps: currentCommercialTerms?.platformPoolShareBps ?? 0,
      platformEffectiveBps:
        currentCommercialTerms?.platformEffectiveGmvBps ??
        legacyPlatformCommissionBps,
    };
  }

  private async getOwnedOffer(userId: string, offerId: string, activeBrandId?: string) {
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: this.offerInclude,
    });
    if (!offer) throw new NotFoundException('Оффер не найден');
    if (offer.brandId !== brand.id) throw new ForbiddenException('Нет доступа к этому офферу');
    return offer;
  }

  private validateCustomerDiscount(input: {
    customerDiscountType?: CustomerDiscountType;
    customerDiscountBps?: number;
    customerDiscountAmountMinor?: number;
  }) {
    const type = input.customerDiscountType ?? CustomerDiscountType.NONE;
    if (
      type === CustomerDiscountType.PERCENT &&
      (!input.customerDiscountBps || input.customerDiscountAmountMinor)
    ) {
      throw new BadRequestException('Для процентной скидки укажите только размер скидки в процентах');
    }
    if (
      type === CustomerDiscountType.FIXED_AMOUNT &&
      (!input.customerDiscountAmountMinor || input.customerDiscountBps)
    ) {
      throw new BadRequestException('Для фиксированной скидки укажите только сумму скидки');
    }
    if (
      type === CustomerDiscountType.NONE &&
      (input.customerDiscountBps || input.customerDiscountAmountMinor)
    ) {
      throw new BadRequestException('Для оффера без скидки нельзя указывать размер скидки');
    }
  }

  private validateImageFile(dto: InitOfferImageUploadDto) {
    return this.validateStoredImage(dto.originalFileName, dto.mimeType, dto.byteSize);
  }

  private validateStoredImage(fileName: string, mimeType: string, byteSize: number) {
    const normalizedMime = mimeType.toLowerCase();
    const extension = extname(fileName).replace('.', '').toLowerCase();
    const allowed = {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
    }[normalizedMime];
    if (!extension || !allowed?.includes(extension)) {
      throw new BadRequestException('Разрешены только JPG, PNG и WebP');
    }
    if (byteSize > 26_214_400) {
      throw new BadRequestException('Изображение превышает допустимый размер');
    }
    return { extension, maxBytes: 26_214_400 };
  }

  private publicImage<T extends { storageObjectKey: string }>(image: T) {
    const { storageObjectKey: _storageObjectKey, ...safe } = image;
    return safe;
  }

  private async deleteSupersededImage(imageId: string, objectKey: string) {
    try {
      await this.storage!.delete(objectKey);
      await this.prisma.offerImage.updateMany({
        where: { id: imageId, status: OfferImageStatus.SUPERSEDED },
        data: { status: OfferImageStatus.DELETED, deletedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(
        `Failed to delete superseded offer image ${imageId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
