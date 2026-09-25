import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Manager access and responsibility end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminToken: string;
  let brandAToken: string;
  let brandBToken: string;
  let creatorToken: string;
  let annaToken: string;
  let mariaToken: string;

  let brandAId: string;
  let brandBId: string;
  let annaId: string;
  let mariaId: string;
  let charlieId: string;
  let brandBOfferId: string;
  let brandBRelationshipId: string;
  let offerId: string;
  let relationshipId: string;
  let affiliateCode: string;
  let firstOrderId: string;

  const passwords = {
    brandA: 'ManagerBrandA123',
    brandB: 'ManagerBrandB123',
    creator: 'ManagerCreator123',
    admin: 'ManagerAdmin123',
    anna: 'ManagerAnna123',
    maria: 'ManagerMaria123',
    charlie: 'ManagerCharlie123',
  };

  const offerPayload = {
    title: 'Manager E2E offer',
    description: 'Offer used to verify manager responsibility with a real database.',
    productUrl: 'https://shop.example.test/manager-e2e',
    productPriceKopecks: 100_000,
    creatorCommissionBps: 1250,
    promotionWithoutProduct: 'YES',
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

  async function cleanDatabase() {
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
    await prisma.affiliateRelationship.deleteMany();
    await prisma.offerApplication.deleteMany();
    await prisma.publicationRequirements.deleteMany();
    await prisma.creatorKitAsset.deleteMany();
    await prisma.creatorKitScenario.deleteMany();
    await prisma.creatorKitFact.deleteMany();
    await prisma.creatorKitClaim.deleteMany();
    await prisma.creatorKitRule.deleteMany();
    await prisma.creatorKit.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.brandManagerAssignment.deleteMany();
    await prisma.managerProfile.deleteMany();
    await prisma.creatorProfile.deleteMany();
    await prisma.brandProfile.deleteMany();
    await prisma.user.deleteMany();
  }

  async function registerAndLogin(payload: Record<string, unknown>) {
    await request(app.getHttpServer()).post('/api/auth/register').send(payload).expect(201);
    return login(payload.email as string, payload.password as string);
  }

  async function login(email: string, password: string) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body.accessToken as string;
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function managerHeaders(token: string, brandId: string) {
    return { ...auth(token), 'X-Active-Brand-Id': brandId };
  }

  async function createPrivilegedUser(
    email: string,
    password: string,
    role: UserRole,
  ) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role,
      },
    });
  }

  async function assignManager(brandId: string, managerId: string) {
    return request(app.getHttpServer())
      .post(`/api/admin/brands/${brandId}/managers/${managerId}`)
      .set(auth(adminToken))
      .expect(201);
  }

  async function transferOffer(
    token: string,
    activeBrandId: string,
    targetManagerId?: string,
  ) {
    return request(app.getHttpServer())
      .patch(`/api/brand/offers/${offerId}/responsibility`)
      .set(managerHeaders(token, activeBrandId))
      .send(targetManagerId ? { managerId: targetManagerId } : {})
      .expect(200);
  }

  async function transferRelationship(
    token: string,
    activeBrandId: string,
    targetManagerId?: string,
  ) {
    return request(app.getHttpServer())
      .patch(`/api/brand/affiliate-relationships/${relationshipId}/responsibility`)
      .set(managerHeaders(token, activeBrandId))
      .send(targetManagerId ? { managerId: targetManagerId } : {})
      .expect(200);
  }

  function orderCsv(externalOrderId: string) {
    const orderDate = new Date(Date.now() + 60_000).toISOString();
    return [
      'external_order_id,order_date,amount_kopecks,currency,status,returned_amount_kopecks,affiliate_code,promo_code,click_id,offer_id',
      `${externalOrderId},${orderDate},10000,RUB,paid,,${affiliateCode},,,`,
    ].join('\n');
  }

  async function importOrder(externalOrderId: string) {
    const preview = await request(app.getHttpServer())
      .post('/api/brand/order-imports')
      .set(managerHeaders(annaToken, brandAId))
      .attach('file', Buffer.from(orderCsv(externalOrderId)), {
        filename: `${externalOrderId}.csv`,
        contentType: 'text/csv',
      })
      .expect(201);
    expect(preview.body.validRows).toBe(1);
    await request(app.getHttpServer())
      .post(`/api/brand/order-imports/${preview.body.id}/confirm`)
      .set(managerHeaders(annaToken, brandAId))
      .expect(201);
    return prisma.order.findUniqueOrThrow({
      where: {
        brandId_externalOrderId: {
          brandId: brandAId,
          externalOrderId,
        },
      },
    });
  }

  beforeAll(async () => {
    app = await createApplication();
    prisma = app.get(PrismaService);
    await cleanDatabase();

    brandAToken = await registerAndLogin({
      email: 'manager-brand-a@example.test',
      password: passwords.brandA,
      role: 'BRAND',
      name: 'Manager Brand A',
    });
    brandBToken = await registerAndLogin({
      email: 'manager-brand-b@example.test',
      password: passwords.brandB,
      role: 'BRAND',
      name: 'Manager Brand B',
    });
    creatorToken = await registerAndLogin({
      email: 'manager-creator@example.test',
      password: passwords.creator,
      role: 'CREATOR',
      name: 'Manager Creator',
    });

    const brandAUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'manager-brand-a@example.test' },
      include: { brandProfile: true },
    });
    const brandBUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'manager-brand-b@example.test' },
      include: { brandProfile: true },
    });
    brandAId = brandAUser.brandProfile!.id;
    brandBId = brandBUser.brandProfile!.id;

    const admin = await createPrivilegedUser(
      'manager-admin@example.test',
      passwords.admin,
      UserRole.ADMIN,
    );
    const anna = await createPrivilegedUser(
      'manager-anna@example.test',
      passwords.anna,
      UserRole.MANAGER,
    );
    const maria = await createPrivilegedUser(
      'manager-maria@example.test',
      passwords.maria,
      UserRole.MANAGER,
    );
    const charlie = await createPrivilegedUser(
      'manager-charlie@example.test',
      passwords.charlie,
      UserRole.MANAGER,
    );
    expect(admin.role).toBe(UserRole.ADMIN);
    annaId = anna.id;
    mariaId = maria.id;
    charlieId = charlie.id;

    adminToken = await login('manager-admin@example.test', passwords.admin);
    annaToken = await login('manager-anna@example.test', passwords.anna);
    mariaToken = await login('manager-maria@example.test', passwords.maria);

    await assignManager(brandAId, annaId);
    await assignManager(brandAId, mariaId);

    const brandBOffer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(auth(brandBToken))
      .send({ ...offerPayload, title: 'Manager Brand B offer' })
      .expect(201);
    brandBOfferId = brandBOffer.body.id;
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${brandBOfferId}/publish`)
      .set(auth(brandBToken))
      .expect(201);
    const brandBApplication = await request(app.getHttpServer())
      .post(`/api/creator/offers/${brandBOfferId}/applications`)
      .set(auth(creatorToken))
      .send({ message: 'Brand B relationship' })
      .expect(201);
    brandBRelationshipId = (
      await request(app.getHttpServer())
        .post(`/api/brand/applications/${brandBApplication.body.id}/approve`)
        .set(auth(brandBToken))
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
  });

  it('preserves legacy BRAND access without an active-brand header', async () => {
    await request(app.getHttpServer())
      .get('/api/brand/offers')
      .set(auth(brandAToken))
      .expect(200);
  });

  it('requires explicit active context and supports deliberate multi-brand switching', async () => {
    await request(app.getHttpServer())
      .get('/api/brand/offers')
      .set(managerHeaders(annaToken, brandAId))
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/brand/offers')
      .set(auth(annaToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/brand/offers')
      .set(managerHeaders(annaToken, brandBId))
      .expect(403);

    await assignManager(brandBId, annaId);

    const brands = await request(app.getHttpServer())
      .get('/api/manager/brands')
      .set(auth(annaToken))
      .expect(200);
    expect(brands.body.map((brand: { id: string }) => brand.id).sort()).toEqual(
      [brandAId, brandBId].sort(),
    );
    await request(app.getHttpServer())
      .get('/api/brand/offers')
      .set(managerHeaders(annaToken, brandAId))
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/brand/offers')
      .set(managerHeaders(annaToken, brandBId))
      .expect(200);
  });

  it('rejects indirect cross-brand Offer, relationship, and Creator Kit access', async () => {
    await request(app.getHttpServer())
      .get(`/api/brand/offers/${brandBOfferId}`)
      .set(managerHeaders(annaToken, brandAId))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/brand/affiliate-relationships/${brandBRelationshipId}/responsibility`)
      .set(managerHeaders(annaToken, brandAId))
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/brand/offers/${brandBOfferId}/creator-kit`)
      .set(managerHeaders(annaToken, brandAId))
      .expect(403);
  });

  it('tracks Offer authorship and transferable current responsibility', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(managerHeaders(annaToken, brandAId))
      .send(offerPayload)
      .expect(201);
    offerId = created.body.id;

    expect(
      await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { createdByManagerId: true, currentManagerId: true },
      }),
    ).toEqual({
      createdByManagerId: annaId,
      currentManagerId: annaId,
    });

    await transferOffer(annaToken, brandAId, mariaId);
    expect(
      await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { createdByManagerId: true, currentManagerId: true },
      }),
    ).toEqual({
      createdByManagerId: annaId,
      currentManagerId: mariaId,
    });

    await transferOffer(mariaToken, brandAId);
    expect(
      await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { createdByManagerId: true, currentManagerId: true },
      }),
    ).toEqual({
      createdByManagerId: annaId,
      currentManagerId: null,
    });
  });

  it('inherits Offer responsibility once and transfers relationship responsibility explicitly', async () => {
    await transferOffer(annaToken, brandAId, annaId);
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/publish`)
      .set(managerHeaders(annaToken, brandAId))
      .expect(201);
    const application = await request(app.getHttpServer())
      .post(`/api/creator/offers/${offerId}/applications`)
      .set(auth(creatorToken))
      .send({ message: 'Manager responsibility inheritance' })
      .expect(201);
    const relationship = await request(app.getHttpServer())
      .post(`/api/brand/applications/${application.body.id}/approve`)
      .set(managerHeaders(annaToken, brandAId))
      .expect(201);
    relationshipId = relationship.body.id;
    affiliateCode = relationship.body.affiliateCode;

    expect(
      await prisma.affiliateRelationship.findUniqueOrThrow({
        where: { id: relationshipId },
        select: { currentManagerId: true },
      }),
    ).toEqual({ currentManagerId: annaId });

    await transferOffer(annaToken, brandAId, mariaId);
    expect(
      await prisma.affiliateRelationship.findUniqueOrThrow({
        where: { id: relationshipId },
        select: { currentManagerId: true },
      }),
    ).toEqual({ currentManagerId: annaId });

    await transferRelationship(annaToken, brandAId, mariaId);
    expect(
      await prisma.affiliateRelationship.findUniqueOrThrow({
        where: { id: relationshipId },
        select: { currentManagerId: true },
      }),
    ).toEqual({ currentManagerId: mariaId });

    await transferRelationship(mariaToken, brandAId);
    expect(
      await prisma.affiliateRelationship.findUniqueOrThrow({
        where: { id: relationshipId },
        select: { currentManagerId: true },
      }),
    ).toEqual({ currentManagerId: null });

    await request(app.getHttpServer())
      .patch(`/api/brand/affiliate-relationships/${relationshipId}/responsibility`)
      .set(managerHeaders(annaToken, brandAId))
      .send({ managerId: charlieId })
      .expect(403);
  });

  it('freezes the relationship manager on each newly attributed Order', async () => {
    await transferRelationship(annaToken, brandAId, annaId);
    const firstOrder = await importOrder('MANAGER-ORDER-ANNA');
    firstOrderId = firstOrder.id;
    expect(firstOrder.managerIdAtAttribution).toBe(annaId);

    await transferRelationship(annaToken, brandAId, mariaId);
    expect(
      (
        await prisma.order.findUniqueOrThrow({
          where: { id: firstOrder.id },
          select: { managerIdAtAttribution: true },
        })
      ).managerIdAtAttribution,
    ).toBe(annaId);

    const secondOrder = await importOrder('MANAGER-ORDER-MARIA');
    expect(secondOrder.managerIdAtAttribution).toBe(mariaId);

    await transferRelationship(mariaToken, brandAId);
    const unassignedOrder = await importOrder('MANAGER-ORDER-UNASSIGNED');
    expect(unassignedOrder.managerIdAtAttribution).toBeNull();
  });

  it('removes manager access and clears only current responsibility', async () => {
    await transferOffer(mariaToken, brandAId, annaId);
    await transferRelationship(mariaToken, brandAId, annaId);

    await request(app.getHttpServer())
      .delete(`/api/admin/brands/${brandAId}/managers/${annaId}`)
      .set(auth(adminToken))
      .expect(200);

    const assignment = await prisma.brandManagerAssignment.findFirstOrThrow({
      where: { brandId: brandAId, managerId: annaId },
      orderBy: { assignedAt: 'desc' },
    });
    expect(assignment.removedAt).not.toBeNull();
    expect(assignment.removedBy).not.toBeNull();

    expect(
      await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { createdByManagerId: true, currentManagerId: true },
      }),
    ).toEqual({
      createdByManagerId: annaId,
      currentManagerId: null,
    });
    expect(
      await prisma.affiliateRelationship.findUniqueOrThrow({
        where: { id: relationshipId },
        select: { currentManagerId: true },
      }),
    ).toEqual({ currentManagerId: null });
    expect(
      (
        await prisma.order.findUniqueOrThrow({
          where: { id: firstOrderId },
          select: { managerIdAtAttribution: true },
        })
      ).managerIdAtAttribution,
    ).toBe(annaId);

    await request(app.getHttpServer())
      .get('/api/brand/offers')
      .set(managerHeaders(annaToken, brandAId))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/brand/offers')
      .set(managerHeaders(annaToken, brandBId))
      .expect(200);
  });
});
