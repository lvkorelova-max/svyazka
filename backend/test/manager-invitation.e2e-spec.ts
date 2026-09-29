import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ManagerInvitationStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { BigIntSerializerInterceptor } from '../src/common/interceptors/bigint-serializer.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Manager invitation links end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let brandAToken: string;
  let brandBToken: string;
  let creatorToken: string;
  let annaToken: string;
  let mariaToken: string;
  let brandAId: string;
  let brandBId: string;
  let annaId: string;
  let mariaId: string;
  let newInvitationId: string;
  let newInvitationToken: string;
  let existingInvitationId: string;
  let existingInvitationToken: string;

  const passwords = {
    brandA: 'InvitationBrandA123',
    brandB: 'InvitationBrandB123',
    creator: 'InvitationCreator123',
    anna: 'InvitationAnna123',
    maria: 'InvitationMaria123',
    newManager: 'InvitationNew123',
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
    await prisma.managerInvitation.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.allow_financial_cleanup', 'on', true)`,
      );
      await tx.payoutItem.deleteMany();
      await tx.commission.deleteMany();
      await tx.payout.deleteMany();
    });
    await prisma.$executeRawUnsafe(
      'UPDATE "Order" SET "currentAttributionResultId" = NULL',
    );
    await prisma.orderTimelineEvent.deleteMany();
    await prisma.attributionEvidence.deleteMany();
    await prisma.attributionException.deleteMany();
    await prisma.tildaPaymentProbe.deleteMany();
    await prisma.attributionResult.deleteMany();
    await prisma.stage8OrderEvent.deleteMany();
    await prisma.orderImportRow.deleteMany();
    await prisma.order.deleteMany();
    await prisma.orderImport.deleteMany();
    await prisma.click.deleteMany();
    await prisma.affiliateRelationship.deleteMany();
    await prisma.offerApplication.deleteMany();
    await prisma.publicationRequirements.deleteMany();
    await prisma.creatorKitRevisionAsset.deleteMany();
    await prisma.creatorKitAsset.deleteMany();
    await prisma.creatorKitScenario.deleteMany();
    await prisma.creatorKitFact.deleteMany();
    await prisma.creatorKitClaim.deleteMany();
    await prisma.creatorKitRule.deleteMany();
    await prisma.creatorKitBrandContent.deleteMany();
    await prisma.creatorKitProductContent.deleteMany();
    await prisma.$executeRawUnsafe(
      'UPDATE "CreatorKit" SET "activeRevisionId" = NULL, "draftRevisionId" = NULL',
    );
    await prisma.creatorKitRevision.deleteMany();
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

  async function createManager(email: string, password: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: UserRole.MANAGER,
        managerProfile: {
          create: { displayName: email },
        },
      },
    });
  }

  function createInvitation(
    token: string,
    email: string,
    displayName: string,
  ) {
    return request(app.getHttpServer())
      .post('/api/brand/team/invitations')
      .set(auth(token))
      .send({ email, displayName });
  }

  function rawToken(invitationUrl: string) {
    return decodeURIComponent(new URL(invitationUrl).pathname.split('/').pop()!);
  }

  beforeAll(async () => {
    app = await createApplication();
    prisma = app.get(PrismaService);
    await cleanDatabase();

    brandAToken = await registerAndLogin({
      email: 'invitation-brand-a@example.test',
      password: passwords.brandA,
      role: 'BRAND',
      name: 'Invitation Brand A',
    });
    brandBToken = await registerAndLogin({
      email: 'invitation-brand-b@example.test',
      password: passwords.brandB,
      role: 'BRAND',
      name: 'Invitation Brand B',
    });
    creatorToken = await registerAndLogin({
      email: 'invitation-creator@example.test',
      password: passwords.creator,
      role: 'CREATOR',
      name: 'Invitation Creator',
    });
    expect(creatorToken).toEqual(expect.any(String));

    const brandA = await prisma.brandProfile.findFirstOrThrow({
      where: { user: { email: 'invitation-brand-a@example.test' } },
    });
    const brandB = await prisma.brandProfile.findFirstOrThrow({
      where: { user: { email: 'invitation-brand-b@example.test' } },
    });
    brandAId = brandA.id;
    brandBId = brandB.id;

    const anna = await createManager(
      'invitation-anna@example.test',
      passwords.anna,
    );
    const maria = await createManager(
      'invitation-maria@example.test',
      passwords.maria,
    );
    annaId = anna.id;
    mariaId = maria.id;
    annaToken = await login(anna.email, passwords.anna);
    mariaToken = await login(maria.email, passwords.maria);

    await request(app.getHttpServer())
      .post(`/api/brand/team/managers/${annaId}`)
      .set(auth(brandAToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/brand/team/managers/${mariaId}`)
      .set(auth(brandBToken))
      .expect(201);
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
  });

  it('creates hashed invitations, hides secrets from lists, and isolates brands', async () => {
    const created = await createInvitation(
      brandAToken,
      'New.Manager@Example.Test',
      'New Manager',
    ).expect(201);
    newInvitationId = created.body.id;
    newInvitationToken = rawToken(created.body.invitationUrl);

    expect(created.body).not.toHaveProperty('tokenHash');
    const stored = await prisma.managerInvitation.findUniqueOrThrow({
      where: { id: newInvitationId },
    });
    expect(stored.email).toBe('new.manager@example.test');
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(newInvitationToken).digest('hex'),
    );
    expect(stored.tokenHash).not.toBe(newInvitationToken);

    const listed = await request(app.getHttpServer())
      .get('/api/brand/team/invitations')
      .set(auth(brandAToken))
      .expect(200);
    expect(listed.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: newInvitationId,
          email: 'new.manager@example.test',
          displayName: 'New Manager',
          status: 'PENDING',
        }),
      ]),
    );
    expect(JSON.stringify(listed.body)).not.toContain('tokenHash');
    expect(JSON.stringify(listed.body)).not.toContain('invitationUrl');
    expect(JSON.stringify(listed.body)).not.toContain(newInvitationToken);

    await createInvitation(
      brandAToken,
      'new.manager@example.test',
      'Duplicate Manager',
    ).expect(409);
    await createInvitation(
      brandBToken,
      'new.manager@example.test',
      'Same Manager Other Brand',
    ).expect(201);

    const brandBList = await request(app.getHttpServer())
      .get('/api/brand/team/invitations')
      .set(auth(brandBToken))
      .expect(200);
    expect(brandBList.body).toHaveLength(1);
    expect(brandBList.body[0].email).toBe('new.manager@example.test');
  });

  it('enforces eligible roles and existing team membership', async () => {
    await createInvitation(
      brandAToken,
      'invitation-anna@example.test',
      'Already Assigned Anna',
    ).expect(409);
    await createInvitation(
      brandAToken,
      'invitation-brand-b@example.test',
      'Existing Brand',
    ).expect(400);
    await createInvitation(
      brandAToken,
      'invitation-creator@example.test',
      'Existing Creator',
    ).expect(400);

    const existing = await createInvitation(
      brandAToken,
      'invitation-maria@example.test',
      'Maria Manager',
    ).expect(201);
    existingInvitationId = existing.body.id;
    existingInvitationToken = rawToken(existing.body.invitationUrl);
    expect(
      await prisma.brandManagerAssignment.count({
        where: { managerId: mariaId, removedAt: null },
      }),
    ).toBe(1);
  });

  it('inspects only valid tokens and masks invitation identity', async () => {
    const inspectedNew = await request(app.getHttpServer())
      .get(`/api/manager-invitations/${newInvitationToken}`)
      .expect(200);
    expect(inspectedNew.body).toEqual(
      expect.objectContaining({
        valid: true,
        brand: expect.objectContaining({ name: 'Invitation Brand A' }),
        email: 'n***@example.test',
        displayName: 'New Manager',
        existingManagerAccount: false,
      }),
    );
    expect(inspectedNew.body).not.toHaveProperty('tokenHash');

    const inspectedExisting = await request(app.getHttpServer())
      .get(`/api/manager-invitations/${existingInvitationToken}`)
      .expect(200);
    expect(inspectedExisting.body.existingManagerAccount).toBe(true);

    await request(app.getHttpServer())
      .get('/api/manager-invitations/not-a-valid-token')
      .expect(404);
  });

  it('prevents cross-brand revocation and rejects revoked or expired tokens', async () => {
    const revoked = await createInvitation(
      brandAToken,
      'revoked.manager@example.test',
      'Revoked Manager',
    ).expect(201);
    const revokedToken = rawToken(revoked.body.invitationUrl);

    await request(app.getHttpServer())
      .delete(`/api/brand/team/invitations/${revoked.body.id}`)
      .set(auth(brandBToken))
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/brand/team/invitations/${revoked.body.id}`)
      .set(auth(brandAToken))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/manager-invitations/${revokedToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/manager-invitations/${revokedToken}/accept`)
      .send({ password: passwords.newManager })
      .expect(404);
    expect(
      await prisma.user.count({ where: { email: 'revoked.manager@example.test' } }),
    ).toBe(0);

    const expired = await createInvitation(
      brandAToken,
      'expired.manager@example.test',
      'Expired Manager',
    ).expect(201);
    const expiredToken = rawToken(expired.body.invitationUrl);
    await prisma.managerInvitation.update({
      where: { id: expired.body.id },
      data: { expiresAt: new Date('2026-09-24T00:00:00.000Z') },
    });
    await request(app.getHttpServer())
      .get(`/api/manager-invitations/${expiredToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/manager-invitations/${expiredToken}/accept`)
      .send({ password: passwords.newManager })
      .expect(404);
    expect(
      await prisma.user.count({ where: { email: 'expired.manager@example.test' } }),
    ).toBe(0);
    expect(
      (
        await prisma.managerInvitation.findUniqueOrThrow({
          where: { id: expired.body.id },
          select: { status: true },
        })
      ).status,
    ).toBe(ManagerInvitationStatus.EXPIRED);
  });

  it('accepts a new Manager once and exposes the normal team assignment', async () => {
    const attempts = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/manager-invitations/${newInvitationToken}/accept`)
        .send({ password: passwords.newManager }),
      request(app.getHttpServer())
        .post(`/api/manager-invitations/${newInvitationToken}/accept`)
        .send({ password: passwords.newManager }),
    ]);
    const statuses = attempts.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 404 || status === 409)).toHaveLength(1);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'new.manager@example.test' },
      include: { managerProfile: true },
    });
    expect(user.role).toBe(UserRole.MANAGER);
    expect(user.managerProfile?.displayName).toBe('New Manager');
    expect(
      await prisma.brandManagerAssignment.count({
        where: { brandId: brandAId, managerId: user.id, removedAt: null },
      }),
    ).toBe(1);
    const invitation = await prisma.managerInvitation.findUniqueOrThrow({
      where: { id: newInvitationId },
    });
    expect(invitation.status).toBe(ManagerInvitationStatus.ACCEPTED);
    expect(invitation.acceptedByUserId).toBe(user.id);
    expect(invitation.acceptedAt).not.toBeNull();

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'new.manager@example.test',
        password: passwords.newManager,
      })
      .expect(200);
    const team = await request(app.getHttpServer())
      .get('/api/brand/team/managers')
      .set(auth(brandAToken))
      .expect(200);
    expect(team.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ managerId: user.id, active: true }),
      ]),
    );
    await request(app.getHttpServer())
      .post(`/api/manager-invitations/${newInvitationToken}/accept`)
      .send({ password: passwords.newManager })
      .expect(404);
  });

  it('requires the matching existing Manager account and preserves other brands', async () => {
    await request(app.getHttpServer())
      .post(`/api/manager-invitations/${existingInvitationToken}/accept-existing`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/manager-invitations/${existingInvitationToken}/accept-existing`)
      .set(auth(annaToken))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/manager-invitations/${existingInvitationToken}/accept-existing`)
      .set(auth(mariaToken))
      .expect(201);

    expect(
      await prisma.brandManagerAssignment.findMany({
        where: { managerId: mariaId, removedAt: null },
        select: { brandId: true },
        orderBy: { brandId: 'asc' },
      }),
    ).toEqual(
      expect.arrayContaining([{ brandId: brandAId }, { brandId: brandBId }]),
    );
    expect(
      (
        await prisma.managerInvitation.findUniqueOrThrow({
          where: { id: existingInvitationId },
          select: { status: true, acceptedByUserId: true },
        })
      ),
    ).toEqual({
      status: ManagerInvitationStatus.ACCEPTED,
      acceptedByUserId: mariaId,
    });
    await request(app.getHttpServer())
      .post(`/api/manager-invitations/${existingInvitationToken}/accept-existing`)
      .set(auth(mariaToken))
      .expect(404);
  });

  it('rejects acceptance if the Manager joined through another path first', async () => {
    const david = await createManager(
      'invitation-david@example.test',
      'InvitationDavid123',
    );
    const davidToken = await login(david.email, 'InvitationDavid123');
    expect(davidToken).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .post(`/api/brand/team/managers/${david.id}`)
      .set(auth(brandBToken))
      .expect(201);
    const invitation = await createInvitation(
      brandAToken,
      david.email,
      'David Manager',
    ).expect(201);
    const token = rawToken(invitation.body.invitationUrl);
    await request(app.getHttpServer())
      .post(`/api/brand/team/managers/${david.id}`)
      .set(auth(brandAToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/manager-invitations/${token}/accept-existing`)
      .set(auth(davidToken))
      .expect(409);
    expect(
      (
        await prisma.managerInvitation.findUniqueOrThrow({
          where: { id: invitation.body.id },
          select: { status: true },
        })
      ).status,
    ).toBe(ManagerInvitationStatus.PENDING);
  });
});
