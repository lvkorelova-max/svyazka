import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AffiliateRelationshipStatus,
  BrandVerificationStatus,
  CreatorKitAccessLevel,
  CreatorKitAssetStatus,
  CreatorKitAssetType,
  OfferStatus,
  Prisma,
  PromotionWithoutProduct,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { BrandAccessService } from '../brand-access/brand-access.service';
import { S3StorageService } from '../storage/storage.service';
import { InitCreatorKitUploadDto } from './dto/init-upload.dto';
import { UpsertCreatorKitDto } from './dto/upsert-creator-kit.dto';

const KIT_INCLUDE = {
  assets: { orderBy: { createdAt: 'asc' as const } },
  scenarios: { orderBy: { sortOrder: 'asc' as const } },
  facts: { orderBy: { sortOrder: 'asc' as const } },
  claims: { orderBy: { sortOrder: 'asc' as const } },
  rules: { orderBy: { sortOrder: 'asc' as const } },
  publicationRequirements: true,
} satisfies Prisma.CreatorKitInclude;

const MIME_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
  'application/pdf': ['pdf'],
};

const IMAGE_TYPES = new Set<CreatorKitAssetType>([
  CreatorKitAssetType.PHOTO,
  CreatorKitAssetType.PRODUCT_PNG,
  CreatorKitAssetType.LOGO,
  CreatorKitAssetType.LIFESTYLE,
  CreatorKitAssetType.BANNER,
]);
const VIDEO_TYPES = new Set<CreatorKitAssetType>([
  CreatorKitAssetType.VERTICAL_VIDEO,
  CreatorKitAssetType.HORIZONTAL_VIDEO,
  CreatorKitAssetType.TEXTURE_VIDEO,
  CreatorKitAssetType.USAGE_VIDEO,
]);

@Injectable()
export class CreatorKitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
    private readonly config: ConfigService,
    private readonly brands: BrandAccessService,
  ) {}

  async getBrandKit(userId: string, offerId: string, activeBrandId?: string) {
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    const kit = await this.ensureKit(offer.id);
    return this.present(kit, offer, false);
  }

  async updateBrandKit(userId: string, offerId: string, dto: UpsertCreatorKitDto, activeBrandId?: string) {
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    const kit = await this.ensureKit(offer.id);
    await this.prisma.$transaction(async (tx) => {
      if (dto.scenarios) {
        await tx.creatorKitScenario.deleteMany({ where: { creatorKitId: kit.id } });
        if (dto.scenarios.length) {
          await tx.creatorKitScenario.createMany({
            data: dto.scenarios.map((item) => ({ ...item, creatorKitId: kit.id })),
          });
        }
      }
      if (dto.facts) {
        await tx.creatorKitFact.deleteMany({ where: { creatorKitId: kit.id } });
        if (dto.facts.length) {
          await tx.creatorKitFact.createMany({
            data: dto.facts.map((item) => ({ ...item, creatorKitId: kit.id })),
          });
        }
      }
      if (dto.claims) {
        await tx.creatorKitClaim.deleteMany({ where: { creatorKitId: kit.id } });
        if (dto.claims.length) {
          await tx.creatorKitClaim.createMany({
            data: dto.claims.map((item) => ({ ...item, creatorKitId: kit.id })),
          });
        }
      }
      if (dto.rules) {
        await tx.creatorKitRule.deleteMany({ where: { creatorKitId: kit.id } });
        if (dto.rules.length) {
          await tx.creatorKitRule.createMany({
            data: dto.rules.map((item) => ({ ...item, creatorKitId: kit.id })),
          });
        }
      }
      if (dto.publicationRequirements) {
        await tx.publicationRequirements.upsert({
          where: { creatorKitId: kit.id },
          update: dto.publicationRequirements,
          create: { ...dto.publicationRequirements, creatorKitId: kit.id },
        });
      }
    });
    return this.getBrandKit(userId, offerId, activeBrandId);
  }

  async getBrandPreview(
    userId: string,
    offerId: string,
    accessLevel: CreatorKitAccessLevel,
    activeBrandId?: string,
  ) {
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    const kit = await this.ensureKit(offer.id);
    return this.present(this.filterKit(kit, offer, accessLevel, true), offer, true);
  }

  async getCreatorKit(userId: string, offerId: string) {
    const creator = await this.assertCreator(userId);
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    const kit = await this.prisma.creatorKit.findUnique({
      where: { offerId },
      include: KIT_INCLUDE,
    });
    if (!kit) throw new NotFoundException('Creator Kit ещё не заполнен');
    const hasActiveRelationship = Boolean(
      await this.prisma.affiliateRelationship.findFirst({
        where: {
          offerId,
          creatorId: creator.id,
          status: AffiliateRelationshipStatus.ACTIVE,
        },
        select: { id: true },
      }),
    );
    return this.present(
      this.filterKit(
        kit,
        offer,
        CreatorKitAccessLevel.DIGITAL,
        false,
        hasActiveRelationship,
      ),
      offer,
      true,
    );
  }

  async initUpload(userId: string, offerId: string, dto: InitCreatorKitUploadDto, activeBrandId?: string) {
    await this.assertVerifiedBrand(userId, activeBrandId);
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    const kit = await this.ensureKit(offer.id);
    const count = await this.prisma.creatorKitAsset.count({
      where: { creatorKitId: kit.id, status: { not: CreatorKitAssetStatus.DELETED } },
    });
    const maxAssets = Number(this.config.get<string>('CREATOR_KIT_MAX_ASSETS') ?? 100);
    if (count >= maxAssets) throw new BadRequestException(`Не более ${maxAssets} материалов`);

    const { extension, maxBytes } = this.validateFile(dto);
    if (dto.byteSize > maxBytes) throw new BadRequestException('Файл превышает допустимый размер');
    const assetId = randomUUID();
    const objectKey = `brands/${offer.brandId}/offers/${offer.id}/creator-kit/${assetId}/${randomUUID()}.${extension}`;
    const asset = await this.prisma.creatorKitAsset.create({
      data: {
        id: assetId,
        creatorKitId: kit.id,
        title: dto.title.trim(),
        assetType: dto.assetType,
        accessLevel: dto.accessLevel,
        originalFileName: dto.originalFileName,
        extension,
        mimeType: dto.mimeType,
        byteSize: BigInt(dto.byteSize),
        storageObjectKey: objectKey,
        editable: dto.editable,
        textAllowed: dto.textAllowed,
        paidAdsAllowed: dto.paidAdsAllowed,
        approvalRequired: dto.approvalRequired,
        requiresAffiliateApproval: dto.requiresAffiliateApproval ?? false,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    return {
      asset: this.publicAsset(asset),
      uploadUrl: await this.storage.createUploadUrl(objectKey, dto.mimeType),
      requiredHeaders: { 'Content-Type': dto.mimeType },
    };
  }

  async completeUpload(userId: string, offerId: string, assetId: string, activeBrandId?: string) {
    await this.assertVerifiedBrand(userId, activeBrandId);
    const { asset } = await this.getOwnedAsset(userId, offerId, assetId, activeBrandId);
    if (asset.status === CreatorKitAssetStatus.READY) return this.publicAsset(asset);
    if (
      asset.status !== CreatorKitAssetStatus.UPLOADING &&
      asset.status !== CreatorKitAssetStatus.FAILED
    ) {
      throw new BadRequestException('Загрузку нельзя подтвердить в текущем статусе');
    }
    try {
      const head = await this.storage.head(asset.storageObjectKey);
      if (head.ContentLength === undefined || BigInt(head.ContentLength) !== asset.byteSize) {
        throw new Error('Размер загруженного объекта не совпадает');
      }
      if ((head.ContentType ?? '').toLowerCase() !== asset.mimeType.toLowerCase()) {
        throw new Error('MIME загруженного объекта не совпадает');
      }
      this.validateStoredFile(asset.originalFileName, asset.mimeType, Number(asset.byteSize), asset.assetType);
      const ready = await this.prisma.creatorKitAsset.update({
        where: { id: asset.id },
        data: { status: CreatorKitAssetStatus.READY, disabledAt: null },
      });
      return this.publicAsset(ready);
    } catch (error) {
      await this.prisma.creatorKitAsset.update({
        where: { id: asset.id },
        data: { status: CreatorKitAssetStatus.FAILED },
      });
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Объект не прошёл проверку',
      );
    }
  }

  async disableAsset(userId: string, offerId: string, assetId: string, activeBrandId?: string) {
    const { asset } = await this.getOwnedAsset(userId, offerId, assetId, activeBrandId);
    if (asset.status !== CreatorKitAssetStatus.READY) {
      throw new BadRequestException('Отключить можно только активный материал');
    }
    return this.publicAsset(
      await this.prisma.creatorKitAsset.update({
        where: { id: asset.id },
        data: { status: CreatorKitAssetStatus.DISABLED, disabledAt: new Date() },
      }),
    );
  }

  async enableAsset(userId: string, offerId: string, assetId: string, activeBrandId?: string) {
    const { asset } = await this.getOwnedAsset(userId, offerId, assetId, activeBrandId);
    if (asset.status !== CreatorKitAssetStatus.DISABLED) {
      throw new BadRequestException('Включить можно только отключённый материал');
    }
    if (asset.expiresAt && asset.expiresAt <= new Date()) {
      throw new BadRequestException('Срок действия материала истёк');
    }
    return this.publicAsset(
      await this.prisma.creatorKitAsset.update({
        where: { id: asset.id },
        data: { status: CreatorKitAssetStatus.READY, disabledAt: null },
      }),
    );
  }

  async brandDownload(userId: string, offerId: string, assetId: string, activeBrandId?: string) {
    const { asset } = await this.getOwnedAsset(userId, offerId, assetId, activeBrandId);
    if (
      asset.status !== CreatorKitAssetStatus.READY &&
      asset.status !== CreatorKitAssetStatus.DISABLED
    ) {
      throw new BadRequestException('Файл ещё не готов к скачиванию');
    }
    return { downloadUrl: await this.storage.createDownloadUrl(asset.storageObjectKey, asset.originalFileName) };
  }

  async creatorDownload(userId: string, offerId: string, assetId: string) {
    const creator = await this.assertCreator(userId);
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    if (offer.promotionWithoutProduct === PromotionWithoutProduct.NO) {
      throw new ForbiddenException('Продвижение без продукта запрещено');
    }
    const hasActiveRelationship = Boolean(
      await this.prisma.affiliateRelationship.findFirst({
        where: {
          offerId,
          creatorId: creator.id,
          status: AffiliateRelationshipStatus.ACTIVE,
        },
        select: { id: true },
      }),
    );
    const asset = await this.prisma.creatorKitAsset.findFirst({
      where: {
        id: assetId,
        creatorKit: { offerId },
        accessLevel: CreatorKitAccessLevel.DIGITAL,
        status: CreatorKitAssetStatus.READY,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(hasActiveRelationship ? {} : { requiresAffiliateApproval: false }),
      },
    });
    if (!asset) throw new NotFoundException('Материал недоступен');
    return { downloadUrl: await this.storage.createDownloadUrl(asset.storageObjectKey, asset.originalFileName) };
  }

  private async getOwnedOffer(userId: string, offerId: string, activeBrandId?: string) {
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Оффер не найден');
    if (offer.brandId !== brand.id) throw new ForbiddenException('Нет доступа к этому офферу');
    return offer;
  }

  private async assertCreator(userId: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!creator) throw new ForbiddenException('Профиль креатора не найден');
    return creator;
  }

  private async assertVerifiedBrand(userId: string, activeBrandId?: string) {
    const brand = await this.brands.resolveBrand(userId, activeBrandId);
    if (brand.verificationStatus !== BrandVerificationStatus.VERIFIED) {
      throw new ForbiddenException(
        'Загрузка файлов доступна только брендам, подтверждённым администратором',
      );
    }
  }

  private async ensureKit(offerId: string) {
    return this.prisma.creatorKit.upsert({
      where: { offerId },
      update: {},
      create: { offerId },
      include: KIT_INCLUDE,
    });
  }

  private async getOwnedAsset(userId: string, offerId: string, assetId: string, activeBrandId?: string) {
    const offer = await this.getOwnedOffer(userId, offerId, activeBrandId);
    const asset = await this.prisma.creatorKitAsset.findFirst({
      where: { id: assetId, creatorKit: { offerId: offer.id } },
    });
    if (!asset) throw new NotFoundException('Материал не найден');
    return { offer, asset };
  }

  private validateFile(dto: InitCreatorKitUploadDto) {
    return this.validateStoredFile(dto.originalFileName, dto.mimeType, dto.byteSize, dto.assetType);
  }

  private validateStoredFile(
    fileName: string,
    mimeType: string,
    byteSize: number,
    assetType: CreatorKitAssetType,
  ) {
    const extension = extname(fileName).replace('.', '').toLowerCase();
    const allowedExtensions = MIME_EXTENSIONS[mimeType.toLowerCase()];
    if (!extension || !allowedExtensions?.includes(extension)) {
      throw new BadRequestException('MIME или расширение файла не разрешены');
    }
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');
    const isDocument = mimeType === 'application/pdf';
    if (
      (IMAGE_TYPES.has(assetType) && !isImage) ||
      (VIDEO_TYPES.has(assetType) && !isVideo) ||
      (assetType === CreatorKitAssetType.DOCUMENT && !isDocument)
    ) {
      throw new BadRequestException('Тип материала не соответствует файлу');
    }
    const maxBytes = isVideo
      ? Number(this.config.get<string>('CREATOR_KIT_MAX_VIDEO_BYTES') ?? 524_288_000)
      : isDocument
        ? Number(this.config.get<string>('CREATOR_KIT_MAX_DOCUMENT_BYTES') ?? 26_214_400)
        : Number(this.config.get<string>('CREATOR_KIT_MAX_IMAGE_BYTES') ?? 26_214_400);
    if (byteSize > maxBytes) throw new BadRequestException('Файл превышает допустимый размер');
    return { extension, maxBytes };
  }

  private filterKit<T extends { assets: any[]; scenarios: any[] }>(
    kit: T,
    offer: { promotionWithoutProduct: PromotionWithoutProduct },
    level: CreatorKitAccessLevel,
    isBrandPreview: boolean,
    hasActiveRelationship = false,
  ): T {
    const now = new Date();
    const noDigital =
      level === CreatorKitAccessLevel.DIGITAL &&
      offer.promotionWithoutProduct === PromotionWithoutProduct.NO;
    const allowedLevels =
      level === CreatorKitAccessLevel.PRODUCT
        ? [CreatorKitAccessLevel.DIGITAL, CreatorKitAccessLevel.PRODUCT]
        : [CreatorKitAccessLevel.DIGITAL];
    return {
      ...kit,
      assets: noDigital
        ? []
        : kit.assets.filter(
            (asset) =>
              allowedLevels.includes(asset.accessLevel) &&
              asset.status === CreatorKitAssetStatus.READY &&
              (isBrandPreview ||
                !asset.requiresAffiliateApproval ||
                hasActiveRelationship) &&
              (!asset.expiresAt || asset.expiresAt > now),
          ),
      scenarios: noDigital
        ? []
        : kit.scenarios.filter(
            (scenario) =>
              allowedLevels.includes(scenario.accessLevel) &&
              (isBrandPreview ||
                !scenario.requiresAffiliateApproval ||
                hasActiveRelationship),
          ),
      previewAccessLevel: isBrandPreview ? level : CreatorKitAccessLevel.DIGITAL,
    };
  }

  private present(kit: any, offer: any, filtered: boolean) {
    return {
      ...kit,
      assets: kit.assets.map((asset: any) => this.publicAsset(asset)),
      offerPolicy: {
        promotionWithoutProduct: offer.promotionWithoutProduct,
        allowedPromotionFormats: offer.allowedPromotionFormats,
      },
      completeness: this.completeness(kit),
      filtered,
    };
  }

  private publicAsset(asset: any) {
    const { storageObjectKey: _storageObjectKey, previewObjectKey: _previewObjectKey, ...safe } =
      asset;
    return safe;
  }

  private completeness(kit: any) {
    const checks = [
      { key: 'policy', weight: 15, complete: true },
      {
        key: 'assets',
        weight: 25,
        complete: kit.assets.some((asset: any) => asset.status === CreatorKitAssetStatus.READY),
      },
      { key: 'scenarios', weight: 15, complete: kit.scenarios.length > 0 },
      { key: 'facts', weight: 20, complete: kit.facts.length >= 5 },
      {
        key: 'claims',
        weight: 10,
        complete:
          kit.claims.some((claim: any) => claim.type === 'ALLOWED') &&
          kit.claims.some((claim: any) => claim.type === 'FORBIDDEN'),
      },
      { key: 'rules', weight: 5, complete: kit.rules.length > 0 },
      { key: 'publicationRequirements', weight: 10, complete: Boolean(kit.publicationRequirements) },
    ];
    return {
      percent: checks.reduce((sum, check) => sum + (check.complete ? check.weight : 0), 0),
      missing: checks.filter((check) => !check.complete).map((check) => check.key),
    };
  }
}
