import { OfferStatus, UserRole, UserStatus } from '@prisma/client';
import { BrandAccessService } from '../brand-access/brand-access.service';
import { OffersService } from './offers.service';

describe('OffersService manager brand authorization', () => {
  const prisma = {
    offer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as any;
  const config = { get: jest.fn(() => '500') } as any;
  const audit = { record: jest.fn() } as any;
  const brands = { resolveBrand: jest.fn() } as unknown as BrandAccessService;

  beforeEach(() => jest.clearAllMocks());

  it('uses the explicit active brand for list and indirect offer access', async () => {
    (brands.resolveBrand as jest.Mock).mockResolvedValue({
      id: 'brand-a',
      verificationStatus: 'VERIFIED',
    });
    prisma.offer.findMany.mockResolvedValue([]);
    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-a',
      brandId: 'brand-a',
      status: OfferStatus.DRAFT,
    });

    const service = new OffersService(prisma, config, audit, brands);
    await service.listOwn('manager', 'brand-a');
    await service.getOwn('manager', 'offer-a', 'brand-a');

    expect(brands.resolveBrand).toHaveBeenNthCalledWith(1, 'manager', 'brand-a');
    expect(brands.resolveBrand).toHaveBeenNthCalledWith(2, 'manager', 'brand-a');
    expect(prisma.offer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { brandId: 'brand-a' } }),
    );
    expect(prisma.offer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'offer-a' } }),
    );
  });
});
