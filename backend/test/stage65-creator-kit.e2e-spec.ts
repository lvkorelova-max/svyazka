import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './reset-test-database';

describe('Stage 6.5 Creator Kit end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let brandToken: string;
  let otherBrandToken: string;
  let creatorToken: string;
  let offerId: string;
  let creatorId: string;
  let digitalScenarioId: string;
  let productScenarioId: string;
  let firstPublishedRevisionId: string;

  const brand = {
    email: 'stage65-brand@example.test',
    password: 'Stage65Brand123!',
    role: 'BRAND',
    name: 'Stage 6.5 Brand',
  };
  const otherBrand = {
    email: 'stage65-other-brand@example.test',
    password: 'Stage65OtherBrand123!',
    role: 'BRAND',
    name: 'Stage 6.5 Other Brand',
  };
  const creator = {
    email: 'stage65-creator@example.test',
    password: 'Stage65Creator123!',
    role: 'CREATOR',
    name: 'Stage 6.5 Creator',
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function registerAndLogin(payload: typeof brand) {
    await request(app.getHttpServer()).post('/api/auth/register').send(payload).expect(201);
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);
    return response.body.accessToken as string;
  }

  async function clearDatabase() {
    await resetTestDatabase(prisma);
  }

  beforeAll(async () => {
    app = await createApplication();
    prisma = app.get(PrismaService);
    await clearDatabase();
    brandToken = await registerAndLogin(brand);
    otherBrandToken = await registerAndLogin(otherBrand);
    creatorToken = await registerAndLogin(creator);
    creatorId = (
      await prisma.creatorProfile.findFirstOrThrow({
        where: { user: { email: creator.email } },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('сохраняет Brand Story и Product Information в PostgreSQL и после перезапуска', async () => {
    const offer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(auth(brandToken))
      .send({
        title: 'Stage 6.5 Creator Kit',
        description: 'Исходное описание продукта',
        productUrl: 'https://shop.example.test/stage65',
        productPriceKopecks: 125000,
        creatorCommissionBps: 1500,
        promotionWithoutProduct: 'YES',
        category: 'Beauty',
        allowedPromotionFormats: ['REELS', 'POST'],
      })
      .expect(201);
    offerId = offer.body.id;

    const saved = await request(app.getHttpServer())
      .put(`/api/brand/offers/${offerId}/creator-kit`)
      .set(auth(brandToken))
      .send({
        brandContent: {
          description: 'Описание бренда BYSOLA',
          history: 'История бренда, сохранённая в PostgreSQL.',
          values: ['Честность', 'Качество'],
          positioning: 'Премиальный уход для ежедневного использования.',
          accessLevel: 'DIGITAL',
        },
        productContent: {
          description: 'Подробное описание продукта.',
          benefits: ['Удобное применение', 'Проверенный состав'],
          usageInstructions: 'Нанести небольшое количество на чистую кожу.',
          accessLevel: 'DIGITAL',
        },
        facts: [
          { type: 'DESCRIPTION', value: 'Факт 1', accessLevel: 'DIGITAL', sortOrder: 0 },
          { type: 'BENEFITS', value: 'Факт 2', accessLevel: 'DIGITAL', sortOrder: 1 },
          { type: 'USAGE', value: 'Факт 3', accessLevel: 'DIGITAL', sortOrder: 2 },
        ],
        claims: [
          { type: 'ALLOWED', value: 'Можно говорить так', sortOrder: 0 },
          { type: 'FORBIDDEN', value: 'Нельзя обещать лечение', sortOrder: 1 },
        ],
        rules: [{ value: 'Не использовать медицинские обещания', sortOrder: 0 }],
        publicationRequirements: {
          mandatoryMentions: ['Название бренда'],
          advertisingLabel: 'Добавить маркировку рекламы',
          hashtags: ['#реклама'],
          brandMention: '@bysola',
          approvalRequired: false,
          allowedPlatforms: ['Instagram', 'Telegram'],
        },
      })
      .expect(200);
    expect(saved.body.brandContent.history).toContain('PostgreSQL');
    expect(saved.body.completeness.percent).toBeGreaterThan(40);
    expect(saved.body.completeness.missingSections).toContain('Сценарии');

    await app.close();
    app = await createApplication();
    prisma = app.get(PrismaService);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: brand.email, password: brand.password })
      .expect(200);
    brandToken = login.body.accessToken;
    const restored = await request(app.getHttpServer())
      .get(`/api/brand/offers/${offerId}/creator-kit`)
      .set(auth(brandToken))
      .expect(200);
    expect(restored.body.brandContent.description).toBe('Описание бренда BYSOLA');
    expect(restored.body.productContent.usageInstructions).toContain('чистую кожу');
  });

  it('создаёт, редактирует, переставляет и удаляет сценарии в черновике', async () => {
    const digital = await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/scenarios`)
      .set(auth(brandToken))
      .send({
        channel: 'REELS',
        title: 'Digital сценарий',
        hook: 'Начните с проблемы аудитории',
        mainIdea: 'Показать продукт в ежедневной рутине',
        structure: 'Хук → демонстрация → результат',
        cta: 'Перейдите по ссылке',
        accessLevel: 'DIGITAL',
        requiresAffiliateApproval: false,
        sortOrder: 0,
      })
      .expect(201);
    digitalScenarioId = digital.body.id;
    const product = await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/scenarios`)
      .set(auth(brandToken))
      .send({
        channel: 'SHORT_REVIEW',
        title: 'Product сценарий',
        hook: 'Покажите личный опыт',
        mainIdea: 'Снять честный обзор после использования',
        structure: 'Распаковка → применение → впечатление',
        cta: 'Используйте промокод',
        accessLevel: 'PRODUCT',
        requiresAffiliateApproval: true,
        sortOrder: 1,
      })
      .expect(201);
    productScenarioId = product.body.id;
    await request(app.getHttpServer())
      .patch(`/api/brand/offers/${offerId}/creator-kit/scenarios/${digitalScenarioId}`)
      .set(auth(brandToken))
      .send({ title: 'Digital сценарий обновлён' })
      .expect(200)
      .expect(({ body }) => expect(body.title).toBe('Digital сценарий обновлён'));
    await request(app.getHttpServer())
      .put(`/api/brand/offers/${offerId}/creator-kit/scenarios/reorder`)
      .set(auth(brandToken))
      .send({ scenarioIds: [productScenarioId, digitalScenarioId] })
      .expect(200);
    const temporary = await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/scenarios`)
      .set(auth(brandToken))
      .send({
        channel: 'POST',
        title: 'Временный сценарий',
        mainIdea: 'Будет удалён',
        accessLevel: 'DIGITAL',
        sortOrder: 2,
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/brand/offers/${offerId}/creator-kit/scenarios/${temporary.body.id}`)
      .set(auth(brandToken))
      .expect(200);

    const kit = await request(app.getHttpServer())
      .get(`/api/brand/offers/${offerId}/creator-kit`)
      .set(auth(brandToken))
      .expect(200);
    expect(kit.body.scenarios.map((item: { id: string }) => item.id)).toEqual([
      productScenarioId,
      digitalScenarioId,
    ]);
    expect(kit.body.completeness.percent).toBeGreaterThan(60);
  });

  it('публикует неизменяемый snapshot и показывает креатору только DIGITAL', async () => {
    const published = await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/publish`)
      .set(auth(brandToken))
      .send({ publisherNote: 'Первая версия для пилота' })
      .expect(201);
    firstPublishedRevisionId = published.body.revision.id;
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/publish`)
      .set(auth(brandToken))
      .expect(201);

    const creatorView = await request(app.getHttpServer())
      .get(`/api/creator/offers/${offerId}/creator-kit`)
      .set(auth(creatorToken))
      .expect(200);
    expect(creatorView.body.scenarios.map((item: { id: string }) => item.id)).toEqual([
      digitalScenarioId,
    ]);
    expect(creatorView.body.brandContent.description).toBe('Описание бренда BYSOLA');
    expect(creatorView.body.accessContext.hasProductAccess).toBe(false);

    await request(app.getHttpServer())
      .put(`/api/brand/offers/${offerId}/creator-kit`)
      .set(auth(brandToken))
      .send({
        brandContent: {
          description: 'Описание бренда в новом черновике',
          history: 'Новая история',
          values: ['Новое значение'],
          positioning: 'Новое позиционирование',
        },
      })
      .expect(200);
    const stillPublished = await request(app.getHttpServer())
      .get(`/api/creator/offers/${offerId}/creator-kit`)
      .set(auth(creatorToken))
      .expect(200);
    expect(stillPublished.body.brandContent.description).toBe('Описание бренда BYSOLA');
  });

  it('запрещает чужому бренду и креатору изменять Creator Kit', async () => {
    await request(app.getHttpServer())
      .put(`/api/brand/offers/${offerId}/creator-kit`)
      .set(auth(otherBrandToken))
      .send({ brandContent: { description: 'Чужое изменение', values: [] } })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/brand/offers/${offerId}/creator-kit`)
      .set(auth(creatorToken))
      .send({ brandContent: { description: 'Изменение креатора', values: [] } })
      .expect(403);
  });

  it('управляет Product Access только для одобренного креатора и пишет AuditLog', async () => {
    const application = await request(app.getHttpServer())
      .post(`/api/creator/offers/${offerId}/applications`)
      .set(auth(creatorToken))
      .send({ message: 'Заявка для Product Access' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/applications/${application.body.id}/approve`)
      .set(auth(brandToken))
      .expect(201);

    const beforeGrant = await request(app.getHttpServer())
      .get(`/api/creator/offers/${offerId}/creator-kit`)
      .set(auth(creatorToken))
      .expect(200);
    expect(beforeGrant.body.scenarios.some((item: { id: string }) => item.id === productScenarioId))
      .toBe(false);

    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/product-access/${creatorId}/grant`)
      .set(auth(brandToken))
      .send({ reason: 'Ручной Product Access для закрытого пилота' })
      .expect(201);
    const withGrant = await request(app.getHttpServer())
      .get(`/api/creator/offers/${offerId}/creator-kit`)
      .set(auth(creatorToken))
      .expect(200);
    expect(withGrant.body.scenarios.some((item: { id: string }) => item.id === productScenarioId))
      .toBe(true);

    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/product-access/${creatorId}/revoke`)
      .set(auth(brandToken))
      .send({ reason: 'Доступ отозван' })
      .expect(201);
    const afterRevoke = await request(app.getHttpServer())
      .get(`/api/creator/offers/${offerId}/creator-kit`)
      .set(auth(creatorToken))
      .expect(200);
    expect(afterRevoke.body.scenarios.some((item: { id: string }) => item.id === productScenarioId))
      .toBe(false);
    expect(
      await prisma.auditLog.count({
        where: {
          action: {
            in: ['CREATOR_PRODUCT_ACCESS_GRANTED', 'CREATOR_PRODUCT_ACCESS_REVOKED'],
          },
        },
      }),
    ).toBe(2);
  });

  it('Preview as Creator использует тот же resolver и не создаёт разрешений', async () => {
    const before = await prisma.creatorProductAccessGrant.count({ where: { offerId } });
    const simulated = await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/preview-as-creator`)
      .set(auth(brandToken))
      .send({
        source: 'PUBLISHED',
        creatorId,
        productAccess: 'GRANTED',
        affiliateApproval: 'ACTIVE',
      })
      .expect(201);
    expect(simulated.body.scenarios.some((item: { id: string }) => item.id === productScenarioId))
      .toBe(true);
    expect(simulated.body.accessContext.simulated).toBe(true);
    expect(await prisma.creatorProductAccessGrant.count({ where: { offerId } })).toBe(before);

    const actualPreview = await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/preview-as-creator`)
      .set(auth(brandToken))
      .send({
        source: 'PUBLISHED',
        creatorId,
        productAccess: 'ACTUAL',
        affiliateApproval: 'ACTUAL',
      })
      .expect(201);
    const actualCreator = await request(app.getHttpServer())
      .get(`/api/creator/offers/${offerId}/creator-kit`)
      .set(auth(creatorToken))
      .expect(200);
    expect(actualPreview.body.scenarios).toEqual(actualCreator.body.scenarios);
  });

  it('ведёт историю DRAFT → PUBLISHED → SUPERSEDED и восстанавливает новой ревизией', async () => {
    const draft = await request(app.getHttpServer())
      .get(`/api/brand/offers/${offerId}/creator-kit`)
      .set(auth(brandToken))
      .expect(200);
    expect(draft.body.revision.status).toBe('DRAFT');
    const secondPublish = await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/publish`)
      .set(auth(brandToken))
      .send({ publisherNote: 'Обновлена история бренда' })
      .expect(201);
    const secondRevisionId = secondPublish.body.revision.id;
    expect(secondRevisionId).not.toBe(firstPublishedRevisionId);

    const history = await request(app.getHttpServer())
      .get(`/api/brand/offers/${offerId}/creator-kit/revisions`)
      .set(auth(brandToken))
      .expect(200);
    expect(history.body.find((item: { id: string }) => item.id === firstPublishedRevisionId).status)
      .toBe('SUPERSEDED');
    expect(history.body.find((item: { id: string }) => item.id === secondRevisionId).status)
      .toBe('PUBLISHED');
    expect(
      history.body.find((item: { id: string }) => item.id === secondRevisionId).changeSet.sections,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ section: 'BRAND_CONTENT' })]));

    const preview = await request(app.getHttpServer())
      .get(
        `/api/brand/offers/${offerId}/creator-kit/revisions/${firstPublishedRevisionId}/restore-preview`,
      )
      .set(auth(brandToken))
      .expect(200);
    expect(preview.body.targetRevision.id).toBe(firstPublishedRevisionId);
    expect(preview.body.preview.brandContent.description).toBe('Описание бренда BYSOLA');

    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/revisions/${firstPublishedRevisionId}/restore`)
      .set(auth(brandToken))
      .send({ expectedActiveRevisionId: firstPublishedRevisionId })
      .expect(409);
    const restored = await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/creator-kit/revisions/${firstPublishedRevisionId}/restore`)
      .set(auth(brandToken))
      .send({ expectedActiveRevisionId: secondRevisionId, publisherNote: 'Возврат к v1' })
      .expect(201);
    expect(restored.body.revision.id).not.toBe(firstPublishedRevisionId);
    expect(restored.body.brandContent.description).toBe('Описание бренда BYSOLA');
    const restoredRevisionId = restored.body.revision.id;

    await request(app.getHttpServer())
      .post(
        `/api/brand/offers/${offerId}/creator-kit/revisions/${secondRevisionId}/create-draft`,
      )
      .set(auth(brandToken))
      .expect(201)
      .expect(({ body }) => {
        expect(body.revision.status).toBe('DRAFT');
        expect(body.revision.basedOnRevisionId).toBe(secondRevisionId);
      });
    await request(app.getHttpServer())
      .post(
        `/api/brand/offers/${offerId}/creator-kit/revisions/${restoredRevisionId}/create-draft`,
      )
      .set(auth(brandToken))
      .expect(409);
  });

  it('не раскрывает Creator Kit после снятия оффера с публикации', async () => {
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offerId}/pause`)
      .set(auth(brandToken))
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/creator/offers/${offerId}/creator-kit`)
      .set(auth(creatorToken))
      .expect(404);
  });
});
