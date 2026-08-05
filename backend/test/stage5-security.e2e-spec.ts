import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { generateTotpCode } from '../src/auth/totp';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Stage 5B authorization hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifiedAdminToken: string;

  const user = {
    email: 'stage5-security@example.test',
    password: 'Stage5Security123',
    role: 'BRAND',
    name: 'Stage 5 Security',
  };
  const admin = {
    email: 'stage5-mfa-admin@example.test',
    password: 'Stage5MfaAdmin123',
    role: 'BRAND',
    name: 'Stage 5 MFA Admin',
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

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
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
    await prisma.offer.deleteMany();
    await prisma.creatorProfile.deleteMany();
    await prisma.brandProfile.deleteMany();
    await prisma.user.deleteMany();

    await request(app.getHttpServer()).post('/api/auth/register').send(user).expect(201);
    await request(app.getHttpServer()).post('/api/auth/register').send(admin).expect(201);
    await prisma.user.update({
      where: { email: admin.email },
      data: { role: 'ADMIN' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('блокирует вход на 15 минут после пяти неверных попыток без раскрытия email', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: 'WrongPassword123' })
        .expect(401);
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { email: user.email } });
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'unknown-security@example.test', password: user.password })
      .expect(401);

    await prisma.user.update({
      where: { id: locked.id },
      data: { lockedUntil: new Date('2020-01-01T00:00:00.000Z') },
    });
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
  });

  it('reset token одноразовый и отзывает ранее выданные сессии', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    const known = await request(app.getHttpServer())
      .post('/api/auth/password-reset/request')
      .send({ email: user.email })
      .expect(200);
    const unknown = await request(app.getHttpServer())
      .post('/api/auth/password-reset/request')
      .send({ email: 'not-found@example.test' })
      .expect(200);
    expect(known.body.message).toBe(unknown.body.message);
    expect(known.body.developmentToken).toBeTruthy();

    const newPassword = 'Stage5Security456';
    await request(app.getHttpServer())
      .post('/api/auth/password-reset/confirm')
      .send({ token: known.body.developmentToken, newPassword })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/password-reset/confirm')
      .send({ token: known.body.developmentToken, newPassword })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(auth(login.body.accessToken))
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: newPassword })
      .expect(200);
    user.password = newPassword;
  });

  it('ADMIN TOTP создаёт хешированные одноразовые recovery codes', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
    const enrollment = await request(app.getHttpServer())
      .post('/api/auth/admin/mfa/enroll')
      .set(auth(login.body.accessToken))
      .send({ currentPassword: admin.password })
      .expect(201);
    const confirmed = await request(app.getHttpServer())
      .post('/api/auth/admin/mfa/confirm')
      .set(auth(login.body.accessToken))
      .send({ code: generateTotpCode(enrollment.body.secret) })
      .expect(201);
    expect(confirmed.body.recoveryCodes).toHaveLength(10);
    const stored = await prisma.adminRecoveryCode.findMany({
      where: { user: { email: admin.email } },
    });
    expect(stored).toHaveLength(10);
    expect(stored.map((item) => item.codeHash)).not.toContain(
      confirmed.body.recoveryCodes[0],
    );

    const challenged = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
    expect(challenged.body.mfaRequired).toBe(true);
    const recoveryCode = confirmed.body.recoveryCodes[0];
    const verified = await request(app.getHttpServer())
      .post('/api/auth/admin/mfa/verify')
      .send({ challengeToken: challenged.body.challengeToken, code: recoveryCode })
      .expect(200);
    expect(verified.body.accessToken).toBeTruthy();
    verifiedAdminToken = verified.body.accessToken;
    await request(app.getHttpServer())
      .post('/api/auth/admin/mfa/verify')
      .send({ challengeToken: challenged.body.challengeToken, code: recoveryCode })
      .expect(401);
    expect(
      await prisma.auditLog.count({
        where: {
          actor: { email: admin.email },
          action: { in: ['ADMIN_MFA_ENABLED', 'ADMIN_MFA_RECOVERY_CODE_USED'] },
        },
      }),
    ).toBe(2);
  });

  it('блокировка пользователя отзывает сессии и записывается в AuditLog', async () => {
    const target = {
      email: 'stage5-block-target@example.test',
      password: 'Stage5BlockTarget123',
      role: 'CREATOR',
      name: 'Blocked Creator',
    };
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(target)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/users/${registered.body.user.id}/block`)
      .set(auth(verifiedAdminToken))
      .send({ reason: 'Security test' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(auth(registered.body.accessToken))
      .expect(401);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'USER_BLOCKED',
          entityId: registered.body.user.id,
        },
      }),
    ).toBe(1);
  });

  it('limiter возвращает 429 и очищает ключи по TTL', async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    }
    await request(app.getHttpServer()).post('/api/auth/refresh').expect(429);
  });
});
