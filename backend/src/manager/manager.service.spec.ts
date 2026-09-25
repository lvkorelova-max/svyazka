import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { ManagerService } from './manager.service';

describe('ManagerService', () => {
  const audit = { requestId: jest.fn(() => 'request-id') } as any;
  const prisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    brandProfile: { findUnique: jest.fn() },
    managerProfile: { findUnique: jest.fn(), create: jest.fn(), upsert: jest.fn() },
    brandManagerAssignment: { findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('returns only active assignments for a manager across multiple brands', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'manager',
      email: 'manager@example.test',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    });
    prisma.brandManagerAssignment.findMany.mockResolvedValue([
      {
        assignedAt: new Date('2026-09-25T00:00:00Z'),
        brand: { id: 'brand-a', brandName: 'A' },
      },
      {
        assignedAt: new Date('2026-09-25T01:00:00Z'),
        brand: { id: 'brand-b', brandName: 'B' },
      },
    ]);
    await expect(new ManagerService(prisma, audit).listBrands('manager')).resolves.toEqual([
      { id: 'brand-a', brandName: 'A', assignedAt: new Date('2026-09-25T00:00:00Z') },
      { id: 'brand-b', brandName: 'B', assignedAt: new Date('2026-09-25T01:00:00Z') },
    ]);
    expect(prisma.brandManagerAssignment.findMany).toHaveBeenCalledWith({
      where: { managerId: 'manager', removedAt: null },
      orderBy: { assignedAt: 'asc' },
      include: { brand: { select: {
        id: true, brandName: true, legalName: true, logoUrl: true, verificationStatus: true,
      } } },
    });
  });

  it('creates a manager profile for an active manager when requested', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'manager',
      email: 'manager@example.test',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    });
    prisma.managerProfile.findUnique.mockResolvedValue(null);
    prisma.managerProfile.create.mockResolvedValue({
      userId: 'manager',
      displayName: 'manager@example.test',
    });
    await expect(new ManagerService(prisma, audit).getProfile('manager')).resolves.toEqual({
      userId: 'manager',
      displayName: 'manager@example.test',
    });
  });

  it('rejects an active duplicate assignment', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'admin', role: UserRole.ADMIN, status: UserStatus.ACTIVE })
      .mockResolvedValueOnce({
        id: 'manager',
        email: 'manager@example.test',
        role: UserRole.MANAGER,
        status: UserStatus.ACTIVE,
        managerProfile: null,
      });
    prisma.brandProfile.findUnique.mockResolvedValue({ id: 'brand' });
    const tx = {
      brandManagerAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'active' }) },
    };
    prisma.$transaction.mockImplementation((callback: (value: unknown) => unknown) => callback(tx));
    await expect(
      new ManagerService(prisma, audit).assignManager('admin', 'brand', 'manager'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows an administrator to remove the last active manager', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    prisma.brandProfile.findUnique.mockResolvedValue({ id: 'brand' });
    const update = jest.fn().mockResolvedValue({ id: 'assignment', removedAt: new Date() });
    const tx = {
      brandManagerAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'assignment' }),
        update,
      },
      auditLog: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((callback: (value: unknown) => unknown) => callback(tx));
    await expect(
      new ManagerService(prisma, audit).removeManager('admin', 'brand', 'manager'),
    ).resolves.toEqual(expect.objectContaining({ id: 'assignment' }));
    expect(update).toHaveBeenCalledWith({
      where: { id: 'assignment' },
      data: { removedAt: expect.any(Date), removedBy: 'admin' },
    });
  });

  it('creates a new assignment period after a previous assignment was removed', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'admin', role: UserRole.ADMIN, status: UserStatus.ACTIVE })
      .mockResolvedValueOnce({
        id: 'manager',
        email: 'manager@example.test',
        role: UserRole.MANAGER,
        status: UserStatus.ACTIVE,
        managerProfile: null,
      });
    prisma.brandProfile.findUnique.mockResolvedValue({ id: 'brand' });
    const create = jest.fn().mockResolvedValue({ id: 'new-assignment', removedAt: null });
    const tx = {
      brandManagerAssignment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
      managerProfile: { upsert: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((callback: (value: unknown) => unknown) => callback(tx));
    await expect(
      new ManagerService(prisma, audit).assignManager('admin', 'brand', 'manager'),
    ).resolves.toEqual(expect.objectContaining({ id: 'new-assignment' }));
    expect(create).toHaveBeenCalledWith({
      data: { brandId: 'brand', managerId: 'manager', assignedBy: 'admin' },
    });
  });

  it('reports no active assignment after removal', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'manager',
      email: 'manager@example.test',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    });
    prisma.brandManagerAssignment.findMany.mockResolvedValue([]);
    await expect(new ManagerService(prisma, audit).listBrands('manager')).resolves.toEqual([]);
    expect(prisma.brandManagerAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { managerId: 'manager', removedAt: null } }),
    );
  });

  it('rejects blocked managers from the manager brand list', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'manager',
      role: UserRole.MANAGER,
      status: UserStatus.BLOCKED,
    });
    await expect(new ManagerService(prisma, audit).listBrands('manager')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
