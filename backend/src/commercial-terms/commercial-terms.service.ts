import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApplicationTermsStatus,
  CommercialCalculationPolicy,
  CreatorApplicationAction,
  NotificationEventStatus,
  NotificationEventType,
  Offer,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import {
  COMMISSION_SCOPE,
  normalizeCommissionEligibility,
} from '../attribution/commission-eligibility';
import { UpdateCommercialTermsDto } from '../offers/dto/update-commercial-terms.dto';
import { PrismaService } from '../prisma/prisma.service';

const CREATOR_POOL_SHARE_BPS = 6_500;
const PLATFORM_POOL_SHARE_BPS = 3_500;

type OfferSnapshotSource = Offer & {
  creatorKit?: { activeRevisionId: string | null } | null;
};

type PoolTermsInput = Omit<
  Partial<UpdateCommercialTermsDto>,
  'commissionEligibility'
> & {
  totalCommissionPoolBps: number;
  commissionEligibility?:
    UpdateCommercialTermsDto['commissionEligibility'] | Record<string, unknown>;
};

@Injectable()
export class CommercialTermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  financialActivationEnabled() {
    return (
      this.config.get<string>('STAGE7_FINANCE_ENABLED') === 'true' &&
      this.config.get<string>('STAGE7_FINANCIAL_ACTIVATION_ENABLED') === 'true'
    );
  }

  async createInitialVersions(
    tx: Prisma.TransactionClient,
    offer: OfferSnapshotSource,
    actorUserId: string,
    mode: {
      totalCommissionPoolBps?: number;
      legacyCreatorBps?: number;
      legacyPlatformBps?: number;
    },
  ) {
    const offerVersion = await this.createOfferVersion(tx, offer, actorUserId);
    const terms =
      mode.totalCommissionPoolBps !== undefined
        ? await this.createPoolTermsVersion(
            tx,
            offer.id,
            actorUserId,
            { totalCommissionPoolBps: mode.totalCommissionPoolBps },
            1,
          )
        : await this.createLegacyTermsVersion(
            tx,
            offer.id,
            actorUserId,
            mode.legacyCreatorBps ?? offer.creatorCommissionBps,
            mode.legacyPlatformBps ?? offer.platformCommissionBps,
            1,
          );
    await tx.offer.update({
      where: { id: offer.id },
      data: {
        currentOfferVersionId: offerVersion.id,
        currentCommercialTermsId: terms.id,
      },
    });
    return { offerVersion, commercialTerms: terms };
  }

  async createOfferVersion(
    tx: Prisma.TransactionClient,
    offer: OfferSnapshotSource,
    actorUserId: string,
  ) {
    const snapshot = {
      title: offer.title,
      description: offer.description,
      productUrl: offer.productUrl,
      productPriceMinor: offer.productPriceKopecks,
      customerDiscountType: offer.customerDiscountType,
      customerDiscountBps: offer.customerDiscountBps,
      customerDiscountAmountMinor:
        offer.customerDiscountAmountMinor?.toString() ?? null,
      imageId: offer.imageId,
      promotionWithoutProduct: offer.promotionWithoutProduct,
      discoveryCategory: offer.category,
      allowedPromotionFormats: [...offer.allowedPromotionFormats].sort(),
      visibility: offer.status,
      creatorKitRevisionId: offer.creatorKit?.activeRevisionId ?? null,
    };
    const contentHash = this.hash(snapshot);
    const existing = await tx.offerVersion.findFirst({
      where: { offerId: offer.id, contentHash },
    });
    if (existing) {
      if (offer.currentOfferVersionId !== existing.id) {
        await tx.offer.update({
          where: { id: offer.id },
          data: { currentOfferVersionId: existing.id },
        });
      }
      return existing;
    }
    const latest = await tx.offerVersion.aggregate({
      where: { offerId: offer.id },
      _max: { version: true },
    });
    return tx.offerVersion.create({
      data: {
        offerId: offer.id,
        version: (latest._max.version ?? 0) + 1,
        title: offer.title,
        description: offer.description,
        productUrl: offer.productUrl,
        productPriceMinor: BigInt(offer.productPriceKopecks),
        customerDiscountType: offer.customerDiscountType,
        customerDiscountBps: offer.customerDiscountBps,
        customerDiscountAmountMinor: offer.customerDiscountAmountMinor,
        imageId: offer.imageId,
        promotionWithoutProduct: offer.promotionWithoutProduct,
        discoveryCategory: offer.category,
        allowedPromotionFormats: offer.allowedPromotionFormats,
        visibility: offer.status,
        creatorKitRevisionId: offer.creatorKit?.activeRevisionId ?? null,
        contentHash,
        createdByUserId: actorUserId,
        requestId: this.audit.requestId(),
      },
    });
  }

  async updatePoolTerms(
    actorUserId: string,
    offerId: string,
    dto: UpdateCommercialTermsDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const offer = await tx.offer.findUnique({
          where: { id: offerId },
          include: {
            brand: { select: { userId: true } },
            currentCommercialTerms: true,
          },
        });
        if (!offer) throw new ConflictException('Оффер не найден');
        if (offer.brand.userId !== actorUserId) {
          throw new ConflictException(
            'Нет доступа к коммерческим условиям оффера',
          );
        }
        const current = offer.currentCommercialTerms;
        const nextInput = this.mergeTermsInput(current, dto);
        const nextFingerprint = this.hash(this.poolFingerprintInput(nextInput));
        if (current?.contractFingerprint === nextFingerprint) return current;
        const next = await this.createPoolTermsVersion(
          tx,
          offer.id,
          actorUserId,
          nextInput,
        );
        await tx.offer.update({
          where: { id: offer.id },
          data: {
            currentCommercialTermsId: next.id,
            creatorCommissionBps: next.creatorEffectiveGmvBps,
            platformCommissionBps: next.platformEffectiveGmvBps,
          },
        });
        await this.requireReacceptance(
          tx,
          offer.id,
          current?.id ?? null,
          next,
          actorUserId,
        );
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'OFFER_COMMERCIAL_TERMS_CHANGED',
            entityType: 'Offer',
            entityId: offer.id,
            requestId: this.audit.requestId(),
            metadata: {
              previousCommercialTermsVersion: current?.version ?? null,
              nextCommercialTermsVersion: next.version,
              previousCreatorEffectiveBps:
                current?.creatorEffectiveGmvBps ?? null,
              nextCreatorEffectiveBps: next.creatorEffectiveGmvBps,
            },
          },
        });
        return next;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateLegacyTerms(
    actorUserId: string,
    offerId: string,
    creatorBps: number,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const offer = await tx.offer.findUnique({
          where: { id: offerId },
          include: {
            brand: { select: { userId: true } },
            currentCommercialTerms: true,
          },
        });
        if (!offer) throw new ConflictException('Оффер не найден');
        if (offer.brand.userId !== actorUserId) {
          throw new ConflictException(
            'Нет доступа к коммерческим условиям оффера',
          );
        }
        if (
          offer.currentCommercialTerms?.calculationPolicy ===
          CommercialCalculationPolicy.POOL_65_35_V1
        ) {
          throw new ConflictException(
            'Для pool-based оффера изменяйте только общий commission pool',
          );
        }
        const platformBps =
          offer.currentCommercialTerms?.platformEffectiveGmvBps ??
          offer.platformCommissionBps;
        const fingerprint = this.hash({
          calculationPolicy: CommercialCalculationPolicy.LEGACY_DIRECT_RATES_V1,
          creatorBps,
          platformBps,
          currency: 'RUB',
        });
        if (offer.currentCommercialTerms?.contractFingerprint === fingerprint) {
          return offer.currentCommercialTerms;
        }
        const latest = await tx.commercialTermsVersion.aggregate({
          where: { offerId },
          _max: { version: true },
        });
        const next = await this.createLegacyTermsVersion(
          tx,
          offerId,
          actorUserId,
          creatorBps,
          platformBps,
          (latest._max.version ?? 0) + 1,
        );
        await tx.offer.update({
          where: { id: offerId },
          data: {
            currentCommercialTermsId: next.id,
            creatorCommissionBps: creatorBps,
            platformCommissionBps: platformBps,
          },
        });
        await this.requireReacceptance(
          tx,
          offerId,
          offer.currentCommercialTerms?.id ?? null,
          next,
          actorUserId,
        );
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'OFFER_COMMERCIAL_TERMS_CHANGED',
            entityType: 'Offer',
            entityId: offerId,
            requestId: this.audit.requestId(),
            metadata: {
              calculationPolicy:
                CommercialCalculationPolicy.LEGACY_DIRECT_RATES_V1,
              previousCommercialTermsVersion:
                offer.currentCommercialTerms?.version ?? null,
              nextCommercialTermsVersion: next.version,
              previousCreatorEffectiveBps:
                offer.currentCommercialTerms?.creatorEffectiveGmvBps ?? null,
              nextCreatorEffectiveBps: creatorBps,
            },
          },
        });
        return next;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async createPoolTermsVersion(
    tx: Prisma.TransactionClient,
    offerId: string,
    actorUserId: string,
    input: PoolTermsInput,
    explicitVersion?: number,
  ) {
    const creatorEffectiveGmvBps = this.roundBps(
      input.totalCommissionPoolBps,
      CREATOR_POOL_SHARE_BPS,
    );
    const normalized = this.normalizePoolInput(input);
    const latest = explicitVersion
      ? null
      : await tx.commercialTermsVersion.aggregate({
          where: { offerId },
          _max: { version: true },
        });
    return tx.commercialTermsVersion.create({
      data: {
        offerId,
        version: explicitVersion ?? (latest?._max.version ?? 0) + 1,
        calculationPolicy: CommercialCalculationPolicy.POOL_65_35_V1,
        totalCommissionPoolBps: input.totalCommissionPoolBps,
        splitPolicyCode: 'POOL_65_35_V1',
        creatorPoolShareBps: CREATOR_POOL_SHARE_BPS,
        platformPoolShareBps: PLATFORM_POOL_SHARE_BPS,
        creatorEffectiveGmvBps,
        platformEffectiveGmvBps:
          input.totalCommissionPoolBps - creatorEffectiveGmvBps,
        currency: normalized.currency,
        attributionPolicySnapshot:
          normalized.attributionPolicy as Prisma.InputJsonValue,
        attributionWindowSnapshot:
          normalized.attributionWindow as Prisma.InputJsonValue,
        commissionEligibilitySnapshot:
          normalized.commissionEligibility as Prisma.InputJsonValue,
        confirmationPolicySnapshot:
          normalized.confirmationPolicy as Prisma.InputJsonValue,
        returnPolicySnapshot: normalized.returnPolicy as Prisma.InputJsonValue,
        cancellationPolicySnapshot:
          normalized.cancellationPolicy as Prisma.InputJsonValue,
        payoutPolicySnapshot: normalized.payoutPolicy as Prisma.InputJsonValue,
        payoutScheduleSnapshot:
          normalized.payoutSchedule as Prisma.InputJsonValue,
        settlementModelSnapshot:
          normalized.settlementModel as Prisma.InputJsonValue,
        minimumPayoutMinor: BigInt(normalized.minimumPayoutMinor),
        contractFingerprint: this.hash(this.poolFingerprintInput(input)),
        createdByUserId: actorUserId,
        requestId: this.audit.requestId(),
      },
    });
  }

  private async createLegacyTermsVersion(
    tx: Prisma.TransactionClient,
    offerId: string,
    actorUserId: string,
    creatorBps: number,
    platformBps: number,
    version: number,
  ) {
    const fingerprintInput = {
      calculationPolicy: CommercialCalculationPolicy.LEGACY_DIRECT_RATES_V1,
      creatorBps,
      platformBps,
      currency: 'RUB',
    };
    return tx.commercialTermsVersion.create({
      data: {
        offerId,
        version,
        calculationPolicy: CommercialCalculationPolicy.LEGACY_DIRECT_RATES_V1,
        totalCommissionPoolBps: Math.min(10_000, creatorBps + platformBps),
        splitPolicyCode: 'LEGACY_DIRECT_RATES_V1',
        creatorPoolShareBps: 0,
        platformPoolShareBps: 0,
        creatorEffectiveGmvBps: creatorBps,
        platformEffectiveGmvBps: platformBps,
        currency: 'RUB',
        attributionPolicySnapshot: {
          source: 'LEGACY',
          methods: ['AFFILIATE_CODE', 'PROMO_CODE', 'CLICK_ID'],
        },
        attributionWindowSnapshot: { source: 'LEGACY', windowDays: null },
        commissionEligibilitySnapshot: {
          source: 'LEGACY',
          scope: COMMISSION_SCOPE.WHOLE_STORE,
        },
        confirmationPolicySnapshot: {
          source: 'LEGACY',
          confirmation: 'PAID_ORDER',
        },
        returnPolicySnapshot: { source: 'LEGACY', returnWindowDays: null },
        cancellationPolicySnapshot: {
          source: 'LEGACY',
          cancelBeforeConfirmation: 'NO_COMMISSION',
        },
        payoutPolicySnapshot: { source: 'LEGACY', method: 'MANUAL' },
        payoutScheduleSnapshot: { source: 'LEGACY', schedule: 'MANUAL' },
        settlementModelSnapshot: { source: 'LEGACY', model: 'MANUAL' },
        minimumPayoutMinor: 0n,
        contractFingerprint: this.hash(fingerprintInput),
        createdByUserId: actorUserId,
        requestId: this.audit.requestId(),
      },
    });
  }

  private async requireReacceptance(
    tx: Prisma.TransactionClient,
    offerId: string,
    previousTermsId: string | null,
    nextTerms: {
      id: string;
      version: number;
      creatorEffectiveGmvBps: number;
    },
    actorUserId: string,
  ) {
    const applications = await tx.offerApplication.findMany({
      where: { offerId, status: 'PENDING' },
      include: {
        creator: { select: { userId: true } },
        latestAcceptedTerms: {
          select: { creatorEffectiveGmvBps: true, version: true },
        },
      },
    });
    const changedAt = new Date();
    for (const application of applications) {
      await tx.userNotification.updateMany({
        where: {
          applicationId: application.id,
          actionRequired: true,
          resolvedAt: null,
          supersededAt: null,
        },
        data: { supersededAt: changedAt, actionRequired: false },
      });
      await tx.offerApplication.update({
        where: { id: application.id },
        data: {
          applicableCommercialTermsId: nextTerms.id,
          termsStatus: ApplicationTermsStatus.REACCEPTANCE_REQUIRED,
          requiredCreatorAction:
            CreatorApplicationAction.ACCEPT_COMMERCIAL_TERMS,
          creatorActionRequiredAt: changedAt,
          creatorActionResolvedAt: null,
          termsChangedAt: changedAt,
          version: { increment: 1 },
        },
      });
      const deduplicationKey =
        `application:${application.id}:commercial-terms:` +
        `${nextTerms.version}:reacceptance-required`;
      const event = await tx.notificationEvent.upsert({
        where: { deduplicationKey },
        update: {},
        create: {
          eventType:
            NotificationEventType.APPLICATION_COMMERCIAL_TERMS_REACCEPTANCE_REQUIRED,
          aggregateType: 'OfferApplication',
          aggregateId: application.id,
          applicationId: application.id,
          actorUserId,
          recipientUserId: application.creator.userId,
          requestId: this.audit.requestId(),
          deduplicationKey,
          payload: {
            applicationId: application.id,
            offerId,
            previousCommercialTermsVersionId: previousTermsId,
            commercialTermsVersionId: nextTerms.id,
            commercialTermsVersion: nextTerms.version,
            previousCreatorEffectiveBps:
              application.latestAcceptedTerms?.creatorEffectiveGmvBps ?? null,
            creatorEffectiveBps: nextTerms.creatorEffectiveGmvBps,
          },
          processingStatus: NotificationEventStatus.PROCESSED,
          processedAt: changedAt,
        },
      });
      await tx.userNotification.upsert({
        where: { eventId: event.id },
        update: {},
        create: {
          eventId: event.id,
          recipientUserId: application.creator.userId,
          applicationId: application.id,
          type: NotificationEventType.APPLICATION_COMMERCIAL_TERMS_REACCEPTANCE_REQUIRED,
          entityType: 'OfferApplication',
          entityId: application.id,
          titleKey: 'application.commercialTerms.reacceptanceRequired',
          messageData: event.payload as Prisma.InputJsonValue,
          actionUrl: '/creator/applications',
          actionRequired: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'APPLICATION_COMMERCIAL_TERMS_REACCEPTANCE_REQUIRED',
          entityType: 'OfferApplication',
          entityId: application.id,
          requestId: this.audit.requestId(),
          metadata: {
            previousCommercialTermsVersion:
              application.latestAcceptedTerms?.version ?? null,
            nextCommercialTermsVersion: nextTerms.version,
          },
        },
      });
    }
  }

  private mergeTermsInput(
    current: {
      currency: string;
      attributionPolicySnapshot: Prisma.JsonValue;
      attributionWindowSnapshot: Prisma.JsonValue;
      commissionEligibilitySnapshot: Prisma.JsonValue;
      confirmationPolicySnapshot: Prisma.JsonValue;
      returnPolicySnapshot: Prisma.JsonValue;
      cancellationPolicySnapshot: Prisma.JsonValue;
      payoutPolicySnapshot: Prisma.JsonValue;
      payoutScheduleSnapshot: Prisma.JsonValue;
      settlementModelSnapshot: Prisma.JsonValue;
      minimumPayoutMinor: bigint;
    } | null,
    dto: UpdateCommercialTermsDto,
  ) {
    return {
      ...dto,
      currency: dto.currency ?? current?.currency ?? 'RUB',
      attributionPolicy:
        dto.attributionPolicy ??
        this.jsonObject(current?.attributionPolicySnapshot),
      attributionWindow:
        dto.attributionWindow ??
        this.jsonObject(current?.attributionWindowSnapshot),
      commissionEligibility:
        dto.commissionEligibility ??
        this.jsonObject(current?.commissionEligibilitySnapshot),
      confirmationPolicy:
        dto.confirmationPolicy ??
        this.jsonObject(current?.confirmationPolicySnapshot),
      returnPolicy:
        dto.returnPolicy ?? this.jsonObject(current?.returnPolicySnapshot),
      cancellationPolicy:
        dto.cancellationPolicy ??
        this.jsonObject(current?.cancellationPolicySnapshot),
      payoutPolicy:
        dto.payoutPolicy ?? this.jsonObject(current?.payoutPolicySnapshot),
      payoutSchedule:
        dto.payoutSchedule ?? this.jsonObject(current?.payoutScheduleSnapshot),
      settlementModel:
        dto.settlementModel ??
        this.jsonObject(current?.settlementModelSnapshot),
      minimumPayoutMinor:
        dto.minimumPayoutMinor ?? Number(current?.minimumPayoutMinor ?? 0n),
    };
  }

  private normalizePoolInput(input: PoolTermsInput) {
    return {
      currency: (input.currency ?? 'RUB').toUpperCase(),
      attributionPolicy: input.attributionPolicy ?? {
        methods: ['AFFILIATE_CODE', 'PROMO_CODE', 'CLICK_ID'],
      },
      attributionWindow: input.attributionWindow ?? {
        windowDays: this.integerConfig('ATTRIBUTION_WINDOW_DAYS', 30),
      },
      commissionEligibility: this.normalizedCommissionEligibility(
        input.commissionEligibility ?? {
          scope: COMMISSION_SCOPE.WHOLE_STORE,
        },
      ),
      confirmationPolicy: input.confirmationPolicy ?? {
        holdDays: this.integerConfig('COMMISSION_HOLD_DAYS', 14),
      },
      returnPolicy: input.returnPolicy ?? {
        returnWindowDays: this.integerConfig('COMMISSION_HOLD_DAYS', 14),
      },
      cancellationPolicy: input.cancellationPolicy ?? {
        cancelBeforeConfirmation: 'NO_COMMISSION',
      },
      payoutPolicy: input.payoutPolicy ?? { method: 'MANUAL_BATCH' },
      payoutSchedule: input.payoutSchedule ?? { schedule: 'MONTHLY' },
      settlementModel: input.settlementModel ?? { model: 'MONTHLY_STATEMENT' },
      minimumPayoutMinor:
        input.minimumPayoutMinor ??
        this.integerConfig('CREATOR_MINIMUM_PAYOUT_MINOR', 50_000),
    };
  }

  private poolFingerprintInput(input: PoolTermsInput) {
    return {
      calculationPolicy: CommercialCalculationPolicy.POOL_65_35_V1,
      totalCommissionPoolBps: input.totalCommissionPoolBps,
      creatorPoolShareBps: CREATOR_POOL_SHARE_BPS,
      platformPoolShareBps: PLATFORM_POOL_SHARE_BPS,
      ...this.normalizePoolInput(input),
    };
  }

  private normalizedCommissionEligibility(input: unknown) {
    const normalized = normalizeCommissionEligibility(
      input as Record<string, unknown> | undefined,
    );
    return {
      scope: normalized.scope,
      ...(normalized.scope === COMMISSION_SCOPE.SELECTED_PRODUCTS
        ? { externalProductIds: normalized.externalProductIds }
        : {}),
    };
  }

  private roundBps(totalBps: number, shareBps: number) {
    return Number((BigInt(totalBps) * BigInt(shareBps) + 5_000n) / 10_000n);
  }

  private integerConfig(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) ?? fallback);
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  private jsonObject(value: Prisma.JsonValue | undefined) {
    return value && !Array.isArray(value) && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private hash(value: unknown) {
    return createHash('sha256')
      .update(this.stableStringify(value))
      .digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, nested]) =>
            `${JSON.stringify(key)}:${this.stableStringify(nested)}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
