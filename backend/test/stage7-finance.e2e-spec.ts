import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './reset-test-database';

describe('Stage 7 finance and settlement core', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let brandToken: string;
  let otherBrandToken: string;
  let creatorToken: string;
  let otherCreatorToken: string;
  let adminToken: string;
  let offerId: string;
  let applicationId: string;
  let relationship: any;

  const users = {
    brand: {
      email: 'stage7-brand@example.test',
      password: 'Stage7Brand123',
      role: 'BRAND',
      name: 'Stage 7 Brand',
    },
    otherBrand: {
      email: 'stage7-other-brand@example.test',
      password: 'Stage7OtherBrand123',
      role: 'BRAND',
      name: 'Stage 7 Other Brand',
    },
    creator: {
      email: 'stage7-creator@example.test',
      password: 'Stage7Creator123',
      role: 'CREATOR',
      name: 'Stage 7 Creator',
    },
    otherCreator: {
      email: 'stage7-other-creator@example.test',
      password: 'Stage7OtherCreator123',
      role: 'CREATOR',
      name: 'Stage 7 Other Creator',
    },
    admin: {
      email: 'stage7-admin@example.test',
      password: 'Stage7Admin123',
      role: 'BRAND',
      name: 'Stage 7 Admin',
    },
  };

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function registerAndLogin(payload: Record<string, unknown>) {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(201);
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);
    return response.body.accessToken as string;
  }

  function csv(rows: string[]) {
    return [
      'external_order_id,order_date,amount_kopecks,currency,status,returned_amount_kopecks,affiliate_code,promo_code,click_id,offer_id',
      ...rows,
    ].join('\n');
  }

  async function importRows(rows: string[]) {
    const preview = await request(app.getHttpServer())
      .post('/api/brand/order-imports')
      .set(auth(brandToken))
      .attach('file', Buffer.from(csv(rows)), {
        filename: 'stage7-orders.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    const confirmed = await request(app.getHttpServer())
      .post(`/api/brand/order-imports/${preview.body.id}/confirm`)
      .set(auth(brandToken))
      .expect(201);
    return { ...preview.body, confirm: confirmed.body };
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
    config = app.get(ConfigService);
    await resetTestDatabase(prisma);

    brandToken = await registerAndLogin(users.brand);
    otherBrandToken = await registerAndLogin(users.otherBrand);
    creatorToken = await registerAndLogin(users.creator);
    otherCreatorToken = await registerAndLogin(users.otherCreator);
    await registerAndLogin(users.admin);
    await prisma.user.update({
      where: { email: users.admin.email },
      data: { role: 'ADMIN' },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: users.admin.email,
          password: users.admin.password,
        })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    [800, 520, 280],
    [1500, 975, 525],
    [2500, 1625, 875],
  ])(
    'server creates POOL_65_35_V1 terms for %i BPS',
    async (poolBps, creatorBps, platformBps) => {
      const response = await request(app.getHttpServer())
        .post('/api/brand/offers')
        .set(auth(brandToken))
        .send({
          title: `Stage 7 pool ${poolBps}`,
          description: 'Stage 7 deterministic pool calculation offer.',
          productUrl: `https://shop.example.test/stage-7-${poolBps}`,
          productPriceKopecks: 300_000,
          totalCommissionPoolBps: poolBps,
          promotionWithoutProduct: 'YES',
        })
        .expect(201);
      expect(response.body.calculationPolicy).toBe('POOL_65_35_V1');
      expect(response.body.creatorEffectiveBps).toBe(creatorBps);
      expect(response.body.platformEffectiveBps).toBe(platformBps);
      expect(response.body.creatorPoolShareBps).toBe(6500);
      expect(response.body.platformPoolShareBps).toBe(3500);
      if (poolBps === 1500) offerId = response.body.id;
    },
  );

  it('keeps Offer Version independent from Commercial Terms Version', async () => {
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/publish`)
      .set(auth(brandToken))
      .expect(201);
    const before = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      include: { currentVersion: true, currentCommercialTerms: true },
    });

    applicationId = (
      await request(app.getHttpServer())
        .post(`/api/creator/offers/${offerId}/applications`)
        .set(auth(creatorToken))
        .send({ expectedCommercialTermsVersion: 1 })
        .expect(201)
    ).body.id;

    await request(app.getHttpServer())
      .patch(`/api/brand/offers/${offerId}`)
      .set(auth(brandToken))
      .send({ description: 'Content changed without changing economics.' })
      .expect(200);
    const afterContent = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      include: { currentVersion: true, currentCommercialTerms: true },
    });
    expect(afterContent.currentVersion!.version).toBe(
      before.currentVersion!.version + 1,
    );
    expect(afterContent.currentCommercialTerms!.version).toBe(
      before.currentCommercialTerms!.version,
    );
    expect(
      (
        await prisma.offerApplication.findUniqueOrThrow({
          where: { id: applicationId },
        })
      ).termsStatus,
    ).toBe('CURRENT_ACCEPTED');
  });

  it('requires explicit reacceptance only after commercial terms change', async () => {
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/commercial-terms`)
      .set(auth(brandToken))
      .send({ totalCommissionPoolBps: 1000 })
      .expect(201);

    const application = await prisma.offerApplication.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(application.termsStatus).toBe('REACCEPTANCE_REQUIRED');
    expect(application.requiredCreatorAction).toBe('ACCEPT_COMMERCIAL_TERMS');

    const blocked = await request(app.getHttpServer())
      .post(`/api/brand/applications/${applicationId}/approve`)
      .set(auth(brandToken))
      .send({
        expectedAcceptedTermsVersion: 2,
        expectedApplicationVersion: application.version,
      })
      .expect(409);
    expect(blocked.body.code ?? blocked.body.message?.code).toBe(
      'APPLICATION_TERMS_ACCEPTANCE_REQUIRED',
    );

    const terms = await request(app.getHttpServer())
      .get(`/api/creator/applications/${applicationId}/terms`)
      .set(auth(creatorToken))
      .expect(200);
    expect(terms.body.observed.creatorEffectiveBps).toBe(975);
    expect(terms.body.accepted.creatorEffectiveBps).toBe(975);
    expect(terms.body.current.creatorEffectiveBps).toBe(650);

    const notifications = await request(app.getHttpServer())
      .get('/api/creator/notifications')
      .set(auth(creatorToken))
      .expect(200);
    expect(
      notifications.body.some(
        (item: any) =>
          item.applicationId === applicationId && item.actionRequired,
      ),
    ).toBe(true);
    const notification = notifications.body.find(
      (item: any) => item.applicationId === applicationId,
    );
    await request(app.getHttpServer())
      .post(`/api/creator/notifications/${notification.id}/read`)
      .set(auth(creatorToken))
      .expect(201);
    expect(
      (
        await prisma.userNotification.findUniqueOrThrow({
          where: { id: notification.id },
        })
      ).actionRequired,
    ).toBe(true);
  });

  it('rejects stale acceptance and binds only the exact accepted current terms', async () => {
    await request(app.getHttpServer())
      .post(`/api/creator/applications/${applicationId}/accept-terms`)
      .set(auth(creatorToken))
      .send({ expectedCommercialTermsVersion: 1 })
      .expect(409);

    const current = await prisma.offerApplication.findUniqueOrThrow({
      where: { id: applicationId },
    });
    const accepted = await request(app.getHttpServer())
      .post(`/api/creator/applications/${applicationId}/accept-terms`)
      .set(auth(creatorToken))
      .send({
        expectedCommercialTermsVersion: 2,
        expectedApplicationVersion: current.version,
      })
      .expect(201);
    expect(accepted.body.termsStatus).toBe('CURRENT_REACCEPTED');
    expect(
      await prisma.userNotification.count({
        where: {
          applicationId,
          actionRequired: true,
          resolvedAt: null,
        },
      }),
    ).toBe(0);

    relationship = (
      await request(app.getHttpServer())
        .post(`/api/brand/applications/${applicationId}/approve`)
        .set(auth(brandToken))
        .send({
          expectedAcceptedTermsVersion: 2,
          expectedApplicationVersion: accepted.body.version,
        })
        .expect(201)
    ).body;
    const agreement =
      await prisma.affiliateCommercialAgreement.findUniqueOrThrow({
        where: { affiliateRelationshipId: relationship.id },
      });
    expect(agreement.calculationPolicy).toBe('POOL_65_35_V1');
    expect(agreement.totalCommissionPoolBps).toBe(1000);
    expect(agreement.creatorEffectiveGmvBps).toBe(650);
    expect(agreement.platformEffectiveGmvBps).toBe(350);
    expect(agreement.commercialTermsVersionNumber).toBe(2);
    await prisma.affiliateRelationship.update({
      where: { id: relationship.id },
      data: {
        activatedAt: new Date('2026-08-01T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
  });

  it('uses the active immutable agreement for Order snapshots and rounding', async () => {
    const preview = await importRows([
      `S7-ROUNDING,2026-08-08T01:00:00.000Z,1999,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    expect(preview.rows[0].previewCreatorAmountKopecks).toBe(130);
    expect(preview.rows[0].previewPlatformAmountKopecks).toBe(70);

    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'S7-ROUNDING' },
      include: { commission: true, ledgerTransactions: { include: { postings: true } } },
    });
    expect(order.totalCommissionAmountMinor).toBe(200n);
    expect(order.creatorCommissionAmountMinor).toBe(130n);
    expect(order.platformCommissionAmountMinor).toBe(70n);
    expect(order.totalCommissionAmountMinor).toBe(
      order.creatorCommissionAmountMinor! +
        order.platformCommissionAmountMinor!,
    );
    expect(order.commercialTermsVersionNumber).toBe(2);
    expect(order.affiliateCommercialAgreementId).not.toBeNull();
    const accrual = order.ledgerTransactions.find(
      (transaction) => transaction.type === 'ACCRUAL',
    )!;
    const debit = accrual.postings
      .filter((posting) => posting.direction === 'DEBIT')
      .reduce((sum, posting) => sum + posting.amountMinor, 0n);
    const credit = accrual.postings
      .filter((posting) => posting.direction === 'CREDIT')
      .reduce((sum, posting) => sum + posting.amountMinor, 0n);
    expect(debit).toBe(credit);
  });

  it('does not mutate agreement or historical Order after later Offer changes', async () => {
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/commercial-terms`)
      .set(auth(brandToken))
      .send({ totalCommissionPoolBps: 2500 })
      .expect(201);
    const agreement =
      await prisma.affiliateCommercialAgreement.findUniqueOrThrow({
        where: { affiliateRelationshipId: relationship.id },
      });
    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'S7-ROUNDING' },
    });
    expect(agreement.totalCommissionPoolBps).toBe(1000);
    expect(agreement.commercialTermsVersionNumber).toBe(2);
    expect(order.totalCommissionPoolBps).toBe(1000);
    expect(order.creatorCommissionAmountMinor).toBe(130n);
  });

  it('blocks new attribution for a paused relationship but keeps historical returns available', async () => {
    await request(app.getHttpServer())
      .post(`/api/brand/affiliate-relationships/${relationship.id}/pause`)
      .set(auth(brandToken))
      .expect(201);
    const preview = await request(app.getHttpServer())
      .post('/api/brand/order-imports')
      .set(auth(brandToken))
      .attach(
        'file',
        Buffer.from(
          csv([
            `S7-PAUSED-NEW,2026-08-08T02:00:00.000Z,100000,RUB,paid,,${relationship.affiliateCode},,,`,
          ]),
        ),
        { filename: 'stage7-paused.csv', contentType: 'text/csv' },
      )
      .expect(201);
    expect(preview.body.rows[0].status).toBe('INVALID');
    expect(preview.body.rows[0].errors).toContain(
      'Новая финансовая атрибуция требует активной партнёрской связи с коммерческим соглашением',
    );
    await request(app.getHttpServer())
      .post(`/api/brand/affiliate-relationships/${relationship.id}/activate`)
      .set(auth(brandToken))
      .expect(201);
  });

  it('creates bounded compensating reversal for a full return', async () => {
    const imported = await importRows([
      `S7-ROUNDING,2026-08-08T01:00:00.000Z,1999,RUB,returned,,${relationship.affiliateCode},,,`,
    ]);
    expect(imported.confirm).toMatchObject({ created: 0, updated: 1 });
    const returnedOrder = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'S7-ROUNDING' },
    });
    expect(returnedOrder.returnedAmountKopecks).toBe(1999);
    expect(returnedOrder.returnedAmountMinor).toBe(1999n);
    const commission = await prisma.commission.findFirstOrThrow({
      where: { order: { externalOrderId: 'S7-ROUNDING' } },
      include: { ledgerTransactions: { include: { postings: true } } },
    });
    expect(commission.status).toBe('REVERSED');
    const transactions = commission.ledgerTransactions;
    expect(transactions.filter((item) => item.type === 'ACCRUAL')).toHaveLength(1);
    expect(transactions.filter((item) => item.type === 'REVERSAL')).toHaveLength(1);
    for (const transaction of transactions) {
      const debit = transaction.postings
        .filter((posting) => posting.direction === 'DEBIT')
        .reduce((sum, posting) => sum + posting.amountMinor, 0n);
      const credit = transaction.postings
        .filter((posting) => posting.direction === 'CREDIT')
        .reduce((sum, posting) => sum + posting.amountMinor, 0n);
      expect(debit).toBe(credit);
    }
  });

  it('keeps PAID payout immutable and carries post-payout return forward', async () => {
    await importRows([
      `S7-PAID-RETURN,2026-08-08T03:00:00.000Z,100000,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    const first = await prisma.commission.findFirstOrThrow({
      where: { order: { externalOrderId: 'S7-PAID-RETURN' } },
    });
    await prisma.commission.update({
      where: { id: first.id },
      data: { holdUntil: new Date('2026-08-01T00:00:00.000Z') },
    });
    await request(app.getHttpServer())
      .post('/api/admin/commissions/release-hold')
      .set(auth(adminToken))
      .expect(201);
    const firstPayout = await request(app.getHttpServer())
      .post('/api/admin/payouts')
      .set(auth(adminToken))
      .send({ commissionIds: [first.id], reference: 'stage7-first-payout' })
      .expect(201);
    expect(firstPayout.body.amountKopecks).toBe('6500');
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${firstPayout.body.id}/approve`)
      .set(auth(adminToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${firstPayout.body.id}/mark-paid`)
      .set(auth(adminToken))
      .expect(201);
    const paidOrder = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'S7-PAID-RETURN' },
    });
    const paidDispute = await request(app.getHttpServer())
      .post('/api/brand/disputes')
      .set(auth(brandToken))
      .send({
        orderId: paidOrder.id,
        reason: 'Проверка сохранения статуса выплаченной комиссии',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/disputes/${paidDispute.body.id}/resolve`)
      .set(auth(adminToken))
      .send({ resolution: 'Выплаченная комиссия подтверждена' })
      .expect(201);
    expect(
      (
        await prisma.commission.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).status,
    ).toBe('PAID');
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${firstPayout.body.id}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'must remain immutable' })
      .expect(409);

    await importRows([
      `S7-PAID-RETURN,2026-08-08T03:00:00.000Z,100000,RUB,returned,,${relationship.affiliateCode},,,`,
    ]);
    const debt = await prisma.commission.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(debt.status).toBe('PAID');
    expect(debt.recoverableAmountMinor).toBe(6500n);
    expect(debt.hasPostPayoutDebt).toBe(true);

    await importRows([
      `S7-NEXT-EARNING,2026-08-08T04:00:00.000Z,200000,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    const next = await prisma.commission.findFirstOrThrow({
      where: { order: { externalOrderId: 'S7-NEXT-EARNING' } },
    });
    await prisma.commission.update({
      where: { id: next.id },
      data: { holdUntil: new Date('2026-08-01T00:00:00.000Z') },
    });
    await request(app.getHttpServer())
      .post('/api/admin/commissions/release-hold')
      .set(auth(adminToken))
      .expect(201);

    const recoveryPayout = await request(app.getHttpServer())
      .post('/api/admin/payouts')
      .set(auth(adminToken))
      .send({ commissionIds: [next.id], reference: 'stage7-recovery-payout' })
      .expect(201);
    expect(recoveryPayout.body.amountKopecks).toBe('6500');
    const item = await prisma.payoutItem.findFirstOrThrow({
      where: { payoutId: recoveryPayout.body.id, commissionId: next.id },
    });
    expect(item.amountMinor).toBe(6500n);
    expect(item.recoveryAmountMinor).toBe(6500n);

    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${recoveryPayout.body.id}/approve`)
      .set(auth(adminToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${recoveryPayout.body.id}/mark-paid`)
      .set(auth(adminToken))
      .expect(201);
    const recoveredDebt = await prisma.commission.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(recoveredDebt.recoverableAmountMinor).toBe(0n);
    expect(recoveredDebt.hasPostPayoutDebt).toBe(false);
    const recoveryTransaction =
      await prisma.ledgerTransaction.findUniqueOrThrow({
        where: {
          eventKey: `payout:${recoveryPayout.body.id}:recoverable-offset`,
        },
        include: { postings: true },
      });
    expect(recoveryTransaction.type).toBe('RECOVERY');
    expect(
      recoveryTransaction.postings
        .filter((posting) => posting.direction === 'DEBIT')
        .reduce((sum, posting) => sum + posting.amountMinor, 0n),
    ).toBe(
      recoveryTransaction.postings
        .filter((posting) => posting.direction === 'CREDIT')
        .reduce((sum, posting) => sum + posting.amountMinor, 0n),
    );
  });

  it('prevents cross-tenant finance access and hides platform revenue from Creator', async () => {
    await request(app.getHttpServer())
      .get('/api/brand/orders')
      .set(auth(otherBrandToken))
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));
    await request(app.getHttpServer())
      .get('/api/creator/orders')
      .set(auth(otherCreatorToken))
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));

    const creatorOrders = await request(app.getHttpServer())
      .get('/api/creator/orders')
      .set(auth(creatorToken))
      .expect(200);
    expect(JSON.stringify(creatorOrders.body)).not.toContain(
      'platformCommissionAmountMinor',
    );
    expect(JSON.stringify(creatorOrders.body)).not.toContain(
      'platformCommissionBps',
    );
  });

  it('settles a partial return through statement, payment and balances', async () => {
    await importRows([
      `S7-PARTIAL-SETTLEMENT,2026-08-08T01:30:00.000Z,100000,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    await importRows([
      `S7-PARTIAL-SETTLEMENT,2026-08-08T01:30:00.000Z,100000,RUB,partially_returned,25000,${relationship.affiliateCode},,,`,
    ]);
    await importRows([
      `S7-STATEMENT,2026-08-08T02:00:00.000Z,100000,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    const partialOrder = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'S7-PARTIAL-SETTLEMENT' },
      include: {
        commission: true,
        ledgerTransactions: { include: { postings: true } },
      },
    });
    expect(partialOrder.status).toBe('PARTIALLY_RETURNED');
    expect(partialOrder.amountMinor).toBe(100000n);
    expect(partialOrder.returnedAmountMinor).toBe(25000n);
    expect(partialOrder.commission?.creatorAmountMinor).toBe(4875n);
    expect(partialOrder.commission?.platformAmountMinor).toBe(2625n);
    expect(partialOrder.commission?.totalAmountMinor).toBe(7500n);
    expect(
      partialOrder.ledgerTransactions.map((transaction) => transaction.type),
    ).toEqual(expect.arrayContaining(['ACCRUAL', 'REVERSAL']));
    for (const transaction of partialOrder.ledgerTransactions) {
      const debit = transaction.postings
        .filter((posting) => posting.direction === 'DEBIT')
        .reduce((sum, posting) => sum + posting.amountMinor, 0n);
      const credit = transaction.postings
        .filter((posting) => posting.direction === 'CREDIT')
        .reduce((sum, posting) => sum + posting.amountMinor, 0n);
      expect(debit).toBe(credit);
    }
    const start = new Date(Date.now() - 86_400_000);
    const end = new Date(Date.now() + 86_400_000);
    const due = new Date(Date.now() + 172_800_000);
    const statement = await request(app.getHttpServer())
      .post('/api/admin/statements')
      .set(auth(adminToken))
      .send({
        brandId: (
          await prisma.brandProfile.findUniqueOrThrow({
            where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: users.brand.email } })).id },
          })
        ).id,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        dueAt: due.toISOString(),
        currency: 'RUB',
      })
      .expect(201);
    expect(statement.body.status).toBe('ISSUED');
    expect(BigInt(statement.body.totalDueMinor)).toBeGreaterThan(0n);
    const partialLines = statement.body.lines.filter(
      (line: any) => line.orderId === partialOrder.id,
    );
    expect(partialLines).toHaveLength(2);
    expect(
      partialLines.reduce(
        (sum: bigint, line: any) =>
          sum +
          BigInt(line.creatorAmountMinor) +
          BigInt(line.platformAmountMinor),
        0n,
      ),
    ).toBe(7500n);

    const duplicate = await request(app.getHttpServer())
      .post('/api/admin/statements')
      .set(auth(adminToken))
      .send({
        brandId: statement.body.brandId,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        dueAt: due.toISOString(),
        currency: 'RUB',
      })
      .expect(201);
    expect(duplicate.body.id).toBe(statement.body.id);

    await request(app.getHttpServer())
      .post('/api/admin/brand-payments')
      .set(auth(adminToken))
      .send({
        brandId: statement.body.brandId,
        currency: 'RUB',
        amountMinor: statement.body.totalDueMinor,
        paidAt: new Date().toISOString(),
        reference: 'stage7-test-payment',
        allocations: [
          {
            statementId: statement.body.id,
            amountMinor: statement.body.totalDueMinor,
          },
        ],
      })
      .expect(201);
    const stored = await prisma.brandStatement.findUniqueOrThrow({
      where: { id: statement.body.id },
    });
    expect(stored.status).toBe('PAID');
    expect(stored.paidMinor).toBe(stored.totalDueMinor);
    const overview = await request(app.getHttpServer())
      .get('/api/brand/finance/overview')
      .set(auth(brandToken))
      .expect(200);
    expect(overview.body.unpaidMinor).toBe('0');
    expect(overview.body.paidMinor).toBe(overview.body.totalPayableMinor);
    expect(
      await prisma.ledgerTransaction.count({
        where: { statementId: stored.id, type: 'SETTLEMENT' },
      }),
    ).toBe(1);
    const payments = await request(app.getHttpServer())
      .get('/api/admin/brand-payments')
      .set(auth(adminToken))
      .expect(200);
    expect(
      payments.body.some((payment: any) =>
        payment.allocations.some(
          (allocation: any) => allocation.statementId === stored.id,
        ),
      ),
    ).toBe(true);

    const reconciliation = await request(app.getHttpServer())
      .post('/api/admin/reconciliation/run')
      .set(auth(adminToken))
      .expect(201);
    expect(reconciliation.body.status).toBe('PASSED');
    expect(reconciliation.body.mismatchCount).toBe(0);

    const ledger = await request(app.getHttpServer())
      .get('/api/admin/ledger-transactions?pageSize=100')
      .set(auth(adminToken))
      .expect(200);
    expect(ledger.body.items.length).toBeGreaterThan(0);
    expect(
      ledger.body.items.some(
        (transaction: any) =>
          transaction.type === 'SETTLEMENT' &&
          transaction.statement?.id === stored.id,
      ),
    ).toBe(true);
    for (const transaction of ledger.body.items) {
      expect(transaction.postings.length).toBeGreaterThan(1);
      const debit = transaction.postings
        .filter((posting: any) => posting.direction === 'DEBIT')
        .reduce(
          (sum: bigint, posting: any) => sum + BigInt(posting.amountMinor),
          0n,
        );
      const credit = transaction.postings
        .filter((posting: any) => posting.direction === 'CREDIT')
        .reduce(
          (sum: bigint, posting: any) => sum + BigInt(posting.amountMinor),
          0n,
        );
      expect(debit).toBe(credit);
    }
    await request(app.getHttpServer())
      .get('/api/admin/ledger-transactions')
      .set(auth(creatorToken))
      .expect(403);
  });

  it('keeps disputes auditable and ADMIN-controlled', async () => {
    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'S7-STATEMENT' },
    });
    await request(app.getHttpServer())
      .post('/api/brand/disputes')
      .set(auth(otherBrandToken))
      .send({ orderId: order.id, reason: 'Another Brand must not access it' })
      .expect(404);
    const dispute = await request(app.getHttpServer())
      .post('/api/brand/disputes')
      .set(auth(brandToken))
      .send({
        orderId: order.id,
        reason: 'Нужно проверить финансовое событие заказа',
      })
      .expect(201);
    expect(dispute.body.status).toBe('OPEN');
    await request(app.getHttpServer())
      .post(`/api/admin/disputes/${dispute.body.id}/resolve`)
      .set(auth(adminToken))
      .send({ resolution: 'Заказ и расчёт проверены администратором' })
      .expect(201);
    expect(
      (
        await prisma.financialDispute.findUniqueOrThrow({
          where: { id: dispute.body.id },
        })
      ).status,
    ).toBe('RESOLVED');
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: dispute.body.id,
          action: {
            in: ['FINANCIAL_DISPUTE_OPENED', 'FINANCIAL_DISPUTE_RESOLVED'],
          },
        },
      }),
    ).toBe(2);
  });

  it('enforces immutable agreements, ledger, issued statements and PAID payouts in PostgreSQL', async () => {
    const agreement =
      await prisma.affiliateCommercialAgreement.findUniqueOrThrow({
        where: { affiliateRelationshipId: relationship.id },
      });
    await expect(
      prisma.affiliateCommercialAgreement.update({
        where: { id: agreement.id },
        data: { creatorEffectiveGmvBps: 999 },
      }),
    ).rejects.toThrow(/append-only/);

    const transaction = await prisma.ledgerTransaction.findFirstOrThrow();
    await expect(
      prisma.ledgerTransaction.update({
        where: { id: transaction.id },
        data: { reason: 'must not mutate' },
      }),
    ).rejects.toThrow(/append-only/);

    const paidPayout = await prisma.payout.findFirstOrThrow({
      where: { status: 'PAID' },
    });
    await expect(
      prisma.payout.update({
        where: { id: paidPayout.id },
        data: { reference: 'must not mutate' },
      }),
    ).rejects.toThrow(/PAID payout is immutable/);

    const issuedStatement = await prisma.brandStatement.findFirstOrThrow();
    await expect(
      prisma.brandStatement.update({
        where: { id: issuedStatement.id },
        data: { totalDueMinor: issuedStatement.totalDueMinor + 1n },
      }),
    ).rejects.toThrow(/Issued statement content is immutable/);
  });

  it('fails closed when the Stage 7 finance feature flag is disabled', async () => {
    const offer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(auth(brandToken))
      .send({
        title: 'Stage 7 disabled activation',
        description: 'Feature flag must block binding agreement activation.',
        productUrl: 'https://shop.example.test/stage-7-disabled',
        productPriceKopecks: 100_000,
        totalCommissionPoolBps: 1500,
        promotionWithoutProduct: 'YES',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offer.body.id}/publish`)
      .set(auth(brandToken))
      .expect(201);
    const application = await request(app.getHttpServer())
      .post(`/api/creator/offers/${offer.body.id}/applications`)
      .set(auth(otherCreatorToken))
      .send({ expectedCommercialTermsVersion: 1 })
      .expect(201);
    const previous = config.get<string>('STAGE7_FINANCE_ENABLED');
    config.set('STAGE7_FINANCE_ENABLED', 'false');
    try {
      const blocked = await request(app.getHttpServer())
        .post(`/api/brand/applications/${application.body.id}/approve`)
        .set(auth(brandToken))
        .send({ expectedAcceptedTermsVersion: 1 })
        .expect(409);
      expect(blocked.body.code ?? blocked.body.message?.code).toBe(
        'STAGE7_FINANCIAL_ACTIVATION_DISABLED',
      );
      expect(
        await prisma.affiliateRelationship.count({
          where: { applicationId: application.body.id },
        }),
      ).toBe(0);
    } finally {
      config.set('STAGE7_FINANCE_ENABLED', previous ?? 'true');
    }
  });
});
