import { ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { BrandAccessService } from './brand-access.service';

describe('BrandAccessService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    brandProfile: { findUnique: jest.fn() },
    brandManagerAssignment: { findFirst: jest.fn() },
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('keeps legacy BRAND authorization without an active-brand header', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.BRAND,
      status: UserStatus.ACTIVE,
    });
    prisma.brandProfile.findUnique.mockResolvedValue({ id: 'brand-owner' });
    await expect(new BrandAccessService(prisma).resolveBrand('brand-user')).resolves.toEqual({
      id: 'brand-owner',
    });
    expect(prisma.brandManagerAssignment.findFirst).not.toHaveBeenCalled();
  });

  it('requires explicit context and active membership for MANAGER users', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    });
    await expect(new BrandAccessService(prisma).resolveBrand('manager')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.brandManagerAssignment.findFirst.mockResolvedValue({ brandId: 'brand-a' });
    prisma.brandProfile.findUnique.mockResolvedValue({ id: 'brand-a' });
    await expect(
      new BrandAccessService(prisma).resolveBrand('manager', 'brand-a'),
    ).resolves.toEqual({ id: 'brand-a' });
  });

  it('rejects cross-brand or removed assignments', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    });
    prisma.brandManagerAssignment.findFirst.mockResolvedValue(null);
    await expect(
      new BrandAccessService(prisma).resolveBrand('manager', 'brand-b'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an assigned manager to switch explicitly between two brands', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    });
    prisma.brandManagerAssignment.findFirst
      .mockResolvedValueOnce({ brandId: 'brand-a' })
      .mockResolvedValueOnce({ brandId: 'brand-b' });
    prisma.brandProfile.findUnique
      .mockResolvedValueOnce({ id: 'brand-a' })
      .mockResolvedValueOnce({ id: 'brand-b' });

    const service = new BrandAccessService(prisma);
    await expect(service.resolveBrand('manager', 'brand-a')).resolves.toEqual({ id: 'brand-a' });
    await expect(service.resolveBrand('manager', 'brand-b')).resolves.toEqual({ id: 'brand-b' });
  });

  it('rejects inactive managers before resolving a brand', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.MANAGER,
      status: UserStatus.BLOCKED,
    });
    await expect(
      new BrandAccessService(prisma).resolveBrand('manager', 'brand-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.brandManagerAssignment.findFirst).not.toHaveBeenCalled();
  });
});
