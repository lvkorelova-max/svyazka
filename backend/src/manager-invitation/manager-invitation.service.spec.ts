import { createHash } from 'crypto';
import { ManagerInvitationStatus } from '@prisma/client';
import { ManagerInvitationService } from './manager-invitation.service';

describe('ManagerInvitationService', () => {
  const config = {
    get: jest.fn((key: string) => (key === 'MANAGER_INVITATION_TTL_DAYS' ? '7' : undefined)),
    getOrThrow: jest.fn(() => 'http://localhost:5173'),
  } as any;
  const audit = { requestId: jest.fn(() => 'request-id') } as any;

  beforeEach(() => jest.clearAllMocks());

  it('returns the raw token only in the creation URL and stores its SHA-256 hash', async () => {
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'invitation-a',
        email: data.email,
        displayName: data.displayName,
        status: ManagerInvitationStatus.PENDING,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
        acceptedAt: null,
        revokedAt: null,
        acceptedByUserId: null,
      }),
    );
    const tx = {
      managerInvitation: {
        updateMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      brandProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-a' }) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      brandManagerAssignment: { findFirst: jest.fn() },
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
    } as any;

    const result = await new ManagerInvitationService(prisma, config, audit).create(
      'brand-user',
      {
        email: 'New.Manager@Example.Test',
        displayName: 'New Manager',
      },
    );

    const rawToken = new URL(result!.invitationUrl).pathname.split('/').pop()!;
    const stored = create.mock.calls[0][0].data;
    expect(stored.email).toBe('new.manager@example.test');
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(rawToken).digest('hex'),
    );
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(result).not.toHaveProperty('tokenHash');
  });

  it('lists invitation metadata without selecting token hashes', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'invitation-a',
        email: 'manager@example.test',
        displayName: 'Manager',
        status: ManagerInvitationStatus.PENDING,
      },
    ]);
    const prisma = {
      brandProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-a' }) },
      managerInvitation: {
        updateMany: jest.fn(),
        findMany,
      },
    } as any;

    const result = await new ManagerInvitationService(prisma, config, audit).list(
      'brand-user',
    );

    expect(result[0]).not.toHaveProperty('tokenHash');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('tokenHash');
  });
});
