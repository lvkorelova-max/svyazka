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
  ApplicationTermsStatus,
  CreatorApplicationAction,
  CreatorPromoCodeStatus,
  OfferApplicationStatus,
  OfferStatus,
  Prisma,
  TermsAcceptanceType,
} from '@prisma/client';
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { CommercialTermsService } from '../commercial-terms/commercial-terms.service';
import { PrismaService } from '../prisma/prisma.service';
import { BrandAccessService } from '../brand-access/brand-access.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import {
  AcceptApplicationTermsDto,
  ApproveApplicationDto,
} from './dto/application-terms.dto';
import {
  CREATOR_PROMO_CODE_NORMALIZATION_POLICY,
  isValidCreatorPromoCode,
  normalizeCreatorPromoCode,
} from '../common/promo-code';
import { ReplacePromoCodeDto } from './dto/replace-promo-code.dto';

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
  offer: {
    include: {
      brand: { select: PUBLIC_BRAND_SELECT },
      currentCommercialTerms: {
        select: {
          id: true,
          version: true,
          creatorEffectiveGmvBps: true,
          currency: true,
        },
      },
      currentVersion: { select: { id: true, version: true } },
    },
  },
  creator: { select: PUBLIC_CREATOR_SELECT },
  termsObservation: {
    include: {
      commercialTermsVersion: {
        select: { version: true, creatorEffectiveGmvBps: true, currency: true },
      },
    },
  },
  applicableCommercialTerms: {
    select: { id: true, version: true, creatorEffectiveGmvBps: true, currency: true },
  },
  latestAcceptedTerms: {
    select: { id: true, version: true, creatorEffectiveGmvBps: true, currency: true },
  },
  affiliateRelationship: { include: { commercialAgreement: true } },
} satisfies Prisma.OfferApplicationInclude;

const APPLICATION_APPROVAL_INCLUDE = {
  ...APPLICATION_INCLUDE,
  offer: {
    include: {
      brand: { select: PUBLIC_BRAND_SELECT },
      currentCommercialTerms: true,
      currentVersion: { select: { id: true, version: true } },
    },
  },
  latestAcceptedTerms: true,
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
  commercialAgreement: true,
  creatorPromoCodes: { orderBy: { createdAt: 'desc' as const } },
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
    private readonly audit: AuditService,
    private readonly brands: BrandAccessService,
  ) {}

  async createApplication(userId: string, offerId: string, dto: CreateApplicationDto) {
    const creator = await this.getCreator(userId);
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, status: OfferStatus.PUBLISHED },
      include: { currentCommercialTerms: true, currentVersion: true },
    });
    if (!offer) throw new NotFoundException('Опубликованный оффер не найден');
    if (
      dto.expectedCommercialTermsVersion !== undefined &&
      offer.currentCommercialTerms?.version !== dto.expectedCommercialTermsVersion
    ) {
      throw new ConflictException({
        code: 'OFFER_TERMS_VERSION_CHANGED',
        message: 'Коммерческие условия оффера изменились. Обновите страницу.',
        currentCommercialTermsVersion: offer.currentCommercialTerms?.version ?? null,
      });
    }

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
      return await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.offer.findFirst({
            where: { id: offerId, status: OfferStatus.PUBLISHED },
            include: { currentCommercialTerms: true, currentVersion: true },
          });
          if (!current?.currentCommercialTerms) {
            throw new ConflictException('Коммерческие условия оффера недоступны');
          }
          if (
            dto.expectedCommercialTermsVersion !== undefined &&
            dto.expectedCommercialTermsVersion !== current.currentCommercialTerms.version
          ) {
            throw new ConflictException({
              code: 'OFFER_TERMS_VERSION_CHANGED',
              message: 'Коммерческие условия оффера изменились. Обновите страницу.',
              currentCommercialTermsVersion: current.currentCommercialTerms.version,
            });
          }
          const submittedAt = new Date();
          const requestId = this.audit.requestId();
          const application = await tx.offerApplication.create({
            data: {
              offerId,
              creatorId: creator.id,
              message: dto.message?.trim() || null,
              termsStatus: ApplicationTermsStatus.CURRENT_ACCEPTED,
              applicableCommercialTermsId: current.currentCommercialTerms.id,
              latestAcceptedTermsId: current.currentCommercialTerms.id,
              termsObservation: {
                create: {
                  offerId,
                  observedOfferVersionId: current.currentVersion?.id ?? null,
                  commercialTermsVersionId: current.currentCommercialTerms.id,
                  calculationPolicy: current.currentCommercialTerms.calculationPolicy,
                  totalCommissionPoolBps: current.currentCommercialTerms.totalCommissionPoolBps,
                  creatorPoolShareBps: current.currentCommercialTerms.creatorPoolShareBps,
                  platformPoolShareBps: current.currentCommercialTerms.platformPoolShareBps,
                  displayedCreatorEffectiveBps: current.currentCommercialTerms.creatorEffectiveGmvBps,
                  displayedPlatformEffectiveBps: current.currentCommercialTerms.platformEffectiveGmvBps,
                  currency: current.currentCommercialTerms.currency,
                  attributionPolicySnapshot:
                    current.currentCommercialTerms.attributionPolicySnapshot as Prisma.InputJsonValue,
                  confirmationPolicySnapshot:
                    current.currentCommercialTerms.confirmationPolicySnapshot as Prisma.InputJsonValue,
                  returnPolicySnapshot:
                    current.currentCommercialTerms.returnPolicySnapshot as Prisma.InputJsonValue,
                  payoutPolicySnapshot:
                    current.currentCommercialTerms.payoutPolicySnapshot as Prisma.InputJsonValue,
                  observedAt: submittedAt,
                  submittedAt,
                  requestId,
                },
              },
              termsAcceptances: {
                create: {
                  commercialTermsVersionId: current.currentCommercialTerms.id,
                  acceptanceType: TermsAcceptanceType.INITIAL_SUBMISSION,
                  displayedCreatorEffectiveBps:
                    current.currentCommercialTerms.creatorEffectiveGmvBps,
                  acceptedAt: submittedAt,
                  actorUserId: userId,
                  requestId,
                  source: 'APPLICATION_SUBMISSION',
                },
              },
            },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: userId,
              action: 'OFFER_APPLICATION_SUBMITTED',
              entityType: 'OfferApplication',
              entityId: application.id,
              requestId,
              metadata: {
                offerId,
                offerVersion: current.currentVersion?.version ?? null,
                commercialTermsVersion: current.currentCommercialTerms.version,
                displayedCreatorEffectiveBps:
                  current.currentCommercialTerms.creatorEffectiveGmvBps,
              },
            },
          });
          return tx.offerApplication.findUniqueOrThrow({
            where: { id: application.id },
            include: APPLICATION_INCLUDE,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
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

  async withdrawApplication(userId: string, applicationId: string) {
    const application = await this.getCreatorApplication(userId, applicationId);
    if (application.status === OfferApplicationStatus.WITHDRAWN) return application;
    if (application.status !== OfferApplicationStatus.PENDING) {
      throw new ConflictException('Отозвать можно только ожидающую заявку');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.offerApplication.update({
        where: { id: application.id },
        data: {
          status: OfferApplicationStatus.WITHDRAWN,
          requiredCreatorAction: null,
          creatorActionResolvedAt: new Date(),
          version: { increment: 1 },
        },
        include: APPLICATION_INCLUDE,
      });
      await tx.userNotification.updateMany({
        where: { applicationId: application.id, actionRequired: true, resolvedAt: null },
        data: { actionRequired: false, resolvedAt: new Date() },
      });
      return updated;
    });
  }

  async getApplicationTerms(userId: string, applicationId: string) {
    const application = await this.getCreatorApplication(userId, applicationId);
    return this.presentTermsComparison(application);
  }

  async acceptApplicationTerms(
    userId: string,
    applicationId: string,
    dto: AcceptApplicationTermsDto,
  ) {
    const creator = await this.getCreator(userId);
    return this.prisma.$transaction(
      async (tx) => {
        const application = await tx.offerApplication.findFirst({
          where: { id: applicationId, creatorId: creator.id },
          include: {
            offer: { include: { currentCommercialTerms: true } },
            latestAcceptedTerms: true,
          },
        });
        if (!application) throw new NotFoundException('Заявка не найдена');
        if (application.status !== OfferApplicationStatus.PENDING) {
          throw new ConflictException('Заявка уже завершена');
        }
        const current = application.offer.currentCommercialTerms;
        if (!current) {
          throw new ConflictException('Коммерческие условия оффера недоступны');
        }
        if (dto.expectedCommercialTermsVersion !== current.version) {
          throw new ConflictException({
            code: 'OFFER_TERMS_VERSION_CHANGED',
            message: 'Коммерческие условия снова изменились. Обновите страницу.',
            currentCommercialTermsVersion: current.version,
          });
        }
        if (
          dto.expectedApplicationVersion !== undefined &&
          dto.expectedApplicationVersion !== application.version
        ) {
          throw new ConflictException({
            code: 'APPLICATION_VERSION_CHANGED',
            message: 'Состояние заявки изменилось. Обновите страницу.',
          });
        }
        if (
          application.latestAcceptedTermsId === current.id &&
          application.termsStatus === ApplicationTermsStatus.CURRENT_REACCEPTED
        ) {
          return tx.offerApplication.findUniqueOrThrow({
            where: { id: application.id },
            include: APPLICATION_INCLUDE,
          });
        }
        if (
          application.termsStatus !==
          ApplicationTermsStatus.REACCEPTANCE_REQUIRED
        ) {
          throw new ConflictException('Повторное согласие сейчас не требуется');
        }
        const acceptedAt = new Date();
        const requestId = this.audit.requestId();
        await tx.offerApplicationTermsAcceptance.upsert({
          where: {
            applicationId_commercialTermsVersionId_acceptanceType: {
              applicationId: application.id,
              commercialTermsVersionId: current.id,
              acceptanceType: TermsAcceptanceType.UPDATED_TERMS,
            },
          },
          update: {},
          create: {
            applicationId: application.id,
            commercialTermsVersionId: current.id,
            acceptanceType: TermsAcceptanceType.UPDATED_TERMS,
            displayedCreatorEffectiveBps: current.creatorEffectiveGmvBps,
            acceptedAt,
            actorUserId: userId,
            requestId,
            source: 'CREATOR_REACCEPTANCE',
          },
        });
        const claimed = await tx.offerApplication.updateMany({
          where: {
            id: application.id,
            version: application.version,
            status: OfferApplicationStatus.PENDING,
            applicableCommercialTermsId: current.id,
            termsStatus: ApplicationTermsStatus.REACCEPTANCE_REQUIRED,
          },
          data: {
            latestAcceptedTermsId: current.id,
            termsStatus: ApplicationTermsStatus.CURRENT_REACCEPTED,
            requiredCreatorAction: null,
            creatorActionResolvedAt: acceptedAt,
            termsReacceptedAt: acceptedAt,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) {
          throw new ConflictException({
            code: 'APPLICATION_VERSION_CHANGED',
            message: 'Состояние заявки изменилось. Обновите страницу.',
          });
        }
        await tx.userNotification.updateMany({
          where: {
            applicationId: application.id,
            actionRequired: true,
            resolvedAt: null,
          },
          data: { actionRequired: false, resolvedAt: acceptedAt },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'APPLICATION_COMMERCIAL_TERMS_REACCEPTED',
            entityType: 'OfferApplication',
            entityId: application.id,
            requestId,
            metadata: {
              previousCommercialTermsVersion:
                application.latestAcceptedTerms?.version ?? null,
              acceptedCommercialTermsVersion: current.version,
              creatorEffectiveBps: current.creatorEffectiveGmvBps,
            },
          },
        });
        return tx.offerApplication.findUniqueOrThrow({
          where: { id: application.id },
          include: APPLICATION_INCLUDE,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listBrandApplications(userId: string, offerId: string, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    await this.assertOwnedOffer(brand.id, offerId);
    return this.prisma.offerApplication.findMany({
      where: { offerId },
      include: APPLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBrandApplication(userId: string, applicationId: string, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
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

  async approveApplication(
    userId: string,
    applicationId: string,
    activeBrandId?: string,
    dto: ApproveApplicationDto = {},
  ) {
    const brand = await this.getBrand(userId, activeBrandId);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const affiliateCode = randomBytes(24).toString('base64url');
      const promoCode = this.generatePromoCode();
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const application = await tx.offerApplication.findUnique({
              where: { id: applicationId },
              include: APPLICATION_APPROVAL_INCLUDE,
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
            const currentTerms = application.offer.currentCommercialTerms;
            if (!currentTerms) {
              throw new ConflictException('Коммерческие условия оффера недоступны');
            }
            if (
              application.termsStatus === ApplicationTermsStatus.REACCEPTANCE_REQUIRED ||
              application.requiredCreatorAction === CreatorApplicationAction.ACCEPT_COMMERCIAL_TERMS ||
              application.latestAcceptedTermsId !== currentTerms.id
            ) {
              throw new ConflictException({
                code: 'APPLICATION_TERMS_ACCEPTANCE_REQUIRED',
                message: 'Креатор должен принять текущие коммерческие условия до одобрения',
                currentCreatorEffectiveBps: currentTerms.creatorEffectiveGmvBps,
                acceptedCreatorEffectiveBps:
                  application.latestAcceptedTerms?.creatorEffectiveGmvBps ?? null,
              });
            }
            if (
              dto.expectedAcceptedTermsVersion !== undefined &&
              dto.expectedAcceptedTermsVersion !== currentTerms.version
            ) {
              throw new ConflictException({
                code: 'OFFER_TERMS_VERSION_CHANGED',
                message: 'Коммерческие условия изменились. Обновите заявку.',
              });
            }
            if (
              dto.expectedApplicationVersion !== undefined &&
              dto.expectedApplicationVersion !== application.version
            ) {
              throw new ConflictException({
                code: 'APPLICATION_VERSION_CHANGED',
                message: 'Состояние заявки изменилось. Обновите страницу.',
              });
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

            const acceptance =
              await tx.offerApplicationTermsAcceptance.findFirst({
                where: {
                  applicationId: application.id,
                  commercialTermsVersionId: currentTerms.id,
                },
                orderBy: { acceptedAt: 'desc' },
              });
            if (!acceptance) {
              throw new ConflictException({
                code: 'APPLICATION_TERMS_ACCEPTANCE_REQUIRED',
                message: 'Не найдена запись согласия креатора с текущими условиями',
              });
            }
            const activatedAt = new Date();
            const relationship = await tx.affiliateRelationship.create({
              data: {
                offerId: application.offerId,
                creatorId: application.creatorId,
                applicationId: application.id,
                affiliateCode,
                promoCode,
                destinationUrl: application.offer.productUrl,
                activatedAt,
                currentManagerId: application.offer.currentManagerId,
              },
            });
            const agreement = await tx.affiliateCommercialAgreement.create({
              data: {
                affiliateRelationshipId: relationship.id,
                applicationId: application.id,
                applicationTermsAcceptanceId: acceptance.id,
                offerId: application.offerId,
                offerVersionIdAtActivation:
                  application.offer.currentVersion?.id ?? null,
                commercialTermsVersionId: currentTerms.id,
                commercialTermsVersionNumber: currentTerms.version,
                calculationPolicy: currentTerms.calculationPolicy,
                totalCommissionPoolBps: currentTerms.totalCommissionPoolBps,
                creatorPoolShareBps: currentTerms.creatorPoolShareBps,
                platformPoolShareBps: currentTerms.platformPoolShareBps,
                creatorEffectiveGmvBps: currentTerms.creatorEffectiveGmvBps,
                platformEffectiveGmvBps: currentTerms.platformEffectiveGmvBps,
                currency: currentTerms.currency,
                attributionPolicySnapshot:
                  currentTerms.attributionPolicySnapshot as Prisma.InputJsonValue,
                attributionWindowSnapshot:
                  currentTerms.attributionWindowSnapshot as Prisma.InputJsonValue,
                commissionEligibilitySnapshot:
                  currentTerms.commissionEligibilitySnapshot as Prisma.InputJsonValue,
                confirmationPolicySnapshot:
                  currentTerms.confirmationPolicySnapshot as Prisma.InputJsonValue,
                returnPolicySnapshot:
                  currentTerms.returnPolicySnapshot as Prisma.InputJsonValue,
                cancellationPolicySnapshot:
                  currentTerms.cancellationPolicySnapshot as Prisma.InputJsonValue,
                payoutPolicySnapshot:
                  currentTerms.payoutPolicySnapshot as Prisma.InputJsonValue,
                payoutScheduleSnapshot:
                  currentTerms.payoutScheduleSnapshot as Prisma.InputJsonValue,
                settlementModelSnapshot:
                  currentTerms.settlementModelSnapshot as Prisma.InputJsonValue,
                minimumPayoutMinor: currentTerms.minimumPayoutMinor,
                acceptedAt: acceptance.acceptedAt,
                approvedAt: activatedAt,
                activatedAt,
                createdByRequestId: this.audit.requestId(),
              },
            });
            await tx.creatorLink.create({
              data: {
                brandId: application.offer.brandId,
                offerId: application.offerId,
                creatorId: application.creatorId,
                affiliateRelationshipId: relationship.id,
                affiliateCommercialAgreementId: agreement.id,
                code: affiliateCode,
                destinationUrl: application.offer.productUrl,
                activeFrom: activatedAt,
              },
            });
            await tx.creatorPromoCode.create({
              data: {
                brandId: application.offer.brandId,
                offerId: application.offerId,
                creatorId: application.creatorId,
                affiliateRelationshipId: relationship.id,
                affiliateCommercialAgreementId: agreement.id,
                rawCode: promoCode,
                normalizedCode: promoCode,
                normalizationPolicy:
                  CREATOR_PROMO_CODE_NORMALIZATION_POLICY,
                discountType: application.offer.customerDiscountType,
                discountBps: application.offer.customerDiscountBps,
                discountAmountMinor:
                  application.offer.customerDiscountAmountMinor,
                currency: currentTerms.currency,
                eligibilitySnapshot: {
                  source: 'OFFER_AT_RELATIONSHIP_ACTIVATION',
                  commercialTermsVersion: currentTerms.version,
                },
                status: CreatorPromoCodeStatus.PENDING_PROVISIONING,
                activeFrom: activatedAt,
              },
            });
            const updated = await tx.offerApplication.updateMany({
              where: {
                id: application.id,
                version: application.version,
                status: OfferApplicationStatus.PENDING,
                latestAcceptedTermsId: currentTerms.id,
                applicableCommercialTermsId: currentTerms.id,
              },
              data: {
                status: OfferApplicationStatus.APPROVED,
                termsStatus: ApplicationTermsStatus.BOUND,
                requiredCreatorAction: null,
                creatorActionResolvedAt: activatedAt,
                reviewedAt: activatedAt,
                reviewedByUserId: userId,
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1) {
              throw new Prisma.PrismaClientKnownRequestError('Concurrent approval', {
                code: 'P2034',
                clientVersion: Prisma.prismaVersion.client,
              });
            }
            await tx.auditLog.create({
              data: {
                actorUserId: userId,
                action: 'AFFILIATE_COMMERCIAL_AGREEMENT_ACTIVATED',
                entityType: 'AffiliateCommercialAgreement',
                entityId: relationship.id,
                requestId: this.audit.requestId(),
                metadata: {
                  applicationId: application.id,
                  offerId: application.offerId,
                  commercialTermsVersion: currentTerms.version,
                  creatorEffectiveBps: currentTerms.creatorEffectiveGmvBps,
                  calculationPolicy: currentTerms.calculationPolicy,
                },
              },
            });
            return tx.affiliateRelationship.findUniqueOrThrow({
              where: { id: relationship.id },
              include: RELATIONSHIP_INCLUDE,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return this.presentRelationship(result, 'brand');
      } catch (error) {
        if (this.isRetryableApproval(error)) continue;
        throw error;
      }
    }
    throw new ConflictException('Не удалось создать уникальные партнёрские коды');
  }

  async rejectApplication(userId: string, applicationId: string, activeBrandId?: string) {
    const application = await this.getBrandApplication(userId, applicationId, activeBrandId);
    if (application.status === OfferApplicationStatus.REJECTED) return application;
    if (application.status !== OfferApplicationStatus.PENDING) {
      throw new ConflictException('Заявку нельзя отклонить в текущем статусе');
    }
    return this.prisma.$transaction(async (tx) => {
      const rejectedAt = new Date();
      const updated = await tx.offerApplication.update({
        where: { id: application.id },
        data: {
          status: OfferApplicationStatus.REJECTED,
          requiredCreatorAction: null,
          creatorActionResolvedAt: rejectedAt,
          reviewedAt: rejectedAt,
          reviewedByUserId: userId,
          version: { increment: 1 },
        },
        include: APPLICATION_INCLUDE,
      });
      await tx.userNotification.updateMany({
        where: {
          applicationId: application.id,
          actionRequired: true,
          resolvedAt: null,
        },
        data: { actionRequired: false, resolvedAt: rejectedAt },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'OFFER_APPLICATION_REJECTED',
          entityType: 'OfferApplication',
          entityId: application.id,
          requestId: this.audit.requestId(),
          metadata: { offerId: application.offerId },
        },
      });
      return updated;
    });
  }

  async listCreatorRelationships(userId: string) {
    const creator = await this.getCreator(userId);
    const relationships = await this.prisma.affiliateRelationship.findMany({
      where: { creatorId: creator.id },
      include: RELATIONSHIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return relationships.map((relationship) =>
      this.presentRelationship(relationship, 'creator'),
    );
  }

  async getCreatorRelationship(userId: string, relationshipId: string) {
    const creator = await this.getCreator(userId);
    const relationship = await this.prisma.affiliateRelationship.findFirst({
      where: { id: relationshipId, creatorId: creator.id },
      include: RELATIONSHIP_INCLUDE,
    });
    if (!relationship) throw new NotFoundException('Партнёрская связь не найдена');
    return this.presentRelationship(relationship, 'creator');
  }

  async listBrandRelationships(userId: string, offerId?: string, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    if (offerId) await this.assertOwnedOffer(brand.id, offerId);
    const relationships = await this.prisma.affiliateRelationship.findMany({
      where: {
        offer: { brandId: brand.id },
        ...(offerId ? { offerId } : {}),
      },
      include: RELATIONSHIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return relationships.map((relationship) =>
      this.presentRelationship(relationship, 'brand'),
    );
  }

  async transitionRelationship(
    userId: string,
    relationshipId: string,
    target: AffiliateRelationshipStatus,
    activeBrandId?: string,
  ) {
    const brand = await this.getBrand(userId, activeBrandId);
    const relationship = await this.prisma.affiliateRelationship.findUnique({
      where: { id: relationshipId },
      include: RELATIONSHIP_INCLUDE,
    });
    if (!relationship) throw new NotFoundException('Партнёрская связь не найдена');
    if (relationship.offer.brandId !== brand.id) {
      throw new ForbiddenException('Нет доступа к этой партнёрской связи');
    }
    if (relationship.status === target) {
      return this.presentRelationship(relationship, 'brand');
    }
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
    if (target === AffiliateRelationshipStatus.REVOKED) {
      await this.prisma.creatorPromoCode.updateMany({
        where: {
          affiliateRelationshipId: relationship.id,
          normalizedCode: normalizeCreatorPromoCode(
            relationship.promoCode,
          ),
          status: {
            in: [
              CreatorPromoCodeStatus.PENDING_PROVISIONING,
              CreatorPromoCodeStatus.PROVISIONING_CONFIRMED,
              CreatorPromoCodeStatus.ACTIVE,
            ],
          },
        },
        data: {
          status: CreatorPromoCodeStatus.REVOKED,
          activeUntil: new Date(),
          revokedAt: new Date(),
        },
      });
      await this.audit.record({
        actorUserId: userId,
        action: 'AFFILIATE_RELATIONSHIP_REVOKED',
        entityType: 'AffiliateRelationship',
        entityId: relationship.id,
        metadata: { offerId: relationship.offerId, creatorId: relationship.creatorId },
      });
    }
    return this.presentRelationship(updated, 'brand');
  }

  async updateResponsibility(
    userId: string,
    relationshipId: string,
    activeBrandId: string,
    managerId: string | null,
  ) {
    const brand = await this.getBrand(userId, activeBrandId);
    const relationship = await this.prisma.affiliateRelationship.findUnique({
      where: { id: relationshipId },
      include: { offer: true },
    });
    if (!relationship) throw new NotFoundException('Партнёрская связь не найдена');
    if (relationship.offer.brandId !== brand.id) {
      throw new ForbiddenException('Нет доступа к этой партнёрской связи');
    }
    if (managerId) await this.brands.assertManagerAssignedToBrand(managerId, brand.id);
    const updated = await this.prisma.affiliateRelationship.update({
      where: { id: relationship.id },
      data: { currentManagerId: managerId },
      include: RELATIONSHIP_INCLUDE,
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'AFFILIATE_RELATIONSHIP_RESPONSIBILITY_CHANGED',
      entityType: 'AffiliateRelationship',
      entityId: relationship.id,
      metadata: {
        previousManagerId: relationship.currentManagerId,
        newManagerId: managerId,
      },
    });
    return this.presentRelationship(updated);
  }

  async replacePromoCode(
    userId: string,
    relationshipId: string,
    dto: ReplacePromoCodeDto,
    activeBrandId?: string,
  ) {
    const brand = await this.getBrand(userId, activeBrandId);
    const normalizedCode = normalizeCreatorPromoCode(dto.code);
    if (!isValidCreatorPromoCode(normalizedCode)) {
      throw new BadRequestException(
        'Промокод должен содержать от 4 до 20 латинских букв или цифр',
      );
    }
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const relationship = await tx.affiliateRelationship.findUnique({
          where: { id: relationshipId },
          include: RELATIONSHIP_INCLUDE,
        });
        if (!relationship) throw new NotFoundException('Партнёрская связь не найдена');
        if (relationship.offer.brandId !== brand.id) {
          throw new ForbiddenException('Нет доступа к этой партнёрской связи');
        }
        const currentCode = relationship.creatorPromoCodes.find(
          (code: any) => code.normalizedCode === normalizeCreatorPromoCode(relationship.promoCode),
        );
        if (!currentCode) throw new ConflictException('Текущий промокод не содержит записи владельца');
        if (currentCode.firstUsedAt) {
          throw new ConflictException({
            code: 'PROMO_CODE_ALREADY_USED',
            message: 'Промокод уже использовался и больше не может быть изменён.',
          });
        }
        if (currentCode.normalizedCode === normalizedCode) return relationship;
        const existing = await tx.creatorPromoCode.findUnique({
          where: { normalizedCode },
          select: { id: true },
        });
        if (existing) this.throwReservedPromoCode();
        const changedAt = new Date();
        await tx.creatorPromoCode.create({
          data: {
            brandId: currentCode.brandId,
            offerId: currentCode.offerId,
            creatorId: currentCode.creatorId,
            affiliateRelationshipId: currentCode.affiliateRelationshipId,
            affiliateCommercialAgreementId: currentCode.affiliateCommercialAgreementId,
            rawCode: normalizedCode,
            normalizedCode,
            normalizationPolicy: CREATOR_PROMO_CODE_NORMALIZATION_POLICY,
            discountType: currentCode.discountType,
            discountBps: currentCode.discountBps,
            discountAmountMinor: currentCode.discountAmountMinor,
            currency: currentCode.currency,
            eligibilitySnapshot: currentCode.eligibilitySnapshot as Prisma.InputJsonValue,
            status: CreatorPromoCodeStatus.PENDING_PROVISIONING,
            activeFrom: changedAt,
            replacementForId: currentCode.id,
          },
        });
        await tx.creatorPromoCode.update({
          where: { id: currentCode.id },
          data: { status: CreatorPromoCodeStatus.REPLACED, activeUntil: changedAt, replacedAt: changedAt },
        });
        await tx.affiliateRelationship.update({
          where: { id: relationship.id },
          data: { promoCode: normalizedCode },
        });
        return tx.affiliateRelationship.findUniqueOrThrow({
          where: { id: relationship.id },
          include: RELATIONSHIP_INCLUDE,
        });
      });
      return this.presentRelationship(updated);
    } catch (error) {
      if (this.isPromoCodeUniqueConflict(error)) this.throwReservedPromoCode();
      throw error;
    }
  }

  async confirmPromoCodeProvisioned(
    userId: string,
    relationshipId: string,
    activeBrandId?: string,
  ) {
    const brand = await this.getBrand(userId, activeBrandId);
    const relationship = await this.prisma.affiliateRelationship.findUnique({
      where: { id: relationshipId },
      include: RELATIONSHIP_INCLUDE,
    });
    if (!relationship) throw new NotFoundException('Партнёрская связь не найдена');
    if (relationship.offer.brandId !== brand.id) {
      throw new ForbiddenException('Нет доступа к этой партнёрской связи');
    }
    const currentCode = relationship.creatorPromoCodes.find(
      (code: any) => code.normalizedCode === normalizeCreatorPromoCode(relationship.promoCode),
    );
    if (!currentCode) throw new ConflictException('Текущий промокод не найден');
    if (currentCode.status === CreatorPromoCodeStatus.ACTIVE) return this.presentRelationship(relationship);
    if (currentCode.status !== CreatorPromoCodeStatus.PENDING_PROVISIONING) {
      throw new ConflictException('Этот промокод нельзя подтвердить в текущем состоянии');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.creatorPromoCode.update({
        where: { id: currentCode.id },
        data: {
          status: CreatorPromoCodeStatus.PROVISIONING_CONFIRMED,
          provisioningConfirmedAt: new Date(),
        },
      });
      return tx.affiliateRelationship.findUniqueOrThrow({
        where: { id: relationship.id },
        include: RELATIONSHIP_INCLUDE,
      });
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
      include: { offer: true, commercialAgreement: true },
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

    let persistedClickId: string | null = null;
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
    url.searchParams.set('click_id', persistedClickId ?? clickId);
    url.searchParams.set('affiliate_code', relationship.affiliateCode);
    if (
      this.config.get<string>('STAGE8_TRACKER_ENABLED') === 'true' &&
      relationship.commercialAgreement
    ) {
      const attributionWindow = relationship.commercialAgreement
        .attributionWindowSnapshot;
      const configuredDays =
        attributionWindow &&
        !Array.isArray(attributionWindow) &&
        typeof attributionWindow === 'object'
          ? Number(
              (attributionWindow as Record<string, unknown>).windowDays,
            )
          : 30;
      const windowDays =
        Number.isInteger(configuredDays) && configuredDays > 0
          ? Math.min(30, configuredDays)
          : 30;
      const expiresAt = new Date(
        clickedAt.getTime() + windowDays * 86_400_000,
      );
      const creatorLink = await this.prisma.creatorLink.upsert({
        where: { code: relationship.affiliateCode },
        update: {
          affiliateCommercialAgreementId:
            relationship.commercialAgreement.id,
          destinationUrl: relationship.destinationUrl,
          status: 'ACTIVE',
        },
        create: {
          brandId: relationship.offer.brandId,
          offerId: relationship.offerId,
          creatorId: relationship.creatorId,
          affiliateRelationshipId: relationship.id,
          affiliateCommercialAgreementId:
            relationship.commercialAgreement.id,
          code: relationship.affiliateCode,
          destinationUrl: relationship.destinationUrl,
          activeFrom: relationship.activatedAt,
        },
      });
      const session = await this.prisma.clickSession.create({
        data: {
          publicAttributionId: `svz_a_${randomBytes(24).toString('base64url')}`,
          creatorLinkId: creatorLink.id,
          clickId: persistedClickId,
          affiliateRelationshipId: relationship.id,
          affiliateCommercialAgreementId:
            relationship.commercialAgreement.id,
          creatorId: relationship.creatorId,
          offerId: relationship.offerId,
          firstClickedAt: clickedAt,
          lastSeenAt: clickedAt,
          expiresAt,
          landingUrl: relationship.destinationUrl,
          referrerOrigin: this.referrerOrigin(context.referrer),
          ipHash,
          userAgentHash: context.userAgent
            ? createHash('sha256')
                .update(context.userAgent.slice(0, 500))
                .digest('hex')
            : null,
          consentState: 'UNKNOWN',
        },
      });
      url.searchParams.set('svz_a', session.publicAttributionId);
      url.searchParams.set('svz_exp', String(expiresAt.getTime()));
    }
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

  private referrerOrigin(value?: string) {
    if (!value) return null;
    try {
      return new URL(value).origin.slice(0, 500);
    } catch {
      return null;
    }
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

  private presentTermsComparison(application: any) {
    const observed = application.termsObservation?.commercialTermsVersion;
    const accepted = application.latestAcceptedTerms;
    const current =
      application.applicableCommercialTerms ??
      application.offer?.currentCommercialTerms;
    return {
      applicationId: application.id,
      applicationStatus: application.status,
      termsStatus: application.termsStatus,
      applicationVersion: application.version,
      requiredCreatorAction: application.requiredCreatorAction,
      observed: observed
        ? {
            version: observed.version,
            creatorEffectiveBps:
              application.termsObservation?.displayedCreatorEffectiveBps ??
              observed.creatorEffectiveGmvBps,
            currency: observed.currency,
          }
        : null,
      accepted: accepted
        ? {
            version: accepted.version,
            creatorEffectiveBps: accepted.creatorEffectiveGmvBps,
            currency: accepted.currency,
          }
        : null,
      current: current
        ? {
            version: current.version,
            creatorEffectiveBps: current.creatorEffectiveGmvBps,
            currency: current.currency,
          }
        : null,
      requiresReacceptance:
        application.termsStatus ===
        ApplicationTermsStatus.REACCEPTANCE_REQUIRED,
    };
  }

  private presentRelationship(
    relationship: any,
    audience: 'brand' | 'creator' = 'brand',
  ) {
    const publicBackendUrl = (
      this.config.get<string>('PUBLIC_BACKEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const agreement = relationship.commercialAgreement;
    const currentPromoCode = relationship.creatorPromoCodes?.find(
      (code: { normalizedCode: string }) =>
        code.normalizedCode ===
        normalizeCreatorPromoCode(relationship.promoCode),
    );
    const safeAgreement = agreement
      ? audience === 'creator'
        ? {
            id: agreement.id,
            commercialTermsVersionNumber:
              agreement.commercialTermsVersionNumber,
            calculationPolicy: agreement.calculationPolicy,
            creatorEffectiveGmvBps: agreement.creatorEffectiveGmvBps,
            currency: agreement.currency,
            attributionPolicySnapshot: agreement.attributionPolicySnapshot,
            attributionWindowSnapshot: agreement.attributionWindowSnapshot,
            confirmationPolicySnapshot: agreement.confirmationPolicySnapshot,
            returnPolicySnapshot: agreement.returnPolicySnapshot,
            cancellationPolicySnapshot: agreement.cancellationPolicySnapshot,
            payoutPolicySnapshot: agreement.payoutPolicySnapshot,
            payoutScheduleSnapshot: agreement.payoutScheduleSnapshot,
            acceptedAt: agreement.acceptedAt,
            approvedAt: agreement.approvedAt,
            activatedAt: agreement.activatedAt,
          }
        : agreement
      : null;
    return {
      ...relationship,
      commercialAgreement: safeAgreement,
      promoCodeDetails: currentPromoCode
        ? {
            id: currentPromoCode.id,
            code: currentPromoCode.rawCode,
            status: currentPromoCode.status,
            discountType: currentPromoCode.discountType,
            discountBps: currentPromoCode.discountBps,
            discountAmountMinor: currentPromoCode.discountAmountMinor,
            currency: currentPromoCode.currency,
            provisioningConfirmedAt:
              currentPromoCode.provisioningConfirmedAt,
            verifiedAt: currentPromoCode.verifiedAt,
            firstUsedAt: currentPromoCode.firstUsedAt,
            editable: !currentPromoCode.firstUsedAt,
          }
        : null,
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

  private async getBrand(userId: string, activeBrandId?: string) {
    return this.brands.resolveBrand(userId, activeBrandId);
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

  private isPromoCodeUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      String(error.meta?.target ?? '').includes('normalizedCode');
  }

  private throwReservedPromoCode(): never {
    throw new ConflictException({
      code: 'PROMO_CODE_PERMANENTLY_RESERVED',
      message:
        'Этот промокод уже используется или использовался ранее. Выберите другой.',
    });
  }
}
