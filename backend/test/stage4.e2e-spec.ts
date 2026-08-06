import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Stage 4 affiliate finance end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let brandToken: string;
  let otherBrandToken: string;
  let creatorToken: string;
  let otherCreatorToken: string;
  let adminToken: string;
  let offerId: string;
  let foreignOfferId: string;
  let relationship: any;
  let secondaryRelationship: any;
  let clickId: string;
  let firstImportId: string;

  const users = {
    brand: {
      email: 'finance-brand@example.test',
      password: 'BrandFinance123',
      role: 'BRAND',
      name: 'Финансовый бренд',
    },
    otherBrand: {
      email: 'finance-other-brand@example.test',
      password: 'OtherBrandFinance123',
      role: 'BRAND',
      name: 'Чужой финансовый бренд',
    },
    creator: {
      email: 'finance-creator@example.test',
      password: 'CreatorFinance123',
      role: 'CREATOR',
      name: 'Анна Финансова',
    },
    otherCreator: {
      email: 'finance-other-creator@example.test',
      password: 'OtherCreatorFinance123',
      role: 'CREATOR',
      name: 'Другой автор',
    },
    admin: {
      email: 'finance-admin@example.test',
      password: 'AdminFinance123',
      role: 'BRAND',
      name: 'Временный профиль администратора',
    },
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

  function uploadCsv(token: string, content: string) {
    return request(app.getHttpServer())
      .post('/api/brand/order-imports')
      .set(auth(token))
      .attach('file', Buffer.from(content), {
        filename: 'orders.csv',
        contentType: 'text/csv',
      });
  }

  beforeAll(async () => {
    app = await createApplication();
    prisma = app.get(PrismaService);
    await prisma.authSession.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.adminRecoveryCode.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.commission.deleteMany();
    await prisma.payout.deleteMany();
    await prisma.orderImportRow.deleteMany();
    await prisma.order.deleteMany();
    await prisma.orderImport.deleteMany();
    await prisma.click.deleteMany();
    await prisma.creatorProductAccessGrant.deleteMany();
    await prisma.affiliateRelationship.deleteMany();
    await prisma.offerApplication.deleteMany();
    await prisma.publicationRequirements.deleteMany();
    await prisma.creatorKitRevisionAsset.deleteMany();
    await prisma.creatorKitScenario.deleteMany();
    await prisma.creatorKitFact.deleteMany();
    await prisma.creatorKitClaim.deleteMany();
    await prisma.creatorKitRule.deleteMany();
    await prisma.creatorKitBrandContent.deleteMany();
    await prisma.creatorKitProductContent.deleteMany();
    await prisma.creatorKit.updateMany({
      data: { activeRevisionId: null, draftRevisionId: null },
    });
    await prisma.creatorKitRevision.deleteMany();
    await prisma.creatorKitAsset.deleteMany();
    await prisma.creatorKit.deleteMany();
    await prisma.offer.updateMany({ data: { imageId: null } });
    await prisma.offerImage.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.creatorProfile.deleteMany();
    await prisma.brandProfile.deleteMany();
    await prisma.user.deleteMany();

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
        .send({ email: users.admin.email, password: users.admin.password })
        .expect(200)
    ).body.accessToken;

    const offerPayload = {
      title: 'Финансовый оффер',
      description: 'Оффер для проверки полного affiliate-цикла этапа четыре.',
      productUrl: 'https://shop.example.test/products/finance',
      productPriceKopecks: 100_000,
      creatorCommissionBps: 1250,
      promotionWithoutProduct: 'YES',
    };
    const offer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(auth(brandToken))
      .send(offerPayload)
      .expect(201);
    offerId = offer.body.id;
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/publish`)
      .set(auth(brandToken))
      .expect(201);

    const application = await request(app.getHttpServer())
      .post(`/api/creator/offers/${offerId}/applications`)
      .set(auth(creatorToken))
      .send({ message: 'Основной финансовый тест' })
      .expect(201);
    relationship = (
      await request(app.getHttpServer())
        .post(`/api/brand/applications/${application.body.id}/approve`)
        .set(auth(brandToken))
        .expect(201)
    ).body;

    const secondOffer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(auth(brandToken))
      .send({ ...offerPayload, title: 'Второй финансовый оффер' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${secondOffer.body.id}/publish`)
      .set(auth(brandToken))
      .expect(201);
    const secondApplication = await request(app.getHttpServer())
      .post(`/api/creator/offers/${secondOffer.body.id}/applications`)
      .set(auth(otherCreatorToken))
      .send({})
      .expect(201);
    secondaryRelationship = (
      await request(app.getHttpServer())
        .post(`/api/brand/applications/${secondApplication.body.id}/approve`)
        .set(auth(brandToken))
        .expect(201)
    ).body;

    const foreignOffer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(auth(otherBrandToken))
      .send({ ...offerPayload, title: 'Чужой оффер' })
      .expect(201);
    foreignOfferId = foreignOffer.body.id;

    await prisma.affiliateRelationship.updateMany({
      where: { id: { in: [relationship.id, secondaryRelationship.id] } },
      data: {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        activatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('ACTIVE-ссылка создаёт Click, добавляет click_id и не хранит сырой IP', async () => {
    const before = await prisma.click.count();
    const response = await request(app.getHttpServer())
      .get(`/go/${relationship.affiliateCode}`)
      .set('User-Agent', 'Stage4-E2E')
      .expect(302);
    const location = new URL(response.headers.location);
    clickId = location.searchParams.get('click_id')!;
    expect(clickId).toMatch(/^[0-9a-f-]{36}$/);
    expect(location.searchParams.get('affiliate_code')).toBe(relationship.affiliateCode);
    expect(await prisma.click.count()).toBe(before + 1);
    const click = await prisma.click.findUniqueOrThrow({ where: { id: clickId } });
    expect(click.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(click.ipHash).not.toContain('127.0.0.1');
    await prisma.click.update({
      where: { id: click.id },
      data: { clickedAt: new Date('2026-07-31T10:00:00.000Z') },
    });
  });

  it('PAUSED и REVOKED ссылки не создают Click, неизвестный код возвращает 404', async () => {
    const before = await prisma.click.count();
    await request(app.getHttpServer())
      .post(`/api/brand/affiliate-relationships/${secondaryRelationship.id}/pause`)
      .set(auth(brandToken))
      .expect(201);
    await request(app.getHttpServer())
      .get(`/go/${secondaryRelationship.affiliateCode}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/brand/affiliate-relationships/${secondaryRelationship.id}/activate`)
      .set(auth(brandToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/affiliate-relationships/${secondaryRelationship.id}/revoke`)
      .set(auth(brandToken))
      .expect(201);
    await request(app.getHttpServer())
      .get(`/go/${secondaryRelationship.affiliateCode}`)
      .expect(404);
    await request(app.getHttpServer()).get('/go/unknownAffiliateCode123456789').expect(404);
    expect(await prisma.click.count()).toBe(before);
  });

  it('предпросмотр применяет приоритет click, affiliate, promo и изолирует ошибки строк', async () => {
    const click = await prisma.click.findUniqueOrThrow({ where: { id: clickId } });
    const clickOrderDate = new Date(click.clickedAt.getTime() + 1000).toISOString();
    const content = csv([
      `CLICK-1,${clickOrderDate},10005,RUB,paid,,,,${clickId},`,
      `AFF-1,2026-07-20T12:00:00.000Z,20000,RUB,paid,,${relationship.affiliateCode},,,`,
      `PROMO-1,2026-07-21T12:00:00.000Z,30000,RUB,paid,,,${relationship.promoCode},,`,
      `CANCEL-1,2026-07-22T12:00:00.000Z,15000,RUB,paid,,${relationship.affiliateCode},,,`,
      `UNKNOWN-1,2026-07-23T12:00:00.000Z,5000,RUB,paid,,UNKNOWNCODE,,,${offerId}`,
      `CONFLICT-1,${clickOrderDate},9000,RUB,paid,,,${secondaryRelationship.promoCode},${clickId},`,
    ]);
    const preview = await uploadCsv(brandToken, content).expect(201);
    firstImportId = preview.body.id;
    expect(preview.body.validRows).toBe(5);
    expect(preview.body.invalidRows).toBe(1);
    const byExternalId = new Map(
      preview.body.rows.map((row: any) => [row.externalOrderId, row]),
    );
    expect((byExternalId.get('CLICK-1') as any).attributionSource).toBe('CLICK_ID');
    expect((byExternalId.get('AFF-1') as any).attributionSource).toBe('AFFILIATE_CODE');
    expect((byExternalId.get('PROMO-1') as any).attributionSource).toBe('PROMO_CODE');
    expect((byExternalId.get('UNKNOWN-1') as any).attributionSource).toBe('UNATTRIBUTED');
    expect((byExternalId.get('UNKNOWN-1') as any).warnings).toContain(
      'Неизвестный affiliate_code',
    );
    expect((byExternalId.get('CONFLICT-1') as any).status).toBe('CONFLICT');

    await request(app.getHttpServer())
      .post(`/api/brand/order-imports/${firstImportId}/confirm`)
      .set(auth(brandToken))
      .expect(201);
    const clickOrder = await prisma.order.findUniqueOrThrow({
      where: { brandId_externalOrderId: { brandId: (await prisma.brandProfile.findUniqueOrThrow({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: users.brand.email } })).id } })).id, externalOrderId: 'CLICK-1' } },
      include: { commission: true },
    });
    expect(clickOrder.attributionSource).toBe('CLICK_ID');
    expect(clickOrder.commission?.creatorAmountKopecks).toBe(1251);
    expect(clickOrder.commission?.platformAmountKopecks).toBe(500);
    expect(await prisma.order.count({ where: { externalOrderId: 'CONFLICT-1' } })).toBe(0);
    expect(await prisma.order.count({ where: { externalOrderId: 'UNKNOWN-1' } })).toBe(1);
  });

  it('повторный импорт не создаёт дубли и чужой оффер не импортируется', async () => {
    const duplicate = await uploadCsv(
      brandToken,
      csv([
        `AFF-1,2026-07-20T12:00:00.000Z,20000,RUB,paid,,${relationship.affiliateCode},,,`,
      ]),
    ).expect(201);
    expect(duplicate.body.duplicateRows).toBe(1);
    await request(app.getHttpServer())
      .post(`/api/brand/order-imports/${duplicate.body.id}/confirm`)
      .set(auth(brandToken))
      .expect(201);
    expect(await prisma.order.count({ where: { externalOrderId: 'AFF-1' } })).toBe(1);

    const foreign = await uploadCsv(
      brandToken,
      csv([
        `FOREIGN-1,2026-07-24T12:00:00.000Z,1000,RUB,paid,,,,,${foreignOfferId}`,
      ]),
    ).expect(201);
    expect(foreign.body.invalidRows).toBe(1);
    expect(foreign.body.rows[0].errors).toContain('offer_id не принадлежит бренду');
  });

  it('фиксирует BPS и создаёт reversals для CANCELLED, RETURNED и PARTIALLY_RETURNED', async () => {
    await request(app.getHttpServer())
      .patch(`/api/brand/offers/${offerId}`)
      .set(auth(brandToken))
      .send({ creatorCommissionBps: 500 })
      .expect(200);
    const updates = await uploadCsv(
      brandToken,
      csv([
        `AFF-1,2026-07-20T12:00:00.000Z,20000,RUB,returned,,${relationship.affiliateCode},,,`,
        `PROMO-1,2026-07-21T12:00:00.000Z,30000,RUB,partially_returned,10000,,${relationship.promoCode},,`,
        `CANCEL-1,2026-07-22T12:00:00.000Z,15000,RUB,cancelled,,${relationship.affiliateCode},,,`,
      ]),
    ).expect(201);
    expect(updates.body.validRows).toBe(3);
    await request(app.getHttpServer())
      .post(`/api/brand/order-imports/${updates.body.id}/confirm`)
      .set(auth(brandToken))
      .expect(201);
    const aff = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'AFF-1' },
      include: { commission: { include: { ledgerEntries: true } } },
    });
    const promo = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'PROMO-1' },
      include: { commission: { include: { ledgerEntries: true } } },
    });
    const cancelled = await prisma.order.findFirstOrThrow({
      where: { externalOrderId: 'CANCEL-1' },
      include: { commission: { include: { ledgerEntries: true } } },
    });
    expect(aff.creatorCommissionBps).toBe(1250);
    expect(aff.commission?.status).toBe('REVERSED');
    expect(aff.commission?.ledgerEntries.some((entry) => entry.amountKopecks === -2500)).toBe(true);
    expect(promo.commission?.creatorAmountKopecks).toBe(2500);
    expect(promo.commission?.ledgerEntries.some((entry) => entry.amountKopecks === -1250)).toBe(true);
    expect(cancelled.commission?.status).toBe('REVERSED');
  });

  it('креатор видит только свои продажи и комиссии', async () => {
    const own = await request(app.getHttpServer())
      .get('/api/creator/orders')
      .set(auth(creatorToken))
      .expect(200);
    const stranger = await request(app.getHttpServer())
      .get('/api/creator/orders')
      .set(auth(otherCreatorToken))
      .expect(200);
    expect(own.body.items.length).toBeGreaterThan(0);
    expect(stranger.body.items).toHaveLength(0);
  });

  it('отчёт использует orderDate, учитывает возвраты, фильтры и итоговую строку', async () => {
    await prisma.orderImport.update({
      where: { id: firstImportId },
      data: {
        createdAt: new Date('2026-08-05T10:00:00.000Z'),
        completedAt: new Date('2026-08-05T10:01:00.000Z'),
      },
    });
    await prisma.order.updateMany({
      where: { orderImportId: firstImportId },
      data: { importedAt: new Date('2026-08-05T10:01:00.000Z') },
    });
    const creatorProfile = await prisma.creatorProfile.findUniqueOrThrow({
      where: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { email: users.creator.email } }))
          .id,
      },
    });
    const report = await request(app.getHttpServer())
      .get('/api/brand/analytics/creators')
      .query({
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        creatorId: creatorProfile.id,
      })
      .set(auth(brandToken))
      .expect(200);
    expect(report.body.items).toHaveLength(1);
    const row = report.body.items[0];
    expect(row.creatorId).toBe(creatorProfile.id);
    expect(row.returnedAmountKopecks).toBe('30000');
    expect(row.netSalesKopecks).toBe('30005');
    expect(row.averageOrderValueKopecks).toBe('15003');
    expect(row.conversionRate).not.toBeNull();
    for (const field of [
      'clicksCount',
      'ordersCount',
      'paidOrdersCount',
      'grossSalesKopecks',
      'cancelledAmountKopecks',
      'returnedAmountKopecks',
      'netSalesKopecks',
      'creatorCommissionKopecks',
      'platformCommissionKopecks',
    ]) {
      expect(report.body.total[field]).toEqual(row[field]);
    }
    const august = await request(app.getHttpServer())
      .get('/api/brand/analytics/creators')
      .query({ dateFrom: '2026-08-01', dateTo: '2026-08-31' })
      .set(auth(brandToken))
      .expect(200);
    expect(august.body.items).toHaveLength(0);
  });

  it('ручной payout не превышает AVAILABLE и создаёт PAYOUT ledger entries', async () => {
    const commission = await prisma.commission.findFirstOrThrow({
      where: { order: { externalOrderId: 'PROMO-1' } },
    });
    await prisma.commission.update({
      where: { id: commission.id },
      data: { holdUntil: new Date('2026-01-01T00:00:00.000Z') },
    });
    await request(app.getHttpServer())
      .post('/api/admin/commissions/release-hold')
      .set(auth(adminToken))
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/admin/payouts')
      .set(auth(adminToken))
      .send({ commissionIds: [commission.id, '00000000-0000-4000-8000-000000000099'] })
      .expect(409);
    const payout = await request(app.getHttpServer())
      .post('/api/admin/payouts')
      .set(auth(adminToken))
      .send({ commissionIds: [commission.id], reference: 'TEST-PAYOUT-1' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${payout.body.id}/approve`)
      .set(auth(adminToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/payouts/${payout.body.id}/mark-paid`)
      .set(auth(adminToken))
      .expect(201);
    expect(
      await prisma.ledgerEntry.count({
        where: { payoutId: payout.body.id, type: 'PAYOUT' },
      }),
    ).toBe(1);
  });

  it('возврат после выплаты сохраняет payout и создаёт отдельную задолженность', async () => {
    const payoutBefore = await prisma.payout.findFirstOrThrow({
      where: { reference: 'TEST-PAYOUT-1' },
    });
    const returned = await uploadCsv(
      brandToken,
      csv([
        `PROMO-1,2026-07-21T12:00:00.000Z,30000,RUB,returned,,,${relationship.promoCode},,`,
      ]),
    ).expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/order-imports/${returned.body.id}/confirm`)
      .set(auth(brandToken))
      .expect(201);
    const commission = await prisma.commission.findFirstOrThrow({
      where: { order: { externalOrderId: 'PROMO-1' } },
    });
    const payoutAfter = await prisma.payout.findUniqueOrThrow({
      where: { id: payoutBefore.id },
    });
    expect(payoutAfter.status).toBe('PAID');
    expect(payoutAfter.amountKopecks).toBe(payoutBefore.amountKopecks);
    expect(commission.status).toBe('PAID');
    expect(commission.hasPostPayoutDebt).toBe(true);
    expect(commission.debtAmountKopecks).toBe(2500);
    expect(
      await prisma.ledgerEntry.count({
        where: { commissionId: commission.id, type: 'REVERSAL' },
      }),
    ).toBe(2);
  });

  it('финансовые данные сохраняются после перезапуска backend', async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { externalOrderId: 'CLICK-1' } });
    await app.close();
    app = await createApplication();
    prisma = app.get(PrismaService);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).not.toBeNull();
    expect(await prisma.ledgerEntry.count()).toBeGreaterThan(0);
  });
});
