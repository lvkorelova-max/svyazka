import {
  BadRequestException,
  ConflictException,
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
  CreatorKitRevisionStatus,
  CreatorProductAccessStatus,
  OfferStatus,
  Prisma,
  PromotionWithoutProduct,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { CommercialTermsService } from '../commercial-terms/commercial-terms.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/storage.service';
import { InitCreatorKitUploadDto } from './dto/init-upload.dto';
import {
  PreviewAsCreatorDto,
  ProductAccessDto,
  PublishCreatorKitDto,
  RestoreCreatorKitDto,
} from './dto/revision.dto';
import {
  CreatorKitScenarioDto,
  UpdateCreatorKitScenarioDto,
  UpsertCreatorKitDto,
} from './dto/upsert-creator-kit.dto';

const REVISION_INCLUDE = {
  brandContent: true,
  productContent: true,
  assets: {
    include: { asset: true },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  scenarios: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  facts: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  claims: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  rules: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  publicationRequirements: true,
} satisfies Prisma.CreatorKitRevisionInclude;

type RevisionWithContent = Prisma.CreatorKitRevisionGetPayload<{
  include: typeof REVISION_INCLUDE;
}>;

type SnapshotItem = {
  id?: string;
  assetId?: string;
  accessLevel?: CreatorKitAccessLevel;
  requiresAffiliateApproval?: boolean;
  sortOrder?: number;
  status?: CreatorKitAssetStatus;
  expiresAt?: string | Date | null;
  [key: string]: unknown;
};

type CreatorKitSnapshot = {
  schemaVersion: number;
  customSections: unknown[];
  brandContent: SnapshotItem | null;
  productContent: SnapshotItem | null;
  assets: SnapshotItem[];
  scenarios: SnapshotItem[];
  facts: SnapshotItem[];
  claims: SnapshotItem[];
  rules: SnapshotItem[];
  publicationRequirements: SnapshotItem | null;
};

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
    private readonly audit: AuditService,
    private readonly commercialTerms: CommercialTermsService,
  ) {}

  async getBrandKit(userId: string, offerId: string) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    let revision = await this.getPreferredBrandRevision(kit);
    if (!revision) revision = await this.ensureDraft(userId, offer);
    return this.presentRevision(revision, offer, false);
  }

  async updateBrandKit(userId: string, offerId: string, dto: UpsertCreatorKitDto) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const draft = await this.ensureDraft(userId, offer);
    await this.prisma.$transaction(async (tx) => {
      if (dto.brandContent) {
        await tx.creatorKitBrandContent.upsert({
          where: { revisionId: draft.id },
          update: this.normalizeBrandContent(dto.brandContent),
          create: { revisionId: draft.id, ...this.normalizeBrandContent(dto.brandContent) },
        });
      }
      if (dto.productContent) {
        await tx.creatorKitProductContent.upsert({
          where: { revisionId: draft.id },
          update: this.normalizeProductContent(dto.productContent),
          create: { revisionId: draft.id, ...this.normalizeProductContent(dto.productContent) },
        });
      }
      if (dto.scenarios) {
        await tx.creatorKitScenario.deleteMany({ where: { revisionId: draft.id } });
        if (dto.scenarios.length) {
          await tx.creatorKitScenario.createMany({
            data: dto.scenarios.map((item, index) =>
              this.normalizeScenario(item, draft.id, item.sortOrder ?? index),
            ),
          });
        }
      }
      if (dto.facts) {
        await tx.creatorKitFact.deleteMany({ where: { revisionId: draft.id } });
        if (dto.facts.length) {
          await tx.creatorKitFact.createMany({
            data: dto.facts.map((item) => ({
              revisionId: draft.id,
              type: item.type,
              value: item.value.trim(),
              accessLevel: item.accessLevel ?? CreatorKitAccessLevel.DIGITAL,
              requiresAffiliateApproval: item.requiresAffiliateApproval ?? false,
              sortOrder: item.sortOrder,
            })),
          });
        }
      }
      if (dto.claims) {
        await tx.creatorKitClaim.deleteMany({ where: { revisionId: draft.id } });
        if (dto.claims.length) {
          await tx.creatorKitClaim.createMany({
            data: dto.claims.map((item) => ({
              revisionId: draft.id,
              type: item.type,
              value: item.value.trim(),
              accessLevel: item.accessLevel ?? CreatorKitAccessLevel.DIGITAL,
              requiresAffiliateApproval: item.requiresAffiliateApproval ?? false,
              sortOrder: item.sortOrder,
            })),
          });
        }
      }
      if (dto.rules) {
        await tx.creatorKitRule.deleteMany({ where: { revisionId: draft.id } });
        if (dto.rules.length) {
          await tx.creatorKitRule.createMany({
            data: dto.rules.map((item) => ({
              revisionId: draft.id,
              value: item.value.trim(),
              accessLevel: item.accessLevel ?? CreatorKitAccessLevel.DIGITAL,
              requiresAffiliateApproval: item.requiresAffiliateApproval ?? false,
              sortOrder: item.sortOrder,
            })),
          });
        }
      }
      if (dto.publicationRequirements) {
        const normalized = {
          ...dto.publicationRequirements,
          accessLevel:
            dto.publicationRequirements.accessLevel ?? CreatorKitAccessLevel.DIGITAL,
          requiresAffiliateApproval:
            dto.publicationRequirements.requiresAffiliateApproval ?? false,
        };
        await tx.publicationRequirements.upsert({
          where: { revisionId: draft.id },
          update: normalized,
          create: { ...normalized, revisionId: draft.id },
        });
      }
    });
    return this.getBrandKit(userId, offerId);
  }

  async publish(userId: string, offerId: string, dto: PublishCreatorKitDto) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    if (!kit.draftRevisionId) throw new BadRequestException('Нет черновика для публикации');
    const draft = await this.loadRevision(kit.draftRevisionId);
    if (draft.status !== CreatorKitRevisionStatus.DRAFT) {
      throw new ConflictException('Версия для публикации больше не является черновиком');
    }
    const snapshot = this.buildSnapshot(draft);
    const completion = this.completeness(snapshot, offer);
    const base = draft.basedOnRevisionId
      ? await this.prisma.creatorKitRevision.findUnique({
          where: { id: draft.basedOnRevisionId },
          select: { snapshot: true },
        })
      : null;
    const diff = this.diffSnapshots(
      this.snapshotFromJson(base?.snapshot),
      snapshot,
    );
    const now = new Date();

    const published = await this.prisma.$transaction(async (tx) => {
      if (kit.activeRevisionId) {
        await tx.creatorKitRevision.updateMany({
          where: {
            id: kit.activeRevisionId,
            status: CreatorKitRevisionStatus.PUBLISHED,
          },
          data: { status: CreatorKitRevisionStatus.SUPERSEDED },
        });
      }
      const next = await tx.creatorKitRevision.update({
        where: { id: draft.id },
        data: {
          status: CreatorKitRevisionStatus.PUBLISHED,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          changeSummary: diff.summary,
          changeSet: diff.changeSet as unknown as Prisma.InputJsonValue,
          publisherNote: dto.publisherNote?.trim() || null,
          completenessPercent: completion.percent,
          completenessDetails: completion as unknown as Prisma.InputJsonValue,
          publishedByUserId: userId,
          publishedAt: now,
        },
      });
      await tx.creatorKit.update({
        where: { id: kit.id },
        data: { activeRevisionId: next.id, draftRevisionId: null },
      });
      const versionedOffer = await tx.offer.findUniqueOrThrow({
        where: { id: offer.id },
        include: {
          creatorKit: { select: { activeRevisionId: true } },
        },
      });
      const offerVersion = await this.commercialTerms.createOfferVersion(
        tx,
        versionedOffer,
        userId,
      );
      await tx.offer.update({
        where: { id: offer.id },
        data: { currentOfferVersionId: offerVersion.id },
      });
      return next;
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'CREATOR_KIT_PUBLISHED',
      entityType: 'CreatorKitRevision',
      entityId: published.id,
      metadata: {
        offerId,
        revisionNumber: published.revisionNumber,
        changeSet: diff.changeSet,
      },
    });
    return this.getBrandKit(userId, offerId);
  }

  async getRevisions(userId: string, offerId: string) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    return this.prisma.creatorKitRevision.findMany({
      where: { creatorKitId: kit.id },
      orderBy: { revisionNumber: 'desc' },
      select: {
        id: true,
        revisionNumber: true,
        status: true,
        basedOnRevisionId: true,
        changeSummary: true,
        changeSet: true,
        publisherNote: true,
        completenessPercent: true,
        completenessDetails: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        createdBy: { select: { id: true, email: true } },
        publishedBy: { select: { id: true, email: true } },
      },
    });
  }

  async createDraftFromRevision(userId: string, offerId: string, revisionId: string) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    if (kit.draftRevisionId) throw new ConflictException('Черновик уже существует');
    const source = await this.loadOwnedRevision(kit.id, revisionId);
    const draft = await this.prisma.$transaction(async (tx) => {
      const created = await this.cloneRevisionInTransaction(
        tx,
        userId,
        kit.id,
        source,
        CreatorKitRevisionStatus.DRAFT,
      );
      await tx.creatorKit.update({
        where: { id: kit.id },
        data: { draftRevisionId: created.id },
      });
      return created;
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'CREATOR_KIT_DRAFT_CREATED_FROM_REVISION',
      entityType: 'CreatorKitRevision',
      entityId: draft.id,
      metadata: { offerId, basedOnRevisionId: source.id },
    });
    return this.presentRevision(await this.loadRevision(draft.id), offer, false);
  }

  async discardDraft(userId: string, offerId: string) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    if (!kit.draftRevisionId) return { discarded: false };
    const draftId = kit.draftRevisionId;
    await this.prisma.$transaction(async (tx) => {
      await tx.creatorKit.update({
        where: { id: kit.id },
        data: { draftRevisionId: null },
      });
      await this.deleteRevisionContent(tx, draftId);
      await tx.creatorKitRevision.delete({ where: { id: draftId } });
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'CREATOR_KIT_DRAFT_DISCARDED',
      entityType: 'CreatorKitRevision',
      entityId: draftId,
      metadata: { offerId },
    });
    return { discarded: true };
  }

  async restorePreview(userId: string, offerId: string, revisionId: string) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    if (!kit.activeRevisionId) throw new BadRequestException('Нет активной версии');
    const active = await this.loadRevision(kit.activeRevisionId);
    const target = await this.loadOwnedRevision(kit.id, revisionId);
    if (!target.snapshot) throw new BadRequestException('Выбранная версия не опубликована');
    const activeSnapshot = this.snapshotFromJson(active.snapshot) ?? this.buildSnapshot(active);
    const targetSnapshot = this.snapshotFromJson(target.snapshot) ?? this.buildSnapshot(target);
    return {
      activeRevision: this.revisionMeta(active),
      targetRevision: this.revisionMeta(target),
      diff: this.diffSnapshots(activeSnapshot, targetSnapshot),
      beforeCompletion: this.completeness(activeSnapshot, offer),
      afterCompletion: this.completeness(targetSnapshot, offer),
      preview: await this.presentFilteredSnapshot(
        targetSnapshot,
        offer,
        { hasProductAccess: true, hasActiveRelationship: true },
        {
          source: 'RESTORE_PREVIEW',
          simulated: true,
        },
      ),
    };
  }

  async restore(
    userId: string,
    offerId: string,
    revisionId: string,
    dto: RestoreCreatorKitDto,
  ) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    if (kit.activeRevisionId !== dto.expectedActiveRevisionId) {
      throw new ConflictException('Активная версия изменилась. Обновите предпросмотр');
    }
    if (kit.draftRevisionId) throw new ConflictException('Сначала опубликуйте или удалите черновик');
    const target = await this.loadOwnedRevision(kit.id, revisionId);
    if (!target.snapshot) throw new BadRequestException('Восстановить можно только опубликованную версию');
    const active = kit.activeRevisionId ? await this.loadRevision(kit.activeRevisionId) : null;
    const targetSnapshot = this.snapshotFromJson(target.snapshot) ?? this.buildSnapshot(target);
    const diff = this.diffSnapshots(
      active ? this.snapshotFromJson(active.snapshot) : null,
      targetSnapshot,
    );
    const completion = this.completeness(targetSnapshot, offer);
    const now = new Date();
    const restored = await this.prisma.$transaction(async (tx) => {
      const currentKit = await tx.creatorKit.findUnique({
        where: { id: kit.id },
        select: { activeRevisionId: true, draftRevisionId: true },
      });
      if (
        !currentKit ||
        currentKit.activeRevisionId !== dto.expectedActiveRevisionId ||
        currentKit.draftRevisionId
      ) {
        throw new ConflictException('Creator Kit изменился. Обновите предпросмотр');
      }
      if (active) {
        await tx.creatorKitRevision.update({
          where: { id: active.id },
          data: { status: CreatorKitRevisionStatus.SUPERSEDED },
        });
      }
      const nextRevisionNumber = await this.nextRevisionNumber(tx, kit.id);
      const created = await tx.creatorKitRevision.create({
        data: {
          creatorKitId: kit.id,
          revisionNumber: nextRevisionNumber,
          status: CreatorKitRevisionStatus.PUBLISHED,
          basedOnRevisionId: target.id,
          createdByUserId: userId,
          publisherNote: dto.publisherNote?.trim() || null,
          snapshot: targetSnapshot as unknown as Prisma.InputJsonValue,
          changeSummary: `Восстановлена версия v${target.revisionNumber}. ${diff.summary}`,
          changeSet: diff.changeSet as unknown as Prisma.InputJsonValue,
          completenessPercent: completion.percent,
          completenessDetails: completion as unknown as Prisma.InputJsonValue,
          publishedByUserId: userId,
          publishedAt: now,
        },
      });
      await this.cloneContent(tx, target, created.id);
      await tx.creatorKit.update({
        where: { id: kit.id },
        data: { activeRevisionId: created.id },
      });
      return created;
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'CREATOR_KIT_REVISION_RESTORED',
      entityType: 'CreatorKitRevision',
      entityId: restored.id,
      metadata: {
        offerId,
        restoredFromRevisionId: target.id,
        previousActiveRevisionId: active?.id,
      },
    });
    return this.getBrandKit(userId, offerId);
  }

  async getBrandPreview(
    userId: string,
    offerId: string,
    accessLevel: CreatorKitAccessLevel,
    source: 'DRAFT' | 'PUBLISHED' = 'DRAFT',
    affiliateApproved = true,
  ) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    const revisionId =
      source === 'DRAFT'
        ? kit.draftRevisionId ?? kit.activeRevisionId
        : kit.activeRevisionId;
    if (!revisionId) throw new NotFoundException('Creator Kit ещё не заполнен');
    const revision = await this.loadRevision(revisionId);
    const snapshot = this.snapshotFromJson(revision.snapshot) ?? this.buildSnapshot(revision);
    return this.presentFilteredSnapshot(
      snapshot,
      offer,
      {
        hasProductAccess: accessLevel === CreatorKitAccessLevel.PRODUCT,
        hasActiveRelationship: affiliateApproved,
      },
      {
        source,
        simulated: true,
        revision: this.revisionMeta(revision),
      },
    );
  }

  async previewAsCreator(
    userId: string,
    offerId: string,
    dto: PreviewAsCreatorDto,
  ) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    if (!dto.creatorId) throw new BadRequestException('Выберите креатора');
    await this.assertCreatorRelevantToOffer(dto.creatorId, offerId);
    const actual = await this.creatorAccess(dto.creatorId, offerId);
    const hasProductAccess =
      dto.productAccess === 'ACTUAL'
        ? actual.hasProductAccess
        : dto.productAccess === 'GRANTED';
    const hasActiveRelationship =
      dto.affiliateApproval === 'ACTUAL'
        ? actual.hasActiveRelationship
        : dto.affiliateApproval === 'ACTIVE';
    const revisionId =
      dto.source === 'DRAFT'
        ? kit.draftRevisionId ?? kit.activeRevisionId
        : kit.activeRevisionId;
    if (!revisionId) throw new NotFoundException('Creator Kit ещё не заполнен');
    const revision = await this.loadRevision(revisionId);
    const snapshot = this.snapshotFromJson(revision.snapshot) ?? this.buildSnapshot(revision);
    const simulated =
      dto.productAccess !== 'ACTUAL' || dto.affiliateApproval !== 'ACTUAL';
    return this.presentFilteredSnapshot(
      snapshot,
      offer,
      { hasProductAccess, hasActiveRelationship },
      {
        source: dto.source,
        simulated,
        creatorId: dto.creatorId,
        actualProductAccess: actual.hasProductAccess,
        effectiveProductAccess: hasProductAccess,
        actualAffiliateApproval: actual.hasActiveRelationship,
        effectiveAffiliateApproval: hasActiveRelationship,
        revision: this.revisionMeta(revision),
      },
    );
  }

  async getCreatorKit(userId: string, offerId: string) {
    const creator = await this.assertCreator(userId);
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    const kit = await this.prisma.creatorKit.findUnique({ where: { offerId } });
    if (!kit?.activeRevisionId) throw new NotFoundException('Creator Kit ещё не опубликован');
    const revision = await this.loadRevision(kit.activeRevisionId);
    const snapshot = this.snapshotFromJson(revision.snapshot) ?? this.buildSnapshot(revision);
    const access = await this.creatorAccess(creator.id, offerId);
    return this.presentFilteredSnapshot(snapshot, offer, access, {
      source: 'PUBLISHED',
      simulated: false,
      creatorId: creator.id,
      revision: this.revisionMeta(revision),
    });
  }

  async createScenario(
    userId: string,
    offerId: string,
    dto: CreatorKitScenarioDto,
  ) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const draft = await this.ensureDraft(userId, offer);
    const count = await this.prisma.creatorKitScenario.count({
      where: { revisionId: draft.id },
    });
    const scenario = await this.prisma.creatorKitScenario.create({
      data: this.normalizeScenario(dto, draft.id, dto.sortOrder ?? count),
    });
    return scenario;
  }

  async updateScenario(
    userId: string,
    offerId: string,
    scenarioId: string,
    dto: UpdateCreatorKitScenarioDto,
  ) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const draft = await this.ensureDraft(userId, offer);
    const existing = await this.prisma.creatorKitScenario.findFirst({
      where: { id: scenarioId, revisionId: draft.id },
    });
    if (!existing) throw new NotFoundException('Сценарий черновика не найден');
    const normalized = this.normalizeScenario(
      {
        channel: dto.channel ?? existing.channel,
        title: dto.title ?? existing.title,
        mainIdea: dto.mainIdea ?? dto.idea ?? existing.mainIdea,
        hook: dto.hook ?? existing.hook ?? undefined,
        structure: dto.structure ?? existing.structure ?? undefined,
        cta: dto.cta ?? existing.cta ?? undefined,
        accessLevel: dto.accessLevel ?? existing.accessLevel,
        requiresAffiliateApproval:
          dto.requiresAffiliateApproval ?? existing.requiresAffiliateApproval,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
      },
      draft.id,
      dto.sortOrder ?? existing.sortOrder,
    );
    return this.prisma.creatorKitScenario.update({
      where: { id: existing.id },
      data: normalized,
    });
  }

  async deleteScenario(userId: string, offerId: string, scenarioId: string) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const draft = await this.ensureDraft(userId, offer);
    const result = await this.prisma.creatorKitScenario.deleteMany({
      where: { id: scenarioId, revisionId: draft.id },
    });
    if (!result.count) throw new NotFoundException('Сценарий черновика не найден');
    return { deleted: true };
  }

  async reorderScenarios(userId: string, offerId: string, scenarioIds: string[]) {
    const offer = await this.getOwnedOffer(userId, offerId);
    const draft = await this.ensureDraft(userId, offer);
    const existing = await this.prisma.creatorKitScenario.findMany({
      where: { revisionId: draft.id },
      select: { id: true },
    });
    const currentIds = new Set(existing.map((item) => item.id));
    if (
      scenarioIds.length !== currentIds.size ||
      scenarioIds.some((id) => !currentIds.has(id))
    ) {
      throw new BadRequestException('Передан неполный или чужой список сценариев');
    }
    await this.prisma.$transaction(
      scenarioIds.map((id, sortOrder) =>
        this.prisma.creatorKitScenario.update({
          where: { id },
          data: { sortOrder },
        }),
      ),
    );
    return { reordered: true };
  }

  async listProductAccess(user: AuthenticatedUser, offerId: string) {
    await this.getOfferForActor(user, offerId);
    return this.prisma.creatorProductAccessGrant.findMany({
      where: { offerId },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, displayName: true } },
        grantedBy: { select: { id: true, email: true } },
        revokedBy: { select: { id: true, email: true } },
      },
    });
  }

  async grantProductAccess(
    user: AuthenticatedUser,
    offerId: string,
    creatorId: string,
    dto: ProductAccessDto,
  ) {
    await this.getOfferForActor(user, offerId);
    await this.assertCreatorRelevantToOffer(creatorId, offerId, true);
    const existing = await this.prisma.creatorProductAccessGrant.findFirst({
      where: { offerId, creatorId, status: CreatorProductAccessStatus.ACTIVE },
    });
    if (existing) return existing;
    const grant = await this.prisma.creatorProductAccessGrant.create({
      data: {
        offerId,
        creatorId,
        grantedByUserId: user.id,
        reason: dto.reason?.trim() || null,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'CREATOR_PRODUCT_ACCESS_GRANTED',
      entityType: 'CreatorProductAccessGrant',
      entityId: grant.id,
      metadata: { offerId, creatorId, pilotManualAccess: true },
    });
    return grant;
  }

  async revokeProductAccess(
    user: AuthenticatedUser,
    offerId: string,
    creatorId: string,
    dto: ProductAccessDto,
  ) {
    await this.getOfferForActor(user, offerId);
    const grant = await this.prisma.creatorProductAccessGrant.findFirst({
      where: { offerId, creatorId, status: CreatorProductAccessStatus.ACTIVE },
    });
    if (!grant) return { revoked: false };
    const revoked = await this.prisma.creatorProductAccessGrant.update({
      where: { id: grant.id },
      data: {
        status: CreatorProductAccessStatus.REVOKED,
        revokedByUserId: user.id,
        revokedAt: new Date(),
        reason: dto.reason?.trim() || grant.reason,
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'CREATOR_PRODUCT_ACCESS_REVOKED',
      entityType: 'CreatorProductAccessGrant',
      entityId: grant.id,
      metadata: { offerId, creatorId, pilotManualAccess: true },
    });
    return revoked;
  }

  async initUpload(userId: string, offerId: string, dto: InitCreatorKitUploadDto) {
    await this.assertVerifiedBrand(userId);
    const offer = await this.getOwnedOffer(userId, offerId);
    const kit = await this.ensureKit(offer.id);
    const draft = await this.ensureDraft(userId, offer);
    const count = await this.prisma.creatorKitAsset.count({
      where: { creatorKitId: kit.id, status: { not: CreatorKitAssetStatus.DELETED } },
    });
    const maxAssets = Number(this.config.get<string>('CREATOR_KIT_MAX_ASSETS') ?? 100);
    if (count >= maxAssets) throw new BadRequestException(`Не более ${maxAssets} материалов`);
    const { extension, maxBytes } = this.validateFile(dto);
    if (dto.byteSize > maxBytes) throw new BadRequestException('Файл превышает допустимый размер');
    const assetId = randomUUID();
    const objectKey = `brands/${offer.brandId}/offers/${offer.id}/creator-kit/${assetId}/${randomUUID()}.${extension}`;
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.creatorKitAsset.create({
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
      const sortOrder = await tx.creatorKitRevisionAsset.count({
        where: { revisionId: draft.id },
      });
      await tx.creatorKitRevisionAsset.create({
        data: {
          revisionId: draft.id,
          assetId: created.id,
          title: created.title,
          accessLevel: created.accessLevel,
          editable: created.editable,
          textAllowed: created.textAllowed,
          paidAdsAllowed: created.paidAdsAllowed,
          approvalRequired: created.approvalRequired,
          requiresAffiliateApproval: created.requiresAffiliateApproval,
          expiresAt: created.expiresAt,
          sortOrder,
        },
      });
      return created;
    });
    return {
      asset: this.publicAsset(asset),
      uploadUrl: await this.storage.createUploadUrl(objectKey, dto.mimeType),
      requiredHeaders: { 'Content-Type': dto.mimeType },
    };
  }

  async completeUpload(userId: string, offerId: string, assetId: string) {
    await this.assertVerifiedBrand(userId);
    const { asset } = await this.getOwnedAsset(userId, offerId, assetId);
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
      this.validateStoredFile(
        asset.originalFileName,
        asset.mimeType,
        Number(asset.byteSize),
        asset.assetType,
      );
      return this.publicAsset(
        await this.prisma.creatorKitAsset.update({
          where: { id: asset.id },
          data: { status: CreatorKitAssetStatus.READY, disabledAt: null },
        }),
      );
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

  async disableAsset(userId: string, offerId: string, assetId: string) {
    const { asset } = await this.getOwnedAsset(userId, offerId, assetId);
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

  async enableAsset(userId: string, offerId: string, assetId: string) {
    const { asset } = await this.getOwnedAsset(userId, offerId, assetId);
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

  async brandDownload(userId: string, offerId: string, assetId: string) {
    const { asset } = await this.getOwnedAsset(userId, offerId, assetId);
    if (
      asset.status !== CreatorKitAssetStatus.READY &&
      asset.status !== CreatorKitAssetStatus.DISABLED
    ) {
      throw new BadRequestException('Файл ещё не готов к скачиванию');
    }
    return {
      downloadUrl: await this.storage.createDownloadUrl(
        asset.storageObjectKey,
        asset.originalFileName,
      ),
    };
  }

  async creatorDownload(userId: string, offerId: string, assetId: string) {
    const creator = await this.assertCreator(userId);
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    const kit = await this.prisma.creatorKit.findUnique({ where: { offerId } });
    if (!kit?.activeRevisionId) throw new NotFoundException('Creator Kit ещё не опубликован');
    const revision = await this.loadRevision(kit.activeRevisionId);
    const snapshot = this.snapshotFromJson(revision.snapshot) ?? this.buildSnapshot(revision);
    const access = await this.creatorAccess(creator.id, offerId);
    const visible = await this.filterSnapshot(snapshot, offer, access);
    if (!visible.assets.some((asset) => (asset.assetId ?? asset.id) === assetId)) {
      throw new NotFoundException('Материал недоступен');
    }
    const asset = await this.prisma.creatorKitAsset.findFirst({
      where: {
        id: assetId,
        creatorKit: { offerId },
        status: CreatorKitAssetStatus.READY,
      },
    });
    if (!asset) throw new NotFoundException('Материал недоступен');
    return {
      downloadUrl: await this.storage.createDownloadUrl(
        asset.storageObjectKey,
        asset.originalFileName,
      ),
    };
  }

  private async getPreferredBrandRevision(kit: {
    activeRevisionId: string | null;
    draftRevisionId: string | null;
  }) {
    const id = kit.draftRevisionId ?? kit.activeRevisionId;
    return id ? this.loadRevision(id) : null;
  }

  private async ensureDraft(
    userId: string,
    offer: { id: string; brandId: string; description: string },
  ) {
    const kit = await this.ensureKit(offer.id);
    if (kit.draftRevisionId) return this.loadRevision(kit.draftRevisionId);
    const base = kit.activeRevisionId ? await this.loadRevision(kit.activeRevisionId) : null;
    if (base) {
      const draft = await this.prisma.$transaction(async (tx) => {
        const created = await this.cloneRevisionInTransaction(
          tx,
          userId,
          kit.id,
          base,
          CreatorKitRevisionStatus.DRAFT,
        );
        await tx.creatorKit.update({
          where: { id: kit.id },
          data: { draftRevisionId: created.id },
        });
        return created;
      });
      return this.loadRevision(draft.id);
    }
    const brand = await this.prisma.brandProfile.findUnique({
      where: { id: offer.brandId },
      select: { description: true },
    });
    const revision = await this.prisma.$transaction(async (tx) => {
      const revisionNumber = await this.nextRevisionNumber(tx, kit.id);
      const created = await tx.creatorKitRevision.create({
        data: {
          creatorKitId: kit.id,
          revisionNumber,
          status: CreatorKitRevisionStatus.DRAFT,
          createdByUserId: userId,
          brandContent: {
            create: {
              description: brand?.description ?? null,
              values: [],
            },
          },
          productContent: {
            create: {
              description: offer.description,
              benefits: [],
            },
          },
        },
      });
      await tx.creatorKit.update({
        where: { id: kit.id },
        data: { draftRevisionId: created.id },
      });
      return created;
    });
    return this.loadRevision(revision.id);
  }

  private async cloneRevisionInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    creatorKitId: string,
    source: RevisionWithContent,
    status: CreatorKitRevisionStatus,
    publisherNote?: string,
  ) {
    const revisionNumber = await this.nextRevisionNumber(tx, creatorKitId);
    const created = await tx.creatorKitRevision.create({
      data: {
        creatorKitId,
        revisionNumber,
        status,
        basedOnRevisionId: source.id,
        createdByUserId: userId,
        publisherNote: publisherNote?.trim() || null,
      },
    });
    await this.cloneContent(tx, source, created.id);
    return created;
  }

  private async cloneContent(
    tx: Prisma.TransactionClient,
    source: RevisionWithContent,
    targetRevisionId: string,
  ) {
    if (source.brandContent) {
      const { id: _id, revisionId: _revisionId, createdAt: _createdAt, updatedAt: _updatedAt, ...data } =
        source.brandContent;
      await tx.creatorKitBrandContent.create({ data: { ...data, revisionId: targetRevisionId } });
    }
    if (source.productContent) {
      const { id: _id, revisionId: _revisionId, createdAt: _createdAt, updatedAt: _updatedAt, ...data } =
        source.productContent;
      await tx.creatorKitProductContent.create({ data: { ...data, revisionId: targetRevisionId } });
    }
    if (source.assets.length) {
      await tx.creatorKitRevisionAsset.createMany({
        data: source.assets.map(({ id: _id, revisionId: _revisionId, createdAt: _createdAt, updatedAt: _updatedAt, asset: _asset, ...item }) => ({
          ...item,
          revisionId: targetRevisionId,
        })),
      });
    }
    if (source.scenarios.length) {
      await tx.creatorKitScenario.createMany({
        data: source.scenarios.map(({ id: _id, creatorKitId: _creatorKitId, revisionId: _revisionId, createdAt: _createdAt, updatedAt: _updatedAt, ...item }) => ({
          ...item,
          revisionId: targetRevisionId,
        })),
      });
    }
    if (source.facts.length) {
      await tx.creatorKitFact.createMany({
        data: source.facts.map(({ id: _id, creatorKitId: _creatorKitId, revisionId: _revisionId, createdAt: _createdAt, updatedAt: _updatedAt, ...item }) => ({
          ...item,
          revisionId: targetRevisionId,
        })),
      });
    }
    if (source.claims.length) {
      await tx.creatorKitClaim.createMany({
        data: source.claims.map(({ id: _id, creatorKitId: _creatorKitId, revisionId: _revisionId, createdAt: _createdAt, updatedAt: _updatedAt, ...item }) => ({
          ...item,
          revisionId: targetRevisionId,
        })),
      });
    }
    if (source.rules.length) {
      await tx.creatorKitRule.createMany({
        data: source.rules.map(({ id: _id, creatorKitId: _creatorKitId, revisionId: _revisionId, createdAt: _createdAt, updatedAt: _updatedAt, ...item }) => ({
          ...item,
          revisionId: targetRevisionId,
        })),
      });
    }
    if (source.publicationRequirements) {
      const { id: _id, creatorKitId: _creatorKitId, revisionId: _revisionId, createdAt: _createdAt, updatedAt: _updatedAt, ...data } =
        source.publicationRequirements;
      await tx.publicationRequirements.create({
        data: { ...data, revisionId: targetRevisionId },
      });
    }
  }

  private async deleteRevisionContent(tx: Prisma.TransactionClient, revisionId: string) {
    await tx.creatorKitRevisionAsset.deleteMany({ where: { revisionId } });
    await tx.creatorKitScenario.deleteMany({ where: { revisionId } });
    await tx.creatorKitFact.deleteMany({ where: { revisionId } });
    await tx.creatorKitClaim.deleteMany({ where: { revisionId } });
    await tx.creatorKitRule.deleteMany({ where: { revisionId } });
    await tx.publicationRequirements.deleteMany({ where: { revisionId } });
    await tx.creatorKitBrandContent.deleteMany({ where: { revisionId } });
    await tx.creatorKitProductContent.deleteMany({ where: { revisionId } });
  }

  private async nextRevisionNumber(tx: Prisma.TransactionClient, creatorKitId: string) {
    const aggregate = await tx.creatorKitRevision.aggregate({
      where: { creatorKitId },
      _max: { revisionNumber: true },
    });
    return (aggregate._max.revisionNumber ?? 0) + 1;
  }

  private buildSnapshot(revision: RevisionWithContent): CreatorKitSnapshot {
    const clean = <T extends Record<string, unknown>>(value: T) => {
      const {
        revisionId: _revisionId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...data
      } = value;
      return data;
    };
    return {
      schemaVersion: 1,
      customSections: [],
      brandContent: revision.brandContent ? clean(revision.brandContent) : null,
      productContent: revision.productContent ? clean(revision.productContent) : null,
      assets: revision.assets.map((link) => ({
        ...clean(link),
        id: link.assetId,
        assetId: link.assetId,
        assetType: link.asset.assetType,
        status: link.asset.status,
        originalFileName: link.asset.originalFileName,
        extension: link.asset.extension,
        mimeType: link.asset.mimeType,
        byteSize: link.asset.byteSize.toString(),
      })),
      scenarios: revision.scenarios.map((item) => clean(item)),
      facts: revision.facts.map((item) => clean(item)),
      claims: revision.claims.map((item) => clean(item)),
      rules: revision.rules.map((item) => clean(item)),
      publicationRequirements: revision.publicationRequirements
        ? clean(revision.publicationRequirements)
        : null,
    };
  }

  private async filterSnapshot(
    snapshot: CreatorKitSnapshot,
    offer: { promotionWithoutProduct: PromotionWithoutProduct },
    access: { hasProductAccess: boolean; hasActiveRelationship: boolean },
  ) {
    const assetIds = snapshot.assets
      .map((item) => String(item.assetId ?? item.id ?? ''))
      .filter(Boolean);
    const operational = assetIds.length
      ? await this.prisma.creatorKitAsset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, status: true, expiresAt: true },
        })
      : [];
    const statusMap = new Map(operational.map((item) => [item.id, item]));
    const allowed = (item: SnapshotItem | null) => {
      if (!item) return false;
      if (
        item.accessLevel === CreatorKitAccessLevel.PRODUCT &&
        !access.hasProductAccess
      ) {
        return false;
      }
      if (
        item.accessLevel !== CreatorKitAccessLevel.PRODUCT &&
        offer.promotionWithoutProduct === PromotionWithoutProduct.NO &&
        !access.hasProductAccess
      ) {
        return false;
      }
      if (item.requiresAffiliateApproval && !access.hasActiveRelationship) {
        return false;
      }
      return true;
    };
    const now = new Date();
    return {
      ...snapshot,
      brandContent: allowed(snapshot.brandContent) ? snapshot.brandContent : null,
      productContent: allowed(snapshot.productContent) ? snapshot.productContent : null,
      assets: snapshot.assets.filter((item) => {
        if (!allowed(item)) return false;
        const id = String(item.assetId ?? item.id);
        const live = statusMap.get(id);
        if (!live || live.status !== CreatorKitAssetStatus.READY) return false;
        const expiresAt = item.expiresAt ? new Date(String(item.expiresAt)) : live.expiresAt;
        return !expiresAt || expiresAt > now;
      }),
      scenarios: snapshot.scenarios.filter(allowed),
      facts: snapshot.facts.filter(allowed),
      claims: snapshot.claims.filter(allowed),
      rules: snapshot.rules.filter(allowed),
      publicationRequirements: allowed(snapshot.publicationRequirements)
        ? snapshot.publicationRequirements
        : null,
    };
  }

  private async presentFilteredSnapshot(
    snapshot: CreatorKitSnapshot,
    offer: {
      id: string;
      promotionWithoutProduct: PromotionWithoutProduct;
      allowedPromotionFormats: string[];
    },
    access: { hasProductAccess: boolean; hasActiveRelationship: boolean },
    context: Record<string, unknown>,
  ) {
    const filtered = await this.filterSnapshot(snapshot, offer, access);
    const presented = await this.withAssetPreviewUrls(filtered, offer.id);
    return {
      ...presented,
      offerPolicy: {
        promotionWithoutProduct: offer.promotionWithoutProduct,
        allowedPromotionFormats: offer.allowedPromotionFormats,
      },
      completeness: this.completeness(snapshot, offer),
      accessContext: {
        ...context,
        hasProductAccess: access.hasProductAccess,
        hasActiveAffiliateRelationship: access.hasActiveRelationship,
      },
      filtered: true,
    };
  }

  private async presentRevision(
    revision: RevisionWithContent,
    offer: {
      id: string;
      promotionWithoutProduct: PromotionWithoutProduct;
      allowedPromotionFormats: string[];
    },
    filtered: boolean,
  ) {
    const snapshot = this.snapshotFromJson(revision.snapshot) ?? this.buildSnapshot(revision);
    const presented = await this.withAssetPreviewUrls(snapshot, offer.id);
    return {
      ...presented,
      offerPolicy: {
        promotionWithoutProduct: offer.promotionWithoutProduct,
        allowedPromotionFormats: offer.allowedPromotionFormats,
      },
      completeness: this.completeness(snapshot, offer),
      revision: this.revisionMeta(revision),
      filtered,
    };
  }

  private async withAssetPreviewUrls(
    snapshot: CreatorKitSnapshot,
    offerId: string,
  ): Promise<CreatorKitSnapshot> {
    const assetIds = snapshot.assets
      .map((item) => String(item.assetId ?? item.id ?? ''))
      .filter(Boolean);
    if (!assetIds.length) return snapshot;

    const assets = await this.prisma.creatorKitAsset.findMany({
      where: {
        id: { in: assetIds },
        status: {
          in: [CreatorKitAssetStatus.READY, CreatorKitAssetStatus.DISABLED],
        },
        mimeType: { startsWith: 'image/' },
        creatorKit: { offerId },
      },
      select: {
        id: true,
        storageObjectKey: true,
        mimeType: true,
      },
    });
    const previewUrls = new Map(
      await Promise.all(
        assets.map(async (asset) => [
          asset.id,
          await this.storage.createViewUrl(asset.storageObjectKey, asset.mimeType),
        ] as const),
      ),
    );

    return {
      ...snapshot,
      assets: snapshot.assets.map((item) => {
        const id = String(item.assetId ?? item.id ?? '');
        const previewUrl = previewUrls.get(id);
        return previewUrl ? { ...item, previewUrl } : item;
      }),
    };
  }

  private completeness(
    snapshot: CreatorKitSnapshot,
    offer: { promotionWithoutProduct: PromotionWithoutProduct },
  ) {
    const nonBlank = (value: unknown) =>
      typeof value === 'string' && value.trim().length > 0;
    const brand = snapshot.brandContent ?? {};
    const product = snapshot.productContent ?? {};
    const scenarioComplete = snapshot.scenarios.some(
      (item) =>
        nonBlank(item.title) &&
        nonBlank(item.hook) &&
        nonBlank(item.mainIdea) &&
        nonBlank(item.structure) &&
        nonBlank(item.cta),
    );
    const requiredAssetLevel =
      offer.promotionWithoutProduct === PromotionWithoutProduct.NO
        ? CreatorKitAccessLevel.PRODUCT
        : CreatorKitAccessLevel.DIGITAL;
    const sections = [
      {
        key: 'BRAND_STORY',
        label: 'О бренде',
        weight: 15,
        missingItems: [
          !nonBlank(brand.description) && 'Описание бренда',
          !nonBlank(brand.history) && 'История бренда',
          !Array.isArray(brand.values) || !(brand.values as unknown[]).some(nonBlank)
            ? 'Ценности бренда'
            : false,
          !nonBlank(brand.positioning) && 'Позиционирование',
        ].filter(Boolean),
      },
      {
        key: 'PRODUCT_INFORMATION',
        label: 'О продукте',
        weight: 15,
        missingItems: [
          !nonBlank(product.description) && 'Описание продукта',
          !Array.isArray(product.benefits) ||
          !(product.benefits as unknown[]).some(nonBlank)
            ? 'Преимущества'
            : false,
          !nonBlank(product.usageInstructions) && 'Инструкция применения',
        ].filter(Boolean),
      },
      {
        key: 'ASSETS',
        label: 'Материалы',
        weight: 15,
        missingItems: snapshot.assets.some(
          (item) =>
            item.accessLevel === requiredAssetLevel &&
            item.status === CreatorKitAssetStatus.READY,
        )
          ? []
          : ['Готовый материал для основного уровня доступа'],
      },
      {
        key: 'SCENARIOS',
        label: 'Сценарии',
        weight: 15,
        missingItems: scenarioComplete ? [] : ['Полностью заполненный сценарий'],
      },
      {
        key: 'FACTS',
        label: 'Банк фактов',
        weight: 10,
        missingItems:
          snapshot.facts.filter((item) => nonBlank(item.value)).length >= 3
            ? []
            : ['Минимум три содержательных факта'],
      },
      {
        key: 'CLAIMS',
        label: 'Формулировки',
        weight: 10,
        missingItems:
          snapshot.claims.some((item) => item.type === 'ALLOWED' && nonBlank(item.value)) &&
          snapshot.claims.some((item) => item.type === 'FORBIDDEN' && nonBlank(item.value))
            ? []
            : ['Разрешённая и запрещённая формулировки'],
      },
      {
        key: 'PROMOTION_RULES',
        label: 'Правила продвижения',
        weight: 10,
        missingItems: snapshot.rules.some((item) => nonBlank(item.value))
          ? []
          : ['Минимум одно правило'],
      },
      {
        key: 'PUBLICATION_REQUIREMENTS',
        label: 'Требования к публикации',
        weight: 10,
        missingItems:
          snapshot.publicationRequirements &&
          Array.isArray(snapshot.publicationRequirements.mandatoryMentions) &&
          (snapshot.publicationRequirements.mandatoryMentions as unknown[]).some(nonBlank) &&
          nonBlank(snapshot.publicationRequirements.advertisingLabel) &&
          Array.isArray(snapshot.publicationRequirements.allowedPlatforms) &&
          (snapshot.publicationRequirements.allowedPlatforms as unknown[]).some(nonBlank)
            ? []
            : ['Упоминания, маркировка и разрешённые площадки'],
      },
    ].map((section) => ({
      ...section,
      status: section.missingItems.length ? 'INCOMPLETE' : 'COMPLETE',
    }));
    return {
      percent: sections.reduce(
        (sum, section) => sum + (section.status === 'COMPLETE' ? section.weight : 0),
        0,
      ),
      readyToPublish: sections.every((section) => section.status === 'COMPLETE'),
      sections,
      missingSections: sections
        .filter((section) => section.status === 'INCOMPLETE')
        .map((section) => section.label),
      blockingIssues: [],
    };
  }

  private diffSnapshots(
    before: CreatorKitSnapshot | null,
    after: CreatorKitSnapshot,
  ) {
    if (!before) {
      return {
        summary: 'Создана первая опубликованная версия Creator Kit',
        changeSet: {
          schemaVersion: 1,
          sections: [{ section: 'CREATOR_KIT', changeType: 'CREATED' }],
        },
      };
    }
    const sections: Record<string, unknown>[] = [];
    const textSections: Array<[string, keyof CreatorKitSnapshot]> = [
      ['BRAND_CONTENT', 'brandContent'],
      ['PRODUCT_CONTENT', 'productContent'],
      ['PUBLICATION_REQUIREMENTS', 'publicationRequirements'],
    ];
    for (const [name, key] of textSections) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        sections.push({ section: name, changeType: 'UPDATED' });
      }
    }
    for (const [name, key] of [
      ['ASSETS', 'assets'],
      ['SCENARIOS', 'scenarios'],
      ['FACTS', 'facts'],
      ['CLAIMS', 'claims'],
      ['RULES', 'rules'],
    ] as Array<[string, 'assets' | 'scenarios' | 'facts' | 'claims' | 'rules']>) {
      const oldItems = before[key];
      const newItems = after[key];
      const oldMap = new Map(oldItems.map((item) => [String(item.assetId ?? item.id), item]));
      const newMap = new Map(newItems.map((item) => [String(item.assetId ?? item.id), item]));
      const added = [...newMap.keys()].filter((id) => !oldMap.has(id)).length;
      const removed = [...oldMap.keys()].filter((id) => !newMap.has(id)).length;
      const updated = [...newMap.keys()].filter(
        (id) => oldMap.has(id) && JSON.stringify(oldMap.get(id)) !== JSON.stringify(newMap.get(id)),
      ).length;
      const reordered =
        oldItems.map((item) => item.assetId ?? item.id).join('|') !==
        newItems.map((item) => item.assetId ?? item.id).join('|');
      if (added || removed || updated || reordered) {
        sections.push({
          section: name,
          changeType: 'COLLECTION_CHANGED',
          added,
          removed,
          updated,
          reordered,
        });
      }
    }
    const labels: Record<string, string> = {
      BRAND_CONTENT: 'О бренде обновлено',
      PRODUCT_CONTENT: 'Информация о продукте обновлена',
      PUBLICATION_REQUIREMENTS: 'Требования к публикации обновлены',
      ASSETS: 'Материалы изменены',
      SCENARIOS: 'Сценарии изменены',
      FACTS: 'Банк фактов изменён',
      CLAIMS: 'Формулировки изменены',
      RULES: 'Правила продвижения изменены',
    };
    return {
      summary: sections.length
        ? sections.map((item) => labels[String(item.section)]).join('; ')
        : 'Содержимое не изменилось',
      changeSet: { schemaVersion: 1, sections },
    };
  }

  private normalizeScenario(
    item: CreatorKitScenarioDto,
    revisionId: string,
    sortOrder: number,
  ) {
    const mainIdea = item.mainIdea?.trim() || item.idea?.trim();
    if (!mainIdea) throw new BadRequestException('Укажите основную идею сценария');
    return {
      revisionId,
      channel: item.channel,
      title: item.title.trim(),
      mainIdea,
      hook: item.hook?.trim() || null,
      structure: item.structure?.trim() || null,
      cta: item.cta?.trim() || null,
      accessLevel: item.accessLevel,
      requiresAffiliateApproval: item.requiresAffiliateApproval ?? false,
      sortOrder,
    };
  }

  private normalizeBrandContent(dto: NonNullable<UpsertCreatorKitDto['brandContent']>) {
    return {
      description: dto.description?.trim() || null,
      history: dto.history?.trim() || null,
      values: dto.values.map((value) => value.trim()).filter(Boolean),
      positioning: dto.positioning?.trim() || null,
      accessLevel: dto.accessLevel ?? CreatorKitAccessLevel.DIGITAL,
      requiresAffiliateApproval: dto.requiresAffiliateApproval ?? false,
    };
  }

  private normalizeProductContent(dto: NonNullable<UpsertCreatorKitDto['productContent']>) {
    return {
      description: dto.description?.trim() || null,
      benefits: dto.benefits.map((value) => value.trim()).filter(Boolean),
      usageInstructions: dto.usageInstructions?.trim() || null,
      accessLevel: dto.accessLevel ?? CreatorKitAccessLevel.DIGITAL,
      requiresAffiliateApproval: dto.requiresAffiliateApproval ?? false,
    };
  }

  private snapshotFromJson(value: Prisma.JsonValue | null | undefined) {
    return value && typeof value === 'object'
      ? (value as unknown as CreatorKitSnapshot)
      : null;
  }

  private revisionMeta(revision: {
    id: string;
    revisionNumber: number;
    status: CreatorKitRevisionStatus;
    basedOnRevisionId: string | null;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      status: revision.status,
      basedOnRevisionId: revision.basedOnRevisionId,
      publishedAt: revision.publishedAt,
      createdAt: revision.createdAt,
      updatedAt: revision.updatedAt,
    };
  }

  private async creatorAccess(creatorId: string, offerId: string) {
    const [relationship, grant] = await Promise.all([
      this.prisma.affiliateRelationship.findFirst({
        where: {
          offerId,
          creatorId,
          status: AffiliateRelationshipStatus.ACTIVE,
        },
        select: { id: true },
      }),
      this.prisma.creatorProductAccessGrant.findFirst({
        where: {
          offerId,
          creatorId,
          status: CreatorProductAccessStatus.ACTIVE,
        },
        select: { id: true },
      }),
    ]);
    return {
      hasActiveRelationship: Boolean(relationship),
      hasProductAccess: Boolean(grant),
    };
  }

  private async assertCreatorRelevantToOffer(
    creatorId: string,
    offerId: string,
    requireApproved = false,
  ) {
    const relationship = await this.prisma.affiliateRelationship.findFirst({
      where: {
        offerId,
        creatorId,
        ...(requireApproved
          ? { status: { in: [AffiliateRelationshipStatus.ACTIVE, AffiliateRelationshipStatus.PAUSED] } }
          : {}),
      },
      select: { id: true },
    });
    if (relationship) return;
    if (!requireApproved) {
      const application = await this.prisma.offerApplication.findFirst({
        where: { offerId, creatorId },
        select: { id: true },
      });
      if (application) return;
    }
    throw new ForbiddenException(
      requireApproved
        ? 'Product Access можно выдать только одобренному креатору'
        : 'Креатор не связан с этим оффером',
    );
  }

  private async getOfferForActor(user: AuthenticatedUser, offerId: string) {
    if (user.role === UserRole.ADMIN) {
      const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
      if (!offer) throw new NotFoundException('Оффер не найден');
      return offer;
    }
    return this.getOwnedOffer(user.id, offerId);
  }

  private async getOwnedOffer(userId: string, offerId: string) {
    const brand = await this.prisma.brandProfile.findUnique({ where: { userId } });
    if (!brand) throw new ForbiddenException('Профиль бренда не найден');
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

  private async assertVerifiedBrand(userId: string) {
    const brand = await this.prisma.brandProfile.findUnique({
      where: { userId },
      select: { verificationStatus: true },
    });
    if (!brand) throw new ForbiddenException('Профиль бренда не найден');
    if (brand.verificationStatus !== BrandVerificationStatus.VERIFIED) {
      throw new ForbiddenException(
        'Загрузка файлов доступна только брендам, подтверждённым администратором',
      );
    }
  }

  private ensureKit(offerId: string) {
    return this.prisma.creatorKit.upsert({
      where: { offerId },
      update: {},
      create: { offerId },
    });
  }

  private loadRevision(id: string) {
    return this.prisma.creatorKitRevision
      .findUnique({ where: { id }, include: REVISION_INCLUDE })
      .then((revision) => {
        if (!revision) throw new NotFoundException('Версия Creator Kit не найдена');
        return revision;
      });
  }

  private async loadOwnedRevision(creatorKitId: string, revisionId: string) {
    const revision = await this.prisma.creatorKitRevision.findFirst({
      where: { id: revisionId, creatorKitId },
      include: REVISION_INCLUDE,
    });
    if (!revision) throw new NotFoundException('Версия Creator Kit не найдена');
    return revision;
  }

  private async getOwnedAsset(userId: string, offerId: string, assetId: string) {
    const offer = await this.getOwnedOffer(userId, offerId);
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

  private publicAsset<T extends { storageObjectKey: string; previewObjectKey: string | null }>(
    asset: T,
  ) {
    const {
      storageObjectKey: _storageObjectKey,
      previewObjectKey: _previewObjectKey,
      ...safe
    } = asset;
    return safe;
  }
}
