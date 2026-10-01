import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './reset-test-database';

describe('Stage 5A financial hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let brandToken: string;
  let creatorToken: string;
  let adminToken: string;
  let offerId: string;
  let relationship: any;

  const brand = {
    email: 'stage5-brand@example.test',
    password: 'Stage5Brand123',
    role: 'BRAND',
    name: 'Stage 5 Brand',
  };
  const creator = {
    email: 'stage5-creator@example.test',
    password: 'Stage5Creator123',
    role: 'CREATOR',
    name: 'Stage 5 Creator',
  };
  const admin = {
    email: 'stage5-admin@example.test',
    password: 'Stage5Admin123',
    role: 'BRAND',
    name: 'Stage 5 Admin',
  };

  async function createApplication() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api', {
      exclude: [
        { path: 'go/:affiliateCode', method: RequestMethod.GET },
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
      ],
    });
    instance.use(cookieParser());
    instance.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    instance.useGlobalInterceptors(new BigIntSerializerInterceptor());
    await instance.init();
    return instance;
  }

  async function registerAndLogin(payload: Record<string, unknown>) {
    await request(app.getHttpServer()).post('/api/auth/register').send(payload).expect(201);
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);
    return response.body.accessToken as string;
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function csv(rows: string[]) {
    return [
      'external_order_id,order_date,amount_kopecks,currency,status,returned_amount_kopecks,affiliate_code,promo_code,click_id,offer_id',
      ...rows,
    ].join('\n');
  }

  function uploadCsv(rows: string[]) {
    return request(app.getHttpServer())
      .post('/api/brand/order-imports')
      .set(auth(brandToken))
      .attach('file', Buffer.from(csv(rows)), {
        filename: 'stage5-orders.csv',
        contentType: 'text/csv',
      });
  }

  async function confirm(importId: string) {
    return request(app.getHttpServer())
      .post(`/api/brand/order-imports/${importId}/confirm`)
      .set(auth(brandToken))
      .expect(201);
  }

  async function importRows(rows: string[]) {
    const preview = await uploadCsv(rows).expect(201);
    await confirm(preview.body.id);
    return preview.body;
  }

  async function commissionFor(externalOrderId: string) {
    return prisma.commission.findFirstOrThrow({
      where: { order: { externalOrderId } },
      include: { ledgerEntries: true },
    });
  }

  async function releaseCommission(externalOrderId: string) {
    const commission = await commissionFor(externalOrderId);
    await prisma.commission.update({
      where: { id: commission.id },
      data: { holdUntil: new Date('2020-01-01T00:00:00.000Z') },
    });
    await request(app.getHttpServer())
      .post('/api/admin/commissions/release-hold')
      .set(auth(adminToken))
      .expect(201);
    return prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
  }

  beforeAll(async () => {
    app = await createApplication();
    prisma = app.get(PrismaService);
    await resetTestDatabase(prisma);

    brandToken = await registerAndLogin(brand);
    creatorToken = await registerAndLogin(creator);
    await registerAndLogin(admin);
    await prisma.user.update({
      where: { email: admin.email },
      data: { role: 'ADMIN' },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200)
    ).body.accessToken;

    const offer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(auth(brandToken))
      .send({
        title: 'Stage 5 finance offer',
        description: 'Isolated financial hardening test offer.',
        productUrl: 'https://shop.example.test/stage-5',
        productPriceKopecks: 100_000,
        creatorCommissionBps: 1250,
        promotionWithoutProduct: 'YES',
      })
      .expect(201);
    offerId = offer.body.id;
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/publish`)
      .set(auth(brandToken))
      .expect(201);
    const application = await request(app.getHttpServer())
      .post(`/api/creator/offers/${offerId}/applications`)
      .set(auth(creatorToken))
      .send({ message: 'Stage 5 finance tests' })
      .expect(201);
    relationship = (
      await request(app.getHttpServer())
        .post(`/api/brand/applications/${application.body.id}/approve`)
        .set(auth(brandToken))
        .expect(201)
    ).body;
    await prisma.affiliateRelationship.update({
      where: { id: relationship.id },
      data: {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        activatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('PENDING → CANCELLED не создаёт ложный REVERSAL', async () => {
    await importRows([
      `S5-PENDING-CANCEL,2026-07-10T10:00:00.000Z,10000,RUB,pending,,${relationship.affiliateCode},,,`,
    ]);
    await importRows([
      `S5-PENDING-CANCEL,2026-07-10T10:00:00.000Z,10000,RUB,cancelled,,${relationship.affiliateCode},,,`,
    ]);

    const commission = await commissionFor('S5-PENDING-CANCEL');
    expect(commission.status).toBe('REVERSED');
    expect(commission.ledgerEntries).toHaveLength(0);
  });

  it('PENDING → PAID → CANCELLED ограничивает REVERSAL суммой ACCRUAL', async () => {
    await importRows([
      `S5-PENDING-PAID-CANCEL,2026-07-11T10:00:00.000Z,10005,RUB,pending,,${relationship.affiliateCode},,,`,
    ]);
    await importRows([
      `S5-PENDING-PAID-CANCEL,2026-07-11T10:00:00.000Z,10005,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    await importRows([
      `S5-PENDING-PAID-CANCEL,2026-07-11T10:00:00.000Z,10005,RUB,cancelled,,${relationship.affiliateCode},,,`,
    ]);
    await importRows([
      `S5-PENDING-PAID-CANCEL,2026-07-11T10:00:00.000Z,10005,RUB,cancelled,,${relationship.affiliateCode},,,`,
    ]);

    const commission = await commissionFor('S5-PENDING-PAID-CANCEL');
    const accrued = commission.ledgerEntries
      .filter((entry) => entry.type === 'ACCRUAL')
      .reduce((sum, entry) => sum + entry.amountKopecks, 0);
    const reversed = commission.ledgerEntries
      .filter((entry) => entry.type === 'REVERSAL')
      .reduce((sum, entry) => sum + -entry.amountKopecks, 0);
    expect(accrued).toBe(1251);
    expect(reversed).toBe(1251);
    expect(reversed).toBeLessThanOrEqual(accrued);
    expect(commission.ledgerEntries.filter((entry) => entry.type === 'REVERSAL')).toHaveLength(1);
  });

  it('PAID → RETURNED и частичный возврат создают только обеспеченные reversals', async () => {
    await importRows([
      `S5-RETURNED,2026-07-12T10:00:00.000Z,20000,RUB,paid,,${relationship.affiliateCode},,,`,
      `S5-PARTIAL,2026-07-13T10:00:00.000Z,20000,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    await importRows([
      `S5-RETURNED,2026-07-12T10:00:00.000Z,20000,RUB,returned,,${relationship.affiliateCode},,,`,
      `S5-PARTIAL,2026-07-13T10:00:00.000Z,20000,RUB,partially_returned,5000,${relationship.affiliateCode},,,`,
    ]);

    const returned = await commissionFor('S5-RETURNED');
    const partial = await commissionFor('S5-PARTIAL');
    expect(returned.status).toBe('REVERSED');
    expect(
      returned.ledgerEntries.find((entry) => entry.type === 'REVERSAL')?.amountKopecks,
    ).toBe(-2500);
    expect(partial.creatorAmountKopecks).toBe(1875);
    expect(
      partial.ledgerEntries.find((entry) => entry.type === 'REVERSAL')?.amountKopecks,
    ).toBe(-625);
  });

  it('confirm использует BPS и суммы, сохранённые во время preview', async () => {
    const preview = await uploadCsv([
      `S5-SNAPSHOT,2026-07-14T10:00:00.000Z,10005,RUB,paid,,${relationship.affiliateCode},,,`,
    ]).expect(201);
    const row = preview.body.rows[0];
    expect(row.creatorCommissionBpsSnapshot).toBe(1250);
    expect(row.previewCreatorAmountKopecks).toBe(1251);

    await request(app.getHttpServer())
      .patch(`/api/brand/offers/${offerId}`)
      .set(auth(brandToken))
      .send({ creatorCommissionBps: 500 })
      .expect(200);
    await confirm(preview.body.id);

    const order = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'S5-SNAPSHOT' },
      include: { commission: true },
    });
    expect(order.creatorCommissionBps).toBe(1250);
    expect(order.platformCommissionBps).toBe(500);
    expect(order.commission?.creatorAmountKopecks).toBe(row.previewCreatorAmountKopecks);
    expect(order.commission?.platformAmountKopecks).toBe(
      row.previewPlatformAmountKopecks,
    );
  });

  it('preview изолирует внутренние DUPLICATE и CONFLICT без отката валидных строк', async () => {
    const preview = await uploadCsv([
      `S5-INTERNAL-DUP,2026-07-15T10:00:00.000Z,10000,RUB,paid,,${relationship.affiliateCode},,,`,
      `S5-INTERNAL-DUP,2026-07-15T10:00:00.000Z,10000,RUB,paid,,${relationship.affiliateCode},,,`,
      `S5-INTERNAL-CONFLICT,2026-07-16T10:00:00.000Z,12000,RUB,paid,,${relationship.affiliateCode},,,`,
      `S5-INTERNAL-CONFLICT,2026-07-16T10:00:00.000Z,13000,RUB,paid,,${relationship.affiliateCode},,,`,
      `S5-INTERNAL-VALID,2026-07-17T10:00:00.000Z,14000,RUB,paid,,${relationship.affiliateCode},,,`,
    ]).expect(201);
    const rows = preview.body.rows as Array<any>;
    expect(rows[0].status).toBe('VALID');
    expect(rows[1].status).toBe('DUPLICATE');
    expect(rows[2].status).toBe('VALID');
    expect(rows[3].status).toBe('CONFLICT');
    expect(rows[4].status).toBe('VALID');
    await confirm(preview.body.id);
    expect(
      await prisma.order.count({
        where: {
          externalOrderId: {
            in: ['S5-INTERNAL-DUP', 'S5-INTERNAL-CONFLICT', 'S5-INTERNAL-VALID'],
          },
        },
      }),
    ).toBe(3);
  });

  it('DRAFT и APPROVED payout отменяются идемпотентно без PAYOUT ledger', async () => {
    await importRows([
      `S5-PAYOUT-DRAFT,2026-07-18T10:00:00.000Z,16000,RUB,paid,,${relationship.affiliateCode},,,`,
      `S5-PAYOUT-APPROVED,2026-07-19T10:00:00.000Z,18000,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    const draftCommission = await releaseCommission('S5-PAYOUT-DRAFT');
    const approvedCommission = await releaseCommission('S5-PAYOUT-APPROVED');

    const draft = await request(app.getHttpServer())
      .post('/api/admin/payouts')
      .set(auth(adminToken))
      .send({ commissionIds: [draftCommission.id], reference: 'S5-DRAFT' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${draft.body.id}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'Stage 5 test' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${draft.body.id}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'Repeated request' })
      .expect(201);

    const approved = await request(app.getHttpServer())
      .post('/api/admin/payouts')
      .set(auth(adminToken))
      .send({ commissionIds: [approvedCommission.id], reference: 'S5-APPROVED' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${approved.body.id}/approve`)
      .set(auth(adminToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${approved.body.id}/cancel`)
      .set(auth(adminToken))
      .send({})
      .expect(201);

    for (const payoutId of [draft.body.id, approved.body.id]) {
      expect(
        (await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } })).status,
      ).toBe('CANCELLED');
      expect(
        await prisma.ledgerEntry.count({ where: { payoutId, type: 'PAYOUT' } }),
      ).toBe(0);
      expect(await prisma.commission.count({ where: { payoutId } })).toBe(0);
    }
    expect(
      (await prisma.commission.findUniqueOrThrow({ where: { id: draftCommission.id } }))
        .status,
    ).toBe('AVAILABLE');
    expect(
      (await prisma.commission.findUniqueOrThrow({ where: { id: approvedCommission.id } }))
        .status,
    ).toBe('AVAILABLE');
  });

  it('PAID payout нельзя отменить', async () => {
    await importRows([
      `S5-PAYOUT-PAID,2026-07-20T10:00:00.000Z,20000,RUB,paid,,${relationship.affiliateCode},,,`,
    ]);
    const commission = await releaseCommission('S5-PAYOUT-PAID');
    const payout = await request(app.getHttpServer())
      .post('/api/admin/payouts')
      .set(auth(adminToken))
      .send({ commissionIds: [commission.id], reference: 'S5-PAID' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${payout.body.id}/approve`)
      .set(auth(adminToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${payout.body.id}/mark-paid`)
      .set(auth(adminToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${payout.body.id}/cancel`)
      .set(auth(adminToken))
      .send({})
      .expect(409);
  });
});
