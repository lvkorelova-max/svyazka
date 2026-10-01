import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AffiliateRelationshipStatus,
  AttributionSource,
  CreatorPromoCodeStatus,
  OrderStatus,
  Prisma,
  Stage8AttributionStatus,
  Stage8CommerceOrderStatus,
  Stage8ConfidenceLevel,
  Stage8EventProcessingStatus,
  Stage8EvidenceType,
  Stage8EvidenceValidationStatus,
  Stage8ExceptionStatus,
  Stage8ExceptionType,
  Stage8FinancialHandoffStatus,
  Stage8IntegrationStatus,
  Stage8OrderEventType,
  Stage8OrderSource,
  Stage8OutboxStatus,
  Stage8TimelineEventType,
  UserRole,
} from "@prisma/client";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import { AuditService } from "../audit/audit.service";
import { BrandAccessService } from "../brand-access/brand-access.service";
import { normalizeCreatorPromoCode } from "../common/promo-code";
import { FinancialOrderPort } from "../finance/financial-order.port";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTrackerInstallationDto } from "./dto/create-tracker-installation.dto";
import { IngestOrderEventDto } from "./dto/order-event.dto";
import { ResolveAttributionExceptionDto } from "./dto/resolve-attribution-exception.dto";
import { TrackingEventDto } from "./dto/tracking-event.dto";
import { IntegrationSecretService } from "./integration-secret.service";
import { Stage8FlagsService } from "./stage8-flags.service";
import { trackerOriginMatches } from "../tracker-origin";
import {
  projectCommissionEligibility,
  proportionalCommissionableRefund,
} from "./commission-eligibility";

type Candidate = {
  source: Stage8OrderSource;
  evidenceType: Stage8EvidenceType;
  identifier: string;
  touchAt: Date;
  clickSessionId?: string;
  clickId?: string;
  relationshipId: string;
  agreementId: string | null;
  creatorId: string;
  offerId: string;
  managerIdAtAttribution: string | null;
  valid: boolean;
  reasonCode: string;
};

@Injectable()
export class AttributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly secrets: IntegrationSecretService,
    private readonly flags: Stage8FlagsService,
    private readonly financialOrderPort: FinancialOrderPort,
    private readonly brands: BrandAccessService,
  ) {}

  async createInstallation(userId: string, dto: CreateTrackerInstallationDto) {
    const brand = await this.getBrand(userId);
    const secret = this.secrets.generate();
    const installation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trackerInstallation.create({
        data: {
          brandId: brand.id,
          publicKey: `svz_pub_${randomBytes(18).toString("base64url")}`,
          name: dto.name.trim(),
          primaryDomain: dto.primaryDomain.toLowerCase(),
          allowedOrigins: [
            ...new Set(dto.allowedOrigins.map(this.normalizeOrigin)),
          ],
          consentMode: dto.consentMode,
          cookieTtlDays: 30,
          createdByUserId: userId,
          status: Stage8IntegrationStatus.PENDING,
        },
      });
      const credential = await tx.integrationCredentialVersion.create({
        data: {
          installationId: created.id,
          version: 1,
          keyId: `svz_key_${randomBytes(12).toString("base64url")}`,
          encryptedSecret: this.secrets.encrypt(secret),
        },
      });
      await this.ensureDefaultRuleSet(tx, brand.id, userId);
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "STAGE8_TRACKER_INSTALLATION_CREATED",
          entityType: "TrackerInstallation",
          entityId: created.id,
          requestId: this.audit.requestId(),
          metadata: {
            primaryDomain: created.primaryDomain,
            allowedOrigins: created.allowedOrigins,
            keyId: credential.keyId,
          },
        },
      });
      return { ...created, keyId: credential.keyId };
    });
    return {
      ...installation,
      webhookSecret: secret,
      webhookSecretShownOnce: true,
    };
  }

  async listInstallations(userId: string) {
    const brand = await this.getBrand(userId);
    return this.prisma.trackerInstallation.findMany({
      where: { brandId: brand.id },
      include: {
        credentials: {
          select: {
            id: true,
            version: true,
            keyId: true,
            status: true,
            validFrom: true,
            validUntil: true,
            revokedAt: true,
          },
          orderBy: { version: "desc" },
          take: 2,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async activateInstallation(userId: string, installationId: string) {
    const installation = await this.ownedInstallation(userId, installationId);
    const updated = await this.prisma.trackerInstallation.update({
      where: { id: installation.id },
      data: {
        status: Stage8IntegrationStatus.ACTIVE,
        healthStatus: "AWAITING_EVENTS",
        activatedAt: installation.activatedAt ?? new Date(),
        pausedAt: null,
      },
    });
    await this.audit.record({
      actorUserId: userId,
      action: "STAGE8_TRACKER_INSTALLATION_ACTIVATED",
      entityType: "TrackerInstallation",
      entityId: installation.id,
    });
    return updated;
  }

  async rotateInstallationSecret(userId: string, installationId: string) {
    const installation = await this.ownedInstallation(userId, installationId);
    const secret = this.secrets.generate();
    const result = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.integrationCredentialVersion.aggregate({
        where: { installationId },
        _max: { version: true },
      });
      const now = new Date();
      const overlapUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await tx.integrationCredentialVersion.updateMany({
        where: {
          installationId,
          status: Stage8IntegrationStatus.ACTIVE,
          validUntil: null,
        },
        data: { validUntil: overlapUntil },
      });
      const credential = await tx.integrationCredentialVersion.create({
        data: {
          installationId,
          version: (latest._max.version ?? 0) + 1,
          keyId: `svz_key_${randomBytes(12).toString("base64url")}`,
          encryptedSecret: this.secrets.encrypt(secret),
          validFrom: now,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "STAGE8_WEBHOOK_SECRET_ROTATED",
          entityType: "TrackerInstallation",
          entityId: installation.id,
          requestId: this.audit.requestId(),
          metadata: {
            keyId: credential.keyId,
            previousKeysValidUntil: overlapUntil.toISOString(),
          },
        },
      });
      return credential;
    });
    return {
      keyId: result.keyId,
      webhookSecret: secret,
      webhookSecretShownOnce: true,
      previousKeysValidUntil: new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
  }

  trackerScript() {
    return `(()=>{const s=document.currentScript;if(!s)return;const read=()=>{const value=(document.cookie.match(/(?:^|; )_svz_at=([^;]+)/)||[])[1];return value?decodeURIComponent(value):null;};const q=new URLSearchParams(location.search);const incoming=q.get("svz_a");const exp=Number(q.get("svz_exp")||0);const max=Date.now()+30*864e5;const until=Math.min(exp>0?exp:max,max);const acceptedIncoming=incoming&&until>Date.now()?incoming:null;if(acceptedIncoming){document.cookie="_svz_at="+encodeURIComponent(acceptedIncoming)+"; Max-Age="+Math.floor((until-Date.now())/1000)+"; Path=/; Secure; SameSite=Lax";}const attributionId=acceptedIncoming||read();window.SvyazkaAttribution=Object.freeze({getAttributionId:read});const field=s.dataset.checkoutField;const selector=s.dataset.checkoutSelector;const sync=(root)=>{if(!field||!selector)return;const value=read();if(!value)return;(root.matches&&root.matches(selector)?[root]:Array.from(root.querySelectorAll?root.querySelectorAll(selector):[])).forEach((form)=>{let input=form.elements&&form.elements.namedItem(field);if(!input){input=document.createElement("input");input.type="hidden";input.name=field;form.appendChild(input);}input.value=value;});};sync(document);if(field&&selector&&window.MutationObserver){new MutationObserver((records)=>records.forEach((record)=>record.addedNodes.forEach((node)=>{if(node.nodeType===1)sync(node);}))).observe(document.documentElement,{childList:true,subtree:true});}const k=s.dataset.installation;if(!k)return;const body=new URLSearchParams({installationKey:k,eventId:crypto.randomUUID(),eventType:attributionId?"SESSION_REFRESHED":"SESSION_STARTED",occurredAt:new Date().toISOString(),consentState:s.dataset.consent||"UNKNOWN"});if(attributionId)body.set("attributionId",attributionId);const endpoint=new URL("v1/events",s.src).toString();fetch(endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8"},body:body.toString(),keepalive:true,credentials:"omit"}).catch(()=>{});})();`;
  }

  async collectTrackingEvent(dto: TrackingEventDto, originHeader?: string) {
    if (!this.flags.trackerEnabled()) {
      throw new ServiceUnavailableException("Stage 8 tracker is disabled");
    }
    const installation = await this.prisma.trackerInstallation.findUnique({
      where: { publicKey: dto.installationKey },
    });
    if (
      !installation ||
      installation.status !== Stage8IntegrationStatus.ACTIVE
    ) {
      throw new NotFoundException("Tracker installation not found");
    }
    const origin = originHeader?.trim() ?? "";
    if (
      ![installation.primaryDomain, ...installation.allowedOrigins].some(
        (configured) => trackerOriginMatches(origin, configured),
      )
    ) {
      throw new ForbiddenException("Tracker origin is not allowed");
    }
    const occurredAt = new Date(dto.occurredAt);
    const payload = {
      eventType: dto.eventType,
      attributionId: dto.attributionId ?? null,
      creatorLinkCode: dto.creatorLinkCode ?? null,
      promoCode: dto.promoCode ?? null,
      consentState: dto.consentState ?? "UNKNOWN",
    };
    const payloadHash = this.hash(payload);
    const existing = await this.prisma.trackingEvent.findUnique({
      where: {
        trackerInstallationId_externalEventId: {
          trackerInstallationId: installation.id,
          externalEventId: dto.eventId,
        },
      },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictException(
          "Tracking event id conflicts with prior payload",
        );
      }
      return { accepted: true, duplicate: true };
    }
    const session = dto.attributionId
      ? await this.prisma.clickSession.findUnique({
          where: { publicAttributionId: dto.attributionId },
        })
      : null;
    if (
      session &&
      (session.expiresAt <= occurredAt ||
        session.status !== Stage8IntegrationStatus.ACTIVE)
    ) {
      throw new ConflictException("Attribution session is expired");
    }
    await this.prisma.$transaction([
      this.prisma.trackingEvent.create({
        data: {
          trackerInstallationId: installation.id,
          clickSessionId: session?.id ?? null,
          externalEventId: dto.eventId,
          eventType: dto.eventType,
          occurredAt,
          origin,
          payload,
          payloadHash,
        },
      }),
      this.prisma.trackerInstallation.update({
        where: { id: installation.id },
        data: {
          lastEventAt: new Date(),
          healthStatus: "RECEIVING_TRACKING_EVENTS",
        },
      }),
      ...(session
        ? [
            this.prisma.clickSession.update({
              where: { id: session.id },
              data: {
                trackerInstallationId: installation.id,
                lastSeenAt: occurredAt,
                consentState: dto.consentState ?? session.consentState,
              },
            }),
          ]
        : []),
    ]);
    return { accepted: true, duplicate: false };
  }

  async ingestSignedOrderEvent(input: {
    installationId: string;
    keyId: string;
    eventId: string;
    timestamp: string;
    signature: string;
    rawBody: Buffer;
    dto: IngestOrderEventDto;
  }) {
    if (!this.flags.ingestionEnabled()) {
      throw new ServiceUnavailableException(
        "Stage 8 order ingestion is disabled",
      );
    }
    const installation = await this.authenticateWebhook(input);
    const sourceNamespace = `TRACKER:${installation.id}`;
    const canonicalOrderKey = input.dto.order.externalOrderId;
    const payload = input.dto as unknown as Prisma.InputJsonValue;
    const payloadHash = createHash("sha256")
      .update(input.rawBody)
      .digest("hex");
    const existing = await this.prisma.stage8OrderEvent.findUnique({
      where: {
        brandId_sourceNamespace_externalEventId: {
          brandId: installation.brandId,
          sourceNamespace,
          externalEventId: input.eventId,
        },
      },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        await this.createEventConflictException(existing, payloadHash);
        throw new ConflictException(
          "The event id already exists with different content",
        );
      }
      return {
        accepted: true,
        duplicate: true,
        eventId: existing.id,
        status: existing.processingStatus,
      };
    }
    const event = await this.prisma.stage8OrderEvent.create({
      data: {
        brandId: installation.brandId,
        trackerInstallationId: installation.id,
        source: Stage8OrderSource.WEBSITE_TRACKER,
        sourceNamespace,
        externalEventId: input.eventId,
        externalOrderId: input.dto.order.externalOrderId,
        canonicalOrderKey,
        eventType: input.dto.type,
        occurredAt: new Date(input.dto.occurredAt),
        orderCreatedAt: input.dto.order.createdAt
          ? new Date(input.dto.order.createdAt)
          : null,
        amountMinor: input.dto.order.amountMinor
          ? BigInt(input.dto.order.amountMinor)
          : null,
        shippingAmountMinor: input.dto.order.shippingAmountMinor
          ? BigInt(input.dto.order.shippingAmountMinor)
          : null,
        refundAmountMinor: input.dto.refundAmountMinor
          ? BigInt(input.dto.refundAmountMinor)
          : null,
        currency: input.dto.order.currency ?? null,
        offerIdHint: input.dto.order.offerId ?? null,
        attributionId: input.dto.attribution?.attributionId ?? null,
        clickIdHint: input.dto.attribution?.clickId ?? null,
        creatorLinkCode: input.dto.attribution?.creatorLinkCode ?? null,
        promoCode: input.dto.attribution?.promoCode
          ? this.normalizePromo(input.dto.attribution.promoCode)
          : null,
        productLines: input.dto.order.items
          ? (input.dto.order.items as unknown as Prisma.InputJsonValue)
          : undefined,
        schemaVersion: input.dto.schemaVersion,
        payload,
        payloadHash,
        authenticationContext: {
          keyId: input.keyId,
          timestamp: input.timestamp,
          authenticated: true,
        },
        requestId: this.audit.requestId(),
        processingStatus: Stage8EventProcessingStatus.ACCEPTED,
      },
    });
    await this.prisma.trackerInstallation.update({
      where: { id: installation.id },
      data: {
        lastWebhookAt: new Date(),
        healthStatus: "RECEIVING_ORDER_EVENTS",
      },
    });
    await this.processOrderEvent(event.id);
    const processed = await this.prisma.stage8OrderEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    return {
      accepted: true,
      duplicate: false,
      eventId: event.id,
      status: processed.processingStatus,
    };
  }

  async processOrderEvent(eventId: string) {
    const event = await this.prisma.stage8OrderEvent.findUnique({
      where: { id: eventId },
      include: { brand: true },
    });
    if (!event) throw new NotFoundException("Order event not found");
    if (event.processingStatus === Stage8EventProcessingStatus.PROCESSED) {
      return event;
    }
    await this.prisma.stage8OrderEvent.update({
      where: { id: event.id },
      data: {
        processingStatus: Stage8EventProcessingStatus.PROCESSING,
        attemptCount: { increment: 1 },
      },
    });
    try {
      await this.recordPromoCodeUse(event);
      const candidates = await this.resolveCandidates(event);
      const requestedOfferId =
        event.offerIdHint ??
        (new Set(candidates.map((candidate) => candidate.offerId)).size === 1
          ? candidates[0]?.offerId
          : null);
      if (!requestedOfferId) {
        await this.createUnsupportedException(event, [
          "OFFER_CANNOT_BE_RESOLVED",
        ]);
        return this.markEventProcessed(event.id);
      }
      const offer = await this.prisma.offer.findFirst({
        where: { id: requestedOfferId, brandId: event.brandId },
      });
      if (!offer) {
        await this.createUnsupportedException(event, [
          "OFFER_NOT_OWNED_BY_BRAND",
        ]);
        return this.markEventProcessed(event.id);
      }
      const order = await this.upsertOrderProjection(event, offer.id);
      await this.prisma.stage8OrderEvent.update({
        where: { id: event.id },
        data: { orderId: order.id },
      });
      await this.createTimeline(order.id, {
        orderEventId: event.id,
        eventType: Stage8TimelineEventType.ORDER_EVENT_ACCEPTED,
        eventKey: `stage8:order-event:${event.id}:accepted`,
        occurredAt: event.occurredAt,
        summary: {
          source: event.source,
          eventType: event.eventType,
          externalOrderId: event.externalOrderId,
        },
      });

      let result = order.currentAttributionResultId
        ? await this.prisma.attributionResult.findUnique({
            where: { id: order.currentAttributionResultId },
          })
        : null;
      if (!result) {
        result = await this.decideAttribution(order.id, event, candidates);
      }
      if (
        result &&
        (result.status === Stage8AttributionStatus.AUTO_ATTRIBUTED ||
          result.status === Stage8AttributionStatus.MANUALLY_ATTRIBUTED)
      ) {
        if (event.eventType === Stage8OrderEventType.PAYMENT_SUCCEEDED) {
          await this.applyCommissionEligibilityProjection(
            order.id,
            result.affiliateCommercialAgreementId,
          );
        }
        await this.enqueueFinancialHandoff(order.id, event.id, result.id);
      }
      await this.markEventProcessed(event.id);
      await this.processPendingOutbox();
      return this.prisma.stage8OrderEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
    } catch (error) {
      await this.prisma.stage8OrderEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: Stage8EventProcessingStatus.RETRY_PENDING,
          nextAttemptAt: new Date(Date.now() + 60_000),
          lastErrorCode:
            error instanceof Error
              ? error.constructor.name.slice(0, 120)
              : "ERROR",
          lastErrorMessage:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Unknown error",
        },
      });
      throw error;
    }
  }

  async processPendingOutbox(limit = 50) {
    if (!this.flags.financeHandoffEnabled()) return { processed: 0, failed: 0 };
    const events = await this.prisma.stage8OutboxEvent.findMany({
      where: {
        status: {
          in: [Stage8OutboxStatus.PENDING, Stage8OutboxStatus.RETRY_PENDING],
        },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    let processed = 0;
    let failed = 0;
    for (const outbox of events) {
      const claimed = await this.prisma.stage8OutboxEvent.updateMany({
        where: {
          id: outbox.id,
          status: {
            in: [Stage8OutboxStatus.PENDING, Stage8OutboxStatus.RETRY_PENDING],
          },
        },
        data: {
          status: Stage8OutboxStatus.PROCESSING,
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count !== 1) continue;
      try {
        const payload = outbox.payload as {
          orderId: string;
          orderEventId: string;
          attributionResultId: string;
        };
        await this.financialOrderPort.process(payload);
        await this.prisma.$transaction([
          this.prisma.stage8OutboxEvent.update({
            where: { id: outbox.id },
            data: {
              status: Stage8OutboxStatus.PROCESSED,
              processedAt: new Date(),
              nextAttemptAt: null,
              lastErrorCode: null,
              lastErrorMessage: null,
            },
          }),
          this.prisma.order.update({
            where: { id: payload.orderId },
            data: {
              financialHandoffStatus: Stage8FinancialHandoffStatus.ACKNOWLEDGED,
            },
          }),
        ]);
        await this.createTimeline(payload.orderId, {
          orderEventId: payload.orderEventId,
          attributionResultId: payload.attributionResultId,
          eventType: Stage8TimelineEventType.FINANCE_HANDOFF_ACCEPTED,
          eventKey: `${outbox.eventKey}:accepted`,
          occurredAt: new Date(),
          summary: { outboxEventId: outbox.id },
        });
        processed += 1;
      } catch (error) {
        const attempts = outbox.attemptCount + 1;
        const retryDeadline = new Date(
          outbox.createdAt.getTime() + 72 * 60 * 60 * 1000,
        );
        const exhausted = Date.now() >= retryDeadline.getTime();
        await this.prisma.stage8OutboxEvent.update({
          where: { id: outbox.id },
          data: {
            status: exhausted
              ? Stage8OutboxStatus.FAILED
              : Stage8OutboxStatus.RETRY_PENDING,
            nextAttemptAt: exhausted
              ? null
              : new Date(
                  Math.min(
                    retryDeadline.getTime(),
                    Date.now() +
                      Math.min(6 * 60 * 60_000, 2 ** attempts * 60_000),
                  ),
                ),
            lastErrorCode:
              error instanceof Error
                ? error.constructor.name.slice(0, 120)
                : "ERROR",
            lastErrorMessage:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Unknown error",
          },
        });
        failed += 1;
      }
    }
    return { processed, failed };
  }

  async processRetryableOrderEvents(limit = 50) {
    const now = new Date();
    const events = await this.prisma.stage8OrderEvent.findMany({
      where: {
        processingStatus: Stage8EventProcessingStatus.RETRY_PENDING,
        nextAttemptAt: { lte: now },
      },
      orderBy: { receivedAt: "asc" },
      take: limit,
    });
    let processed = 0;
    let deadLettered = 0;
    for (const event of events) {
      const retryDeadline = new Date(
        event.receivedAt.getTime() + 72 * 60 * 60 * 1000,
      );
      if (now >= retryDeadline) {
        await this.prisma.stage8OrderEvent.update({
          where: { id: event.id },
          data: {
            processingStatus: Stage8EventProcessingStatus.DEAD_LETTER,
            nextAttemptAt: null,
            lastErrorCode: event.lastErrorCode ?? "RETRY_WINDOW_EXPIRED",
          },
        });
        await this.openAttributionException(
          event.brandId,
          event.orderId,
          null,
          Stage8ExceptionType.MANUAL_CORRECTION_REQUIRED,
          ["ORDER_EVENT_RETRY_WINDOW_EXPIRED"],
          event.requestId,
        );
        deadLettered += 1;
        continue;
      }
      try {
        await this.processOrderEvent(event.id);
        processed += 1;
      } catch {
        // processOrderEvent records the next retry and sanitized error state.
      }
    }
    return { processed, deadLettered };
  }

  async ingestConfirmedCsvImport(userId: string, importId: string) {
    const brand = await this.getBrand(userId);
    const orderImport = await this.prisma.orderImport.findFirst({
      where: { id: importId, brandId: brand.id },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
    if (!orderImport) throw new NotFoundException("Order import not found");
    if (orderImport.status === "IMPORTED") {
      return {
        id: orderImport.id,
        status: orderImport.status,
        idempotent: true,
      };
    }
    if (orderImport.status !== "READY") {
      throw new ConflictException("Order import is not ready");
    }
    const claimed = await this.prisma.orderImport.updateMany({
      where: { id: orderImport.id, status: "READY" },
      data: { status: "VALIDATING" },
    });
    if (claimed.count !== 1) {
      throw new ConflictException("Order import is already processing");
    }
    let created = 0;
    let updated = 0;
    try {
      for (const row of orderImport.rows) {
        if (
          row.status !== "VALID" ||
          !row.externalOrderId ||
          !row.orderStatus
        ) {
          continue;
        }
        const existing = await this.prisma.order.findUnique({
          where: {
            brandId_externalOrderId: {
              brandId: brand.id,
              externalOrderId: row.externalOrderId,
            },
          },
        });
        const targetReturned = BigInt(row.returnedAmountKopecks ?? 0);
        const previousReturned =
          existing?.returnedAmountMinor ??
          BigInt(existing?.returnedAmountKopecks ?? 0);
        const refundDelta =
          targetReturned > previousReturned
            ? targetReturned - previousReturned
            : 0n;
        const eventType = this.csvEventType(row.orderStatus);
        const externalEventId = [
          "csv",
          orderImport.id,
          row.rowNumber,
          row.orderStatus,
          row.returnedAmountKopecks ?? 0,
        ].join(":");
        const payload = {
          source: "CSV_IMPORT",
          importId: orderImport.id,
          rowNumber: row.rowNumber,
          externalOrderId: row.externalOrderId,
          status: row.orderStatus,
          amountMinor: row.amountKopecks,
          returnedAmountMinor: row.returnedAmountKopecks ?? 0,
          currency: row.currency,
          offerId: row.offerId,
          clickId: row.clickId,
          affiliateCode: row.affiliateCode,
          promoCode: row.promoCode,
        };
        if (
          !existing &&
          eventType !== Stage8OrderEventType.ORDER_CREATED &&
          eventType !== Stage8OrderEventType.PAYMENT_SUCCEEDED
        ) {
          const baseEventType =
            eventType === Stage8OrderEventType.ORDER_CANCELLED
              ? Stage8OrderEventType.ORDER_CREATED
              : Stage8OrderEventType.PAYMENT_SUCCEEDED;
          const basePayload = {
            ...payload,
            status:
              baseEventType === Stage8OrderEventType.ORDER_CREATED
                ? "PENDING"
                : "PAID",
            synthesizedFromFinalCsvState: true,
          };
          const baseEvent = await this.prisma.stage8OrderEvent.upsert({
            where: {
              brandId_sourceNamespace_externalEventId: {
                brandId: brand.id,
                sourceNamespace: `CSV:${orderImport.id}`,
                externalEventId: `${externalEventId}:base`,
              },
            },
            update: {},
            create: {
              brandId: brand.id,
              orderImportId: orderImport.id,
              source: Stage8OrderSource.CSV_IMPORT,
              sourceNamespace: `CSV:${orderImport.id}`,
              externalEventId: `${externalEventId}:base`,
              externalOrderId: row.externalOrderId,
              canonicalOrderKey: row.externalOrderId,
              eventType: baseEventType,
              occurredAt: row.orderDate ?? orderImport.createdAt,
              orderCreatedAt: row.orderDate,
              amountMinor:
                row.amountKopecks === null ? null : BigInt(row.amountKopecks),
              currency: row.currency,
              offerIdHint: row.offerId,
              clickIdHint: row.clickId,
              creatorLinkCode: row.affiliateCode,
              promoCode: row.promoCode,
              payload: basePayload,
              payloadHash: this.hash(basePayload),
              authenticationContext: {
                source: "CSV_IMPORT",
                actorUserId: userId,
                fileChecksum: orderImport.fileChecksum,
                synthesizedBaseEvent: true,
              },
              requestId: this.audit.requestId(),
              processingStatus: Stage8EventProcessingStatus.ACCEPTED,
            },
          });
          await this.processOrderEvent(baseEvent.id);
        }
        const event = await this.prisma.stage8OrderEvent.upsert({
          where: {
            brandId_sourceNamespace_externalEventId: {
              brandId: brand.id,
              sourceNamespace: `CSV:${orderImport.id}`,
              externalEventId,
            },
          },
          update: {},
          create: {
            brandId: brand.id,
            orderImportId: orderImport.id,
            source: Stage8OrderSource.CSV_IMPORT,
            sourceNamespace: `CSV:${orderImport.id}`,
            externalEventId,
            externalOrderId: row.externalOrderId,
            canonicalOrderKey: row.externalOrderId,
            eventType,
            occurredAt: row.orderDate ?? orderImport.createdAt,
            orderCreatedAt: row.orderDate,
            amountMinor:
              row.amountKopecks === null ? null : BigInt(row.amountKopecks),
            refundAmountMinor:
              eventType === Stage8OrderEventType.PARTIAL_REFUND_SUCCEEDED
                ? refundDelta
                : eventType === Stage8OrderEventType.REFUND_SUCCEEDED
                  ? targetReturned
                  : null,
            currency: row.currency,
            offerIdHint: row.offerId,
            clickIdHint: row.clickId,
            creatorLinkCode: row.affiliateCode,
            promoCode: row.promoCode,
            payload,
            payloadHash: this.hash(payload),
            authenticationContext: {
              source: "CSV_IMPORT",
              actorUserId: userId,
              fileChecksum: orderImport.fileChecksum,
            },
            requestId: this.audit.requestId(),
            processingStatus: Stage8EventProcessingStatus.ACCEPTED,
          },
        });
        await this.processOrderEvent(event.id);
        if (existing) updated += 1;
        else created += 1;
      }
      await this.prisma.$transaction([
        this.prisma.orderImport.update({
          where: { id: orderImport.id },
          data: { status: "IMPORTED", completedAt: new Date() },
        }),
        this.prisma.auditLog.create({
          data: {
            actorUserId: userId,
            action: "STAGE8_CSV_IMPORT_PROCESSED",
            entityType: "OrderImport",
            entityId: orderImport.id,
            requestId: this.audit.requestId(),
            metadata: { created, updated, source: "CANONICAL_PIPELINE" },
          },
        }),
      ]);
      return {
        id: orderImport.id,
        status: "IMPORTED",
        created,
        updated,
      };
    } catch (error) {
      await this.prisma.orderImport.update({
        where: { id: orderImport.id },
        data: {
          status: "FAILED",
          errorSummary: {
            message:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "CSV ingestion failed",
          },
        },
      });
      throw error;
    }
  }

  async mirrorConfirmedCsvImport(userId: string, importId: string) {
    const brand = await this.getBrand(userId);
    const orderImport = await this.prisma.orderImport.findFirst({
      where: { id: importId, brandId: brand.id, status: "IMPORTED" },
      include: { orders: true },
    });
    if (!orderImport) return { mirrored: 0 };
    let mirrored = 0;
    for (const order of orderImport.orders) {
      const payload = {
        source: "CSV_SHADOW",
        orderId: order.id,
        externalOrderId: order.externalOrderId,
        status: order.status,
      };
      await this.prisma.stage8OrderEvent.upsert({
        where: {
          brandId_sourceNamespace_externalEventId: {
            brandId: brand.id,
            sourceNamespace: `CSV_SHADOW:${orderImport.id}`,
            externalEventId: `shadow:${order.id}`,
          },
        },
        update: {},
        create: {
          brandId: brand.id,
          orderImportId: orderImport.id,
          orderId: order.id,
          source: Stage8OrderSource.CSV_IMPORT,
          sourceNamespace: `CSV_SHADOW:${orderImport.id}`,
          externalEventId: `shadow:${order.id}`,
          externalOrderId: order.externalOrderId,
          canonicalOrderKey: order.externalOrderId,
          eventType: this.csvEventType(order.status),
          occurredAt: order.orderDate,
          orderCreatedAt: order.orderDate,
          amountMinor: order.amountMinor ?? BigInt(order.amountKopecks),
          refundAmountMinor:
            order.returnedAmountKopecks > 0
              ? (order.returnedAmountMinor ??
                BigInt(order.returnedAmountKopecks))
              : null,
          currency: order.currency,
          offerIdHint: order.offerId,
          clickIdHint: order.clickId,
          creatorLinkCode: order.affiliateCode,
          promoCode: order.promoCode,
          payload,
          payloadHash: this.hash(payload),
          authenticationContext: {
            source: "CSV_SHADOW",
            actorUserId: userId,
          },
          requestId: this.audit.requestId(),
          processingStatus: Stage8EventProcessingStatus.PROCESSED,
          processedAt: new Date(),
        },
      });
      mirrored += 1;
    }
    return { mirrored };
  }

  async listBrandExceptions(userId: string, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    return this.prisma.attributionException.findMany({
      where: { brandId: brand.id },
      include: {
        order: { select: { id: true, externalOrderId: true, currency: true } },
        attributionResult: true,
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    });
  }

  async listAdminExceptions() {
    return this.prisma.attributionException.findMany({
      include: {
        brand: { select: { id: true, brandName: true } },
        order: { select: { id: true, externalOrderId: true, currency: true } },
        attributionResult: true,
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    });
  }

  async openIntegrationException(input: {
    brandId: string;
    orderId: string | null;
    reasonCodes: string[];
    requestId: string;
  }) {
    return this.openAttributionException(
      input.brandId,
      input.orderId,
      null,
      Stage8ExceptionType.MANUAL_CORRECTION_REQUIRED,
      input.reasonCodes,
      input.requestId,
    );
  }

  async resolveException(
    user: { id: string; role: UserRole },
    exceptionId: string,
    dto: ResolveAttributionExceptionDto,
  ) {
    const exception = await this.prisma.attributionException.findUnique({
      where: { id: exceptionId },
      include: { order: true, attributionResult: true },
    });
    if (!exception)
      throw new NotFoundException("Attribution exception not found");
    if (exception.status === Stage8ExceptionStatus.RESOLVED) return exception;
    if (user.role === UserRole.BRAND) {
      const brand = await this.getBrand(user.id);
      if (brand.id !== exception.brandId) {
        throw new ForbiddenException("No access to this exception");
      }
      if (
        exception.type === Stage8ExceptionType.CONFLICTING_ATTRIBUTION ||
        exception.order?.financialHandoffStatus ===
          Stage8FinancialHandoffStatus.ACKNOWLEDGED
      ) {
        throw new ForbiddenException(
          "Cross-creator and post-finance corrections require ADMIN",
        );
      }
    } else if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException("ADMIN or owning Brand is required");
    }
    if (!exception.order) {
      throw new ConflictException("Exception has no order to attribute");
    }
    const agreement = await this.prisma.affiliateCommercialAgreement.findUnique(
      {
        where: { id: dto.affiliateCommercialAgreementId },
        include: { affiliateRelationship: { include: { offer: true } } },
      },
    );
    if (
      !agreement ||
      agreement.affiliateRelationship.offer.brandId !== exception.brandId
    ) {
      throw new ForbiddenException("Agreement is outside the exception Brand");
    }
    const previous = await this.prisma.attributionResult.findFirst({
      where: { orderId: exception.order.id },
      orderBy: { decisionVersion: "desc" },
    });
    const version = (previous?.decisionVersion ?? 0) + 1;
    const requestId = this.audit.requestId();
    const result = await this.prisma.$transaction(async (tx) => {
      if (previous && previous.status !== Stage8AttributionStatus.SUPERSEDED) {
        await tx.attributionResult.update({
          where: { id: previous.id },
          data: { status: Stage8AttributionStatus.SUPERSEDED },
        });
      }
      const created = await tx.attributionResult.create({
        data: {
          orderId: exception.order!.id,
          decisionVersion: version,
          status: Stage8AttributionStatus.MANUALLY_ATTRIBUTED,
          creatorId: agreement.affiliateRelationship.creatorId,
          offerId: agreement.offerId,
          affiliateRelationshipId: agreement.affiliateRelationshipId,
          affiliateCommercialAgreementId: agreement.id,
          confidenceLevel: Stage8ConfidenceLevel.VERIFIED,
          confidenceScore: 100,
          reasonCodes: ["MANUAL_EXCEPTION_RESOLUTION"],
          evidenceIds: [],
          attributedAt: new Date(),
          decidedByType: user.role,
          decidedByUserId: user.id,
          supersedesResultId: previous?.id ?? null,
          decisionHash: this.hash({
            orderId: exception.order!.id,
            version,
            agreementId: agreement.id,
            reason: dto.reason,
          }),
          requestId,
        },
      });
      await tx.order.update({
        where: { id: exception.order!.id },
        data: {
          currentAttributionResultId: created.id,
          affiliateRelationshipId: agreement.affiliateRelationshipId,
          affiliateCommercialAgreementId: agreement.id,
          offerId: agreement.offerId,
          attributedAt: created.attributedAt,
          managerIdAtAttribution:
            agreement.affiliateRelationship.currentManagerId,
          financialHandoffStatus: Stage8FinancialHandoffStatus.READY,
        },
      });
      await tx.attributionException.update({
        where: { id: exception.id },
        data: {
          status: Stage8ExceptionStatus.RESOLVED,
          resolution: dto.reason,
          resolvedAt: new Date(),
          resolvedByUserId: user.id,
          resolvedResultId: created.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "STAGE8_ATTRIBUTION_EXCEPTION_RESOLVED",
          entityType: "AttributionException",
          entityId: exception.id,
          requestId,
          metadata: {
            orderId: exception.order!.id,
            previousResultId: previous?.id ?? null,
            nextResultId: created.id,
            affiliateCommercialAgreementId: agreement.id,
            reason: dto.reason,
          },
        },
      });
      return created;
    });
    await this.enqueueFinancialHandoff(
      exception.order.id,
      (
        await this.prisma.stage8OrderEvent.findFirstOrThrow({
          where: { orderId: exception.order.id },
          orderBy: { occurredAt: "desc" },
        })
      ).id,
      result.id,
    );
    await this.processPendingOutbox();
    return this.prisma.attributionException.findUniqueOrThrow({
      where: { id: exception.id },
      include: { attributionResult: true },
    });
  }

  async brandSalesOverview(userId: string, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    const [orders, exceptions, events, imports] = await Promise.all([
      this.prisma.order.findMany({
        where: { brandId: brand.id },
        include: { commission: true },
      }),
      this.prisma.attributionException.count({
        where: {
          brandId: brand.id,
          status: {
            in: [Stage8ExceptionStatus.OPEN, Stage8ExceptionStatus.IN_REVIEW],
          },
        },
      }),
      this.prisma.stage8OrderEvent.count({ where: { brandId: brand.id } }),
      this.prisma.orderImport.findMany({
        where: { brandId: brand.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);
    return {
      automaticallyProcessedSales: orders.filter(
        (order) =>
          order.financialHandoffStatus ===
          Stage8FinancialHandoffStatus.ACKNOWLEDGED,
      ).length,
      salesRequiringReview: exceptions,
      paidOrders: orders.filter(
        (order) =>
          order.status === OrderStatus.PAID ||
          order.status === OrderStatus.PARTIALLY_RETURNED,
      ).length,
      refunds: orders.filter(
        (order) =>
          order.status === OrderStatus.RETURNED ||
          order.status === OrderStatus.PARTIALLY_RETURNED,
      ).length,
      receivedEvents: events,
      csvFallback: {
        minimumUploadsPerWeek: 2,
        deadlines: ["TUESDAY_18:00", "FRIDAY_18:00"],
        timezone: brand.timezone,
        recentImports: imports,
      },
    };
  }

  async adminOperationalStatus() {
    const [
      retryableOrderEvents,
      deadLetterOrderEvents,
      retryableOutboxEvents,
      failedOutboxEvents,
      openExceptions,
      escalatedExceptions,
    ] = await Promise.all([
      this.prisma.stage8OrderEvent.count({
        where: { processingStatus: Stage8EventProcessingStatus.RETRY_PENDING },
      }),
      this.prisma.stage8OrderEvent.count({
        where: { processingStatus: Stage8EventProcessingStatus.DEAD_LETTER },
      }),
      this.prisma.stage8OutboxEvent.count({
        where: { status: Stage8OutboxStatus.RETRY_PENDING },
      }),
      this.prisma.stage8OutboxEvent.count({
        where: { status: Stage8OutboxStatus.FAILED },
      }),
      this.prisma.attributionException.count({
        where: {
          status: {
            in: [Stage8ExceptionStatus.OPEN, Stage8ExceptionStatus.IN_REVIEW],
          },
        },
      }),
      this.prisma.attributionException.count({
        where: {
          status: {
            in: [Stage8ExceptionStatus.OPEN, Stage8ExceptionStatus.IN_REVIEW],
          },
          escalatedAt: { not: null },
        },
      }),
    ]);
    const flags = {
      tracker: this.flags.trackerEnabled(),
      tilda: this.flags.tildaEnabled(),
      orderIngestion: this.flags.ingestionEnabled(),
      shadowAttribution: this.flags.shadowEnabled(),
      autoAttribution: this.flags.autoAttributionEnabled(),
      financeHandoff: this.flags.financeHandoffEnabled(),
    };
    return {
      status:
        deadLetterOrderEvents > 0 || failedOutboxEvents > 0
          ? "DEGRADED"
          : "READY",
      flags,
      queues: {
        retryableOrderEvents,
        deadLetterOrderEvents,
        retryableOutboxEvents,
        failedOutboxEvents,
        openExceptions,
        escalatedExceptions,
      },
      disabledIsHealthy: Object.values(flags).every((enabled) => !enabled),
      checkedAt: new Date(),
    };
  }

  async creatorPerformanceOverview(userId: string) {
    const creator = await this.prisma.creatorProfile.findUnique({
      where: { userId },
    });
    if (!creator) throw new ForbiddenException("Creator profile not found");
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const [clicks, orders, commissions, payouts] = await Promise.all([
      this.prisma.click.count({
        where: { creatorId: creator.id, clickedAt: { gte: start } },
      }),
      this.prisma.order.findMany({
        where: {
          affiliateRelationship: { creatorId: creator.id },
          status: {
            in: [
              OrderStatus.PAID,
              OrderStatus.PARTIALLY_RETURNED,
              OrderStatus.RETURNED,
            ],
          },
        },
        include: { commission: true },
      }),
      this.prisma.commission.findMany({ where: { creatorId: creator.id } }),
      this.prisma.payout.aggregate({
        where: { creatorId: creator.id, status: "PAID" },
        _sum: { amountKopecks: true },
      }),
    ]);
    const sum = (statuses: string[]) =>
      commissions
        .filter((commission) => statuses.includes(commission.status))
        .reduce(
          (total, commission) =>
            total +
            (commission.creatorAmountMinor ??
              BigInt(commission.creatorAmountKopecks)),
          0n,
        );
    return {
      todayClicks: clicks,
      paidAttributedOrders: orders.filter(
        (order) => order.status !== OrderStatus.RETURNED,
      ).length,
      revenueGeneratedMinor: orders.reduce((total, order) => {
        const merchandiseAmount =
          (order.amountMinor ?? BigInt(order.amountKopecks)) -
          order.shippingAmountMinor;
        const returnedAmount =
          order.returnedAmountMinor ?? BigInt(order.returnedAmountKopecks);
        return (
          total +
          (merchandiseAmount > returnedAmount
            ? merchandiseAmount - returnedAmount
            : 0n)
        );
      }, 0n),
      expectedCommissionMinor: sum(["PENDING", "HOLD"]),
      confirmedCommissionMinor: sum(["CONFIRMED", "AVAILABLE", "PAYABLE"]),
      paidCommissionMinor: payouts._sum.amountKopecks ?? 0n,
      reversedCommissionMinor: sum(["REVERSED"]),
      currency: this.singleCurrency(orders.map((order) => order.currency)),
      freshnessAt: new Date(),
    };
  }

  async orderTimeline(
    user: { id: string; role: UserRole },
    orderId: string,
    activeBrandId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { affiliateRelationship: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (user.role === UserRole.BRAND || user.role === UserRole.MANAGER) {
      const brand = await this.getBrand(user.id, activeBrandId);
      if (order.brandId !== brand.id) throw new ForbiddenException();
    } else if (user.role === UserRole.CREATOR) {
      const creator = await this.prisma.creatorProfile.findUnique({
        where: { userId: user.id },
      });
      if (!creator || order.affiliateRelationship?.creatorId !== creator.id) {
        throw new ForbiddenException();
      }
    }
    return this.prisma.orderTimelineEvent.findMany({
      where: { orderId },
      orderBy: { occurredAt: "asc" },
    });
  }

  async escalateDueExceptions() {
    const now = new Date();
    const result = await this.prisma.attributionException.updateMany({
      where: {
        status: {
          in: [Stage8ExceptionStatus.OPEN, Stage8ExceptionStatus.IN_REVIEW],
        },
        dueAt: { lte: now },
        escalatedAt: null,
      },
      data: { escalatedAt: now },
    });
    return { escalated: result.count };
  }

  async purgeExpiredRetentionData() {
    const trackingBefore = new Date();
    trackingBefore.setUTCMonth(trackingBefore.getUTCMonth() - 13);
    const payloadBefore = new Date();
    payloadBefore.setUTCMonth(payloadBefore.getUTCMonth() - 24);
    const [tracking, payloads] = await this.prisma.$transaction([
      this.prisma.trackingEvent.deleteMany({
        where: { receivedAt: { lt: trackingBefore } },
      }),
      this.prisma.$executeRaw`
        UPDATE "Stage8OrderEvent"
        SET "payload" = '{"redactedByRetention":true}'::jsonb
        WHERE "receivedAt" < ${payloadBefore}
          AND "payload" <> '{"redactedByRetention":true}'::jsonb
      `,
    ]);
    return {
      trackingEventsDeleted: tracking.count,
      orderPayloadsSanitized: payloads,
    };
  }

  private async authenticateWebhook(input: {
    installationId: string;
    keyId: string;
    eventId: string;
    timestamp: string;
    signature: string;
    rawBody: Buffer;
  }) {
    if (
      !input.installationId ||
      !input.keyId ||
      !input.eventId ||
      !/^\d{10}$/.test(input.timestamp) ||
      !/^v1=[a-f0-9]{64}$/i.test(input.signature)
    ) {
      throw new UnauthorizedException("Invalid webhook authentication headers");
    }
    const eventTime = Number(input.timestamp) * 1000;
    if (Math.abs(Date.now() - eventTime) > 5 * 60 * 1000) {
      throw new UnauthorizedException("Webhook timestamp is outside tolerance");
    }
    const credential = await this.prisma.integrationCredentialVersion.findFirst(
      {
        where: {
          installationId: input.installationId,
          keyId: input.keyId,
          status: Stage8IntegrationStatus.ACTIVE,
          validFrom: { lte: new Date() },
          OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
        },
        include: { installation: true },
      },
    );
    if (
      !credential ||
      credential.installation.status !== Stage8IntegrationStatus.ACTIVE
    ) {
      throw new UnauthorizedException("Webhook credential is inactive");
    }
    const bodyHash = createHash("sha256").update(input.rawBody).digest("hex");
    const expected = createHmac(
      "sha256",
      this.secrets.decrypt(credential.encryptedSecret),
    )
      .update(`${input.timestamp}\n${input.eventId}\n${bodyHash}`)
      .digest("hex");
    const actual = input.signature.slice(3).toLowerCase();
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    ) {
      throw new UnauthorizedException("Invalid webhook signature");
    }
    return credential.installation;
  }

  private csvEventType(status: OrderStatus) {
    if (status === OrderStatus.PAID) {
      return Stage8OrderEventType.PAYMENT_SUCCEEDED;
    }
    if (status === OrderStatus.CANCELLED) {
      return Stage8OrderEventType.ORDER_CANCELLED;
    }
    if (status === OrderStatus.RETURNED) {
      return Stage8OrderEventType.REFUND_SUCCEEDED;
    }
    if (status === OrderStatus.PARTIALLY_RETURNED) {
      return Stage8OrderEventType.PARTIAL_REFUND_SUCCEEDED;
    }
    return Stage8OrderEventType.ORDER_CREATED;
  }

  private async upsertOrderProjection(
    event: {
      id: string;
      brandId: string;
      externalOrderId: string;
      canonicalOrderKey: string;
      sourceNamespace: string;
      source: Stage8OrderSource;
      eventType: Stage8OrderEventType;
      occurredAt: Date;
      orderCreatedAt: Date | null;
      amountMinor: bigint | null;
      shippingAmountMinor: bigint | null;
      refundAmountMinor: bigint | null;
      currency: string | null;
      productLines: Prisma.JsonValue | null;
    },
    offerId: string,
  ) {
    const existing = await this.prisma.order.findUnique({
      where: {
        brandId_externalOrderId: {
          brandId: event.brandId,
          externalOrderId: event.externalOrderId,
        },
      },
    });
    if (!existing) {
      if (
        !event.amountMinor ||
        !event.currency ||
        (event.eventType !== Stage8OrderEventType.ORDER_CREATED &&
          event.eventType !== Stage8OrderEventType.PAYMENT_SUCCEEDED)
      ) {
        throw new ConflictException(
          "First order event must contain amount and currency",
        );
      }
      const amount = this.legacyMoney(event.amountMinor);
      return this.prisma.order.create({
        data: {
          brandId: event.brandId,
          offerId,
          orderImportId: null,
          externalOrderId: event.externalOrderId,
          orderDate: event.orderCreatedAt ?? event.occurredAt,
          amountKopecks: amount,
          amountMinor: event.amountMinor,
          shippingAmountMinor: event.shippingAmountMinor ?? 0n,
          returnedAmountKopecks: 0,
          returnedAmountMinor: 0n,
          productLines: event.productLines ?? undefined,
          currency: event.currency,
          status:
            event.eventType === Stage8OrderEventType.PAYMENT_SUCCEEDED
              ? OrderStatus.PAID
              : OrderStatus.PENDING,
          attributionSource: AttributionSource.UNATTRIBUTED,
          creatorCommissionBps: 0,
          platformCommissionBps: 0,
          canonicalOrderKey: event.canonicalOrderKey,
          sourceNamespace: event.sourceNamespace,
          stage8Source: event.source,
          commerceStatus:
            event.eventType === Stage8OrderEventType.PAYMENT_SUCCEEDED
              ? Stage8CommerceOrderStatus.PAID
              : Stage8CommerceOrderStatus.CREATED,
          paidAt:
            event.eventType === Stage8OrderEventType.PAYMENT_SUCCEEDED
              ? event.occurredAt
              : null,
          financialHandoffStatus: Stage8FinancialHandoffStatus.NOT_READY,
        },
      });
    }
    if (
      event.amountMinor !== null &&
      existing.amountMinor !== null &&
      event.amountMinor !== existing.amountMinor
    ) {
      throw new ConflictException("Order amount is immutable");
    }
    if (
      event.shippingAmountMinor !== null &&
      event.shippingAmountMinor !== existing.shippingAmountMinor
    ) {
      throw new ConflictException("Order shipping amount is immutable");
    }
    if (event.currency && event.currency !== existing.currency) {
      throw new ConflictException("Order currency is immutable");
    }
    if (
      event.productLines &&
      existing.productLines &&
      this.hash(event.productLines) !== this.hash(existing.productLines)
    ) {
      throw new ConflictException("Order product lines are immutable");
    }
    let status = existing.status;
    let commerceStatus =
      existing.commerceStatus ?? Stage8CommerceOrderStatus.CREATED;
    let returnedAmount =
      existing.returnedAmountMinor ?? BigInt(existing.returnedAmountKopecks);
    let paidAt = existing.paidAt;
    let cancelledAt = existing.cancelledAt;
    let chargebackOpenedAt = existing.chargebackOpenedAt;
    if (event.eventType === Stage8OrderEventType.PAYMENT_SUCCEEDED) {
      status = OrderStatus.PAID;
      commerceStatus = Stage8CommerceOrderStatus.PAID;
      paidAt = existing.paidAt ?? event.occurredAt;
    } else if (event.eventType === Stage8OrderEventType.ORDER_CANCELLED) {
      status = OrderStatus.CANCELLED;
      commerceStatus = Stage8CommerceOrderStatus.CANCELLED;
      cancelledAt = event.occurredAt;
    } else if (
      event.eventType === Stage8OrderEventType.PARTIAL_REFUND_SUCCEEDED
    ) {
      if (!event.refundAmountMinor) {
        throw new BadRequestException("Partial refund amount is required");
      }
      returnedAmount += event.refundAmountMinor;
      if (
        returnedAmount >=
        (existing.amountMinor ?? BigInt(existing.amountKopecks))
      ) {
        throw new ConflictException(
          "Partial refund must remain below the paid amount",
        );
      }
      status = OrderStatus.PARTIALLY_RETURNED;
      commerceStatus = Stage8CommerceOrderStatus.PARTIALLY_REFUNDED;
    } else if (
      event.eventType === Stage8OrderEventType.REFUND_SUCCEEDED ||
      event.eventType === Stage8OrderEventType.CHARGEBACK_CONFIRMED
    ) {
      returnedAmount = existing.amountMinor ?? BigInt(existing.amountKopecks);
      status = OrderStatus.RETURNED;
      commerceStatus = Stage8CommerceOrderStatus.REFUNDED;
    } else if (event.eventType === Stage8OrderEventType.CHARGEBACK_OPENED) {
      commerceStatus = Stage8CommerceOrderStatus.CHARGEBACK;
      chargebackOpenedAt = event.occurredAt;
    } else if (event.eventType === Stage8OrderEventType.CHARGEBACK_REVERSED) {
      commerceStatus =
        returnedAmount > 0n
          ? Stage8CommerceOrderStatus.PARTIALLY_REFUNDED
          : Stage8CommerceOrderStatus.PAID;
      chargebackOpenedAt = null;
    }
    const amount = existing.amountMinor ?? BigInt(existing.amountKopecks);
    if (returnedAmount < 0n || returnedAmount > amount) {
      throw new ConflictException("Refund exceeds original order amount");
    }
    const productLines = existing.productLines ?? event.productLines;
    const commissionableAmountMinor = existing.commissionableAmountMinor;
    const returnedCommissionableAmountMinor =
      commissionableAmountMinor === null
        ? existing.returnedCommissionableAmountMinor
        : proportionalCommissionableRefund({
            orderAmountMinor: amount,
            commissionableAmountMinor,
            returnedAmountMinor: returnedAmount,
          });
    return this.prisma.order.update({
      where: { id: existing.id },
      data: {
        status,
        commerceStatus,
        returnedAmountMinor: returnedAmount,
        returnedAmountKopecks: this.legacyMoney(returnedAmount),
        productLines: productLines ?? undefined,
        returnedCommissionableAmountMinor,
        paidAt,
        cancelledAt,
        chargebackOpenedAt,
      },
    });
  }

  private async applyCommissionEligibilityProjection(
    orderId: string,
    agreementId: string | null,
  ) {
    if (!agreementId) {
      throw new ConflictException(
        "Attributed order requires an immutable commercial agreement",
      );
    }
    const [order, agreement] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      this.prisma.affiliateCommercialAgreement.findUniqueOrThrow({
        where: { id: agreementId },
      }),
    ]);
    const amountMinor = order.amountMinor ?? BigInt(order.amountKopecks);
    const returnedAmountMinor =
      order.returnedAmountMinor ?? BigInt(order.returnedAmountKopecks);
    const projection = projectCommissionEligibility({
      agreementSnapshot: agreement.commissionEligibilitySnapshot,
      productLines: order.productLines,
      orderAmountMinor: amountMinor,
      shippingAmountMinor: order.shippingAmountMinor,
    });
    const commissionableAmountMinor = BigInt(
      projection.commissionableAmountMinor,
    );
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        commissionEligibilityProjection:
          projection as unknown as Prisma.InputJsonValue,
        commissionableAmountMinor,
        returnedCommissionableAmountMinor: proportionalCommissionableRefund({
          orderAmountMinor: amountMinor,
          commissionableAmountMinor,
          returnedAmountMinor,
        }),
      },
    });
  }

  private async decideAttribution(
    orderId: string,
    event: {
      id: string;
      brandId: string;
      occurredAt: Date;
      requestId: string;
      offerIdHint: string | null;
    },
    candidates: Candidate[],
  ) {
    const rule = await this.activeRuleSet(event.brandId, event.offerIdHint);
    const evidence = [];
    for (const candidate of candidates) {
      evidence.push(
        await this.prisma.attributionEvidence.create({
          data: {
            orderId,
            orderEventId: event.id,
            evidenceType: candidate.evidenceType,
            source: candidate.source,
            identifierHash: this.hash(candidate.identifier),
            clickSessionId: candidate.clickSessionId ?? null,
            clickId: candidate.clickId ?? null,
            affiliateRelationshipId: candidate.relationshipId,
            affiliateCommercialAgreementId: candidate.agreementId,
            creatorId: candidate.creatorId,
            offerId: candidate.offerId,
            observedAt: candidate.touchAt,
            validationStatus: candidate.valid
              ? Stage8EvidenceValidationStatus.VALID
              : Stage8EvidenceValidationStatus.INVALID,
            reasonCode: candidate.reasonCode,
          },
        }),
      );
    }
    const valid = candidates.filter((candidate) => candidate.valid);
    const agreementIds = new Set(
      valid.map((candidate) => candidate.agreementId),
    );
    const creatorIds = new Set(valid.map((candidate) => candidate.creatorId));
    let status: Stage8AttributionStatus;
    let confidence: Stage8ConfidenceLevel;
    let score: number;
    let selected: Candidate | undefined;
    let reasonCodes: string[];
    if (valid.length === 0) {
      status = Stage8AttributionStatus.UNATTRIBUTED;
      confidence = Stage8ConfidenceLevel.NONE;
      score = 0;
      reasonCodes = candidates.length
        ? [...new Set(candidates.map((candidate) => candidate.reasonCode))]
        : ["NO_ATTRIBUTION_EVIDENCE"];
    } else if (agreementIds.size > 1 || creatorIds.size > 1) {
      status = Stage8AttributionStatus.REVIEW_REQUIRED;
      confidence = Stage8ConfidenceLevel.CONFLICT;
      score = 0;
      reasonCodes = ["CROSS_CREATOR_OR_AGREEMENT_CONFLICT"];
    } else {
      selected = [...valid].sort(
        (left, right) => right.touchAt.getTime() - left.touchAt.getTime(),
      )[0];
      status = Stage8AttributionStatus.AUTO_ATTRIBUTED;
      confidence =
        valid.length > 1
          ? Stage8ConfidenceLevel.VERIFIED
          : selected.source === Stage8OrderSource.WEBSITE_TRACKER
            ? Stage8ConfidenceLevel.HIGH
            : Stage8ConfidenceLevel.MEDIUM;
      score =
        confidence === Stage8ConfidenceLevel.VERIFIED
          ? 100
          : confidence === Stage8ConfidenceLevel.HIGH
            ? 90
            : 70;
      reasonCodes = [
        "LAST_ELIGIBLE_TOUCH",
        valid.length > 1 ? "CORROBORATED_EVIDENCE" : "UNIQUE_ELIGIBLE_EVIDENCE",
      ];
    }
    const previous = await this.prisma.attributionResult.findFirst({
      where: { orderId },
      orderBy: { decisionVersion: "desc" },
    });
    const version = (previous?.decisionVersion ?? 0) + 1;
    const result = await this.prisma.attributionResult.create({
      data: {
        orderId,
        decisionVersion: version,
        status,
        creatorId: selected?.creatorId ?? null,
        offerId: selected?.offerId ?? null,
        affiliateRelationshipId: selected?.relationshipId ?? null,
        affiliateCommercialAgreementId: selected?.agreementId ?? null,
        ruleSetId: rule.id,
        ruleSetVersion: rule.version,
        confidenceLevel: confidence,
        confidenceScore: score,
        reasonCodes,
        evidenceIds: evidence.map((item) => item.id),
        attributedAt: selected ? new Date() : null,
        decidedByType: this.flags.autoAttributionEnabled()
          ? "SYSTEM"
          : "SHADOW",
        decisionHash: this.hash({
          orderId,
          version,
          status,
          selectedAgreementId: selected?.agreementId ?? null,
          ruleSetId: rule.id,
          evidenceIds: evidence.map((item) => item.id),
        }),
        requestId: event.requestId,
      },
    });
    if (this.flags.autoAttributionEnabled()) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          currentAttributionResultId: result.id,
          affiliateRelationshipId: selected?.relationshipId ?? null,
          affiliateCommercialAgreementId: selected?.agreementId ?? null,
          offerId: selected?.offerId,
          attributionSource: selected
            ? this.legacyAttributionSource(selected)
            : AttributionSource.UNATTRIBUTED,
          attributionIdentifier: selected?.identifier ?? null,
          attributedAt: result.attributedAt,
          managerIdAtAttribution: selected?.managerIdAtAttribution ?? null,
          financialHandoffStatus: selected
            ? Stage8FinancialHandoffStatus.READY
            : Stage8FinancialHandoffStatus.NOT_READY,
        },
      });
    }
    await this.createTimeline(orderId, {
      orderEventId: event.id,
      attributionResultId: result.id,
      eventType: Stage8TimelineEventType.ATTRIBUTION_COMPLETED,
      eventKey: `stage8:attribution-result:${result.id}`,
      occurredAt: new Date(),
      summary: { status, confidence, reasonCodes },
    });
    if (
      status === Stage8AttributionStatus.REVIEW_REQUIRED ||
      status === Stage8AttributionStatus.UNATTRIBUTED
    ) {
      await this.openAttributionException(
        event.brandId,
        orderId,
        result.id,
        status === Stage8AttributionStatus.REVIEW_REQUIRED
          ? Stage8ExceptionType.CONFLICTING_ATTRIBUTION
          : Stage8ExceptionType.UNSUPPORTED_ATTRIBUTION,
        reasonCodes,
        event.requestId,
      );
    }
    return result;
  }

  private async resolveCandidates(event: {
    brandId: string;
    occurredAt: Date;
    attributionId: string | null;
    clickIdHint: string | null;
    creatorLinkCode: string | null;
    promoCode: string | null;
  }) {
    const candidates: Candidate[] = [];
    if (event.attributionId) {
      const session = await this.prisma.clickSession.findUnique({
        where: { publicAttributionId: event.attributionId },
        include: {
          affiliateRelationship: true,
          affiliateCommercialAgreement: true,
          offer: true,
        },
      });
      if (session && session.offer.brandId === event.brandId) {
        candidates.push(
          this.candidateFromRelationship({
            source: Stage8OrderSource.WEBSITE_TRACKER,
            evidenceType: Stage8EvidenceType.SIGNED_ATTRIBUTION_ID,
            identifier: event.attributionId,
            touchAt: session.lastSeenAt,
            relationship: session.affiliateRelationship,
            agreement: session.affiliateCommercialAgreement,
            expiresAt: session.expiresAt,
            clickSessionId: session.id,
            orderOccurredAt: event.occurredAt,
          }),
        );
      }
    }
    if (event.clickIdHint && /^[0-9a-f-]{36}$/i.test(event.clickIdHint)) {
      const click = await this.prisma.click.findUnique({
        where: { id: event.clickIdHint },
        include: {
          offer: true,
          affiliateRelationship: { include: { commercialAgreement: true } },
        },
      });
      if (click && click.offer.brandId === event.brandId) {
        candidates.push(
          this.candidateFromRelationship({
            source: Stage8OrderSource.CREATOR_LINK,
            evidenceType: Stage8EvidenceType.CLICK_ID,
            identifier: event.clickIdHint,
            touchAt: click.clickedAt,
            relationship: click.affiliateRelationship,
            agreement: click.affiliateRelationship.commercialAgreement,
            clickId: click.id,
            orderOccurredAt: event.occurredAt,
          }),
        );
      }
    }
    if (event.creatorLinkCode) {
      const link = await this.prisma.creatorLink.findUnique({
        where: { code: event.creatorLinkCode },
        include: {
          brand: true,
          affiliateRelationship: true,
          affiliateCommercialAgreement: true,
        },
      });
      const legacy = link
        ? null
        : await this.prisma.affiliateRelationship.findUnique({
            where: { affiliateCode: event.creatorLinkCode },
            include: { offer: true, commercialAgreement: true },
          });
      if (link?.brandId === event.brandId) {
        candidates.push(
          this.candidateFromRelationship({
            source: Stage8OrderSource.CREATOR_LINK,
            evidenceType: Stage8EvidenceType.CREATOR_LINK_CODE,
            identifier: event.creatorLinkCode,
            touchAt: event.occurredAt,
            relationship: link.affiliateRelationship,
            agreement: link.affiliateCommercialAgreement,
            expiresAt: link.activeUntil,
            orderOccurredAt: event.occurredAt,
          }),
        );
      } else if (legacy?.offer.brandId === event.brandId) {
        candidates.push(
          this.candidateFromRelationship({
            source: Stage8OrderSource.CREATOR_LINK,
            evidenceType: Stage8EvidenceType.CREATOR_LINK_CODE,
            identifier: event.creatorLinkCode,
            touchAt: event.occurredAt,
            relationship: legacy,
            agreement: legacy.commercialAgreement,
            orderOccurredAt: event.occurredAt,
          }),
        );
      }
    }
    if (event.promoCode) {
      const normalized = normalizeCreatorPromoCode(event.promoCode);
      const promo = await this.prisma.creatorPromoCode.findUnique({
        where: { normalizedCode: normalized },
        include: {
          affiliateRelationship: true,
          affiliateCommercialAgreement: true,
        },
      });
      const legacy = promo
        ? null
        : await this.prisma.affiliateRelationship.findFirst({
            where: { promoCode: normalized, offer: { brandId: event.brandId } },
            include: { commercialAgreement: true },
          });
      if (promo?.brandId === event.brandId) {
        const identifierActiveAtOrder =
          promo.activeFrom <= event.occurredAt &&
          (!promo.activeUntil || promo.activeUntil > event.occurredAt);
        candidates.push(
          this.candidateFromRelationship({
            source: Stage8OrderSource.CREATOR_PROMO_CODE,
            evidenceType: Stage8EvidenceType.PROMO_CODE,
            identifier: normalized,
            touchAt: event.occurredAt,
            relationship: promo.affiliateRelationship,
            agreement: promo.affiliateCommercialAgreement,
            identifierActiveAtOrder,
            inactiveIdentifierReason: "PROMO_CODE_INACTIVE_AT_ORDER_TIME",
            orderOccurredAt: event.occurredAt,
          }),
        );
      } else if (legacy) {
        candidates.push(
          this.candidateFromRelationship({
            source: Stage8OrderSource.CREATOR_PROMO_CODE,
            evidenceType: Stage8EvidenceType.PROMO_CODE,
            identifier: normalized,
            touchAt: event.occurredAt,
            relationship: legacy,
            agreement: legacy.commercialAgreement,
            orderOccurredAt: event.occurredAt,
          }),
        );
      }
    }
    return candidates;
  }

  private candidateFromRelationship(input: {
    source: Stage8OrderSource;
    evidenceType: Stage8EvidenceType;
    identifier: string;
    touchAt: Date;
    relationship: {
      id: string;
      offerId: string;
      creatorId: string;
      currentManagerId: string | null;
      status: AffiliateRelationshipStatus;
      activatedAt: Date;
      pausedAt: Date | null;
      revokedAt: Date | null;
    };
    agreement: {
      id: string;
      attributionWindowSnapshot: Prisma.JsonValue;
    } | null;
    orderOccurredAt: Date;
    expiresAt?: Date | null;
    identifierActiveAtOrder?: boolean;
    inactiveIdentifierReason?: string;
    clickSessionId?: string;
    clickId?: string;
  }): Candidate {
    const windowDays = Math.min(
      30,
      this.windowDays(input.agreement?.attributionWindowSnapshot),
    );
    const windowExpiresAt = new Date(
      input.touchAt.getTime() + windowDays * 86_400_000,
    );
    const validUntil =
      input.expiresAt && input.expiresAt < windowExpiresAt
        ? input.expiresAt
        : windowExpiresAt;
    const activeAtOrder =
      input.relationship.activatedAt <= input.orderOccurredAt &&
      (!input.relationship.pausedAt ||
        input.relationship.pausedAt > input.orderOccurredAt) &&
      (!input.relationship.revokedAt ||
        input.relationship.revokedAt > input.orderOccurredAt);
    const withinWindow = input.orderOccurredAt <= validUntil;
    const identifierActiveAtOrder = input.identifierActiveAtOrder ?? true;
    const valid =
      Boolean(input.agreement) &&
      activeAtOrder &&
      withinWindow &&
      identifierActiveAtOrder;
    return {
      source: input.source,
      evidenceType: input.evidenceType,
      identifier: input.identifier,
      touchAt: input.touchAt,
      clickSessionId: input.clickSessionId,
      clickId: input.clickId,
      relationshipId: input.relationship.id,
      agreementId: input.agreement?.id ?? null,
      creatorId: input.relationship.creatorId,
      offerId: input.relationship.offerId,
      managerIdAtAttribution: input.relationship.currentManagerId,
      valid,
      reasonCode: !input.agreement
        ? "NO_ACTIVE_COMMERCIAL_AGREEMENT"
        : !activeAtOrder
          ? "RELATIONSHIP_INACTIVE_AT_ORDER_TIME"
          : !identifierActiveAtOrder
            ? (input.inactiveIdentifierReason ??
              "ATTRIBUTION_IDENTIFIER_INACTIVE_AT_ORDER_TIME")
            : !withinWindow
              ? "OUTSIDE_30_DAY_ATTRIBUTION_WINDOW"
              : "ELIGIBLE",
    };
  }

  private async recordPromoCodeUse(event: {
    brandId: string;
    promoCode: string | null;
    occurredAt: Date;
    receivedAt: Date;
  }) {
    if (!event.promoCode) return;
    const normalizedCode = normalizeCreatorPromoCode(event.promoCode);
    const promo = await this.prisma.creatorPromoCode.findUnique({
      where: { normalizedCode },
    });
    if (!promo || promo.brandId !== event.brandId) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.creatorPromoCode.updateMany({
        where: { id: promo.id, firstUsedAt: null },
        data: {
          firstUsedAt: event.occurredAt,
          verifiedAt: promo.verifiedAt ?? event.receivedAt,
          ...(promo.status === CreatorPromoCodeStatus.PENDING_PROVISIONING ||
          promo.status === CreatorPromoCodeStatus.PROVISIONING_CONFIRMED
            ? { status: CreatorPromoCodeStatus.ACTIVE }
            : {}),
        },
      });
      await tx.creatorPromoCode.update({
        where: { id: promo.id },
        data: { lastUsedAt: event.occurredAt },
      });
    });
  }

  private async enqueueFinancialHandoff(
    orderId: string,
    orderEventId: string,
    attributionResultId: string,
  ) {
    if (
      !this.flags.autoAttributionEnabled() ||
      !this.flags.financeHandoffEnabled()
    ) {
      return;
    }
    const event = await this.prisma.stage8OrderEvent.findUniqueOrThrow({
      where: { id: orderEventId },
    });
    if (event.eventType === Stage8OrderEventType.ORDER_CREATED) {
      return;
    }
    const eventKey = `stage8:finance:${orderEventId}`;
    await this.prisma.$transaction([
      this.prisma.stage8OutboxEvent.upsert({
        where: { eventKey },
        update: {},
        create: {
          eventKey,
          eventType: event.eventType,
          aggregateType: "Order",
          aggregateId: orderId,
          payload: { orderId, orderEventId, attributionResultId },
          requestId: event.requestId,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          financialHandoffStatus: Stage8FinancialHandoffStatus.ENQUEUED,
        },
      }),
    ]);
  }

  private async activeRuleSet(brandId: string, offerId: string | null) {
    const existing = await this.prisma.attributionRuleSet.findFirst({
      where: {
        status: Stage8IntegrationStatus.ACTIVE,
        OR: [
          ...(offerId ? [{ brandId, offerId }] : []),
          { brandId, offerId: null },
        ],
        effectiveFrom: { lte: new Date() },
        AND: [
          {
            OR: [
              { effectiveUntil: null },
              { effectiveUntil: { gt: new Date() } },
            ],
          },
        ],
      },
      orderBy: [{ offerId: "desc" }, { version: "desc" }],
    });
    if (existing) return existing;
    const brand = await this.prisma.brandProfile.findUniqueOrThrow({
      where: { id: brandId },
    });
    return this.prisma.$transaction((tx) =>
      this.ensureDefaultRuleSet(tx, brandId, brand.userId),
    );
  }

  private async ensureDefaultRuleSet(
    tx: Prisma.TransactionClient,
    brandId: string,
    actorUserId: string,
  ) {
    const rules = {
      attributionWindowDays: 30,
      attributionModel: "LAST_ELIGIBLE_TOUCH",
      cookieTtlDays: 30,
      crossCreatorConflictPolicy: "REVIEW_REQUIRED",
      webhookTimestampToleranceSeconds: 300,
      webhookRetryHours: 72,
      exceptionSlaBusinessDays: 3,
      csvFallbackSchedule: [
        { weekday: "TUESDAY", localTime: "18:00" },
        { weekday: "FRIDAY", localTime: "18:00" },
      ],
      chargebackPolicy: "DISPUTE_THEN_FINAL_REVERSAL",
      trackingRetentionMonths: 13,
      orderPayloadRetentionMonths: 24,
    };
    const contentHash = this.hash(rules);
    const existing = await tx.attributionRuleSet.findFirst({
      where: { brandId, offerId: null, contentHash },
    });
    if (existing) return existing;
    return tx.attributionRuleSet.create({
      data: {
        brandId,
        offerId: null,
        version: 1,
        sourcePriority: [
          Stage8OrderSource.CREATOR_LINK,
          Stage8OrderSource.CREATOR_PROMO_CODE,
          Stage8OrderSource.WEBSITE_TRACKER,
          Stage8OrderSource.CSV_IMPORT,
        ],
        attributionWindowDays: 30,
        attributionModel: "LAST_ELIGIBLE_TOUCH",
        crossCreatorConflictPolicy: "REVIEW_REQUIRED",
        cookieTtlDays: 30,
        rules,
        contentHash,
        createdByUserId: actorUserId,
      },
    });
  }

  private async openAttributionException(
    brandId: string,
    orderId: string | null,
    attributionResultId: string | null,
    type: Stage8ExceptionType,
    reasonCodes: string[],
    requestId: string,
  ) {
    const exception = await this.prisma.attributionException.create({
      data: {
        brandId,
        orderId,
        attributionResultId,
        type,
        severity:
          type === Stage8ExceptionType.CONFLICTING_ATTRIBUTION
            ? "HIGH"
            : "MEDIUM",
        reasonCodes,
        dueAt: this.addBusinessDays(new Date(), 3),
        requestId,
      },
    });
    if (orderId) {
      await this.createTimeline(orderId, {
        attributionResultId: attributionResultId ?? undefined,
        exceptionId: exception.id,
        eventType: Stage8TimelineEventType.EXCEPTION_OPENED,
        eventKey: `stage8:exception:${exception.id}:opened`,
        occurredAt: exception.createdAt,
        summary: { type, reasonCodes, dueAt: exception.dueAt },
      });
    }
    return exception;
  }

  private async createUnsupportedException(
    event: { brandId: string; requestId: string; id: string },
    reasonCodes: string[],
  ) {
    await this.openAttributionException(
      event.brandId,
      null,
      null,
      Stage8ExceptionType.UNSUPPORTED_ATTRIBUTION,
      reasonCodes,
      event.requestId,
    );
  }

  private async createEventConflictException(
    event: {
      brandId: string;
      orderId: string | null;
      requestId: string;
      id: string;
      payloadHash: string;
    },
    incomingPayloadHash: string,
  ) {
    return this.openAttributionException(
      event.brandId,
      event.orderId,
      null,
      Stage8ExceptionType.EVENT_CONFLICT,
      ["SAME_EVENT_ID_DIFFERENT_PAYLOAD"],
      event.requestId,
    ).then(async (exception) => {
      await this.prisma.attributionException.update({
        where: { id: exception.id },
        data: {
          details: {
            orderEventId: event.id,
            storedPayloadHash: event.payloadHash,
            incomingPayloadHash,
          },
        },
      });
    });
  }

  private createTimeline(
    orderId: string,
    input: {
      orderEventId?: string;
      attributionResultId?: string;
      exceptionId?: string;
      eventType: Stage8TimelineEventType;
      eventKey: string;
      occurredAt: Date;
      summary: Prisma.InputJsonValue;
    },
  ) {
    return this.prisma.orderTimelineEvent.upsert({
      where: { eventKey: input.eventKey },
      update: {},
      create: {
        orderId,
        orderEventId: input.orderEventId,
        attributionResultId: input.attributionResultId,
        exceptionId: input.exceptionId,
        eventType: input.eventType,
        eventKey: input.eventKey,
        occurredAt: input.occurredAt,
        summary: input.summary,
      },
    });
  }

  private markEventProcessed(eventId: string) {
    return this.prisma.stage8OrderEvent.update({
      where: { id: eventId },
      data: {
        processingStatus: Stage8EventProcessingStatus.PROCESSED,
        processedAt: new Date(),
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  private legacyAttributionSource(candidate: Candidate) {
    if (candidate.evidenceType === Stage8EvidenceType.PROMO_CODE) {
      return AttributionSource.PROMO_CODE;
    }
    if (candidate.evidenceType === Stage8EvidenceType.CLICK_ID) {
      return AttributionSource.CLICK_ID;
    }
    if (
      candidate.evidenceType === Stage8EvidenceType.SIGNED_ATTRIBUTION_ID ||
      candidate.evidenceType === Stage8EvidenceType.TRACKER_SESSION
    ) {
      return AttributionSource.WEBSITE_TRACKER;
    }
    return AttributionSource.AFFILIATE_CODE;
  }

  private windowDays(value: Prisma.JsonValue | undefined) {
    if (value && !Array.isArray(value) && typeof value === "object") {
      const days = Number((value as Record<string, unknown>).windowDays);
      if (Number.isInteger(days) && days > 0) return days;
    }
    return 30;
  }

  private addBusinessDays(date: Date, days: number) {
    const result = new Date(date);
    let remaining = days;
    while (remaining > 0) {
      result.setUTCDate(result.getUTCDate() + 1);
      const weekday = result.getUTCDay();
      if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }
    return result;
  }

  private legacyMoney(value: bigint) {
    if (value < 0n || value > 2_147_483_647n) {
      throw new BadRequestException("Order amount exceeds pilot limit");
    }
    return Number(value);
  }

  private normalizePromo(value: string) {
    return normalizeCreatorPromoCode(value);
  }

  private normalizeOrigin = (value: string) => {
    try {
      return new URL(value).origin.toLowerCase();
    } catch {
      throw new BadRequestException("Invalid origin");
    }
  };

  private hash(value: unknown) {
    return createHash("sha256")
      .update(this.stableStringify(value))
      .digest("hex");
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, nested]) =>
            `${JSON.stringify(key)}:${this.stableStringify(nested)}`,
        )
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private singleCurrency(currencies: string[]) {
    const unique = [...new Set(currencies)];
    return unique.length === 1
      ? unique[0]
      : unique.length === 0
        ? null
        : "MULTI";
  }

  private async getBrand(userId: string, activeBrandId?: string) {
    return this.brands.resolveBrand(userId, activeBrandId);
  }

  private async ownedInstallation(userId: string, installationId: string) {
    const brand = await this.getBrand(userId);
    const installation = await this.prisma.trackerInstallation.findFirst({
      where: { id: installationId, brandId: brand.id },
    });
    if (!installation)
      throw new NotFoundException("Tracker installation not found");
    return installation;
  }
}
