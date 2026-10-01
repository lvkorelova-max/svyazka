import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac } from "crypto";
import cookieParser = require("cookie-parser");
import { NextFunction, Request, Response } from "express";
import request = require("supertest");
import { AppModule } from "../src/app.module";
import { BigIntSerializerInterceptor } from "../src/common/interceptors/bigint-serializer.interceptor";
import { PrismaService } from "../src/prisma/prisma.service";
import { AttributionService } from "../src/attribution/attribution.service";
import { CloudPaymentsClient } from "../src/attribution/cloudpayments-client.service";
import { TildaIntegrationService } from "../src/attribution/tilda-integration.service";
import { applyTrackerScriptHeaders } from "../src/tracker-script-headers";
import { resetTestDatabase } from "./reset-test-database";

process.env.STAGE8_TRACKER_ENABLED = "true";
process.env.STAGE8_TILDA_ENABLED = "true";
process.env.STAGE8_ORDER_INGESTION_ENABLED = "true";
process.env.STAGE8_ATTRIBUTION_SHADOW_ENABLED = "true";
process.env.STAGE8_AUTO_ATTRIBUTION_ENABLED = "true";
process.env.STAGE8_FINANCE_HANDOFF_ENABLED = "true";

describe("Stage 8 sales attribution engine", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let attribution: AttributionService;
  let cloudPayments: CloudPaymentsClient;
  let tilda: TildaIntegrationService;
  let config: ConfigService;
  let brandToken: string;
  let creatorToken: string;
  let otherCreatorToken: string;
  let adminToken: string;
  let offerId: string;
  let relationship: any;
  let otherRelationship: any;
  let installation: any;
  let tildaSetup: any;
  const cloudPaymentsApiSecret = "stage8-cloudpayments-secret";

  const users = {
    brand: {
      email: "stage8-brand@example.test",
      password: "Stage8Brand123",
      role: "BRAND",
      name: "Stage 8 Brand",
    },
    creator: {
      email: "stage8-creator@example.test",
      password: "Stage8Creator123",
      role: "CREATOR",
      name: "Stage 8 Creator",
    },
    otherCreator: {
      email: "stage8-other-creator@example.test",
      password: "Stage8OtherCreator123",
      role: "CREATOR",
      name: "Stage 8 Other Creator",
    },
    admin: {
      email: "stage8-admin@example.test",
      password: "Stage8Admin123",
      role: "BRAND",
      name: "Stage 8 Admin",
    },
  };

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function registerAndLogin(payload: Record<string, unknown>) {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send(payload)
      .expect(201);
    return (
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: payload.email, password: payload.password })
        .expect(200)
    ).body.accessToken as string;
  }

  async function applyAndApprove(token: string) {
    const application = await request(app.getHttpServer())
      .post(`/api/creator/offers/${offerId}/applications`)
      .set(auth(token))
      .send({ expectedCommercialTermsVersion: 1 })
      .expect(201);
    return (
      await request(app.getHttpServer())
        .post(`/api/brand/applications/${application.body.id}/approve`)
        .set(auth(brandToken))
        .send({
          expectedAcceptedTermsVersion: 1,
          expectedApplicationVersion: application.body.version,
        })
        .expect(201)
    ).body;
  }

  function signedEvent(
    eventId: string,
    payload: Record<string, unknown>,
    options: { secret?: string; timestamp?: number; keyId?: string } = {},
  ) {
    const timestamp = String(
      options.timestamp ?? Math.floor(Date.now() / 1000),
    );
    const body = JSON.stringify(payload);
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const signature = createHmac(
      "sha256",
      options.secret ?? installation.webhookSecret,
    )
      .update(`${timestamp}\n${eventId}\n${bodyHash}`)
      .digest("hex");
    return request(app.getHttpServer())
      .post("/api/v1/integrations/order-events")
      .set("Svyazka-Installation", installation.id)
      .set("Svyazka-Key-Id", options.keyId ?? installation.keyId)
      .set("Svyazka-Event-Id", eventId)
      .set("Svyazka-Timestamp", timestamp)
      .set("Svyazka-Signature", `v1=${signature}`)
      .send(payload);
  }

  function csv(rows: string[]) {
    return [
      "external_order_id,order_date,amount_kopecks,currency,status,returned_amount_kopecks,affiliate_code,promo_code,click_id,offer_id",
      ...rows,
    ].join("\n");
  }

  function uploadCsv(content: string) {
    return request(app.getHttpServer())
      .post("/api/brand/order-imports")
      .set(auth(brandToken))
      .attach("file", Buffer.from(content), {
        filename: "stage8-orders.csv",
        contentType: "text/csv",
      });
  }

  async function getTildaIntegration() {
    return (
      await request(app.getHttpServer())
        .get("/api/brand/tilda-integration")
        .set(auth(brandToken))
        .expect(200)
    ).body;
  }

  async function createPaidTildaOrder(
    externalOrderId: string,
    transactionId: number,
    amount = "3000.00",
    shippingAmount?: string,
    shippingField = "payment[delivery]",
    subtotal?: string,
  ) {
    const integration = await getTildaIntegration();
    const webhookUrl = new URL(integration.tildaWebhookUrl);
    await request(app.getHttpServer())
      .post(`${webhookUrl.pathname}${webhookUrl.search}`)
      .type("form")
      .send({
        tranid: externalOrderId,
        "payment[amount]": amount,
        ...(subtotal ? { "payment[subtotal]": subtotal } : {}),
        ...(shippingAmount ? { [shippingField]: shippingAmount } : {}),
        "payment[currency]": "RUB",
        affiliate_code: relationship.affiliateCode,
      })
      .expect(200);
    jest.spyOn(cloudPayments, "findPayment").mockResolvedValueOnce({
      Success: true,
      Model: {
        TransactionId: transactionId,
        InvoiceId: externalOrderId,
        Status: "Completed",
        Amount: amount,
        Currency: "RUB",
      },
    });
    await expect(tilda.processPendingPayments()).resolves.toMatchObject({
      checked: 1,
      paid: 1,
    });
    return prisma.order.findUniqueOrThrow({
      where: {
        brandId_externalOrderId: {
          brandId: relationship.offer.brandId,
          externalOrderId,
        },
      },
      include: {
        commission: true,
        ledgerTransactions: true,
      },
    });
  }

  function sendCloudPaymentsRefund(input: {
    refundTransactionId: number;
    paymentTransactionId: number;
    externalOrderId: string;
    amount: string;
    hmac?: string;
  }) {
    if (!tildaSetup) throw new Error("Tilda integration is not configured");
    const refundUrl = new URL(tildaSetup.cloudPaymentsRefundUrl);
    const body = new URLSearchParams({
      TransactionId: String(input.refundTransactionId),
      PaymentTransactionId: String(input.paymentTransactionId),
      Amount: input.amount,
      OperationType: "Refund",
      InvoiceId: input.externalOrderId,
      DateTime: "2026-08-11 12:00:00",
    }).toString();
    const contentHmac =
      input.hmac ??
      createHmac("sha256", cloudPaymentsApiSecret)
        .update(body, "utf8")
        .digest("base64");
    return request(app.getHttpServer())
      .post(refundUrl.pathname)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set("Content-HMAC", contentHmac)
      .send(body);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api", {
      exclude: [
        { path: "go/:affiliateCode", method: RequestMethod.GET },
        { path: "health/live", method: RequestMethod.GET },
        { path: "health/ready", method: RequestMethod.GET },
        { path: "track/v1.js", method: RequestMethod.GET },
        { path: "track/v1/events", method: RequestMethod.POST },
      ],
    });
    app.use((request: Request, response: Response, next: NextFunction) => {
      applyTrackerScriptHeaders(request, response);
      next();
    });
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new BigIntSerializerInterceptor());
    await app.init();
    prisma = app.get(PrismaService);
    attribution = app.get(AttributionService);
    cloudPayments = app.get(CloudPaymentsClient);
    tilda = app.get(TildaIntegrationService);
    config = app.get(ConfigService);
    config.set("STAGE8_TRACKER_ENABLED", "true");
    config.set("STAGE8_TILDA_ENABLED", "true");
    config.set("STAGE8_ORDER_INGESTION_ENABLED", "true");
    config.set("STAGE8_ATTRIBUTION_SHADOW_ENABLED", "true");
    config.set("STAGE8_AUTO_ATTRIBUTION_ENABLED", "true");
    config.set("STAGE8_FINANCE_HANDOFF_ENABLED", "true");
    await resetTestDatabase(prisma);

    brandToken = await registerAndLogin(users.brand);
    creatorToken = await registerAndLogin(users.creator);
    otherCreatorToken = await registerAndLogin(users.otherCreator);
    await registerAndLogin(users.admin);
    await prisma.user.update({
      where: { email: users.admin.email },
      data: { role: "ADMIN" },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: users.admin.email, password: users.admin.password })
        .expect(200)
    ).body.accessToken;

    const offer = await request(app.getHttpServer())
      .post("/api/brand/offers")
      .set(auth(brandToken))
      .send({
        title: "Stage 8 automatic attribution",
        description: "Signed store events and automatic financial handoff.",
        productUrl: "https://shop.stage8.test/product",
        productPriceKopecks: 300_000,
        totalCommissionPoolBps: 1500,
        promotionWithoutProduct: "YES",
      })
      .expect(201);
    offerId = offer.body.id;
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/publish`)
      .set(auth(brandToken))
      .expect(201);
    relationship = await applyAndApprove(creatorToken);
    otherRelationship = await applyAndApprove(otherCreatorToken);

    installation = (
      await request(app.getHttpServer())
        .post("/api/brand/tracker-installations")
        .set(auth(brandToken))
        .send({
          name: "Pilot store",
          primaryDomain: "shop.stage8.test",
          allowedOrigins: ["https://shop.stage8.test"],
          consentMode: "REQUIRED",
        })
        .expect(201)
    ).body;
    expect(installation.webhookSecret).toBeTruthy();
    await request(app.getHttpServer())
      .post(`/api/brand/tracker-installations/${installation.id}/activate`)
      .set(auth(brandToken))
      .expect(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("serves a finance-free tracker and persists privacy-safe session evidence", async () => {
    const script = await request(app.getHttpServer())
      .get("/track/v1.js")
      .expect("content-type", /javascript/)
      .expect(200);
    expect(script.text).toContain("_svz_at");
    expect(script.text).toContain('new URL("v1/events",s.src)');
    expect(script.text).toContain("application/x-www-form-urlencoded");
    expect(script.text).not.toContain("application/json");
    expect(script.text).not.toContain("commission");
    expect(script.text).not.toContain("amountMinor");
    expect(script.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(script.headers["access-control-allow-origin"]).toBe("*");

    const redirect = await request(app.getHttpServer())
      .get(`/go/${relationship.affiliateCode}`)
      .set("User-Agent", "Stage8-E2E")
      .expect(302);
    const location = new URL(redirect.headers.location);
    const attributionId = location.searchParams.get("svz_a");
    expect(attributionId).toMatch(/^svz_a_/);
    const session = await prisma.clickSession.findUniqueOrThrow({
      where: { publicAttributionId: attributionId! },
    });
    expect(session.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.userAgentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.expiresAt.getTime() - session.firstClickedAt.getTime()).toBe(
      30 * 86_400_000,
    );

    const trackingPayload = {
      installationKey: installation.publicKey,
      eventId: "track-stage8-session-1",
      eventType: "SESSION_REFRESHED",
      occurredAt: new Date().toISOString(),
      attributionId,
      consentState: "GRANTED",
    };
    await request(app.getHttpServer())
      .post("/track/v1/events")
      .set("Origin", "https://shop.stage8.test")
      .type("form")
      .send(trackingPayload)
      .expect(201);
    await request(app.getHttpServer())
      .post("/track/v1/events")
      .set("Origin", "https://shop.stage8.test")
      .type("form")
      .send(trackingPayload)
      .expect(201)
      .expect(({ body }) => expect(body.duplicate).toBe(true));
    await request(app.getHttpServer())
      .post("/track/v1/events")
      .set("Origin", "https://www.shop.stage8.test")
      .type("form")
      .send({
        ...trackingPayload,
        eventId: "track-stage8-session-2",
      })
      .expect(201);
    expect(
      await prisma.trackingEvent.count({
        where: { externalEventId: "track-stage8-session-1" },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .post("/track/v1/events")
      .set("Origin", "https://foreign.example.test")
      .send({
        installationKey: installation.publicKey,
        eventId: "track-stage8-foreign",
        eventType: "SESSION_STARTED",
        occurredAt: new Date().toISOString(),
      })
      .expect(403);
  });

  it("connects Tilda without code and turns a verified CloudPayments payment into one expected commission", async () => {
    jest
      .spyOn(cloudPayments, "verifyCredentials")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const connected = await request(app.getHttpServer())
      .post("/api/brand/tilda-integration")
      .set(auth(brandToken))
      .send({
        domain: " https://www.shop.stage8.test/catalog?utm_source=e2e ",
        cloudPaymentsPublicId: "pk_stage8_pilot",
        cloudPaymentsApiSecret,
      })
      .expect(201);
    tildaSetup = connected.body;
    expect(connected.body.domain).toBe("shop.stage8.test");
    expect(connected.body.trackerSnippet).toContain("data-installation");
    expect(connected.body.trackerSnippet).toContain(
      'data-checkout-selector=".t706 form"',
    );
    expect(connected.body.tildaWebhookUrl).toContain(
      "/api/v1/integrations/tilda/",
    );
    const tildaWebhookUrl = new URL(connected.body.tildaWebhookUrl);
    const tildaWebhookPath = `${tildaWebhookUrl.pathname}${tildaWebhookUrl.search}`;
    expect(tildaWebhookUrl.searchParams.get("key")).toMatch(/^svz_tilda_/);
    expect(connected.body.cloudPaymentsRefundUrl).toContain(
      "/cloudpayments/refunds",
    );

    await request(app.getHttpServer())
      .post(tildaWebhookPath)
      .type("form")
      .send({ test: "test" })
      .expect(200)
      .expect("content-type", /text\/plain/)
      .expect(({ text }) => {
        expect(text).toBe("ok");
      });

    jest.spyOn(cloudPayments, "getNotificationSettings").mockResolvedValueOnce({
      Success: true,
      Model: {
        IsEnabled: true,
        Address: connected.body.cloudPaymentsRefundUrl,
        HttpMethod: "POST",
      },
    });

    const readiness = await request(app.getHttpServer())
      .post("/api/brand/tilda-integration/check")
      .set(auth(brandToken))
      .expect(201);
    expect(readiness.body.status).toBe("ACTIVE");

    const redirect = await request(app.getHttpServer())
      .get(`/go/${relationship.affiliateCode}`)
      .redirects(0)
      .expect(302);
    const attributionId = new URL(redirect.headers.location).searchParams.get(
      "svz_a",
    );
    expect(attributionId).toBeTruthy();

    const externalOrderId = "TILDA-STAGE8-PAID-1";
    const tildaPayload = {
      tranid: externalOrderId,
      "payment[amount]": "3000.00",
      "payment[currency]": "RUB",
      "tildaspec-referer": "https://shop.stage8.test/cart",
      COOKIES: `_svz_at=${attributionId}`,
    };
    const webhook = () =>
      request(app.getHttpServer())
        .post(tildaWebhookPath)
        .type("form")
        .send(tildaPayload);
    await webhook().expect(200);

    jest.spyOn(cloudPayments, "findPayment").mockResolvedValue({
      Success: true,
      Model: {
        TransactionId: 880001,
        InvoiceId: externalOrderId,
        Status: "Completed",
        Amount: "3000.00",
        Currency: "RUB",
      },
    });
    await expect(tilda.processPendingPayments()).resolves.toMatchObject({
      checked: 1,
      paid: 1,
    });

    const [
      clickSession,
      orderEventCount,
      order,
      commission,
      brandOrders,
      creatorOrders,
      performance,
    ] = await Promise.all([
      prisma.clickSession.findUnique({
        where: { publicAttributionId: attributionId! },
      }),
      prisma.stage8OrderEvent.count({
        where: { externalOrderId, source: "TILDA" },
      }),
      prisma.order.findUniqueOrThrow({
        where: {
          brandId_externalOrderId: {
            brandId: relationship.offer.brandId,
            externalOrderId,
          },
        },
        include: { currentAttributionResult: true },
      }),
      prisma.commission.findFirst({
        where: { order: { externalOrderId } },
      }),
      request(app.getHttpServer())
        .get("/api/brand/orders?pageSize=100")
        .set(auth(brandToken))
        .expect(200),
      request(app.getHttpServer())
        .get("/api/creator/orders?pageSize=100")
        .set(auth(creatorToken))
        .expect(200),
      request(app.getHttpServer())
        .get("/api/creator/performance/overview")
        .set(auth(creatorToken))
        .expect(200),
    ]);
    expect(clickSession).toBeTruthy();
    expect(orderEventCount).toBe(2);
    expect(order.currentAttributionResult?.status).toBe("AUTO_ATTRIBUTED");
    expect(order.financialHandoffStatus).toBe("ACKNOWLEDGED");
    expect(commission?.status).toBe("HOLD");
    expect(
      brandOrders.body.items.some(
        (item: { externalOrderId: string }) =>
          item.externalOrderId === externalOrderId,
      ),
    ).toBe(true);
    expect(
      creatorOrders.body.items.some(
        (item: { externalOrderId: string }) =>
          item.externalOrderId === externalOrderId,
      ),
    ).toBe(true);
    expect(BigInt(performance.body.expectedCommissionMinor)).toBeGreaterThan(
      0n,
    );

    await webhook().expect(200);
    await expect(tilda.processPendingPayments()).resolves.toMatchObject({
      checked: 0,
      paid: 0,
    });
    expect(await prisma.order.count({ where: { externalOrderId } })).toBe(1);
    expect(
      await prisma.commission.count({
        where: { order: { externalOrderId } },
      }),
    ).toBe(1);
  });

  it("enriches Tilda shipping before payment and freezes the paid projection", async () => {
    jest.spyOn(cloudPayments, "verifyCredentials").mockResolvedValueOnce(true);
    tildaSetup = (
      await request(app.getHttpServer())
        .post("/api/brand/tilda-integration")
        .set(auth(brandToken))
        .send({
          domain: "shop.stage8.test",
          cloudPaymentsPublicId: "pk_stage8_shipping",
          cloudPaymentsApiSecret,
        })
        .expect(201)
    ).body;
    config.set("STAGE8_FINANCE_HANDOFF_ENABLED", "false");
    const performanceBefore = await request(app.getHttpServer())
      .get("/api/creator/performance/overview")
      .set(auth(creatorToken))
      .expect(200);
    const externalOrderId = "TILDA-SHIPPING-ENRICHMENT-1";
    const webhookUrl = new URL(tildaSetup.tildaWebhookUrl);
    const webhook = (shippingAmount?: string) =>
      request(app.getHttpServer())
        .post(`${webhookUrl.pathname}${webhookUrl.search}`)
        .type("form")
        .send({
          tranid: externalOrderId,
          "payment[amount]": "285.75",
          "payment[subtotal]": "100",
          ...(shippingAmount
            ? { "payment[delivery_price]": shippingAmount }
            : {}),
          "payment[currency]": "RUB",
          affiliate_code: relationship.affiliateCode,
        });

    await webhook().expect(200);
    const createdOrder = await prisma.order.findUniqueOrThrow({
      where: {
        brandId_externalOrderId: {
          brandId: relationship.offer.brandId,
          externalOrderId,
        },
      },
    });
    expect(createdOrder.shippingAmountMinor).toBe(0n);
    expect(createdOrder.commissionEligibilityProjection).toBeNull();
    expect(createdOrder.commissionableAmountMinor).toBeNull();

    await webhook("185.75").expect(200);
    const enrichedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrder.id },
    });
    expect(enrichedOrder.shippingAmountMinor).toBe(18575n);
    expect(enrichedOrder.commissionEligibilityProjection).toBeNull();

    await webhook("200.00").expect(200);
    expect(
      (
        await prisma.order.findUniqueOrThrow({
          where: { id: createdOrder.id },
        })
      ).shippingAmountMinor,
    ).toBe(18575n);

    jest.spyOn(cloudPayments, "findPayment").mockResolvedValueOnce({
      Success: true,
      Model: {
        TransactionId: 880002,
        InvoiceId: externalOrderId,
        Status: "Completed",
        Amount: "285.75",
        Currency: "RUB",
      },
    });
    await expect(tilda.processPendingPayments()).resolves.toMatchObject({
      checked: 1,
      paid: 1,
    });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrder.id },
    });
    const paidProjection = order.commissionEligibilityProjection;
    const performanceAfter = await request(app.getHttpServer())
      .get("/api/creator/performance/overview")
      .set(auth(creatorToken))
      .expect(200);

    expect(order.amountMinor).toBe(28575n);
    expect(order.shippingAmountMinor).toBe(18575n);
    expect(order.commissionableAmountMinor).toBe(10000n);
    expect(paidProjection).not.toBeNull();
    expect(
      BigInt(performanceAfter.body.revenueGeneratedMinor) -
        BigInt(performanceBefore.body.revenueGeneratedMinor),
    ).toBe(10000n);
    expect(
      await prisma.stage8OrderEvent.count({
        where: {
          externalOrderId,
          eventType: "PAYMENT_SUCCEEDED",
        },
      }),
    ).toBe(1);

    await webhook("250.00").expect(200);
    const postPaymentOrder = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrder.id },
    });
    expect(postPaymentOrder.shippingAmountMinor).toBe(18575n);
    expect(postPaymentOrder.commissionEligibilityProjection).toEqual(
      paidProjection,
    );

    await sendCloudPaymentsRefund({
      refundTransactionId: 990002,
      paymentTransactionId: 880002,
      externalOrderId,
      amount: "285.75",
    })
      .expect(200)
      .expect({ code: 0 });
    const refundedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrder.id },
    });
    expect(refundedOrder.commissionEligibilityProjection).toEqual(
      paidProjection,
    );
    expect(refundedOrder.commissionableAmountMinor).toBe(10000n);
    expect(refundedOrder.returnedCommissionableAmountMinor).toBe(10000n);
    expect(
      await prisma.stage8OutboxEvent.count({
        where: { aggregateId: createdOrder.id },
      }),
    ).toBe(0);
    config.set("STAGE8_FINANCE_HANDOFF_ENABLED", "true");
  });

  it("syncs paid to full refund through one immutable event and Stage 7 reversal", async () => {
    const externalOrderId = "TILDA-REFUND-FULL-1";
    const paymentTransactionId = 881001;
    const order = await createPaidTildaOrder(
      externalOrderId,
      paymentTransactionId,
    );
    expect(order.financialHandoffStatus).toBe("ACKNOWLEDGED");

    await sendCloudPaymentsRefund({
      refundTransactionId: 991001,
      paymentTransactionId,
      externalOrderId,
      amount: "3000.00",
    })
      .expect(200)
      .expect({ code: 0 });

    const refunded = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        commission: true,
        ledgerTransactions: true,
      },
    });
    expect(refunded.status).toBe("RETURNED");
    expect(refunded.returnedAmountMinor).toBe(300000n);
    expect(refunded.commission?.status).toBe("REVERSED");
    expect(refunded.commission?.creatorAmountMinor).toBe(0n);
    expect(
      refunded.ledgerTransactions.filter(
        (transaction) => transaction.type === "REVERSAL",
      ),
    ).toHaveLength(1);
  });

  it("syncs a partial CloudPayments refund through proportional Stage 7 correction", async () => {
    const externalOrderId = "TILDA-REFUND-PARTIAL-1";
    const paymentTransactionId = 881002;
    const order = await createPaidTildaOrder(
      externalOrderId,
      paymentTransactionId,
    );
    const creatorBefore = order.commission!.creatorAmountMinor!;

    await sendCloudPaymentsRefund({
      refundTransactionId: 991002,
      paymentTransactionId,
      externalOrderId,
      amount: "750.00",
    }).expect(200);

    const refunded = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        commission: true,
        ledgerTransactions: true,
      },
    });
    expect(refunded.status).toBe("PARTIALLY_RETURNED");
    expect(refunded.returnedAmountMinor).toBe(75000n);
    expect(refunded.commission!.creatorAmountMinor!).toBe(21938n);
    expect(refunded.commission!.platformAmountMinor!).toBe(11812n);
    expect(refunded.commission!.creatorAmountMinor!).toBeLessThan(
      creatorBefore,
    );
    expect(
      refunded.ledgerTransactions.some(
        (transaction) => transaction.type === "REVERSAL",
      ),
    ).toBe(true);
  });

  it("applies two different partial refund notifications cumulatively", async () => {
    const externalOrderId = "TILDA-REFUND-PARTIAL-TWICE-1";
    const paymentTransactionId = 881003;
    const order = await createPaidTildaOrder(
      externalOrderId,
      paymentTransactionId,
    );

    await sendCloudPaymentsRefund({
      refundTransactionId: 991003,
      paymentTransactionId,
      externalOrderId,
      amount: "500.00",
    }).expect(200);
    await sendCloudPaymentsRefund({
      refundTransactionId: 991004,
      paymentTransactionId,
      externalOrderId,
      amount: "700.00",
    }).expect(200);

    const refunded = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { commission: true, ledgerTransactions: true },
    });
    expect(refunded.status).toBe("PARTIALLY_RETURNED");
    expect(refunded.returnedAmountMinor).toBe(120000n);
    expect(refunded.commission?.creatorAmountMinor).toBe(17550n);
    expect(refunded.commission?.platformAmountMinor).toBe(9450n);
    expect(
      refunded.ledgerTransactions.filter(
        (transaction) => transaction.type === "REVERSAL",
      ),
    ).toHaveLength(2);
    expect(
      await prisma.stage8OrderEvent.count({
        where: {
          orderId: order.id,
          eventType: "PARTIAL_REFUND_SUCCEEDED",
        },
      }),
    ).toBe(2);
  });

  it("acknowledges a duplicate refund notification without a second correction", async () => {
    const externalOrderId = "TILDA-REFUND-DUPLICATE-1";
    const paymentTransactionId = 881004;
    const order = await createPaidTildaOrder(
      externalOrderId,
      paymentTransactionId,
    );
    const refund = {
      refundTransactionId: 991005,
      paymentTransactionId,
      externalOrderId,
      amount: "600.00",
    };

    await sendCloudPaymentsRefund(refund).expect(200).expect({ code: 0 });
    await sendCloudPaymentsRefund(refund).expect(200).expect({ code: 0 });

    const duplicateSafe = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { ledgerTransactions: true },
    });
    expect(duplicateSafe.returnedAmountMinor).toBe(60000n);
    expect(
      duplicateSafe.ledgerTransactions.filter(
        (transaction) => transaction.type === "REVERSAL",
      ),
    ).toHaveLength(1);
    expect(
      await prisma.stage8OrderEvent.count({
        where: {
          externalEventId: "cloudpayments:refund:991005",
        },
      }),
    ).toBe(1);
  });

  it("processes a refund after the paid order financial handoff is acknowledged", async () => {
    const externalOrderId = "TILDA-REFUND-AFTER-HANDOFF-1";
    const paymentTransactionId = 881005;
    const order = await createPaidTildaOrder(
      externalOrderId,
      paymentTransactionId,
    );
    expect(order.financialHandoffStatus).toBe("ACKNOWLEDGED");
    expect(
      order.ledgerTransactions.some(
        (transaction) => transaction.type === "ACCRUAL",
      ),
    ).toBe(true);

    await sendCloudPaymentsRefund({
      refundTransactionId: 991006,
      paymentTransactionId,
      externalOrderId,
      amount: "1000.00",
    }).expect(200);

    const corrected = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        commission: true,
        ledgerTransactions: true,
      },
    });
    expect(corrected.financialHandoffStatus).toBe("ACKNOWLEDGED");
    expect(corrected.returnedAmountMinor).toBe(100000n);
    expect(corrected.commission?.creatorAmountMinor).toBe(19500n);
    expect(corrected.commission?.platformAmountMinor).toBe(10500n);
    expect(
      corrected.ledgerTransactions.some(
        (transaction) => transaction.type === "REVERSAL",
      ),
    ).toBe(true);
  });

  it("rejects an unauthenticated CloudPayments refund notification", async () => {
    await sendCloudPaymentsRefund({
      refundTransactionId: 991007,
      paymentTransactionId: 881005,
      externalOrderId: "TILDA-REFUND-AFTER-HANDOFF-1",
      amount: "100.00",
      hmac: "invalid",
    }).expect(403);
    expect(
      await prisma.stage8OrderEvent.count({
        where: { externalEventId: "cloudpayments:refund:991007" },
      }),
    ).toBe(0);
  });

  it("does not report Tilda as connected until the CloudPayments Refund URL matches", async () => {
    jest
      .spyOn(cloudPayments, "verifyCredentials")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    jest
      .spyOn(cloudPayments, "getNotificationSettings")
      .mockResolvedValueOnce({
        Success: true,
        Model: {
          IsEnabled: true,
          Address: "https://wrong.example.test/refund",
          HttpMethod: "POST",
        },
      })
      .mockResolvedValueOnce({
        Success: true,
        Model: {
          IsEnabled: true,
          Address: tildaSetup.cloudPaymentsRefundUrl,
          HttpMethod: "POST",
        },
      });

    const notReady = await request(app.getHttpServer())
      .post("/api/brand/tilda-integration/check")
      .set(auth(brandToken))
      .expect(201);
    expect(notReady.body.status).toBe("WAITING_FOR_WEBHOOK");
    expect(notReady.body.diagnostic.code).toBe("REFUND_WEBHOOK_NOT_CONFIGURED");

    const ready = await request(app.getHttpServer())
      .post("/api/brand/tilda-integration/check")
      .set(auth(brandToken))
      .expect(201);
    expect(ready.body.status).toBe("ACTIVE");
    expect(ready.body.diagnostic.code).toBe("CONNECTED");
  });

  it("returns human-readable Tilda diagnostics for a wrong key and domain mismatch", async () => {
    const integration = await request(app.getHttpServer())
      .get("/api/brand/tilda-integration")
      .set(auth(brandToken))
      .expect(200);
    const webhookUrl = new URL(integration.body.tildaWebhookUrl);
    const webhookPath = `${webhookUrl.pathname}${webhookUrl.search}`;
    await request(app.getHttpServer())
      .post(`/api/v1/integrations/tilda/${integration.body.id}/orders`)
      .type("form")
      .send({ test: "test" })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain(
          "Ключ подключения Tilda не совпадает",
        );
      });

    await request(app.getHttpServer())
      .post(webhookPath)
      .type("form")
      .send({
        tranid: "TILDA-WRONG-DOMAIN-1",
        "payment[amount]": "1000.00",
        "payment[currency]": "RUB",
        "tildaspec-referer": "https://another-shop.example/cart",
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("другого домена");
      });

    const status = await request(app.getHttpServer())
      .get("/api/brand/tilda-integration")
      .set(auth(brandToken))
      .expect(200);
    expect(status.body.diagnostic.code).toBe("TILDA_DOMAIN_MISMATCH");
    expect(status.body.diagnostic.message).not.toMatch(
      /ConflictException|Prisma|HTTP|409/,
    );
  });

  it("keeps real Tilda orders blocked while order ingestion is disabled", async () => {
    const integration = await request(app.getHttpServer())
      .get("/api/brand/tilda-integration")
      .set(auth(brandToken))
      .expect(200);
    const webhookUrl = new URL(integration.body.tildaWebhookUrl);
    config.set("STAGE8_ORDER_INGESTION_ENABLED", "false");
    await request(app.getHttpServer())
      .post(`${webhookUrl.pathname}${webhookUrl.search}`)
      .type("form")
      .send({
        tranid: "TILDA-FLAG-OFF-1",
        "payment[amount]": "1000.00",
        "payment[currency]": "RUB",
      })
      .expect(503);
    config.set("STAGE8_ORDER_INGESTION_ENABLED", "true");
    expect(
      await prisma.stage8OrderEvent.count({
        where: { externalOrderId: "TILDA-FLAG-OFF-1" },
      }),
    ).toBe(0);
  });

  it("routes a CloudPayments amount mismatch to review without finance handoff", async () => {
    const integration = await request(app.getHttpServer())
      .get("/api/brand/tilda-integration")
      .set(auth(brandToken))
      .expect(200);
    const webhookUrl = new URL(integration.body.tildaWebhookUrl);
    const externalOrderId = "TILDA-AMOUNT-MISMATCH-1";
    await request(app.getHttpServer())
      .post(`${webhookUrl.pathname}${webhookUrl.search}`)
      .type("form")
      .send({
        tranid: externalOrderId,
        "payment[amount]": "1000.00",
        "payment[currency]": "RUB",
        affiliate_code: relationship.affiliateCode,
      })
      .expect(200);
    jest.spyOn(cloudPayments, "findPayment").mockResolvedValueOnce({
      Success: true,
      Model: {
        TransactionId: 880002,
        InvoiceId: externalOrderId,
        Status: "Completed",
        Amount: "999.00",
        Currency: "RUB",
      },
    });

    await expect(tilda.processPendingPayments()).resolves.toMatchObject({
      checked: 1,
      paid: 0,
    });

    const order = await prisma.order.findUniqueOrThrow({
      where: {
        brandId_externalOrderId: {
          brandId: relationship.offer.brandId,
          externalOrderId,
        },
      },
    });
    expect(order.financialHandoffStatus).not.toBe("ACKNOWLEDGED");
    expect(
      await prisma.commission.count({ where: { orderId: order.id } }),
    ).toBe(0);
    expect(
      await prisma.attributionException.count({
        where: {
          orderId: order.id,
          type: "MANUAL_CORRECTION_REQUIRED",
          reasonCodes: { has: "PAYMENT_AMOUNT_MISMATCH" },
        },
      }),
    ).toBe(1);
  });

  it("caps tracker sessions by the commercial agreement attribution window", async () => {
    const shortWindowCreatorToken = await registerAndLogin({
      email: "stage8-short-window@example.test",
      password: "Stage8ShortWindow123",
      role: "CREATOR",
      name: "Stage 8 Short Window",
    });
    const shortWindowOffer = (
      await request(app.getHttpServer())
        .post("/api/brand/offers")
        .set(auth(brandToken))
        .send({
          title: "Stage 8 seven-day attribution",
          description: "Offer with a shorter immutable attribution window.",
          productUrl: "https://shop.stage8.test/short-window",
          productPriceKopecks: 100_000,
          totalCommissionPoolBps: 1500,
          promotionWithoutProduct: "YES",
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${shortWindowOffer.id}/commercial-terms`)
      .set(auth(brandToken))
      .send({
        totalCommissionPoolBps: 1500,
        attributionWindow: { windowDays: 7 },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${shortWindowOffer.id}/publish`)
      .set(auth(brandToken))
      .expect(201);
    const application = (
      await request(app.getHttpServer())
        .post(`/api/creator/offers/${shortWindowOffer.id}/applications`)
        .set(auth(shortWindowCreatorToken))
        .send({ expectedCommercialTermsVersion: 2 })
        .expect(201)
    ).body;
    const shortWindowRelationship = (
      await request(app.getHttpServer())
        .post(`/api/brand/applications/${application.id}/approve`)
        .set(auth(brandToken))
        .send({
          expectedAcceptedTermsVersion: 2,
          expectedApplicationVersion: application.version,
        })
        .expect(201)
    ).body;
    const redirect = await request(app.getHttpServer())
      .get(`/go/${shortWindowRelationship.affiliateCode}`)
      .expect(302);
    const attributionId = new URL(redirect.headers.location).searchParams.get(
      "svz_a",
    )!;
    const session = await prisma.clickSession.findUniqueOrThrow({
      where: { publicAttributionId: attributionId },
    });
    expect(session.expiresAt.getTime() - session.firstClickedAt.getTime()).toBe(
      7 * 86_400_000,
    );
  });

  it("automatically attributes a paid sale and exposes expected commission immediately", async () => {
    const redirect = await request(app.getHttpServer())
      .get(`/go/${relationship.affiliateCode}`)
      .expect(302);
    const attributionId = new URL(redirect.headers.location).searchParams.get(
      "svz_a",
    )!;
    const payload = {
      schemaVersion: "1.0",
      type: "PAYMENT_SUCCEEDED",
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: "S8-AUTO-PAID-1",
        createdAt: new Date().toISOString(),
        amountMinor: "300000",
        currency: "RUB",
        offerId,
        items: [
          {
            externalProductId: "SKU-1",
            category: "beauty",
            quantity: "1",
            amountMinor: "300000",
          },
        ],
      },
      attribution: { attributionId },
    };
    const performanceBefore = await request(app.getHttpServer())
      .get("/api/creator/performance/overview")
      .set(auth(creatorToken))
      .expect(200);
    const response = await signedEvent("s8-event-paid-1", payload).expect(201);
    expect(response.body.status).toBe("PROCESSED");

    const order = await prisma.order.findUniqueOrThrow({
      where: {
        brandId_externalOrderId: {
          brandId: (
            await prisma.brandProfile.findUniqueOrThrow({
              where: {
                userId: (
                  await prisma.user.findUniqueOrThrow({
                    where: { email: users.brand.email },
                  })
                ).id,
              },
            })
          ).id,
          externalOrderId: "S8-AUTO-PAID-1",
        },
      },
      include: {
        commission: true,
        currentAttributionResult: true,
        ledgerTransactions: { include: { postings: true } },
      },
    });
    expect(order.currentAttributionResult?.status).toBe("AUTO_ATTRIBUTED");
    expect(order.financialHandoffStatus).toBe("ACKNOWLEDGED");
    expect(order.affiliateCommercialAgreementId).toBeTruthy();
    expect(order.commission?.status).toBe("HOLD");
    expect(order.creatorCommissionAmountMinor).toBe(29250n);
    expect(order.platformCommissionAmountMinor).toBe(15750n);
    expect(order.totalCommissionAmountMinor).toBe(45000n);
    const accrual = order.ledgerTransactions.find(
      (transaction) => transaction.type === "ACCRUAL",
    )!;
    const debit = accrual.postings
      .filter((posting) => posting.direction === "DEBIT")
      .reduce((sum, posting) => sum + posting.amountMinor, 0n);
    const credit = accrual.postings
      .filter((posting) => posting.direction === "CREDIT")
      .reduce((sum, posting) => sum + posting.amountMinor, 0n);
    expect(debit).toBe(credit);

    const performance = await request(app.getHttpServer())
      .get("/api/creator/performance/overview")
      .set(auth(creatorToken))
      .expect(200);
    expect(
      performance.body.paidAttributedOrders -
        performanceBefore.body.paidAttributedOrders,
    ).toBe(1);
    expect(
      BigInt(performance.body.expectedCommissionMinor) -
        BigInt(performanceBefore.body.expectedCommissionMinor),
    ).toBe(29250n);
    expect(
      BigInt(performance.body.confirmedCommissionMinor) -
        BigInt(performanceBefore.body.confirmedCommissionMinor),
    ).toBe(0n);
    expect(
      BigInt(performance.body.paidCommissionMinor) -
        BigInt(performanceBefore.body.paidCommissionMinor),
    ).toBe(0n);

    await signedEvent("s8-event-paid-1", payload)
      .expect(201)
      .expect(({ body }) => {
        expect(body.duplicate).toBe(true);
      });
    expect(
      await prisma.ledgerTransaction.count({
        where: { orderId: order.id, type: "ACCRUAL" },
      }),
    ).toBe(1);
  });

  it("sends cross-creator link and promo conflict to REVIEW_REQUIRED without finance", async () => {
    const payload = {
      schemaVersion: "1.0",
      type: "PAYMENT_SUCCEEDED",
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: "S8-CONFLICT-1",
        amountMinor: "100000",
        currency: "RUB",
        offerId,
      },
      attribution: {
        creatorLinkCode: relationship.affiliateCode,
        promoCode: otherRelationship.promoCode,
      },
    };
    await signedEvent("s8-event-conflict-1", payload).expect(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: "S8-CONFLICT-1" },
      include: { currentAttributionResult: true, commission: true },
    });
    expect(order.currentAttributionResult?.status).toBe("REVIEW_REQUIRED");
    expect(order.currentAttributionResult?.confidenceLevel).toBe("CONFLICT");
    expect(order.financialHandoffStatus).toBe("NOT_READY");
    expect(order.commission).toBeNull();
    const exception = await prisma.attributionException.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(exception.type).toBe("CONFLICTING_ATTRIBUTION");
    expect(exception.dueAt.getTime()).toBeGreaterThan(
      exception.createdAt.getTime() + 2 * 86_400_000,
    );
  });

  it("uses last eligible touch only when evidence belongs to the same agreement", async () => {
    const redirect = await request(app.getHttpServer())
      .get(`/go/${relationship.affiliateCode}`)
      .expect(302);
    const attributionId = new URL(redirect.headers.location).searchParams.get(
      "svz_a",
    )!;
    await signedEvent("s8-last-touch-1", {
      schemaVersion: "1.0",
      type: "PAYMENT_SUCCEEDED",
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: "S8-LAST-TOUCH-1",
        amountMinor: "100000",
        currency: "RUB",
        offerId,
      },
      attribution: {
        attributionId,
        promoCode: relationship.promoCode,
      },
    }).expect(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: "S8-LAST-TOUCH-1" },
    });
    expect(order.attributionSource).toBe("PROMO_CODE");
    expect(order.affiliateRelationshipId).toBe(relationship.id);
  });

  it("creates one immutable CSV batch and converges with a later webhook", async () => {
    const orderDate = new Date().toISOString();
    const preview = await uploadCsv(
      csv([
        `S8-CSV-1,${orderDate},200000,RUB,paid,,${relationship.affiliateCode},,,`,
      ]),
    ).expect(201);
    expect(preview.body.fileChecksum).toMatch(/^[a-f0-9]{64}$/);
    await request(app.getHttpServer())
      .post(`/api/brand/order-imports/${preview.body.id}/confirm`)
      .set(auth(brandToken))
      .expect(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: "S8-CSV-1" },
    });
    expect(
      await prisma.stage8OrderEvent.count({
        where: { orderImportId: preview.body.id },
      }),
    ).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({
        where: { orderId: order.id, type: "ACCRUAL" },
      }),
    ).toBe(1);

    await signedEvent("s8-csv-webhook-convergence-1", {
      schemaVersion: "1.0",
      type: "PAYMENT_SUCCEEDED",
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: "S8-CSV-1",
        amountMinor: "200000",
        currency: "RUB",
        offerId,
      },
      attribution: { creatorLinkCode: relationship.affiliateCode },
    }).expect(201);
    expect(
      await prisma.order.count({ where: { externalOrderId: "S8-CSV-1" } }),
    ).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({
        where: { orderId: order.id, type: "ACCRUAL" },
      }),
    ).toBe(1);
  });

  it("imports a historical partial-return CSV row through synthesized canonical events", async () => {
    const preview = await uploadCsv(
      csv([
        `S8-CSV-PARTIAL-1,${new Date().toISOString()},200000,RUB,partially_returned,50000,${relationship.affiliateCode},,,`,
      ]),
    ).expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/order-imports/${preview.body.id}/confirm`)
      .set(auth(brandToken))
      .expect(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: "S8-CSV-PARTIAL-1" },
      include: { commission: true },
    });
    expect(order.status).toBe("PARTIALLY_RETURNED");
    expect(order.returnedAmountMinor).toBe(50000n);
    expect(order.commission?.creatorAmountMinor).toBe(14625n);
    expect(
      await prisma.stage8OrderEvent.count({
        where: { orderImportId: preview.body.id },
      }),
    ).toBe(2);
  });

  it("applies partial refund and final chargeback only through compensating Stage 7 entries", async () => {
    const partial = {
      schemaVersion: "1.0",
      type: "PARTIAL_REFUND_SUCCEEDED",
      occurredAt: new Date().toISOString(),
      order: { externalOrderId: "S8-AUTO-PAID-1", offerId },
      refundAmountMinor: "50000",
    };
    await signedEvent("s8-event-partial-1", partial).expect(201);
    let order: any = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: "S8-AUTO-PAID-1" },
      include: {
        commission: true,
        ledgerTransactions: { include: { postings: true } },
      },
    });
    expect(order.status).toBe("PARTIALLY_RETURNED");
    expect(order.returnedAmountMinor).toBe(50000n);
    expect(order.commission?.creatorAmountMinor).toBe(24375n);
    expect(order.commission?.platformAmountMinor).toBe(13125n);
    expect(
      order.ledgerTransactions.some(
        (transaction: any) => transaction.type === "REVERSAL",
      ),
    ).toBe(true);

    await signedEvent("s8-event-chargeback-open-1", {
      schemaVersion: "1.0",
      type: "CHARGEBACK_OPENED",
      occurredAt: new Date().toISOString(),
      order: { externalOrderId: "S8-AUTO-PAID-1", offerId },
    }).expect(201);
    expect(
      (
        await prisma.commission.findUniqueOrThrow({
          where: { orderId: order.id },
        })
      ).status,
    ).toBe("DISPUTED");

    await signedEvent("s8-event-chargeback-reversed-1", {
      schemaVersion: "1.0",
      type: "CHARGEBACK_REVERSED",
      occurredAt: new Date().toISOString(),
      order: { externalOrderId: "S8-AUTO-PAID-1", offerId },
    }).expect(201);
    expect(
      (
        await prisma.commission.findUniqueOrThrow({
          where: { orderId: order.id },
        })
      ).status,
    ).toBe("HOLD");

    await signedEvent("s8-event-chargeback-open-2", {
      schemaVersion: "1.0",
      type: "CHARGEBACK_OPENED",
      occurredAt: new Date().toISOString(),
      order: { externalOrderId: "S8-AUTO-PAID-1", offerId },
    }).expect(201);
    await signedEvent("s8-event-chargeback-final-1", {
      schemaVersion: "1.0",
      type: "CHARGEBACK_CONFIRMED",
      occurredAt: new Date().toISOString(),
      order: { externalOrderId: "S8-AUTO-PAID-1", offerId },
    }).expect(201);
    order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: "S8-AUTO-PAID-1" },
      include: { commission: true },
    });
    expect(order.status).toBe("RETURNED");
    expect(order.commission?.status).toBe("REVERSED");
  });

  it("rejects invalid signatures, stale timestamps and cross-tenant access", async () => {
    const payload = {
      schemaVersion: "1.0",
      type: "ORDER_CREATED",
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: "S8-INVALID-AUTH",
        amountMinor: "1000",
        currency: "RUB",
        offerId,
      },
    };
    await signedEvent("s8-invalid-signature", payload, {
      secret: "wrong-test-secret",
    }).expect(401);
    await signedEvent("s8-stale-timestamp", payload, {
      timestamp: Math.floor(Date.now() / 1000) - 301,
    }).expect(401);

    await request(app.getHttpServer())
      .get("/api/brand/attribution-exceptions")
      .set(auth(brandToken))
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/admin/attribution/exceptions")
      .set(auth(adminToken))
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/admin/attribution/exceptions")
      .set(auth(creatorToken))
      .expect(403);
  });

  it("keeps rotated webhook credentials valid only during the overlap window", async () => {
    const rotated = (
      await request(app.getHttpServer())
        .post(
          `/api/brand/tracker-installations/${installation.id}/rotate-secret`,
        )
        .set(auth(brandToken))
        .expect(201)
    ).body;
    await signedEvent("s8-old-key-overlap-1", {
      schemaVersion: "1.0",
      type: "ORDER_CREATED",
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: "S8-OLD-KEY-1",
        amountMinor: "1000",
        currency: "RUB",
        offerId,
      },
      attribution: { creatorLinkCode: relationship.affiliateCode },
    }).expect(201);
    await signedEvent(
      "s8-new-key-1",
      {
        schemaVersion: "1.0",
        type: "ORDER_CREATED",
        occurredAt: new Date().toISOString(),
        order: {
          externalOrderId: "S8-NEW-KEY-1",
          amountMinor: "1000",
          currency: "RUB",
          offerId,
        },
        attribution: { creatorLinkCode: relationship.affiliateCode },
      },
      { secret: rotated.webhookSecret, keyId: rotated.keyId },
    ).expect(201);
  });

  it("records same-event-id payload conflicts without duplicating economics", async () => {
    const original = {
      schemaVersion: "1.0",
      type: "ORDER_CREATED",
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: "S8-EVENT-CONFLICT-1",
        amountMinor: "1000",
        currency: "RUB",
        offerId,
      },
      attribution: { creatorLinkCode: relationship.affiliateCode },
    };
    await signedEvent("s8-event-conflicting-id", original).expect(201);
    await signedEvent("s8-event-conflicting-id", {
      ...original,
      order: { ...original.order, amountMinor: "2000" },
    }).expect(409);
    expect(
      await prisma.attributionException.count({
        where: { type: "EVENT_CONFLICT" },
      }),
    ).toBe(1);
    expect(
      await prisma.stage8OrderEvent.count({
        where: { externalEventId: "s8-event-conflicting-id" },
      }),
    ).toBe(1);
  });

  it("dead-letters order events after the 72-hour retry window and escalates exceptions", async () => {
    const brand = await prisma.brandProfile.findUniqueOrThrow({
      where: {
        userId: (
          await prisma.user.findUniqueOrThrow({
            where: { email: users.brand.email },
          })
        ).id,
      },
    });
    const expiredRetry = await prisma.stage8OrderEvent.create({
      data: {
        brandId: brand.id,
        source: "WEBSITE_TRACKER",
        sourceNamespace: `TRACKER:${installation.id}`,
        externalEventId: "s8-expired-retry-1",
        externalOrderId: "S8-EXPIRED-RETRY-1",
        canonicalOrderKey: "S8-EXPIRED-RETRY-1",
        eventType: "PAYMENT_SUCCEEDED",
        occurredAt: new Date(Date.now() - 73 * 60 * 60 * 1000),
        receivedAt: new Date(Date.now() - 73 * 60 * 60 * 1000),
        amountMinor: 1000n,
        currency: "RUB",
        offerIdHint: offerId,
        payload: { test: true },
        payloadHash: createHash("sha256").update("retry").digest("hex"),
        authenticationContext: { authenticated: true },
        requestId: "stage8-expired-retry-request",
        processingStatus: "RETRY_PENDING",
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });
    const result = await attribution.processRetryableOrderEvents();
    expect(result.deadLettered).toBe(1);
    expect(
      (
        await prisma.stage8OrderEvent.findUniqueOrThrow({
          where: { id: expiredRetry.id },
        })
      ).processingStatus,
    ).toBe("DEAD_LETTER");
    const exception = await prisma.attributionException.findFirstOrThrow({
      where: {
        requestId: "stage8-expired-retry-request",
        type: "MANUAL_CORRECTION_REQUIRED",
      },
    });
    await prisma.attributionException.update({
      where: { id: exception.id },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await attribution.escalateDueExceptions()).escalated,
    ).toBeGreaterThan(0);
    expect(
      (
        await prisma.attributionException.findUniqueOrThrow({
          where: { id: exception.id },
        })
      ).escalatedAt,
    ).toBeTruthy();
  });

  it("enforces 13-month tracking retention and 24-month payload sanitization", async () => {
    const oldTracking = await prisma.trackingEvent.create({
      data: {
        trackerInstallationId: installation.id,
        externalEventId: "s8-retention-tracking-1",
        eventType: "SESSION_STARTED",
        occurredAt: new Date("2025-06-01T00:00:00.000Z"),
        receivedAt: new Date("2025-06-01T00:00:00.000Z"),
        origin: "https://shop.stage8.test",
        payload: { consentState: "UNKNOWN" },
        payloadHash: createHash("sha256").update("tracking").digest("hex"),
      },
    });
    const brand = await prisma.brandProfile.findUniqueOrThrow({
      where: {
        userId: (
          await prisma.user.findUniqueOrThrow({
            where: { email: users.brand.email },
          })
        ).id,
      },
    });
    const oldOrderEvent = await prisma.stage8OrderEvent.create({
      data: {
        brandId: brand.id,
        source: "LEGACY_BACKFILL",
        sourceNamespace: "RETENTION_TEST",
        externalEventId: "s8-retention-order-1",
        externalOrderId: "S8-RETENTION-1",
        canonicalOrderKey: "S8-RETENTION-1",
        eventType: "ORDER_CREATED",
        occurredAt: new Date("2024-06-01T00:00:00.000Z"),
        receivedAt: new Date("2024-06-01T00:00:00.000Z"),
        amountMinor: 1000n,
        currency: "RUB",
        offerIdHint: offerId,
        payload: { customerEmail: "must-not-survive@example.test" },
        payloadHash: createHash("sha256").update("order").digest("hex"),
        authenticationContext: { source: "TEST" },
        requestId: "stage8-retention-request",
        processingStatus: "PROCESSED",
      },
    });
    const result = await attribution.purgeExpiredRetentionData();
    expect(result.trackingEventsDeleted).toBeGreaterThan(0);
    expect(
      await prisma.trackingEvent.findUnique({ where: { id: oldTracking.id } }),
    ).toBeNull();
    expect(
      (
        await prisma.stage8OrderEvent.findUniqueOrThrow({
          where: { id: oldOrderEvent.id },
        })
      ).payload,
    ).toEqual({ redactedByRetention: true });
  });

  it("keeps CMS-neutral attribution and immutable product eligibility finance-free", async () => {
    config.set("STAGE8_FINANCE_HANDOFF_ENABLED", "false");
    const financialCountsBefore = await Promise.all([
      prisma.commission.count(),
      prisma.ledgerTransaction.count(),
      prisma.brandStatement.count(),
      prisma.payout.count(),
      prisma.stage8OutboxEvent.count(),
    ]);
    try {
      const redirect = await request(app.getHttpServer())
        .get(`/go/${relationship.affiliateCode}`)
        .expect(302);
      const attributionId = new URL(redirect.headers.location).searchParams.get(
        "svz_a",
      )!;
      const session = await prisma.clickSession.findUniqueOrThrow({
        where: { publicAttributionId: attributionId },
      });

      const wholeStoreOrderId = "S8-FINANCE-OFF-WHOLE-STORE";
      await signedEvent("s8-finance-off-whole-store", {
        schemaVersion: "1.0",
        type: "PAYMENT_SUCCEEDED",
        occurredAt: new Date().toISOString(),
        order: {
          externalOrderId: wholeStoreOrderId,
          amountMinor: "100000",
          currency: "RUB",
          offerId,
          items: [
            {
              externalProductId: "SKU-ONE",
              quantity: "1",
              amountMinor: "70000",
            },
            {
              externalProductId: "SKU-TWO",
              quantity: "1",
              amountMinor: "30000",
            },
          ],
        },
        attribution: { attributionId },
      }).expect(201);
      const wholeStoreOrder = await prisma.order.findFirstOrThrow({
        where: { externalOrderId: wholeStoreOrderId },
        include: { currentAttributionResult: true },
      });
      expect(wholeStoreOrder.currentAttributionResult).toMatchObject({
        affiliateRelationshipId: session.affiliateRelationshipId,
        affiliateCommercialAgreementId: session.affiliateCommercialAgreementId,
      });
      expect(wholeStoreOrder.commissionableAmountMinor).toBe(100000n);
      expect(wholeStoreOrder.commissionEligibilityProjection).toMatchObject({
        scope: "WHOLE_STORE",
        sourceAgreementSnapshot: true,
        commissionableAmountMinor: "100000",
        lines: [
          expect.objectContaining({
            externalProductId: "SKU-ONE",
            commissionable: true,
          }),
          expect.objectContaining({
            externalProductId: "SKU-TWO",
            commissionable: true,
          }),
        ],
      });

      const noCookieOrderId = "S8-FINANCE-OFF-NO-COOKIE";
      await signedEvent("s8-finance-off-no-cookie", {
        schemaVersion: "1.0",
        type: "PAYMENT_SUCCEEDED",
        occurredAt: new Date().toISOString(),
        order: {
          externalOrderId: noCookieOrderId,
          amountMinor: "10000",
          currency: "RUB",
          offerId,
        },
      }).expect(201);
      expect(
        (
          await prisma.order.findFirstOrThrow({
            where: { externalOrderId: noCookieOrderId },
            include: { currentAttributionResult: true },
          })
        ).currentAttributionResult?.status,
      ).toBe("UNATTRIBUTED");

      const expiringRedirect = await request(app.getHttpServer())
        .get(`/go/${relationship.affiliateCode}`)
        .expect(302);
      const expiredAttributionId = new URL(
        expiringRedirect.headers.location,
      ).searchParams.get("svz_a")!;
      await prisma.clickSession.update({
        where: { publicAttributionId: expiredAttributionId },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      await signedEvent("s8-finance-off-expired", {
        schemaVersion: "1.0",
        type: "PAYMENT_SUCCEEDED",
        occurredAt: new Date().toISOString(),
        order: {
          externalOrderId: "S8-FINANCE-OFF-EXPIRED",
          amountMinor: "10000",
          currency: "RUB",
          offerId,
        },
        attribution: { attributionId: expiredAttributionId },
      }).expect(201);
      expect(
        (
          await prisma.order.findFirstOrThrow({
            where: { externalOrderId: "S8-FINANCE-OFF-EXPIRED" },
            include: { currentAttributionResult: true },
          })
        ).currentAttributionResult?.status,
      ).toBe("UNATTRIBUTED");

      const selectedOffer = (
        await request(app.getHttpServer())
          .post("/api/brand/offers")
          .set(auth(brandToken))
          .send({
            title: "Stage 8 selected product eligibility",
            description:
              "Mixed carts use the immutable selected product agreement.",
            productUrl: "https://shop.stage8.test/",
            productPriceKopecks: 100_000,
            totalCommissionPoolBps: 1500,
            promotionWithoutProduct: "YES",
          })
          .expect(201)
      ).body;
      await request(app.getHttpServer())
        .post(`/api/brand/offers/${selectedOffer.id}/commercial-terms`)
        .set(auth(brandToken))
        .send({
          totalCommissionPoolBps: 1500,
          commissionEligibility: {
            scope: "SELECTED_PRODUCTS",
            externalProductIds: ["SKU-ELIGIBLE"],
          },
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/brand/offers/${selectedOffer.id}/publish`)
        .set(auth(brandToken))
        .expect(201);
      const selectedCreatorToken = await registerAndLogin({
        email: "stage8-selected-products@example.test",
        password: "Stage8Selected123",
        role: "CREATOR",
        name: "Stage 8 Selected Products",
      });
      const selectedApplication = (
        await request(app.getHttpServer())
          .post(`/api/creator/offers/${selectedOffer.id}/applications`)
          .set(auth(selectedCreatorToken))
          .send({ expectedCommercialTermsVersion: 2 })
          .expect(201)
      ).body;
      const selectedRelationship = (
        await request(app.getHttpServer())
          .post(`/api/brand/applications/${selectedApplication.id}/approve`)
          .set(auth(brandToken))
          .send({
            expectedAcceptedTermsVersion: 2,
            expectedApplicationVersion: selectedApplication.version,
          })
          .expect(201)
      ).body;
      const selectedRedirect = await request(app.getHttpServer())
        .get(`/go/${selectedRelationship.affiliateCode}`)
        .expect(302);
      const selectedAttributionId = new URL(
        selectedRedirect.headers.location,
      ).searchParams.get("svz_a")!;
      await signedEvent("s8-finance-off-selected-products", {
        schemaVersion: "1.0",
        type: "PAYMENT_SUCCEEDED",
        occurredAt: new Date().toISOString(),
        order: {
          externalOrderId: "S8-FINANCE-OFF-SELECTED",
          amountMinor: "100000",
          currency: "RUB",
          offerId: selectedOffer.id,
          items: [
            {
              externalProductId: "SKU-ELIGIBLE",
              quantity: "1",
              amountMinor: "60000",
            },
            {
              externalProductId: "SKU-INELIGIBLE",
              quantity: "1",
              amountMinor: "40000",
            },
          ],
        },
        attribution: { attributionId: selectedAttributionId },
      }).expect(201);
      let selectedOrder = await prisma.order.findFirstOrThrow({
        where: { externalOrderId: "S8-FINANCE-OFF-SELECTED" },
      });
      expect(selectedOrder.commissionableAmountMinor).toBe(60000n);
      expect(selectedOrder.commissionEligibilityProjection).toMatchObject({
        scope: "SELECTED_PRODUCTS",
        commissionableAmountMinor: "60000",
        lines: [
          expect.objectContaining({
            externalProductId: "SKU-ELIGIBLE",
            commissionable: true,
            commissionableAmountMinor: "60000",
          }),
          expect.objectContaining({
            externalProductId: "SKU-INELIGIBLE",
            commissionable: false,
            commissionableAmountMinor: "0",
          }),
        ],
      });
      await signedEvent("s8-finance-off-selected-refund", {
        schemaVersion: "1.0",
        type: "PARTIAL_REFUND_SUCCEEDED",
        occurredAt: new Date().toISOString(),
        order: {
          externalOrderId: "S8-FINANCE-OFF-SELECTED",
          offerId: selectedOffer.id,
        },
        refundAmountMinor: "25000",
      }).expect(201);
      selectedOrder = await prisma.order.findFirstOrThrow({
        where: { externalOrderId: "S8-FINANCE-OFF-SELECTED" },
      });
      expect(selectedOrder.returnedAmountMinor).toBe(25000n);
      expect(selectedOrder.returnedCommissionableAmountMinor).toBe(15000n);

      const tildaWebhookUrl = new URL(tildaSetup.tildaWebhookUrl);
      await request(app.getHttpServer())
        .post(`${tildaWebhookUrl.pathname}${tildaWebhookUrl.search}`)
        .type("form")
        .send({
          tranid: "S8-FINANCE-OFF-TILDA",
          "payment[amount]": "1000.00",
          "payment[currency]": "RUB",
          "tildaspec-referer": "https://shop.stage8.test/checkout",
          attributionId,
        })
        .expect(200);
      expect(
        await prisma.stage8OrderEvent.findFirstOrThrow({
          where: {
            externalOrderId: "S8-FINANCE-OFF-TILDA",
            source: "TILDA",
          },
        }),
      ).toMatchObject({
        attributionId,
        source: "TILDA",
      });

      expect(
        await Promise.all([
          prisma.commission.count(),
          prisma.ledgerTransaction.count(),
          prisma.brandStatement.count(),
          prisma.payout.count(),
          prisma.stage8OutboxEvent.count(),
        ]),
      ).toEqual(financialCountsBefore);
    } finally {
      config.set("STAGE8_FINANCE_HANDOFF_ENABLED", "true");
    }
  });

  it("keeps all Stage 8 flags independently enforceable", async () => {
    config.set("STAGE8_ORDER_INGESTION_ENABLED", "false");
    const payload = {
      schemaVersion: "1.0",
      type: "ORDER_CREATED",
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: "S8-FLAG-OFF",
        amountMinor: "1000",
        currency: "RUB",
        offerId,
      },
    };
    await signedEvent("s8-flag-off", payload).expect(503);
    config.set("STAGE8_ORDER_INGESTION_ENABLED", "true");

    for (const key of [
      "STAGE8_TRACKER_ENABLED",
      "STAGE8_TILDA_ENABLED",
      "STAGE8_ORDER_INGESTION_ENABLED",
      "STAGE8_ATTRIBUTION_SHADOW_ENABLED",
      "STAGE8_AUTO_ATTRIBUTION_ENABLED",
      "STAGE8_FINANCE_HANDOFF_ENABLED",
    ]) {
      config.set(key, "false");
    }
    const readiness = await request(app.getHttpServer())
      .get("/api/admin/attribution/readiness")
      .set(auth(adminToken))
      .expect(200);
    expect(readiness.body.disabledIsHealthy).toBe(true);
    expect(Object.values(readiness.body.flags)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    for (const key of [
      "STAGE8_TRACKER_ENABLED",
      "STAGE8_TILDA_ENABLED",
      "STAGE8_ORDER_INGESTION_ENABLED",
      "STAGE8_ATTRIBUTION_SHADOW_ENABLED",
      "STAGE8_AUTO_ATTRIBUTION_ENABLED",
      "STAGE8_FINANCE_HANDOFF_ENABLED",
    ]) {
      config.set(key, "true");
    }
  });
});
