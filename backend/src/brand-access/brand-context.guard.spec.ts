import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { BrandContextGuard } from './brand-context.guard';
import { BrandAccessService } from './brand-access.service';

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
  const brands = {
    getActiveBrandForManager: jest.fn(),
  } as unknown as BrandAccessService;

  beforeEach(() => jest.clearAllMocks());

  it('accepts an explicitly selected assigned brand', async () => {
    (brands.getActiveBrandForManager as jest.Mock).mockResolvedValue({ id: 'brand' });
    const requestContext = context(
      { id: 'manager', role: UserRole.MANAGER, status: UserStatus.ACTIVE },
      '11111111-1111-4111-8111-111111111111',
    );
    await expect(new BrandContextGuard(brands).canActivate(requestContext)).resolves.toBe(true);
    expect(brands.getActiveBrandForManager).toHaveBeenCalledWith(
      'manager',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('rejects a missing context header', async () => {
    await expect(
      new BrandContextGuard(brands).canActivate(
        context({ id: 'manager', role: UserRole.MANAGER, status: UserStatus.ACTIVE }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(brands.getActiveBrandForManager).not.toHaveBeenCalled();
  });

  it('rejects a cross-brand or removed assignment', async () => {
    (brands.getActiveBrandForManager as jest.Mock).mockRejectedValue(
      new ForbiddenException('Нет активного доступа к бренду'),
    );
    await expect(
      new BrandContextGuard(brands).canActivate(
        context(
          { id: 'manager', role: UserRole.MANAGER, status: UserStatus.ACTIVE },
          '22222222-2222-4222-8222-222222222222',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not alter existing non-manager authorization paths', async () => {
    await expect(
      new BrandContextGuard(brands).canActivate(
        context({ id: 'brand', role: UserRole.BRAND, status: UserStatus.ACTIVE }),
      ),
    ).resolves.toBe(true);
    expect(brands.getActiveBrandForManager).not.toHaveBeenCalled();
  });
});
