import { AffiliateRelationshipStatus, OfferApplicationStatus, UserRole, UserStatus } from '@prisma/client';
import { PartnershipsService } from './partnerships.service';
import { BrandAccessService } from '../brand-access/brand-access.service';

describe('Phase 3 relationship responsibility', () => {
  it('transfers an existing relationship without changing its identity', async () => {
    const prisma = {
      affiliateRelationship: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'relationship-a',
          offerId: 'offer-a',
          currentManagerId: 'manager-a',
          status: AffiliateRelationshipStatus.ACTIVE,
          offer: { id: 'offer-a', brandId: 'brand-a' },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'relationship-a',
          offerId: 'offer-a',
          currentManagerId: 'manager-b',
          offer: { id: 'offer-a', brand: { id: 'brand-a' } },
          creator: {},
          application: {},
        }),
      },
    } as any;
    const brands = {
      resolveBrand: jest.fn().mockResolvedValue({ id: 'brand-a' }),
      assertManagerAssignedToBrand: jest.fn().mockResolvedValue('manager-b'),
    } as unknown as BrandAccessService;
    const audit = { record: jest.fn() } as any;
    const service = new PartnershipsService(
      prisma,
      { get: jest.fn() } as any,
      audit,
      brands,
    );
    await service.updateResponsibility('manager-a', 'relationship-a', 'brand-a', 'manager-b');
    expect(prisma.affiliateRelationship.update).toHaveBeenCalledWith({
      where: { id: 'relationship-a' },
      data: { currentManagerId: 'manager-b' },
      include: expect.anything(),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AFFILIATE_RELATIONSHIP_RESPONSIBILITY_CHANGED',
        metadata: { previousManagerId: 'manager-a', newManagerId: 'manager-b' },
      }),
    );
  });

  it('inherits the offer responsibility when approving a new relationship', async () => {
    const application = {
      id: 'application-a',
      offerId: 'offer-a',
      creatorId: 'creator-a',
      status: OfferApplicationStatus.PENDING,
      offer: {
        id: 'offer-a',
        brandId: 'brand-a',
        productUrl: 'https://example.test/product',
        currentManagerId: 'manager-a',
      },
      affiliateRelationship: null,
    };
    const relationshipCreate = jest.fn().mockResolvedValue({ id: 'relationship-a' });
    const tx = {
      offerApplication: {
        findUnique: jest.fn().mockResolvedValue(application),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      affiliateRelationship: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: relationshipCreate,
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as any;
    const brands = {
      resolveBrand: jest.fn().mockResolvedValue({ id: 'brand-a' }),
    } as unknown as BrandAccessService;
    const service = new PartnershipsService(
      prisma,
      { get: jest.fn(() => 'http://localhost:3000') } as any,
      { record: jest.fn() } as any,
      brands,
    );
    await service.approveApplication('manager-a', 'application-a', 'brand-a');
    expect(relationshipCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ currentManagerId: 'manager-a' }),
    });
  });
});
