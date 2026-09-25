import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { BrandContextGuard } from './brand-context.guard';

function context(user: { id: string; role: UserRole; status: UserStatus }, brandId?: string) {
  const request = {
    user,
    header: (name: string) => (name === 'x-active-brand-id' ? brandId : undefined),
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('BrandContextGuard', () => {
  const prisma = {
    brandManagerAssignment: { findFirst: jest.fn() },
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('accepts an explicitly selected assigned brand', async () => {
    prisma.brandManagerAssignment.findFirst.mockResolvedValue({ brandId: 'a'.repeat(36) });
    const requestContext = context(
      { id: 'manager', role: UserRole.MANAGER, status: UserStatus.ACTIVE },
      '11111111-1111-4111-8111-111111111111',
    );
    await expect(new BrandContextGuard(prisma).canActivate(requestContext)).resolves.toBe(true);
    expect(prisma.brandManagerAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        brandId: '11111111-1111-4111-8111-111111111111',
        managerId: 'manager',
        removedAt: null,
      },
      select: { brandId: true },
    });
  });

  it('rejects a missing context header', async () => {
    await expect(
      new BrandContextGuard(prisma).canActivate(
        context({ id: 'manager', role: UserRole.MANAGER, status: UserStatus.ACTIVE }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.brandManagerAssignment.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a cross-brand or removed assignment', async () => {
    prisma.brandManagerAssignment.findFirst.mockResolvedValue(null);
    await expect(
      new BrandContextGuard(prisma).canActivate(
        context(
          { id: 'manager', role: UserRole.MANAGER, status: UserStatus.ACTIVE },
          '22222222-2222-4222-8222-222222222222',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not alter existing non-manager authorization paths', async () => {
    await expect(
      new BrandContextGuard(prisma).canActivate(
        context({ id: 'brand', role: UserRole.BRAND, status: UserStatus.ACTIVE }),
      ),
    ).resolves.toBe(true);
    expect(prisma.brandManagerAssignment.findFirst).not.toHaveBeenCalled();
  });
});
