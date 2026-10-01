import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './reset-test-database';

describe('Stage 1 end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const creator = {
    email: 'creator.e2e@example.test',
    password: 'Creator12345',
    role: 'CREATOR',
    name: 'Креатор E2E',
  };
  const brand = {
    email: 'brand.e2e@example.test',
    password: 'Brand123456',
    role: 'BRAND',
    name: 'Бренд E2E',
  };
  const otherBrand = {
    email: 'other-brand.e2e@example.test',
    password: 'OtherBrand123',
    role: 'BRAND',
    name: 'Другой бренд E2E',
  };
  const otherCreator = {
    email: 'other-creator.e2e@example.test',
    password: 'OtherCreator123',
    role: 'CREATOR',
    name: 'Другой креатор E2E',
  };
  const offerPayload = {
    title: 'Тестовый оффер E2E',
    description: 'Описание тестового оффера для автоматической проверки.',
    productUrl: 'https://shop.example.test/products/e2e',
    productPriceKopecks: 125050,
    creatorCommissionBps: 1250,
    promotionWithoutProduct: 'LIMITED',
    category: 'Тестовая категория',
    productRequirementSales: 3,
    allowedPromotionFormats: ['wishlist', 'подборка товаров'],
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

  function register(payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/auth/register').send(payload);
  }

  async function loginAgent(email: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    const response = await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return { agent, token: response.body.accessToken as string };
  }

  function authHeader(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await createApplication();
    prisma = app.get(PrismaService);
    await resetTestDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('разделяет liveness и неблокирующую operational readiness', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('OK'));
    const readiness = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(['READY', 'DEGRADED']).toContain(readiness.body.status);
    expect(readiness.body.dependencies.postgres.status).toBe('READY');
    expect(readiness.body.dependencies.minio.status).toBe('READY');
    expect(readiness.body.dependencies.migrations.status).toBe('READY');
    expect(readiness.body.operational.invitationsAllowed).toBe(
      readiness.body.status === 'READY',
    );
  });

  it('регистрирует бренд и сохраняет пароль только как Argon2-хеш', async () => {
    const response = await register(brand).expect(201);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: brand.email } });
    expect(stored.passwordHash).not.toBe(brand.password);
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('запрещает повторную регистрацию на тот же email без учёта регистра', async () => {
    await register({ ...brand, email: brand.email.toUpperCase() }).expect(409);
  });

  it('входит с правильным паролем и отклоняет неправильный', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: brand.email, password: brand.password })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: brand.email, password: 'WrongPassword1' })
      .expect(401);
  });

  it('восстанавливает сессию через refresh-cookie', async () => {
    const { agent } = await loginAgent(brand.email, brand.password);
    const refreshed = await agent.post('/api/auth/refresh').expect(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
  });

  it('запрещает креатору создавать оффер', async () => {
    await register(creator).expect(201);
    const { agent, token } = await loginAgent(creator.email, creator.password);
    await agent
      .post('/api/brand/offers')
      .set(authHeader(token))
      .send(offerPayload)
      .expect(403);
    await agent.get('/api/brand/offers').set(authHeader(token)).expect(403);
  });

  it('не позволяет бренду открыть каталог креатора', async () => {
    const { agent, token } = await loginAgent(brand.email, brand.password);
    await agent.get('/api/creator/offers').set(authHeader(token)).expect(403);
  });

  it('не позволяет бренду редактировать чужой оффер', async () => {
    await register(otherBrand).expect(201);
    const owner = await loginAgent(brand.email, brand.password);
    const created = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send(offerPayload)
      .expect(201);
    const stranger = await loginAgent(otherBrand.email, otherBrand.password);
    await stranger.agent
      .patch(`/api/brand/offers/${created.body.id}`)
      .set(authHeader(stranger.token))
      .send({ title: 'Чужое изменение' })
      .expect(403);
  });

  it('креатор видит опубликованный оффер и не видит черновик', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const draft = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Приватный черновик' })
      .expect(201);
    const published = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Опубликованный оффер' })
      .expect(201);
    await owner.agent
      .post(`/api/brand/offers/${published.body.id}/publish`)
      .set(authHeader(owner.token))
      .expect(201);

    const creatorSession = await loginAgent(creator.email, creator.password);
    const catalog = await creatorSession.agent
      .get('/api/creator/offers')
      .set(authHeader(creatorSession.token))
      .expect(200);
    expect(catalog.body.some((item: { id: string }) => item.id === published.body.id)).toBe(true);
    expect(catalog.body.some((item: { id: string }) => item.id === draft.body.id)).toBe(false);
    await creatorSession.agent
      .get(`/api/creator/offers/${draft.body.id}`)
      .set(authHeader(creatorSession.token))
      .expect(404);
  });

  it('сохраняет оффер после перезапуска приложения', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const created = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Оффер после перезапуска' })
      .expect(201);
    await app.close();
    app = await createApplication();
    prisma = app.get(PrismaService);
    const afterRestart = await loginAgent(brand.email, brand.password);
    const offers = await afterRestart.agent
      .get('/api/brand/offers')
      .set(authHeader(afterRestart.token))
      .expect(200);
    expect(offers.body.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
  });

  it('не позволяет произвольную смену статуса и считает ARCHIVED терминальным', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const created = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Оффер для архива' })
      .expect(201);
    await owner.agent
      .patch(`/api/brand/offers/${created.body.id}`)
      .set(authHeader(owner.token))
      .send({ status: 'PUBLISHED' })
      .expect(400);
    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/archive`)
      .set(authHeader(owner.token))
      .expect(201);
    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/publish`)
      .set(authHeader(owner.token))
      .expect(400);
  });

  it('разрешает загрузку файлов только после подтверждения бренда администратором', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const created = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Оффер для верификации бренда' })
      .expect(201);
    const uploadPayload = {
      title: 'Пилотный файл',
      assetType: 'DOCUMENT',
      accessLevel: 'DIGITAL',
      originalFileName: 'pilot.pdf',
      mimeType: 'application/pdf',
      byteSize: 10,
      editable: false,
      textAllowed: false,
      paidAdsAllowed: false,
      approvalRequired: false,
    };
    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/creator-kit/assets/uploads`)
      .set(authHeader(owner.token))
      .send(uploadPayload)
      .expect(403);

    const profile = await prisma.brandProfile.findUniqueOrThrow({
      where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: brand.email } })).id },
    });
    await owner.agent
      .post(`/api/admin/brands/${profile.id}/verify`)
      .set(authHeader(owner.token))
      .expect(403);

    const adminPassword = 'PilotAdmin123!';
    await prisma.user.create({
      data: {
        email: 'pilot-admin.e2e@example.test',
        passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
        role: 'ADMIN',
      },
    });
    const admin = await loginAgent('pilot-admin.e2e@example.test', adminPassword);
    const brands = await admin.agent
      .get('/api/admin/brands')
      .set(authHeader(admin.token))
      .expect(200);
    expect(brands.body.some((item: { id: string }) => item.id === profile.id)).toBe(true);
    await admin.agent
      .post(`/api/admin/brands/${profile.id}/verify`)
      .set(authHeader(admin.token))
      .expect(201);
    await admin.agent
      .post(`/api/admin/brands/${profile.id}/verify`)
      .set(authHeader(admin.token))
      .expect(201);

    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/creator-kit/assets/uploads`)
      .set(authHeader(owner.token))
      .send(uploadPayload)
      .expect(201);
    const verified = await prisma.brandProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(verified.verificationStatus).toBe('VERIFIED');
    expect(verified.verifiedByUserId).toBeTruthy();
    expect(
      await prisma.auditLog.count({
        where: { action: 'BRAND_VERIFIED', entityId: profile.id },
      }),
    ).toBe(1);
  });

  it('загружает Digital-материал через presigned URL и подтверждает его через S3 HEAD', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const created = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Оффер с Creator Kit' })
      .expect(201);
    await owner.agent
      .put(`/api/brand/offers/${created.body.id}/creator-kit`)
      .set(authHeader(owner.token))
      .send({
        scenarios: [
          {
            channel: 'REELS',
            title: 'Идея Digital',
            idea: 'Использовать официальные материалы без заявления о личном опыте.',
            accessLevel: 'DIGITAL',
            sortOrder: 1,
          },
        ],
        facts: [{ type: 'DESCRIPTION', value: 'Тестовый факт', sortOrder: 1 }],
        claims: [
          { type: 'ALLOWED', value: 'Разрешено', sortOrder: 1 },
          { type: 'FORBIDDEN', value: 'Запрещено', sortOrder: 2 },
        ],
        rules: [{ value: 'Не заявлять о тестировании.', sortOrder: 1 }],
        publicationRequirements: {
          mandatoryMentions: ['Название'],
          advertisingLabel: 'Маркировка обязательна',
          hashtags: ['#реклама'],
          brandMention: '@brand',
          approvalRequired: false,
          allowedPlatforms: ['Telegram'],
        },
      })
      .expect(200);

    const file = Buffer.from('closed-pilot-image');
    const upload = await owner.agent
      .post(`/api/brand/offers/${created.body.id}/creator-kit/assets/uploads`)
      .set(authHeader(owner.token))
      .send({
        title: 'Главное фото',
        assetType: 'PHOTO',
        accessLevel: 'DIGITAL',
        originalFileName: 'product.png',
        mimeType: 'image/png',
        byteSize: file.length,
        editable: true,
        textAllowed: true,
        paidAdsAllowed: false,
        approvalRequired: false,
      })
      .expect(201);
    expect(upload.body.asset.storageObjectKey).toBeUndefined();

    const uploadResponse = await fetch(upload.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error(
        `MinIO upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`,
      );
    }
    expect(uploadResponse.ok).toBe(true);

    const completed = await owner.agent
      .post(
        `/api/brand/offers/${created.body.id}/creator-kit/assets/${upload.body.asset.id}/complete`,
      )
      .set(authHeader(owner.token))
      .expect(201);
    expect(completed.body.status).toBe('READY');

    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/publish`)
      .set(authHeader(owner.token))
      .expect(201);
    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/creator-kit/publish`)
      .set(authHeader(owner.token))
      .send({})
      .expect(201);
    const creatorSession = await loginAgent(creator.email, creator.password);
    const kit = await creatorSession.agent
      .get(`/api/creator/offers/${created.body.id}/creator-kit`)
      .set(authHeader(creatorSession.token))
      .expect(200);
    expect(kit.body.assets.map((asset: { id: string }) => asset.id)).toContain(
      upload.body.asset.id,
    );

    await owner.agent
      .post(
        `/api/brand/offers/${created.body.id}/creator-kit/assets/${upload.body.asset.id}/disable`,
      )
      .set(authHeader(owner.token))
      .expect(201);
    const disabledKit = await creatorSession.agent
      .get(`/api/creator/offers/${created.body.id}/creator-kit`)
      .set(authHeader(creatorSession.token))
      .expect(200);
    expect(disabledKit.body.assets).toHaveLength(0);
    await owner.agent
      .post(
        `/api/brand/offers/${created.body.id}/creator-kit/assets/${upload.body.asset.id}/enable`,
      )
      .set(authHeader(owner.token))
      .expect(201);
  });

  it('не выдаёт Product Access креатору и блокирует Digital при promotionWithoutProduct=NO', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const created = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({
        ...offerPayload,
        title: 'Оффер без Digital Access',
        promotionWithoutProduct: 'NO',
      })
      .expect(201);
    await owner.agent
      .put(`/api/brand/offers/${created.body.id}/creator-kit`)
      .set(authHeader(owner.token))
      .send({
        scenarios: [
          {
            channel: 'REELS',
            title: 'Digital сценарий',
            idea: 'Этот сценарий должен быть скрыт без продукта.',
            accessLevel: 'DIGITAL',
            sortOrder: 1,
          },
          {
            channel: 'SHORT_REVIEW',
            title: 'Product сценарий',
            idea: 'Этот сценарий доступен только в preview бренда.',
            accessLevel: 'PRODUCT',
            sortOrder: 2,
          },
        ],
      })
      .expect(200);
    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/publish`)
      .set(authHeader(owner.token))
      .expect(201);
    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/creator-kit/publish`)
      .set(authHeader(owner.token))
      .send({})
      .expect(201);
    const creatorSession = await loginAgent(creator.email, creator.password);
    const kit = await creatorSession.agent
      .get(`/api/creator/offers/${created.body.id}/creator-kit`)
      .set(authHeader(creatorSession.token))
      .expect(200);
    expect(kit.body.scenarios).toHaveLength(0);
    const preview = await owner.agent
      .get(`/api/brand/offers/${created.body.id}/creator-kit/preview?accessLevel=PRODUCT`)
      .set(authHeader(owner.token))
      .expect(200);
    expect(preview.body.scenarios).toHaveLength(2);
  });

  it('отклоняет запрещённый MIME и не позволяет чужому бренду начать загрузку', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const created = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Оффер для проверки файлов' })
      .expect(201);
    const invalid = {
      title: 'Архив',
      assetType: 'DOCUMENT',
      accessLevel: 'DIGITAL',
      originalFileName: 'materials.zip',
      mimeType: 'application/zip',
      byteSize: 100,
      editable: false,
      textAllowed: false,
      paidAdsAllowed: false,
      approvalRequired: false,
    };
    await owner.agent
      .post(`/api/brand/offers/${created.body.id}/creator-kit/assets/uploads`)
      .set(authHeader(owner.token))
      .send(invalid)
      .expect(400);
    const stranger = await loginAgent(otherBrand.email, otherBrand.password);
    await stranger.agent
      .post(`/api/brand/offers/${created.body.id}/creator-kit/assets/uploads`)
      .set(authHeader(stranger.token))
      .send({ ...invalid, originalFileName: 'document.pdf', mimeType: 'application/pdf' })
      .expect(403);
  });

  it('принимает одну ожидающую заявку только на опубликованный оффер', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const draft = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Черновик без заявок' })
      .expect(201);
    const published = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Оффер для заявки' })
      .expect(201);
    await owner.agent
      .post(`/api/brand/offers/${published.body.id}/publish`)
      .set(authHeader(owner.token))
      .expect(201);

    const creatorSession = await loginAgent(creator.email, creator.password);
    const application = await creatorSession.agent
      .post(`/api/creator/offers/${published.body.id}/applications`)
      .set(authHeader(creatorSession.token))
      .send({ message: 'Хочу рассказать об этом товаре своей аудитории.' })
      .expect(201);
    expect(application.body.status).toBe('PENDING');
    expect(application.body.creator.userId).toBeUndefined();

    await creatorSession.agent
      .post(`/api/creator/offers/${published.body.id}/applications`)
      .set(authHeader(creatorSession.token))
      .send({ message: 'Повторная заявка' })
      .expect(409);
    await creatorSession.agent
      .post(`/api/creator/applications/${application.body.id}/cancel`)
      .set(authHeader(creatorSession.token))
      .expect(201);
    await creatorSession.agent
      .post(`/api/creator/offers/${published.body.id}/applications`)
      .set(authHeader(creatorSession.token))
      .send({ message: 'Новая заявка после отмены' })
      .expect(201);
    await creatorSession.agent
      .post(`/api/creator/offers/${draft.body.id}/applications`)
      .set(authHeader(creatorSession.token))
      .send({})
      .expect(404);
  });

  it('защищает чужие заявки и при отклонении не создаёт связь', async () => {
    await register(otherCreator).expect(201);
    const owner = await loginAgent(brand.email, brand.password);
    const published = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Оффер для отклонения' })
      .expect(201);
    await owner.agent
      .post(`/api/brand/offers/${published.body.id}/publish`)
      .set(authHeader(owner.token))
      .expect(201);
    const applicant = await loginAgent(otherCreator.email, otherCreator.password);
    const application = await applicant.agent
      .post(`/api/creator/offers/${published.body.id}/applications`)
      .set(authHeader(applicant.token))
      .send({ message: 'Тестовое сообщение бренду' })
      .expect(201);

    const stranger = await loginAgent(otherBrand.email, otherBrand.password);
    await stranger.agent
      .get(`/api/brand/offers/${published.body.id}/applications`)
      .set(authHeader(stranger.token))
      .expect(403);
    await stranger.agent
      .post(`/api/brand/applications/${application.body.id}/approve`)
      .set(authHeader(stranger.token))
      .expect(403);

    await owner.agent
      .post(`/api/brand/applications/${application.body.id}/reject`)
      .set(authHeader(owner.token))
      .expect(201);
    expect(
      await prisma.affiliateRelationship.count({
        where: { applicationId: application.body.id },
      }),
    ).toBe(0);
  });

  it('одобряет заявку идемпотентно и создаёт уникальные коды', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const firstOffer = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Первый партнёрский оффер' })
      .expect(201);
    const secondOffer = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Второй партнёрский оффер' })
      .expect(201);
    for (const offer of [firstOffer.body, secondOffer.body]) {
      await owner.agent
        .post(`/api/brand/offers/${offer.id}/publish`)
        .set(authHeader(owner.token))
        .expect(201);
    }
    const applicant = await loginAgent(otherCreator.email, otherCreator.password);
    const applicationIds: string[] = [];
    for (const offer of [firstOffer.body, secondOffer.body]) {
      const application = await applicant.agent
        .post(`/api/creator/offers/${offer.id}/applications`)
        .set(authHeader(applicant.token))
        .send({})
        .expect(201);
      applicationIds.push(application.body.id);
    }

    const first = await owner.agent
      .post(`/api/brand/applications/${applicationIds[0]}/approve`)
      .set(authHeader(owner.token))
      .expect(201);
    const repeated = await owner.agent
      .post(`/api/brand/applications/${applicationIds[0]}/approve`)
      .set(authHeader(owner.token))
      .expect(201);
    const second = await owner.agent
      .post(`/api/brand/applications/${applicationIds[1]}/approve`)
      .set(authHeader(owner.token))
      .expect(201);

    expect(repeated.body.id).toBe(first.body.id);
    expect(await prisma.affiliateRelationship.count({ where: { applicationId: applicationIds[0] } })).toBe(1);
    expect(first.body.affiliateCode).not.toBe(second.body.affiliateCode);
    expect(first.body.promoCode).not.toBe(second.body.promoCode);
    expect(first.body.affiliateCode).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.body.promoCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
  });

  it('перенаправляет только ACTIVE-связь опубликованного оффера', async () => {
    const relationship = await prisma.affiliateRelationship.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      include: { offer: true },
    });
    const active = await request(app.getHttpServer())
      .get(`/go/${relationship.affiliateCode}`)
      .expect(302);
    const location = new URL(active.headers.location);
    expect(location.searchParams.get('affiliate_code')).toBe(relationship.affiliateCode);
    expect(location.searchParams.get('utm_source')).toBe('svyazka');
    expect(location.searchParams.get('utm_medium')).toBe('affiliate');

    const ownerUser = await prisma.user.findUniqueOrThrow({
      where: { id: (await prisma.brandProfile.findUniqueOrThrow({ where: { id: relationship.offer.brandId } })).userId },
    });
    const owner = await loginAgent(ownerUser.email, brand.password);
    await owner.agent
      .post(`/api/brand/offers/${relationship.offerId}/pause`)
      .set(authHeader(owner.token))
      .expect(201);
    await request(app.getHttpServer()).get(`/go/${relationship.affiliateCode}`).expect(404);
    await owner.agent
      .post(`/api/brand/offers/${relationship.offerId}/publish`)
      .set(authHeader(owner.token))
      .expect(201);
    await request(app.getHttpServer()).get(`/go/${relationship.affiliateCode}`).expect(302);
    await owner.agent
      .post(`/api/brand/affiliate-relationships/${relationship.id}/pause`)
      .set(authHeader(owner.token))
      .expect(201);
    await request(app.getHttpServer()).get(`/go/${relationship.affiliateCode}`).expect(404);
    await owner.agent
      .post(`/api/brand/affiliate-relationships/${relationship.id}/activate`)
      .set(authHeader(owner.token))
      .expect(201);
    await request(app.getHttpServer()).get(`/go/${relationship.affiliateCode}`).expect(302);
    await owner.agent
      .post(`/api/brand/affiliate-relationships/${relationship.id}/revoke`)
      .set(authHeader(owner.token))
      .expect(201);
    await request(app.getHttpServer()).get(`/go/${relationship.affiliateCode}`).expect(404);
  });

  it('ограничивает списки заявок и партнёров текущим пользователем', async () => {
    const creatorSession = await loginAgent(creator.email, creator.password);
    const otherCreatorSession = await loginAgent(otherCreator.email, otherCreator.password);
    const ownApplications = await creatorSession.agent
      .get('/api/creator/applications')
      .set(authHeader(creatorSession.token))
      .expect(200);
    const otherApplications = await otherCreatorSession.agent
      .get('/api/creator/applications')
      .set(authHeader(otherCreatorSession.token))
      .expect(200);
    expect(ownApplications.body.every((item: any) => item.creator.id !== otherApplications.body[0]?.creator.id)).toBe(true);

    const ownRelationships = await otherCreatorSession.agent
      .get('/api/creator/affiliate-relationships')
      .set(authHeader(otherCreatorSession.token))
      .expect(200);
    expect(ownRelationships.body.every((item: any) => item.creator.displayName === otherCreator.name)).toBe(true);
    const relationshipOfOtherCreator = ownRelationships.body[0];
    if (relationshipOfOtherCreator) {
      await creatorSession.agent
        .get(`/api/creator/affiliate-relationships/${relationshipOfOtherCreator.id}`)
        .set(authHeader(creatorSession.token))
        .expect(404);
    }

    const owner = await loginAgent(brand.email, brand.password);
    const brandRelationships = await owner.agent
      .get('/api/brand/affiliate-relationships')
      .set(authHeader(owner.token))
      .expect(200);
    const stranger = await loginAgent(otherBrand.email, otherBrand.password);
    const strangerRelationships = await stranger.agent
      .get('/api/brand/affiliate-relationships')
      .set(authHeader(stranger.token))
      .expect(200);
    expect(brandRelationships.body.length).toBeGreaterThan(0);
    expect(strangerRelationships.body).toHaveLength(0);
  });

  it('открывает закрытый Digital Creator Kit после одобрения и закрывает после отзыва', async () => {
    const owner = await loginAgent(brand.email, brand.password);
    const offer = await owner.agent
      .post('/api/brand/offers')
      .set(authHeader(owner.token))
      .send({ ...offerPayload, title: 'Оффер с закрытым Digital Kit' })
      .expect(201);
    await owner.agent
      .put(`/api/brand/offers/${offer.body.id}/creator-kit`)
      .set(authHeader(owner.token))
      .send({
        scenarios: [
          {
            channel: 'REELS',
            title: 'Открытая идея',
            idea: 'Открытая идея доступна до подачи и одобрения заявки.',
            accessLevel: 'DIGITAL',
            requiresAffiliateApproval: false,
            sortOrder: 1,
          },
          {
            channel: 'TELEGRAM',
            title: 'Идея для партнёров',
            idea: 'Закрытая идея доступна только активному партнёру бренда.',
            accessLevel: 'DIGITAL',
            requiresAffiliateApproval: true,
            sortOrder: 2,
          },
        ],
      })
      .expect(200);
    await owner.agent
      .post(`/api/brand/offers/${offer.body.id}/publish`)
      .set(authHeader(owner.token))
      .expect(201);
    await owner.agent
      .post(`/api/brand/offers/${offer.body.id}/creator-kit/publish`)
      .set(authHeader(owner.token))
      .send({})
      .expect(201);

    const applicant = await loginAgent(creator.email, creator.password);
    const before = await applicant.agent
      .get(`/api/creator/offers/${offer.body.id}/creator-kit`)
      .set(authHeader(applicant.token))
      .expect(200);
    expect(before.body.scenarios.map((item: any) => item.title)).toEqual(['Открытая идея']);

    const application = await applicant.agent
      .post(`/api/creator/offers/${offer.body.id}/applications`)
      .set(authHeader(applicant.token))
      .send({})
      .expect(201);
    const relationship = await owner.agent
      .post(`/api/brand/applications/${application.body.id}/approve`)
      .set(authHeader(owner.token))
      .expect(201);
    const approved = await applicant.agent
      .get(`/api/creator/offers/${offer.body.id}/creator-kit`)
      .set(authHeader(applicant.token))
      .expect(200);
    expect(approved.body.scenarios).toHaveLength(2);

    await owner.agent
      .post(`/api/brand/affiliate-relationships/${relationship.body.id}/revoke`)
      .set(authHeader(owner.token))
      .expect(201);
    const revoked = await applicant.agent
      .get(`/api/creator/offers/${offer.body.id}/creator-kit`)
      .set(authHeader(applicant.token))
      .expect(200);
    expect(revoked.body.scenarios.map((item: any) => item.title)).toEqual(['Открытая идея']);
  });

  it('сохраняет заявки и партнёрские связи после перезапуска backend', async () => {
    const relationship = await prisma.affiliateRelationship.findFirstOrThrow();
    await app.close();
    app = await createApplication();
    prisma = app.get(PrismaService);
    const persisted = await prisma.affiliateRelationship.findUnique({
      where: { id: relationship.id },
      include: { application: true },
    });
    expect(persisted?.application.status).toBe('APPROVED');
  });
});
