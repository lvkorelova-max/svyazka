import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PartnershipsService } from '../src/partnerships/partnerships.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './reset-test-database';

process.env.STAGE8_TRACKER_ENABLED = 'true';
process.env.STAGE8_ORDER_INGESTION_ENABLED = 'true';
process.env.STAGE8_ATTRIBUTION_SHADOW_ENABLED = 'true';
process.env.STAGE8_AUTO_ATTRIBUTION_ENABLED = 'true';
process.env.STAGE8_FINANCE_HANDOFF_ENABLED = 'true';

describe('Stage 8 creator promo-code provisioning', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let partnerships: PartnershipsService;
  let brandToken: string;
  let otherBrandToken: string;
  let offerId: string;
  let relationshipA: any;
  let relationshipB: any;
  let otherBrandRelationship: any;
  let installation: any;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function registerAndLogin(
    email: string,
    password: string,
    role: 'BRAND' | 'CREATOR',
    name: string,
  ) {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, role, name })
      .expect(201);
    return (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.accessToken as string;
  }

  async function createOffer(token: string, title: string, domain: string) {
    const offer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(auth(token))
      .send({
        title,
        description: `${title} with a customer promo-code discount.`,
        productUrl: `https://${domain}/product`,
        productPriceKopecks: 300_000,
        totalCommissionPoolBps: 1500,
        customerDiscountType: 'PERCENT',
        customerDiscountBps: 1000,
        promotionWithoutProduct: 'YES',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offer.body.id}/publish`)
      .set(auth(token))
      .expect(201);
    return offer.body.id as string;
  }

  async function createApplication(creatorToken: string, targetOfferId: string) {
    return (
      await request(app.getHttpServer())
        .post(`/api/creator/offers/${targetOfferId}/applications`)
        .set(auth(creatorToken))
        .send({ expectedCommercialTermsVersion: 1 })
        .expect(201)
    ).body;
  }

  async function approve(
    token: string,
    application: { id: string; version: number },
  ) {
    return (
      await request(app.getHttpServer())
        .post(`/api/brand/applications/${application.id}/approve`)
        .set(auth(token))
        .send({
          expectedAcceptedTermsVersion: 1,
          expectedApplicationVersion: application.version,
        })
        .expect(201)
    ).body;
  }

  async function createRelationship(
    token: string,
    creatorToken: string,
    targetOfferId: string,
  ) {
    return approve(
      token,
      await createApplication(creatorToken, targetOfferId),
    );
  }

  function signedEvent(
    eventId: string,
    payload: Record<string, unknown>,
  ) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(payload);
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const signature = createHmac('sha256', installation.webhookSecret)
      .update(`${timestamp}\n${eventId}\n${bodyHash}`)
      .digest('hex');
    return request(app.getHttpServer())
      .post('/api/v1/integrations/order-events')
      .set('content-type', 'application/json')
      .set('svyazka-installation', installation.id)
      .set('svyazka-key-id', installation.keyId)
      .set('svyazka-event-id', eventId)
      .set('svyazka-timestamp', String(timestamp))
      .set('svyazka-signature', `v1=${signature}`)
      .send(payload);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', {
      exclude: [
        { path: 'go/:affiliateCode', method: RequestMethod.GET },
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
        { path: 'track/v1.js', method: RequestMethod.GET },
        { path: 'track/v1/events', method: RequestMethod.POST },
      ],
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
    partnerships = app.get(PartnershipsService);
    const config = app.get(ConfigService);
    config.set('STAGE8_TRACKER_ENABLED', 'true');
    config.set('STAGE8_ORDER_INGESTION_ENABLED', 'true');
    config.set('STAGE8_ATTRIBUTION_SHADOW_ENABLED', 'true');
    config.set('STAGE8_AUTO_ATTRIBUTION_ENABLED', 'true');
    config.set('STAGE8_FINANCE_HANDOFF_ENABLED', 'true');
    await resetTestDatabase(prisma);

    brandToken = await registerAndLogin(
      'promo-brand@example.test',
      'PromoBrand123',
      'BRAND',
      'Promo Brand',
    );
    otherBrandToken = await registerAndLogin(
      'promo-other-brand@example.test',
      'PromoOtherBrand123',
      'BRAND',
      'Other Promo Brand',
    );
    const creatorA = await registerAndLogin(
      'promo-a@example.test',
      'PromoCreatorA123',
      'CREATOR',
      'Promo Creator A',
    );
    const creatorB = await registerAndLogin(
      'promo-b@example.test',
      'PromoCreatorB123',
      'CREATOR',
      'Promo Creator B',
    );
    const creatorOtherBrand = await registerAndLogin(
      'promo-other@example.test',
      'PromoCreatorOther123',
      'CREATOR',
      'Other Brand Creator',
    );
    offerId = await createOffer(
      brandToken,
      'Promo-code invariant offer',
      'promo.test',
    );
    const otherOfferId = await createOffer(
      otherBrandToken,
      'Other brand promo offer',
      'promo-other.test',
    );
    relationshipA = await createRelationship(
      brandToken,
      creatorA,
      offerId,
    );
    relationshipB = await createRelationship(
      brandToken,
      creatorB,
      offerId,
    );
    otherBrandRelationship = await createRelationship(
      otherBrandToken,
      creatorOtherBrand,
      otherOfferId,
    );
    installation = (
      await request(app.getHttpServer())
        .post('/api/brand/tracker-installations')
        .set(auth(brandToken))
        .send({
          name: 'Promo pilot store',
          primaryDomain: 'promo.test',
          allowedOrigins: ['https://promo.test'],
          consentMode: 'REQUIRED',
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/api/brand/tracker-installations/${installation.id}/activate`)
      .set(auth(brandToken))
      .expect(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('approves a relationship while Stage 7 activation and Stage 8 finance handoff remain disabled', async () => {
    const config = app.get(ConfigService);
    config.set('STAGE7_FINANCE_ENABLED', 'false');
    config.set('STAGE7_FINANCIAL_ACTIVATION_ENABLED', 'false');
    config.set('STAGE8_AUTO_ATTRIBUTION_ENABLED', 'true');
    config.set('STAGE8_FINANCE_HANDOFF_ENABLED', 'false');

    try {
      const creatorToken = await registerAndLogin(
        'promo-gated-creator@example.test',
        'PromoGatedCreator123',
        'CREATOR',
        'Promo Gated Creator',
      );
      const application = await createApplication(creatorToken, offerId);
      const before = {
        commissions: await prisma.commission.count(),
        ledgerEntries: await prisma.ledgerEntry.count(),
        ledgerTransactions: await prisma.ledgerTransaction.count(),
        statements: await prisma.brandStatement.count(),
        payouts: await prisma.payout.count(),
        outbox: await prisma.stage8OutboxEvent.count(),
      };

      const approved = await request(app.getHttpServer())
        .post(`/api/brand/applications/${application.id}/approve`)
        .set(auth(brandToken))
        .send({
          expectedAcceptedTermsVersion: 1,
          expectedApplicationVersion: application.version,
        })
        .expect(201);

      expect(approved.body.status).toBe('ACTIVE');
      expect(approved.body.affiliateCode).toBeTruthy();
      expect(approved.body.promoCode).toBeTruthy();
      expect(
        await prisma.affiliateRelationship.findUnique({
          where: { id: approved.body.id },
        }),
      ).toMatchObject({ status: 'ACTIVE' });
      expect(
        await prisma.creatorLink.findFirst({
          where: { affiliateRelationshipId: approved.body.id },
        }),
      ).toMatchObject({
        affiliateRelationshipId: approved.body.id,
        activeUntil: null,
      });
      expect(
        await prisma.creatorPromoCode.findFirst({
          where: { affiliateRelationshipId: approved.body.id },
        }),
      ).toMatchObject({
        status: 'PENDING_PROVISIONING',
        affiliateRelationshipId: approved.body.id,
        discountType: 'PERCENT',
        discountBps: 1000,
      });

      expect(await prisma.commission.count()).toBe(before.commissions);
      expect(await prisma.ledgerEntry.count()).toBe(before.ledgerEntries);
      expect(await prisma.ledgerTransaction.count()).toBe(
        before.ledgerTransactions,
      );
      expect(await prisma.brandStatement.count()).toBe(before.statements);
      expect(await prisma.payout.count()).toBe(before.payouts);
      expect(await prisma.stage8OutboxEvent.count()).toBe(before.outbox);
    } finally {
      config.set('STAGE7_FINANCE_ENABLED', 'true');
      config.set('STAGE7_FINANCIAL_ACTIVATION_ENABLED', 'true');
      config.set('STAGE8_FINANCE_HANDOFF_ENABLED', 'true');
    }
  });

  it('creates one immutable-owner promo record with the Offer discount', async () => {
    const promo = await prisma.creatorPromoCode.findUniqueOrThrow({
      where: { normalizedCode: relationshipA.promoCode },
    });
    expect(promo.creatorId).toBe(relationshipA.creatorId);
    expect(promo.affiliateRelationshipId).toBe(relationshipA.id);
    expect(promo.offerId).toBe(offerId);
    expect(promo.discountType).toBe('PERCENT');
    expect(promo.discountBps).toBe(1000);
    expect(promo.status).toBe('PENDING_PROVISIONING');
    expect(promo.normalizationPolicy).toBe('NFKC_TRIM_UPPER_V1');
  });

  it('rejects case-insensitive and whitespace-normalized collisions', async () => {
    await request(app.getHttpServer())
      .patch(
        `/api/brand/affiliate-relationships/${relationshipB.id}/promo-code`,
      )
      .set(auth(brandToken))
      .send({ code: ` ${relationshipA.promoCode.toLowerCase()} ` })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('PROMO_CODE_PERMANENTLY_RESERVED');
        expect(body.message).toBe(
          'Этот промокод уже используется или использовался ранее. Выберите другой.',
        );
        expect(JSON.stringify(body)).not.toContain(relationshipA.creatorId);
      });
  });

  it('keeps manual Tilda confirmation distinct from actual Order verification', async () => {
    relationshipB = (
      await request(app.getHttpServer())
        .post(
          `/api/brand/affiliate-relationships/${relationshipB.id}/promo-code/confirm-tilda`,
        )
        .set(auth(brandToken))
        .expect(201)
    ).body;
    expect(relationshipB.promoCodeDetails.status).toBe(
      'PROVISIONING_CONFIRMED',
    );
    expect(
      relationshipB.promoCodeDetails.provisioningConfirmedAt,
    ).not.toBeNull();
    expect(relationshipB.promoCodeDetails.verifiedAt).toBeNull();
    expect(relationshipB.promoCodeDetails.firstUsedAt).toBeNull();
  });

  it("does not let another Brand use another Creator's code", async () => {
    await request(app.getHttpServer())
      .patch(
        `/api/brand/affiliate-relationships/${otherBrandRelationship.id}/promo-code`,
      )
      .set(auth(otherBrandToken))
      .send({ code: relationshipA.promoCode })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('PROMO_CODE_PERMANENTLY_RESERVED'),
      );
  });

  it('replaces before first use without releasing the old identity', async () => {
    const oldCode = relationshipA.promoCode;
    relationshipA = (
      await request(app.getHttpServer())
        .patch(
          `/api/brand/affiliate-relationships/${relationshipA.id}/promo-code`,
        )
        .set(auth(brandToken))
        .send({ code: ' Melissa10 ' })
        .expect(200)
    ).body;
    expect(relationshipA.promoCode).toBe('MELISSA10');
    expect(relationshipA.promoCodeDetails.status).toBe(
      'PENDING_PROVISIONING',
    );
    const old = await prisma.creatorPromoCode.findUniqueOrThrow({
      where: { normalizedCode: oldCode },
    });
    const replacement = await prisma.creatorPromoCode.findUniqueOrThrow({
      where: { normalizedCode: 'MELISSA10' },
    });
    expect(old.status).toBe('REPLACED');
    expect(old.activeUntil).not.toBeNull();
    expect(replacement.replacementForId).toBe(old.id);
    expect(replacement.creatorId).toBe(old.creatorId);
    expect(replacement.affiliateRelationshipId).toBe(
      old.affiliateRelationshipId,
    );
  });

  it.each([
    ['REPLACED', () => relationshipA.creatorPromoCodes?.[0]?.rawCode],
    ['EXPIRED', () => 'EXPIRED10'],
    ['REVOKED', () => 'REVOKED10'],
  ])('%s codes remain permanently reserved', async (status, codeFactory) => {
    if (status !== 'REPLACED') {
      const owner = await prisma.creatorPromoCode.findUniqueOrThrow({
        where: { normalizedCode: 'MELISSA10' },
      });
      const code = codeFactory()!;
      await prisma.creatorPromoCode.create({
        data: {
          brandId: owner.brandId,
          offerId: owner.offerId,
          creatorId: owner.creatorId,
          affiliateRelationshipId: owner.affiliateRelationshipId,
          affiliateCommercialAgreementId:
            owner.affiliateCommercialAgreementId,
          rawCode: code,
          normalizedCode: code,
          normalizationPolicy: 'NFKC_TRIM_UPPER_V1',
          discountType: owner.discountType,
          discountBps: owner.discountBps,
          discountAmountMinor: owner.discountAmountMinor,
          currency: owner.currency,
          status: status as 'EXPIRED' | 'REVOKED',
          activeFrom: new Date(Date.now() - 86_400_000),
          activeUntil: new Date(),
          ...(status === 'REVOKED' ? { revokedAt: new Date() } : {}),
        },
      });
    }
    const reservedCode =
      status === 'REPLACED'
        ? (
            await prisma.creatorPromoCode.findFirstOrThrow({
              where: {
                affiliateRelationshipId: relationshipA.id,
                status: 'REPLACED',
              },
            })
          ).rawCode
        : codeFactory()!;
    await request(app.getHttpServer())
      .patch(
        `/api/brand/affiliate-relationships/${relationshipB.id}/promo-code`,
      )
      .set(auth(brandToken))
      .send({ code: reservedCode })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('PROMO_CODE_PERMANENTLY_RESERVED'),
      );
  });

  it('lets concurrent approvals recover from one generated collision', async () => {
    const creatorC = await registerAndLogin(
      'promo-c@example.test',
      'PromoCreatorC123',
      'CREATOR',
      'Promo Creator C',
    );
    const creatorD = await registerAndLogin(
      'promo-d@example.test',
      'PromoCreatorD123',
      'CREATOR',
      'Promo Creator D',
    );
    const [applicationC, applicationD] = await Promise.all([
      createApplication(creatorC, offerId),
      createApplication(creatorD, offerId),
    ]);
    let generated = 0;
    const generator = jest
      .spyOn(partnerships as any, 'generatePromoCode')
      .mockImplementation(() => {
        generated += 1;
        return generated <= 2
          ? 'RACE2026'
          : `RACE${String(generated).padStart(6, '0')}`;
      });
    const [approvedC, approvedD] = await Promise.all([
      approve(brandToken, applicationC),
      approve(brandToken, applicationD),
    ]);
    generator.mockRestore();
    expect(approvedC.promoCode).not.toBe(approvedD.promoCode);
    expect(
      await prisma.creatorPromoCode.count({
        where: {
          normalizedCode: {
            in: [approvedC.promoCode, approvedD.promoCode],
          },
        },
      }),
    ).toBe(2);
  });

  it('resolves a historical replaced code to its original owner', async () => {
    const historical = await prisma.creatorPromoCode.findFirstOrThrow({
      where: {
        affiliateRelationshipId: relationshipA.id,
        status: 'REPLACED',
      },
    });
    expect(historical.activeUntil).not.toBeNull();
    const occurredAt = new Date(historical.activeFrom.getTime());
    const payload = {
      schemaVersion: '1.0',
      type: 'PAYMENT_SUCCEEDED',
      occurredAt: occurredAt.toISOString(),
      order: {
        externalOrderId: 'PROMO-HISTORICAL-1',
        amountMinor: '100000',
        currency: 'RUB',
        offerId,
      },
      attribution: { promoCode: historical.rawCode },
    };
    await signedEvent('promo-historical-event-1', payload).expect(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'PROMO-HISTORICAL-1' },
      include: { affiliateRelationship: true },
    });
    expect(order.affiliateRelationshipId).toBe(relationshipA.id);
    expect(order.affiliateRelationship?.creatorId).toBe(
      relationshipA.creatorId,
    );
    expect(order.attributionSource).toBe('PROMO_CODE');
  });

  it('locks manual editing after the first immutable Order Event', async () => {
    const payload = {
      schemaVersion: '1.0',
      type: 'PAYMENT_SUCCEEDED',
      occurredAt: new Date().toISOString(),
      order: {
        externalOrderId: 'PROMO-FIRST-USE-1',
        amountMinor: '100000',
        currency: 'RUB',
        offerId,
      },
      attribution: { promoCode: relationshipA.promoCode },
    };
    await signedEvent('promo-first-use-event-1', payload).expect(201);
    await request(app.getHttpServer())
      .patch(
        `/api/brand/affiliate-relationships/${relationshipA.id}/promo-code`,
      )
      .set(auth(brandToken))
      .send({ code: 'AFTERUSE10' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PROMO_CODE_ALREADY_USED'));
  });

  it('enforces immutable owner identity and permanent records in PostgreSQL', async () => {
    const promo = await prisma.creatorPromoCode.findUniqueOrThrow({
      where: { normalizedCode: relationshipA.promoCode },
    });
    await expect(
      prisma.creatorPromoCode.update({
        where: { id: promo.id },
        data: { creatorId: relationshipB.creatorId },
      }),
    ).rejects.toThrow(/identity and ownership are immutable/);
    await expect(
      prisma.creatorPromoCode.delete({ where: { id: promo.id } }),
    ).rejects.toThrow(/records are permanent/);
    expect(
      createHash('sha256')
        .update(
          `${promo.creatorId}:${promo.affiliateRelationshipId}:${promo.brandId}:${promo.offerId}`,
        )
        .digest('hex'),
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a normalized identity that does not match the raw code', async () => {
    const owner = await prisma.creatorPromoCode.findUniqueOrThrow({
      where: { normalizedCode: relationshipB.promoCode },
    });
    await expect(
      prisma.creatorPromoCode.create({
        data: {
          brandId: owner.brandId,
          offerId: owner.offerId,
          creatorId: owner.creatorId,
          affiliateRelationshipId: owner.affiliateRelationshipId,
          affiliateCommercialAgreementId:
            owner.affiliateCommercialAgreementId,
          rawCode: ` ${relationshipA.promoCode.toLowerCase()} `,
          normalizedCode: 'MISMATCH10',
          normalizationPolicy: 'NFKC_TRIM_UPPER_V1',
          discountType: owner.discountType,
          discountBps: owner.discountBps,
          discountAmountMinor: owner.discountAmountMinor,
          currency: owner.currency,
          status: 'EXPIRED',
          activeFrom: new Date(Date.now() - 86_400_000),
          activeUntil: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('prevents the relationship promo pointer from referencing another immutable owner', async () => {
    const otherOwner = await prisma.creatorPromoCode.findUniqueOrThrow({
      where: { normalizedCode: relationshipB.promoCode },
    });
    await prisma.creatorPromoCode.create({
      data: {
        brandId: otherOwner.brandId,
        offerId: otherOwner.offerId,
        creatorId: otherOwner.creatorId,
        affiliateRelationshipId: otherOwner.affiliateRelationshipId,
        affiliateCommercialAgreementId:
          otherOwner.affiliateCommercialAgreementId,
        rawCode: 'OTHEROWNER10',
        normalizedCode: 'OTHEROWNER10',
        normalizationPolicy: 'NFKC_TRIM_UPPER_V1',
        discountType: otherOwner.discountType,
        discountBps: otherOwner.discountBps,
        discountAmountMinor: otherOwner.discountAmountMinor,
        currency: otherOwner.currency,
        status: 'EXPIRED',
        activeFrom: new Date(Date.now() - 86_400_000),
        activeUntil: new Date(),
      },
    });
    await expect(
      prisma.affiliateRelationship.update({
        where: { id: relationshipA.id },
        data: { promoCode: 'OTHEROWNER10' },
      }),
    ).rejects.toThrow(/must reference its immutable CreatorPromoCode owner/);
    await expect(
      prisma.affiliateRelationship.update({
        where: { id: relationshipA.id },
        data: { creatorId: relationshipB.creatorId },
      }),
    ).rejects.toThrow(/must reference its immutable CreatorPromoCode owner/);
  });

  it('revokes a manually provisioned code without deleting its owner record', async () => {
    await request(app.getHttpServer())
      .post(`/api/brand/affiliate-relationships/${relationshipB.id}/revoke`)
      .set(auth(brandToken))
      .expect(201);
    const promo = await prisma.creatorPromoCode.findUniqueOrThrow({
      where: { normalizedCode: relationshipB.promoCode },
    });
    expect(promo.status).toBe('REVOKED');
    expect(promo.revokedAt).not.toBeNull();
    expect(promo.activeUntil).not.toBeNull();
  });
});
