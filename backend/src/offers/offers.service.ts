import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrandVerificationStatus,
  OfferImageStatus,
  OfferStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/storage.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { InitOfferImageUploadDto } from './dto/init-offer-image-upload.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly storage: S3StorageService,
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
    const offer = await this.prisma.offer.create({
      data: {
        ...dto,
        brandId: brand.id,
        platformCommissionBps,
        status: OfferStatus.DRAFT,
      },
      include: OFFER_INCLUDE,
    });
    return this.presentOffer(offer);
  }

  async listOwn(userId: string) {
    const brand = await this.getBrandByUserId(userId);
    const offers = await this.prisma.offer.findMany({
      where: { brandId: brand.id },
      include: OFFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(offers.map((offer) => this.presentOffer(offer)));
  }

  async getOwn(userId: string, offerId: string) {
    return this.presentOffer(await this.getOwnedOffer(userId, offerId));
  }

  async updateOwn(userId: string, offerId: string, dto: UpdateOfferDto) {
    const offer = await this.getOwnedOffer(userId, offerId);
    if (offer.status === OfferStatus.ARCHIVED) {
      throw new BadRequestException('Архивированный оффер нельзя редактировать');
    }
    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: dto,
      include: OFFER_INCLUDE,
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
    return this.presentOffer(updated);
  }

  async initImageUpload(
    userId: string,
    offerId: string,
    dto: InitOfferImageUploadDto,
  ) {
    await this.assertVerifiedBrand(userId);
    const offer = await this.getOwnedOffer(userId, offerId);
    if (offer.status === OfferStatus.ARCHIVED) {
      throw new BadRequestException('Архивированный оффер нельзя редактировать');
    }
    const { extension, maxBytes } = this.validateImageFile(dto);
    if (dto.byteSize > maxBytes) {
      throw new BadRequestException('Изображение превышает допустимый размер');
    }
    const uploadId = randomUUID();
    const objectKey =
      `brands/${offer.brandId}/offers/${offer.id}/image/` +
      `${uploadId}/${randomUUID()}.${extension}`;
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

  async completeImageUpload(userId: string, offerId: string, uploadId: string) {
    await this.assertVerifiedBrand(userId);
    const offer = await this.getOwnedOffer(userId, offerId);
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
      this.validateStoredImage(
        image.originalFileName,
        image.mimeType,
        Number(image.byteSize),
      );

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
            include: OFFER_INCLUDE,
          });
          return { updated, previousImage };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      await this.prisma.offerImage.updateMany({
        where: {
          id: image.id,
          status: { in: [OfferImageStatus.UPLOADING, OfferImageStatus.FAILED] },
        },
        data: { status: OfferImageStatus.FAILED },
      });
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Изображение не прошло проверку',
      );
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

  async transition(userId: string, offerId: string, target: OfferStatus) {
    const offer = await this.getOwnedOffer(userId, offerId);
    if (!ALLOWED_TRANSITIONS[offer.status].includes(target)) {
      throw new BadRequestException(`Переход ${offer.status} → ${target} недоступен`);
    }
    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: { status: target },
      include: OFFER_INCLUDE,
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

  async listPublished() {
    const offers = await this.prisma.offer.findMany({
      where: { status: OfferStatus.PUBLISHED },
      include: OFFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(offers.map((offer) => this.presentOffer(offer)));
  }

  async getPublished(offerId: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
      include: OFFER_INCLUDE,
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    return this.presentOffer(offer);
  }

  private async getOwnedOffer(userId: string, offerId: string) {
    const brand = await this.getBrandByUserId(userId);
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: OFFER_INCLUDE,
    });
    if (!offer) throw new NotFoundException('Оффер не найден');
    if (offer.brandId !== brand.id) throw new ForbiddenException('Нет доступа к этому офферу');
    return offer;
  }

  private async assertVerifiedBrand(userId: string) {
    const brand = await this.getBrandByUserId(userId);
    if (brand.verificationStatus !== BrandVerificationStatus.VERIFIED) {
      throw new ForbiddenException(
        'Загрузка файлов доступна только брендам, подтверждённым администратором',
      );
    }
    return brand;
  }

  private validateImageFile(dto: InitOfferImageUploadDto) {
    return this.validateStoredImage(dto.originalFileName, dto.mimeType, dto.byteSize);
  }

  private validateStoredImage(fileName: string, mimeType: string, byteSize: number) {
    const normalizedMime = mimeType.toLowerCase();
    const extension = extname(fileName).replace('.', '').toLowerCase();
    const allowedExtensions = OFFER_IMAGE_MIME_EXTENSIONS[normalizedMime];
    if (!extension || !allowedExtensions?.includes(extension)) {
      throw new BadRequestException('Разрешены только JPG, PNG и WebP');
    }
    if (byteSize > OFFER_IMAGE_MAX_BYTES) {
      throw new BadRequestException('Изображение превышает допустимый размер');
    }
    return { extension, maxBytes: OFFER_IMAGE_MAX_BYTES };
  }

  private async presentOffer(offer: OfferWithImage) {
    const { image, ...safe } = offer;
    const imageUrl =
      image?.status === OfferImageStatus.READY
        ? await this.storage.createViewUrl(image.storageObjectKey, image.mimeType)
        : safe.imageUrl;
    return { ...safe, imageUrl };
  }

  private publicImage<T extends { storageObjectKey: string }>(image: T) {
    const { storageObjectKey: _storageObjectKey, ...safe } = image;
    return safe;
  }

  private async deleteSupersededImage(imageId: string, objectKey: string) {
    try {
      await this.storage.delete(objectKey);
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

  private async getBrandByUserId(userId: string) {
    const brand = await this.prisma.brandProfile.findUnique({ where: { userId } });
    if (!brand) throw new ForbiddenException('Профиль бренда не найден');
    return brand;
  }
}
