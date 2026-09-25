import { UserRole, UserStatus } from '@prisma/client';
import { ManagerService } from './manager.service';

describe('Phase 3 manager removal cleanup', () => {
  it('clears current responsibility but preserves authorship and historical order snapshots', async () => {
    const updateAssignment = jest.fn().mockResolvedValue({
      id: 'assignment-a',
      removedAt: new Date(),
    });
    const tx = {
      brandManagerAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'assignment-a' }),
        update: updateAssignment,
      },
      offer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      affiliateRelationship: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        }),
      },
      brandProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-a' }) },
      $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as any;
    const audit = { requestId: jest.fn(() => 'request-id') } as any;
    await new ManagerService(prisma, audit).removeManager('admin', 'brand-a', 'manager-a');
    expect(tx.offer.updateMany).toHaveBeenCalledWith({
      where: { brandId: 'brand-a', currentManagerId: 'manager-a' },
      data: { currentManagerId: null },
    });
    expect(tx.affiliateRelationship.updateMany).toHaveBeenCalledWith({
      where: { offer: { brandId: 'brand-a' }, currentManagerId: 'manager-a' },
      data: { currentManagerId: null },
    });
    expect(updateAssignment).toHaveBeenCalledWith({
      where: { id: 'assignment-a' },
      data: { removedAt: expect.any(Date), removedBy: 'admin' },
    });
  });
});
