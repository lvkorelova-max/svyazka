import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  OrderStatus,
  Prisma,
  Stage8EventProcessingStatus,
  Stage8OrderEventType,
  Stage8OrderSource,
  TildaConnectionStatus,
  TildaPaymentProbeStatus,
} from "@prisma/client";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { AuditService } from "../audit/audit.service";
import { normalizeCreatorPromoCode } from "../common/promo-code";
import { PrismaService } from "../prisma/prisma.service";
import { AttributionService } from "./attribution.service";
import { CloudPaymentsClient } from "./cloudpayments-client.service";
import { CreateTildaIntegrationDto } from "./dto/create-tilda-integration.dto";
import { IntegrationSecretService } from "./integration-secret.service";
import { Stage8FlagsService } from "./stage8-flags.service";

type TildaPayload = Record<string, unknown>;
const TILDA_MONETARY_KEY = /amount|sum|total|price|cost|delivery|shipping|currency/i;
const TILDA_PII_KEY =
  /address|city|comment|customer|description|email|name|phone|postal|recipient|street|zip/i;
const CURRENCY_VALUE = /^(?:RUB|RUR|USD|EUR|₽)$/i;
const QUALIFIED_MONEY =
  /(?:\b(?:RUB|RUR|USD|EUR)\s*[+-]?\d+(?:[.,]\d{2})\b)|(?:\b[+-]?\d+(?:[.,]\d{2})\s*(?:RUB|RUR|USD|EUR)\b)|(?:[+-]?\d+(?:[.,]\d{2})\s*₽)/gi;

@Injectable()
export class TildaIntegrationService {
  private readonly logger = new Logger(TildaIntegrationService.name);
  private monetaryDiagnosticCaptured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly attribution: AttributionService,
    private readonly cloudPayments: CloudPaymentsClient,
    private readonly secrets: IntegrationSecretService,
    private readonly flags: Stage8FlagsService,
  ) {}

  async createOrReplace(userId: string, dto: CreateTildaIntegrationDto) {
    const brand = await this.getBrand(userId);
    const webhookKey = `svz_tilda_${randomBytes(24).toString("base64url")}`;
    await this.cloudPayments.verifyCredentials(
      dto.cloudPaymentsPublicId.trim(),
      dto.cloudPaymentsApiSecret,
    );
    const result = await this.prisma.$transaction(async (tx) => {
      const installation = await tx.trackerInstallation.upsert({
        where: {
          brandId_primaryDomain: {
            brandId: brand.id,
            primaryDomain: dto.domain.toLowerCase(),
          },
        },
        update: {
          name: `Tilda ${dto.domain.toLowerCase()}`,
          allowedOrigins: [`https://${dto.domain.toLowerCase()}`],
          status: "PENDING",
          healthStatus: "AWAITING_TILDA_WEBHOOK",
        },
        create: {
          brandId: brand.id,
          publicKey: `svz_pub_${randomBytes(18).toString("base64url")}`,
          name: `Tilda ${dto.domain.toLowerCase()}`,
          primaryDomain: dto.domain.toLowerCase(),
          allowedOrigins: [`https://${dto.domain.toLowerCase()}`],
          consentMode: "REQUIRED",
          cookieTtlDays: 30,
          createdByUserId: userId,
          status: "PENDING",
          healthStatus: "AWAITING_TILDA_WEBHOOK",
        },
      });
      const integration = await tx.tildaIntegration.upsert({
        where: { brandId: brand.id },
        update: {
          trackerInstallationId: installation.id,
          status: TildaConnectionStatus.WAITING_FOR_WEBHOOK,
          encryptedWebhookKey: this.secrets.encrypt(webhookKey),
          cloudPaymentsPublicId: dto.cloudPaymentsPublicId.trim(),
          encryptedCloudPaymentsApiSecret: this.secrets.encrypt(
            dto.cloudPaymentsApiSecret,
          ),
          lastErrorCode: null,
          lastErrorAt: null,
        },
        create: {
          brandId: brand.id,
          trackerInstallationId: installation.id,
          status: TildaConnectionStatus.WAITING_FOR_WEBHOOK,
          encryptedWebhookKey: this.secrets.encrypt(webhookKey),
          cloudPaymentsPublicId: dto.cloudPaymentsPublicId.trim(),
          encryptedCloudPaymentsApiSecret: this.secrets.encrypt(
            dto.cloudPaymentsApiSecret,
          ),
          createdByUserId: userId,
        },
        include: { trackerInstallation: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "STAGE8_TILDA_INTEGRATION_CONFIGURED",
          entityType: "TildaIntegration",
          entityId: integration.id,
          requestId: this.audit.requestId(),
          metadata: {
            domain: installation.primaryDomain,
            provider: "CLOUDPAYMENTS",
          },
        },
      });
      return integration;
    });
    return this.present(result, webhookKey);
  }

  async getForBrand(userId: string) {
    const brand = await this.getBrand(userId);
    const integration = await this.prisma.tildaIntegration.findUnique({
      where: { brandId: brand.id },
      include: { trackerInstallation: true },
    });
    if (!integration) return null;
    return this.present(
      integration,
      this.secrets.decrypt(integration.encryptedWebhookKey),
    );
  }

  async checkConnection(userId: string) {
    const integration = await this.ownedIntegration(userId);
    let providerOk = false;
    let refundWebhookOk = false;
    let providerErrorCode: string | null = null;
    try {
      const apiSecret = this.secrets.decrypt(
        integration.encryptedCloudPaymentsApiSecret,
      );
      await this.cloudPayments.verifyCredentials(
        integration.cloudPaymentsPublicId,
        apiSecret,
      );
      providerOk = true;
      const refundSettings = await this.cloudPayments.getNotificationSettings(
        integration.cloudPaymentsPublicId,
        apiSecret,
        "refund",
      );
      refundWebhookOk =
        refundSettings.Success === true &&
        refundSettings.Model?.IsEnabled === true &&
        refundSettings.Model.HttpMethod?.toUpperCase() === "POST" &&
        this.sameUrl(
          refundSettings.Model.Address ?? "",
          this.cloudPaymentsRefundUrl(integration.id),
        );
    } catch (error) {
      providerOk = false;
      providerErrorCode =
        error instanceof UnauthorizedException
          ? "CLOUDPAYMENTS_CREDENTIALS_INVALID"
          : "CLOUDPAYMENTS_UNAVAILABLE";
    }
    const webhookOk = Boolean(integration.lastWebhookTestAt);
    const active = providerOk && webhookOk && refundWebhookOk;
    const lastErrorCode = active
      ? null
      : providerErrorCode
        ? providerErrorCode
        : !webhookOk
          ? "TILDA_WEBHOOK_NOT_RECEIVED"
          : "REFUND_WEBHOOK_NOT_CONFIGURED";
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.tildaIntegration.update({
        where: { id: integration.id },
        data: {
          status: active
            ? TildaConnectionStatus.ACTIVE
            : providerOk
              ? TildaConnectionStatus.WAITING_FOR_WEBHOOK
              : TildaConnectionStatus.ERROR,
          lastErrorCode,
          lastErrorAt: active ? null : new Date(),
        },
        include: { trackerInstallation: true },
      });
      if (active) {
        await tx.trackerInstallation.update({
          where: { id: integration.trackerInstallationId },
          data: {
            status: "ACTIVE",
            healthStatus: "TILDA_CONNECTED",
            activatedAt:
              integration.trackerInstallation.activatedAt ?? new Date(),
          },
        });
      }
      return saved;
    });
    return this.present(
      updated,
      this.secrets.decrypt(updated.encryptedWebhookKey),
    );
  }

  async receiveWebhook(
    integrationId: string,
    providedKey: string,
    payload: TildaPayload,
  ) {
    if (!this.flags.tildaEnabled()) {
      throw new ServiceUnavailableException("Интеграция Tilda пока выключена");
    }
    const integration = await this.prisma.tildaIntegration.findUnique({
      where: { id: integrationId },
      include: { trackerInstallation: true },
    });
    if (!integration)
      throw new NotFoundException("Интеграция Tilda не найдена");
    this.verifyWebhookKey(
      this.secrets.decrypt(integration.encryptedWebhookKey),
      providedKey,
    );
    const now = new Date();
    if (String(payload.test ?? "").toLowerCase() === "test") {
      await this.prisma.$transaction([
        this.prisma.tildaIntegration.update({
          where: { id: integration.id },
          data: {
            lastWebhookAt: now,
            lastWebhookTestAt: now,
            status: TildaConnectionStatus.CHECKING_PAYMENT_PROVIDER,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        }),
        this.prisma.trackerInstallation.update({
          where: { id: integration.trackerInstallationId },
          data: {
            lastWebhookAt: now,
            healthStatus: "TILDA_WEBHOOK_RECEIVED",
          },
        }),
      ]);
      return { ok: true };
    }
    this.captureMonetaryDiagnostic(integration.id, payload);
    if (!this.flags.ingestionEnabled()) {
      throw new ServiceUnavailableException(
        "Автоматическая передача заказов пока выключена",
      );
    }

    const tildaReferer = this.first(payload, [
      "tildaspec-referer",
      "tildaspec_referer",
      "referer",
    ]);
    if (
      tildaReferer &&
      !this.sameDomain(
        tildaReferer,
        integration.trackerInstallation.primaryDomain,
      )
    ) {
      await this.setError(integration.id, "TILDA_DOMAIN_MISMATCH");
      throw new ConflictException(
        "Webhook пришёл с другого домена. Проверьте подключённый сайт Tilda.",
      );
    }
    const externalOrderId = this.first(payload, [
      "payment[orderid]",
      "payment.orderid",
      "orderid",
      "OrderId",
      "invoiceId",
      "InvoiceId",
      "tranid",
    ]);
    if (!externalOrderId) {
      await this.setError(integration.id, "TILDA_ORDER_ID_MISSING");
      throw new ConflictException(
        "Tilda не передала номер заказа. Проверьте настройки корзины.",
      );
    }
    if (externalOrderId.length > 160) {
      await this.setError(integration.id, "TILDA_ORDER_ID_INVALID");
      throw new ConflictException(
        "Номер заказа слишком длинный. Проверьте формат номера заказа в Tilda.",
      );
    }
    const amountMinor = this.moneyMinor(
      this.first(payload, [
        "payment[amount]",
        "payment.amount",
        "amount",
        "Amount",
        "payment[sum]",
      ]),
    );
    if (amountMinor === null) {
      await this.setError(integration.id, "TILDA_AMOUNT_MISSING");
      throw new ConflictException(
        "Tilda не передала сумму заказа. Включите передачу данных корзины.",
      );
    }
    const shippingAmountMinor = this.deliveryMoneyMinor(payload);
    if (shippingAmountMinor > amountMinor) {
      throw new ConflictException("Стоимость доставки превышает сумму заказа.");
    }
    const currency = (
      this.first(payload, [
        "payment[currency]",
        "payment.currency",
        "currency",
        "Currency",
      ]) ?? "RUB"
    ).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      await this.setError(integration.id, "TILDA_CURRENCY_INVALID");
      throw new ConflictException(
        "Tilda передала некорректную валюту заказа. Проверьте настройки магазина.",
      );
    }
    const attributionId =
      this.first(payload, ["svz_a", "attributionId"]) ??
      this.cookieValue(this.first(payload, ["COOKIES", "cookies"]), "_svz_at");
    const creatorLinkCode = this.first(payload, [
      "affiliate_code",
      "affiliateCode",
    ]);
    const rawPromoCode = this.first(payload, [
      "promocode",
      "promoCode",
      "payment[promocode]",
    ]);
    const promoCode = rawPromoCode
      ? normalizeCreatorPromoCode(rawPromoCode)
      : null;
    const eventKey = `tilda:${integration.id}:${externalOrderId}:created`;
    const sanitizedPayload = {
      source: "TILDA",
      externalOrderId,
      amountMinor: amountMinor?.toString() ?? null,
      shippingAmountMinor: shippingAmountMinor.toString(),
      currency,
      attributionId: attributionId ? this.hash(attributionId) : null,
      creatorLinkCode: creatorLinkCode ? this.hash(creatorLinkCode) : null,
      promoCode: promoCode ? this.hash(promoCode) : null,
    };
    const event = await this.prisma.stage8OrderEvent.upsert({
      where: {
        brandId_sourceNamespace_externalEventId: {
          brandId: integration.brandId,
          sourceNamespace: `TILDA:${integration.id}`,
          externalEventId: eventKey,
        },
      },
      update: {},
      create: {
        brandId: integration.brandId,
        trackerInstallationId: integration.trackerInstallationId,
        source: Stage8OrderSource.TILDA,
        sourceNamespace: `TILDA:${integration.id}`,
        externalEventId: eventKey,
        externalOrderId,
        canonicalOrderKey: externalOrderId,
        eventType: Stage8OrderEventType.ORDER_CREATED,
        occurredAt: now,
        orderCreatedAt: now,
        amountMinor,
        shippingAmountMinor,
        currency,
        attributionId,
        creatorLinkCode,
        promoCode,
        schemaVersion: "1.0",
        payload: sanitizedPayload,
        payloadHash: this.hash(sanitizedPayload),
        authenticationContext: {
          source: "TILDA_WEBHOOK",
          authenticated: true,
        },
        requestId: this.audit.requestId(),
        processingStatus: Stage8EventProcessingStatus.ACCEPTED,
      },
    });
    await this.prisma.$transaction([
      this.prisma.tildaPaymentProbe.upsert({
        where: {
          integrationId_externalOrderId: {
            integrationId: integration.id,
            externalOrderId,
          },
        },
        update: {},
        create: {
          integrationId: integration.id,
          orderEventId: event.id,
          externalOrderId,
          amountMinor,
          currency,
          nextAttemptAt: now,
          expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
        },
      }),
      this.prisma.tildaIntegration.update({
        where: { id: integration.id },
        data: {
          lastWebhookAt: now,
          lastOrderReceivedAt: now,
          lastErrorCode: null,
          lastErrorAt: null,
        },
      }),
      this.prisma.trackerInstallation.update({
        where: { id: integration.trackerInstallationId },
        data: {
          lastWebhookAt: now,
          healthStatus: "TILDA_ORDER_RECEIVED",
        },
      }),
    ]);
    await this.enrichPendingShipping({
      eventId: event.id,
      externalOrderId,
      amountMinor,
      shippingAmountMinor,
      currency,
      payload: sanitizedPayload,
    });
    await this.attribution.processOrderEvent(event.id);
    return { ok: true };
  }

  private async enrichPendingShipping(input: {
    eventId: string;
    externalOrderId: string;
    amountMinor: bigint;
    shippingAmountMinor: bigint;
    currency: string;
    payload: Record<string, unknown>;
  }) {
    if (input.shippingAmountMinor <= 0n || this.flags.financeHandoffEnabled()) {
      return;
    }
    await this.prisma.$transaction(
      async (tx) => {
        const event = await tx.stage8OrderEvent.findUnique({
          where: { id: input.eventId },
          include: { order: true, tildaPaymentProbe: true },
        });
        if (
          !event ||
          (event.shippingAmountMinor ?? 0n) > 0n ||
          event.externalOrderId !== input.externalOrderId ||
          event.amountMinor !== input.amountMinor ||
          event.currency !== input.currency ||
          event.tildaPaymentProbe?.status !== TildaPaymentProbeStatus.PENDING ||
          event.tildaPaymentProbe.amountMinor !== input.amountMinor ||
          event.tildaPaymentProbe.currency !== input.currency ||
          (event.order &&
            (event.order.status !== OrderStatus.PENDING ||
              event.order.amountMinor !== input.amountMinor ||
              event.order.currency !== input.currency ||
              event.order.shippingAmountMinor > 0n ||
              event.order.commissionEligibilityProjection !== null ||
              event.order.commissionableAmountMinor !== null))
        ) {
          return;
        }
        const [
          paidEvents,
          commissions,
          ledgerEntries,
          ledgerTransactions,
          statementLines,
          outbox,
        ] = await Promise.all([
          tx.stage8OrderEvent.count({
            where: {
              brandId: event.brandId,
              sourceNamespace: event.sourceNamespace,
              externalOrderId: event.externalOrderId,
              eventType: Stage8OrderEventType.PAYMENT_SUCCEEDED,
            },
          }),
          event.order
            ? tx.commission.count({ where: { orderId: event.order.id } })
            : 0,
          event.order
            ? tx.ledgerEntry.count({ where: { orderId: event.order.id } })
            : 0,
          event.order
            ? tx.ledgerTransaction.count({
                where: { orderId: event.order.id },
              })
            : 0,
          event.order
            ? tx.brandStatementLine.count({
                where: { orderId: event.order.id },
              })
            : 0,
          event.order
            ? tx.stage8OutboxEvent.count({
                where: {
                  aggregateType: "Order",
                  aggregateId: event.order.id,
                },
              })
            : 0,
        ]);
        if (
          paidEvents +
            commissions +
            ledgerEntries +
            ledgerTransactions +
            statementLines +
            outbox >
          0
        ) {
          return;
        }
        const enrichedPayload = {
          ...input.payload,
          shippingAmountMinor: input.shippingAmountMinor.toString(),
        };
        const updated = await tx.stage8OrderEvent.updateMany({
          where: {
            id: event.id,
            OR: [{ shippingAmountMinor: null }, { shippingAmountMinor: 0n }],
          },
          data: {
            shippingAmountMinor: input.shippingAmountMinor,
            payload: enrichedPayload,
            payloadHash: this.hash(enrichedPayload),
          },
        });
        if (updated.count !== 1 || !event.order) return;
        const updatedOrder = await tx.order.updateMany({
          where: {
            id: event.order.id,
            status: OrderStatus.PENDING,
            shippingAmountMinor: 0n,
            amountMinor: input.amountMinor,
            currency: input.currency,
            commissionableAmountMinor: null,
          },
          data: { shippingAmountMinor: input.shippingAmountMinor },
        });
        if (updatedOrder.count !== 1) {
          throw new ConflictException(
            "Pending Tilda shipping enrichment lost its compare-and-set",
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async receiveCloudPaymentsRefund(
    integrationId: string,
    input: {
      contentHmac: string;
      decodedContentHmac: string;
      rawBody: Buffer;
      payload: TildaPayload;
    },
  ) {
    if (!this.flags.tildaEnabled() || !this.flags.ingestionEnabled()) {
      throw new ServiceUnavailableException(
        "Автоматическая передача возвратов пока выключена",
      );
    }
    const integration = await this.prisma.tildaIntegration.findUnique({
      where: { id: integrationId },
      include: { trackerInstallation: true },
    });
    if (!integration) {
      throw new NotFoundException("Интеграция Tilda не найдена");
    }
    const apiSecret = this.secrets.decrypt(
      integration.encryptedCloudPaymentsApiSecret,
    );
    this.verifyCloudPaymentsHmac(apiSecret, input);

    const operationType = this.first(input.payload, ["OperationType"]);
    if (operationType?.toLowerCase() !== "refund") {
      throw new BadRequestException(
        "CloudPayments передал неподдерживаемый тип операции",
      );
    }
    const refundTransactionId = this.first(input.payload, ["TransactionId"]);
    const paymentTransactionId = this.first(input.payload, [
      "PaymentTransactionId",
    ]);
    if (!refundTransactionId || !paymentTransactionId) {
      throw new BadRequestException(
        "CloudPayments не передал идентификаторы возврата",
      );
    }
    if (refundTransactionId.length > 160 || paymentTransactionId.length > 160) {
      throw new BadRequestException(
        "CloudPayments передал некорректный идентификатор операции",
      );
    }
    const refundAmountMinor = this.moneyMinor(
      this.first(input.payload, ["Amount"]),
    );
    if (refundAmountMinor === null || refundAmountMinor <= 0n) {
      throw new BadRequestException(
        "CloudPayments передал некорректную сумму возврата",
      );
    }
    const invoiceId = this.first(input.payload, ["InvoiceId"]);
    const probe = await this.prisma.tildaPaymentProbe.findFirst({
      where: {
        integrationId: integration.id,
        transactionId: paymentTransactionId,
        status: TildaPaymentProbeStatus.PAID,
      },
      include: {
        orderEvent: {
          include: {
            order: true,
          },
        },
      },
    });
    const order = probe?.orderEvent.order;
    if (
      !probe ||
      !order ||
      (invoiceId && invoiceId !== probe.externalOrderId)
    ) {
      await this.setError(integration.id, "REFUND_ORDER_NOT_FOUND");
      throw new ConflictException(
        "Не удалось связать возврат с оплаченным заказом",
      );
    }
    if (order.currency.length !== 3) {
      throw new ConflictException("Валюта заказа не поддерживается");
    }
    const externalEventId = `cloudpayments:refund:${refundTransactionId}`;
    const payload = {
      source: "CLOUDPAYMENTS",
      operationType: "Refund",
      refundTransactionId,
      paymentTransactionId,
      externalOrderId: probe.externalOrderId,
      refundAmountMinor: refundAmountMinor.toString(),
      currency: order.currency,
    };
    const payloadHash = this.hash(payload);
    const existing = await this.prisma.stage8OrderEvent.findUnique({
      where: {
        brandId_sourceNamespace_externalEventId: {
          brandId: integration.brandId,
          sourceNamespace: `TILDA:${integration.id}`,
          externalEventId,
        },
      },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        await this.attribution.openIntegrationException({
          brandId: integration.brandId,
          orderId: order.id,
          reasonCodes: ["SAME_REFUND_ID_DIFFERENT_PAYLOAD"],
          requestId: existing.requestId,
        });
        throw new ConflictException(
          "Идентификатор возврата уже использован с другими данными",
        );
      }
      await this.attribution.processOrderEvent(existing.id);
      return { code: 0 };
    }
    const orderAmountMinor = order.amountMinor ?? BigInt(order.amountKopecks);
    const returnedAmountMinor =
      order.returnedAmountMinor ?? BigInt(order.returnedAmountKopecks);
    const nextReturnedAmountMinor = returnedAmountMinor + refundAmountMinor;
    if (nextReturnedAmountMinor > orderAmountMinor) {
      await this.attribution.openIntegrationException({
        brandId: integration.brandId,
        orderId: order.id,
        reasonCodes: ["REFUND_EXCEEDS_ORDER_AMOUNT"],
        requestId: this.audit.requestId(),
      });
      await this.setError(integration.id, "REFUND_AMOUNT_EXCEEDS_ORDER");
      throw new ConflictException(
        "Сумма возврата превышает сумму оплаченного заказа",
      );
    }
    const eventType =
      nextReturnedAmountMinor === orderAmountMinor
        ? Stage8OrderEventType.REFUND_SUCCEEDED
        : Stage8OrderEventType.PARTIAL_REFUND_SUCCEEDED;
    const occurredAt = this.cloudPaymentsDate(
      this.first(input.payload, ["DateTime"]),
    );
    const event = await this.prisma.stage8OrderEvent.upsert({
      where: {
        brandId_sourceNamespace_externalEventId: {
          brandId: integration.brandId,
          sourceNamespace: `TILDA:${integration.id}`,
          externalEventId,
        },
      },
      update: {},
      create: {
        brandId: integration.brandId,
        trackerInstallationId: integration.trackerInstallationId,
        orderId: order.id,
        source: Stage8OrderSource.TILDA,
        sourceNamespace: `TILDA:${integration.id}`,
        externalEventId,
        externalOrderId: probe.externalOrderId,
        canonicalOrderKey: probe.externalOrderId,
        eventType,
        occurredAt,
        refundAmountMinor,
        currency: order.currency,
        offerIdHint: order.offerId,
        schemaVersion: "1.0",
        payload,
        payloadHash,
        authenticationContext: {
          source: "CLOUDPAYMENTS_REFUND_NOTIFICATION",
          authenticated: true,
          hmacVersion: "HMAC_SHA256_BASE64",
        },
        requestId: this.audit.requestId(),
        processingStatus: Stage8EventProcessingStatus.ACCEPTED,
      },
    });
    if (event.payloadHash !== payloadHash) {
      await this.attribution.openIntegrationException({
        brandId: integration.brandId,
        orderId: order.id,
        reasonCodes: ["SAME_REFUND_ID_DIFFERENT_PAYLOAD"],
        requestId: event.requestId,
      });
      throw new ConflictException(
        "Идентификатор возврата уже использован с другими данными",
      );
    }
    await this.attribution.processOrderEvent(event.id);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: null,
        actorType: "SYSTEM",
        action: "STAGE8_CLOUDPAYMENTS_REFUND_ACCEPTED",
        entityType: "Stage8OrderEvent",
        entityId: event.id,
        requestId: event.requestId,
        metadata: {
          orderId: order.id,
          eventType,
          refundTransactionId,
          refundAmountMinor: refundAmountMinor.toString(),
        },
      },
    });
    return { code: 0 };
  }

  async processPendingPayments(limit = 25) {
    if (!this.flags.tildaEnabled() || !this.flags.ingestionEnabled()) {
      return { checked: 0, paid: 0, expired: 0 };
    }
    const probes = await this.prisma.tildaPaymentProbe.findMany({
      where: {
        status: TildaPaymentProbeStatus.PENDING,
        nextAttemptAt: { lte: new Date() },
      },
      include: {
        integration: true,
        orderEvent: { include: { order: true } },
      },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
    });
    let paid = 0;
    let expired = 0;
    for (const probe of probes) {
      if (probe.expiresAt <= new Date()) {
        await this.prisma.tildaPaymentProbe.update({
          where: { id: probe.id },
          data: {
            status: TildaPaymentProbeStatus.EXPIRED,
            lastErrorCode: "PAYMENT_NOT_RECEIVED",
          },
        });
        await this.setError(probe.integrationId, "PAYMENT_NOT_RECEIVED");
        expired += 1;
        continue;
      }
      try {
        const response = await this.cloudPayments.findPayment(
          probe.integration.cloudPaymentsPublicId,
          this.secrets.decrypt(
            probe.integration.encryptedCloudPaymentsApiSecret,
          ),
          probe.externalOrderId,
        );
        const model = response.Model;
        const completed = response.Success && model?.Status === "Completed";
        if (!completed) {
          await this.scheduleNextCheck(probe.id, "PAYMENT_NOT_COMPLETED");
          continue;
        }
        const amountMinor = this.moneyMinor(
          String(model.PaymentAmount ?? model.Amount ?? ""),
        );
        const currency = String(
          model.PaymentCurrency ?? model.Currency ?? probe.currency ?? "RUB",
        ).toUpperCase();
        if (
          probe.amountMinor !== null &&
          amountMinor !== null &&
          probe.amountMinor !== amountMinor
        ) {
          await this.prisma.tildaPaymentProbe.update({
            where: { id: probe.id },
            data: {
              status: TildaPaymentProbeStatus.FAILED,
              lastErrorCode: "PAYMENT_AMOUNT_MISMATCH",
            },
          });
          await this.setError(probe.integrationId, "PAYMENT_AMOUNT_MISMATCH");
          await this.attribution.openIntegrationException({
            brandId: probe.integration.brandId,
            orderId: probe.orderEvent.order?.id ?? null,
            reasonCodes: ["PAYMENT_AMOUNT_MISMATCH"],
            requestId: probe.orderEvent.requestId,
          });
          continue;
        }
        const transactionId = String(model.TransactionId ?? "unknown");
        const eventId = `cloudpayments:${transactionId}:${probe.externalOrderId}`;
        const payload = {
          source: "CLOUDPAYMENTS",
          externalOrderId: probe.externalOrderId,
          transactionId,
          status: "Completed",
          amountMinor: amountMinor?.toString() ?? null,
          currency,
        };
        const paidEvent = await this.prisma.stage8OrderEvent.upsert({
          where: {
            brandId_sourceNamespace_externalEventId: {
              brandId: probe.integration.brandId,
              sourceNamespace: `TILDA:${probe.integrationId}`,
              externalEventId: eventId,
            },
          },
          update: {},
          create: {
            brandId: probe.integration.brandId,
            trackerInstallationId: probe.integration.trackerInstallationId,
            source: Stage8OrderSource.TILDA,
            sourceNamespace: `TILDA:${probe.integrationId}`,
            externalEventId: eventId,
            externalOrderId: probe.externalOrderId,
            canonicalOrderKey: probe.externalOrderId,
            eventType: Stage8OrderEventType.PAYMENT_SUCCEEDED,
            occurredAt: new Date(),
            amountMinor: amountMinor ?? probe.amountMinor,
            shippingAmountMinor: probe.orderEvent.shippingAmountMinor,
            currency,
            offerIdHint: probe.orderEvent.order?.offerId ?? null,
            attributionId: probe.orderEvent.attributionId,
            clickIdHint: probe.orderEvent.clickIdHint,
            creatorLinkCode: probe.orderEvent.creatorLinkCode,
            promoCode: probe.orderEvent.promoCode,
            schemaVersion: "1.0",
            payload,
            payloadHash: this.hash(payload),
            authenticationContext: {
              source: "CLOUDPAYMENTS_API",
              authenticated: true,
            },
            requestId: this.audit.requestId(),
            processingStatus: Stage8EventProcessingStatus.ACCEPTED,
          },
        });
        await this.attribution.processOrderEvent(paidEvent.id);
        await this.prisma.$transaction([
          this.prisma.tildaPaymentProbe.update({
            where: { id: probe.id },
            data: {
              status: TildaPaymentProbeStatus.PAID,
              paidAt: new Date(),
              transactionId,
              attemptCount: { increment: 1 },
              lastErrorCode: null,
            },
          }),
          this.prisma.tildaIntegration.update({
            where: { id: probe.integrationId },
            data: {
              status: TildaConnectionStatus.ACTIVE,
              lastPaymentCheckAt: new Date(),
              lastPaidOrderAt: new Date(),
              lastErrorCode: null,
              lastErrorAt: null,
            },
          }),
        ]);
        paid += 1;
      } catch (error) {
        const code =
          error instanceof UnauthorizedException
            ? "CLOUDPAYMENTS_CREDENTIALS_INVALID"
            : "CLOUDPAYMENTS_UNAVAILABLE";
        await this.scheduleNextCheck(probe.id, code);
        await this.setError(probe.integrationId, code);
      }
    }
    return { checked: probes.length, paid, expired };
  }

  private async scheduleNextCheck(probeId: string, code: string) {
    await this.prisma.tildaPaymentProbe.update({
      where: { id: probeId },
      data: {
        attemptCount: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + 60_000),
        lastErrorCode: code,
      },
    });
  }

  private present(
    integration: {
      id: string;
      status: TildaConnectionStatus;
      lastWebhookAt: Date | null;
      lastWebhookTestAt: Date | null;
      lastOrderReceivedAt: Date | null;
      lastPaymentCheckAt: Date | null;
      lastPaidOrderAt: Date | null;
      lastErrorCode: string | null;
      cloudPaymentsPublicId: string;
      trackerInstallation: {
        id: string;
        publicKey: string;
        primaryDomain: string;
      };
    },
    webhookKey: string,
  ) {
    const publicBackendUrl = (
      this.config.get<string>("PUBLIC_BACKEND_URL") ?? "http://localhost:3000"
    ).replace(/\/+$/, "");
    return {
      id: integration.id,
      status: integration.status,
      domain: integration.trackerInstallation.primaryDomain,
      trackerInstallationId: integration.trackerInstallation.id,
      trackerPublicKey: integration.trackerInstallation.publicKey,
      trackerSnippet: `<script src="${publicBackendUrl}/track/v1.js" data-installation="${integration.trackerInstallation.publicKey}" data-checkout-field="attributionId" data-checkout-selector=".t706 form" async></script>`,
      tildaWebhookUrl: `${publicBackendUrl}/api/v1/integrations/tilda/${integration.id}/orders?key=${encodeURIComponent(webhookKey)}`,
      cloudPaymentsRefundUrl: this.cloudPaymentsRefundUrl(integration.id),
      cloudPaymentsPublicId: integration.cloudPaymentsPublicId,
      lastWebhookAt: integration.lastWebhookAt,
      lastWebhookTestAt: integration.lastWebhookTestAt,
      lastOrderReceivedAt: integration.lastOrderReceivedAt,
      lastPaymentCheckAt: integration.lastPaymentCheckAt,
      lastPaidOrderAt: integration.lastPaidOrderAt,
      diagnostic: this.diagnostic(integration),
    };
  }

  private diagnostic(integration: {
    status: TildaConnectionStatus;
    lastErrorCode: string | null;
    lastWebhookTestAt: Date | null;
    lastPaidOrderAt: Date | null;
  }) {
    const messages: Record<string, string> = {
      TILDA_WEBHOOK_NOT_RECEIVED:
        "Tilda ещё не прислала проверочное событие. Проверьте URL и ключ.",
      TILDA_ORDER_ID_MISSING:
        "Tilda прислала форму без номера заказа. Проверьте блок корзины.",
      TILDA_ORDER_ID_INVALID:
        "Номер заказа имеет неподдерживаемый формат. Проверьте настройки номера заказа в Tilda.",
      TILDA_AMOUNT_MISSING:
        "Tilda прислала заказ без суммы. Включите передачу данных корзины.",
      TILDA_CURRENCY_INVALID:
        "В заказе указана некорректная валюта. Проверьте настройки магазина.",
      TILDA_DOMAIN_MISMATCH:
        "Событие пришло с другого домена. Проверьте, к какому сайту подключён Webhook.",
      CLOUDPAYMENTS_CREDENTIALS_INVALID:
        "Не удалось проверить CloudPayments. Проверьте Public ID и API Secret.",
      CLOUDPAYMENTS_UNAVAILABLE:
        "CloudPayments временно недоступен. Проверка повторится автоматически.",
      PAYMENT_NOT_RECEIVED:
        "Заказ получен, но успешная оплата пока не найдена.",
      PAYMENT_NOT_COMPLETED: "Заказ получен, оплата ещё не завершена.",
      PAYMENT_AMOUNT_MISMATCH:
        "Сумма оплаты не совпадает с суммой заказа. Продажа отправлена на проверку.",
      REFUND_ORDER_NOT_FOUND:
        "Получен возврат, но оплаченный заказ не найден. Проверьте идентификатор заказа.",
      REFUND_AMOUNT_EXCEEDS_ORDER:
        "Сумма возврата превышает сумму заказа. Операция отправлена на проверку.",
      REFUND_WEBHOOK_NOT_CONFIGURED:
        "Уведомления о возвратах ещё не подключены в CloudPayments. Проверьте Refund URL и метод POST.",
    };
    if (integration.lastErrorCode) {
      return {
        level:
          integration.status === TildaConnectionStatus.ERROR
            ? "ERROR"
            : "WAITING",
        code: integration.lastErrorCode,
        message:
          messages[integration.lastErrorCode] ??
          "Подключение требует проверки.",
      };
    }
    if (!integration.lastWebhookTestAt) {
      return {
        level: "WAITING",
        code: "TILDA_WEBHOOK_NOT_RECEIVED",
        message: messages.TILDA_WEBHOOK_NOT_RECEIVED,
      };
    }
    if (!integration.lastPaidOrderAt) {
      return {
        level: "READY",
        code: "WAITING_FOR_FIRST_PAYMENT",
        message: "Подключение проверено. Ожидается первый оплаченный заказ.",
      };
    }
    return {
      level: "OK",
      code: "CONNECTED",
      message: "Tilda передаёт оплаченные заказы автоматически.",
    };
  }

  private async setError(integrationId: string, code: string) {
    await this.prisma.tildaIntegration.update({
      where: { id: integrationId },
      data: {
        status: TildaConnectionStatus.ERROR,
        lastErrorCode: code,
        lastErrorAt: new Date(),
        lastPaymentCheckAt: new Date(),
      },
    });
  }

  private verifyWebhookKey(expected: string, provided: string) {
    const left = Buffer.from(expected);
    const right = Buffer.from(provided);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new ForbiddenException(
        "Ключ подключения Tilda не совпадает. Скопируйте его заново.",
      );
    }
  }

  private verifyCloudPaymentsHmac(
    secret: string,
    input: {
      contentHmac: string;
      decodedContentHmac: string;
      rawBody: Buffer;
    },
  ) {
    const rawBody = input.rawBody.toString("utf8");
    const rawValid = this.hmacMatches(secret, rawBody, input.contentHmac);
    let decodedValid = false;
    if (input.decodedContentHmac) {
      try {
        decodedValid = this.hmacMatches(
          secret,
          decodeURIComponent(rawBody.replace(/\+/g, " ")),
          input.decodedContentHmac,
        );
      } catch {
        decodedValid = false;
      }
    }
    if (!rawValid && !decodedValid) {
      throw new ForbiddenException(
        "Подпись уведомления CloudPayments не прошла проверку",
      );
    }
  }

  private hmacMatches(secret: string, value: string, provided: string) {
    if (!provided) return false;
    const expected = createHmac("sha256", secret)
      .update(value, "utf8")
      .digest("base64");
    const left = Buffer.from(expected);
    const right = Buffer.from(provided);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private first(payload: TildaPayload, keys: string[]) {
    for (const key of keys) {
      const value = this.payloadValue(payload, key);
      if (Array.isArray(value) && value.length) return String(value[0]).trim();
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return null;
  }

  private payloadValue(payload: TildaPayload, key: string) {
    if (payload[key] !== undefined) return payload[key];
    const path = key.replace(/\[([^\]]+)\]/g, ".$1").split(".");
    let current: unknown = payload;
    for (const segment of path) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private cookieValue(cookieHeader: string | null, name: string) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  private sameDomain(value: string, expectedDomain: string) {
    try {
      return (
        new URL(value).hostname.toLowerCase() === expectedDomain.toLowerCase()
      );
    } catch {
      return false;
    }
  }

  private sameUrl(left: string, right: string) {
    try {
      const normalize = (value: string) => {
        const parsed = new URL(value);
        parsed.hash = "";
        return parsed.toString().replace(/\/+$/, "");
      };
      return normalize(left) === normalize(right);
    } catch {
      return false;
    }
  }

  private moneyMinor(value: string | null) {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, "").replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const [major, fraction = ""] = normalized.split(".");
    const result = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0"));
    return result <= 9_223_372_036_854_775_807n ? result : null;
  }

  private deliveryMoneyMinor(payload: TildaPayload) {
    const raw = this.first(payload, [
      "payment[delivery_price]",
      "payment.delivery_price",
      "delivery_price",
      "deliveryPrice",
      "shipping_amount",
      "shippingAmount",
      "payment[delivery]",
      "payment.delivery",
      "Delivery",
      "delivery",
    ]);
    if (!raw) return 0n;
    const numeric = this.moneyMinor(raw);
    if (numeric !== null) return numeric;
    const match = raw.match(/(?:=|:)\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/);
    return match ? (this.moneyMinor(match[1]) ?? 0n) : 0n;
  }

  private captureMonetaryDiagnostic(integrationId: string, payload: TildaPayload) {
    const enabled =
      this.config.get<string>("STAGE8_TILDA_MONETARY_DIAGNOSTIC_ENABLED") ===
      "true";
    if (this.monetaryDiagnosticCaptured || !enabled) return;

    const fields: Array<Record<string, unknown>> = [];
    const visit = (value: unknown, path: string[], depth: number) => {
      if (depth > 5 || fields.length >= 30) return;
      if (Array.isArray(value)) {
        value.slice(0, 10).forEach((item, index) => {
          visit(item, [...path, String(index)], depth + 1);
        });
        return;
      }
      if (value && typeof value === "object") {
        Object.entries(value as Record<string, unknown>).slice(0, 50).forEach(
          ([key, nested]) => visit(nested, [...path, key], depth + 1),
        );
        return;
      }
      if (
        !path.length ||
        !TILDA_MONETARY_KEY.test(path[path.length - 1]) ||
        TILDA_PII_KEY.test(path[path.length - 1]) ||
        !["string", "number", "bigint"].includes(typeof value)
      ) {
        return;
      }

      const raw = String(value).trim();
      if (!raw || raw.length > 500) return;
      if (/^[+-]?\d+(?:[.,]\d{1,2})?$/.test(raw) || CURRENCY_VALUE.test(raw)) {
        fields.push({ path: path.join("."), value: raw });
        return;
      }
      const monetaryValues = raw.match(QUALIFIED_MONEY)?.slice(0, 5) ?? [];
      fields.push({
        path: path.join("."),
        value: { type: "mixed", monetaryValues, length: raw.length },
      });
    };

    visit(payload, [], 0);
    this.logger.log(
      JSON.stringify({ event: "stage8_tilda_monetary_diagnostic", integrationId, fields }),
    );
    this.monetaryDiagnosticCaptured = true;
  }

  private cloudPaymentsDate(value: string | null) {
    if (!value) return new Date();
    const normalized = value.includes("T")
      ? value
      : `${value.replace(" ", "T")}Z`;
    const result = new Date(normalized);
    if (Number.isNaN(result.getTime())) {
      throw new BadRequestException(
        "CloudPayments передал некорректную дату возврата",
      );
    }
    return result;
  }

  private cloudPaymentsRefundUrl(integrationId: string) {
    const publicBackendUrl = (
      this.config.get<string>("PUBLIC_BACKEND_URL") ?? "http://localhost:3000"
    ).replace(/\/+$/, "");
    return `${publicBackendUrl}/api/v1/integrations/tilda/${integrationId}/cloudpayments/refunds`;
  }

  private hash(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private async getBrand(userId: string) {
    const brand = await this.prisma.brandProfile.findUnique({
      where: { userId },
    });
    if (!brand) throw new ForbiddenException("Brand profile not found");
    return brand;
  }

  private async ownedIntegration(userId: string) {
    const brand = await this.getBrand(userId);
    const integration = await this.prisma.tildaIntegration.findUnique({
      where: { brandId: brand.id },
      include: { trackerInstallation: true },
    });
    if (!integration)
      throw new NotFoundException("Интеграция Tilda не настроена");
    return integration;
  }
}
