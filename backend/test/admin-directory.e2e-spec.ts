import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './reset-test-database';

describe('ADMIN creator directory end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const brand = {
    email: 'admin-directory-brand@example.test',
    password: 'BrandDirectory123!',
    role: 'BRAND',
    name: 'Бренд каталога',
  };
  const creator = {
    email: 'admin-directory-creator@example.test',
    password: 'CreatorDirectory123!',
    role: 'CREATOR',
    name: 'Мелисса Тестовая',
  };
  const admin = {
    email: 'admin-directory-admin@example.test',
    password: 'AdminDirectory123!',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new BigIntSerializerInterceptor());
    await app.init();
    prisma = app.get(PrismaService);
    await resetTestDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function register(payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/auth/register').send(payload);
  }

  async function login(email: string, password: string) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body.accessToken as string;
  }

  function authHeader(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it('читает реальные профили и заявки из PostgreSQL только для ADMIN', async () => {
    await register(brand).expect(201);
    await register(creator).expect(201);
    await prisma.user.create({
      data: {
        email: admin.email,
        passwordHash: await argon2.hash(admin.password, { type: argon2.argon2id }),
        role: 'ADMIN',
      },
    });

    const brandToken = await login(brand.email, brand.password);
    const creatorToken = await login(creator.email, creator.password);
    const adminToken = await login(admin.email, admin.password);

    const offer = await request(app.getHttpServer())
      .post('/api/brand/offers')
      .set(authHeader(brandToken))
      .send({
        title: 'Оффер для реального ADMIN-списка',
        description: 'Проверка чтения настоящей заявки из PostgreSQL.',
        productUrl: 'https://shop.example.test/admin-directory',
        productPriceKopecks: 300_000,
        creatorCommissionBps: 1500,
        promotionWithoutProduct: 'YES',
        category: 'Тест',
        productRequirementSales: 0,
        allowedPromotionFormats: ['обзор'],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/offers/${offer.body.id}/publish`)
      .set(authHeader(brandToken))
      .expect(201);
    const application = await request(app.getHttpServer())
      .post(`/api/creator/offers/${offer.body.id}/applications`)
      .set(authHeader(creatorToken))
      .send({})
      .expect(201);

    const creatorProfile = await prisma.creatorProfile.findUniqueOrThrow({
      where: {
        userId: (
          await prisma.user.findUniqueOrThrow({ where: { email: creator.email } })
        ).id,
      },
    });
    const creators = await request(app.getHttpServer())
      .get('/api/admin/creators')
      .set(authHeader(adminToken))
      .expect(200);
    const listedCreator = creators.body.find(
      (item: { id: string }) => item.id === creatorProfile.id,
    );
    expect(listedCreator).toMatchObject({
      displayName: creator.name,
      user: { status: 'ACTIVE' },
      _count: { applications: 1, affiliateRelationships: 0 },
    });
    expect(JSON.stringify(listedCreator)).not.toContain(creator.email);

    const applications = await request(app.getHttpServer())
      .get('/api/admin/applications')
      .set(authHeader(adminToken))
      .expect(200);
    expect(applications.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: application.body.id,
          status: 'PENDING',
          creator: expect.objectContaining({ displayName: creator.name }),
          offer: expect.objectContaining({
            title: offer.body.title,
            brand: expect.objectContaining({ brandName: brand.name }),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(applications.body)).not.toContain(creator.email);

    for (const token of [brandToken, creatorToken]) {
      await request(app.getHttpServer())
        .get('/api/admin/creators')
        .set(authHeader(token))
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/admin/applications')
        .set(authHeader(token))
        .expect(403);
    }
  });
});
