import { OfferStatus, UserRole } from '@prisma/client';
import { BrandAccessService } from '../brand-access/brand-access.service';
import { OffersService } from './offers.service';

describe('OffersService manager brand authorization', () => {
  const prisma = {
    offer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  } as any;
  const config = { get: jest.fn(() => '500') } as any;
  const audit = { record: jest.fn() } as any;
  const brands = {
    resolveBrand: jest.fn(),
    assertManagerAssignedToBrand: jest.fn(),
  } as unknown as BrandAccessService;

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

  it('assigns manager authorship and current responsibility on manager-created offers', async () => {
    (brands.resolveBrand as jest.Mock).mockResolvedValue({ id: 'brand-a' });
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.MANAGER });
    prisma.offer.create.mockResolvedValue({ id: 'offer-a' });
    const service = new OffersService(prisma, config, audit, brands);
    await service.create('manager-a', {
      title: 'Offer',
      description: 'Description',
      productPriceKopecks: 100,
      creatorCommissionBps: 100,
      promotionWithoutProduct: 'YES' as any,
    } as any, 'brand-a');
    expect(prisma.offer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brandId: 'brand-a',
          createdByManagerId: 'manager-a',
          currentManagerId: 'manager-a',
        }),
      }),
    );
  });

  it('leaves responsibility fields null for legacy BRAND-created offers', async () => {
    (brands.resolveBrand as jest.Mock).mockResolvedValue({ id: 'brand-a' });
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.BRAND });
    prisma.offer.create.mockResolvedValue({ id: 'offer-a' });
    const service = new OffersService(prisma, config, audit, brands);
    await service.create('brand-a', {} as any, undefined);
    const data = prisma.offer.create.mock.calls[0][0].data;
    expect(data.createdByManagerId).toBeUndefined();
    expect(data.currentManagerId).toBeUndefined();
  });

  it('allows a DRAFT offer without a product URL', async () => {
    (brands.resolveBrand as jest.Mock).mockResolvedValue({ id: 'brand-a' });
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.BRAND });
    prisma.offer.create.mockResolvedValue({
      id: 'offer-a',
      status: OfferStatus.DRAFT,
      productUrl: null,
    });
    const service = new OffersService(prisma, config, audit, brands);

    await expect(
      service.create(
        'brand-a',
        {
          title: 'Offer',
          description: 'Description',
          productPriceKopecks: 100,
          creatorCommissionBps: 100,
          promotionWithoutProduct: 'YES',
        } as any,
        undefined,
      ),
    ).resolves.toEqual(expect.objectContaining({ status: OfferStatus.DRAFT }));
  });

  it('rejects publishing an offer without a product URL', async () => {
    (brands.resolveBrand as jest.Mock).mockResolvedValue({ id: 'brand-a' });
    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-a',
      brandId: 'brand-a',
      status: OfferStatus.DRAFT,
      productUrl: null,
      brand: {},
    });
    const service = new OffersService(prisma, config, audit, brands);

    await expect(
      service.transition('brand-a', 'offer-a', OfferStatus.PUBLISHED, 'brand-a'),
    ).rejects.toThrow('Для публикации у оффера должна быть ссылка на товар');
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  it('allows publishing an offer with a valid product URL', async () => {
    (brands.resolveBrand as jest.Mock).mockResolvedValue({ id: 'brand-a' });
    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-a',
      brandId: 'brand-a',
      status: OfferStatus.DRAFT,
      productUrl: 'https://shop.example.test/products/offer-a',
      brand: {},
    });
    prisma.offer.update.mockResolvedValue({
      id: 'offer-a',
      brandId: 'brand-a',
      status: OfferStatus.PUBLISHED,
      productUrl: 'https://shop.example.test/products/offer-a',
    });
    const service = new OffersService(prisma, config, audit, brands);

    await expect(
      service.transition('brand-a', 'offer-a', OfferStatus.PUBLISHED, 'brand-a'),
    ).resolves.toEqual(
      expect.objectContaining({ status: OfferStatus.PUBLISHED }),
    );
    expect(prisma.offer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OfferStatus.PUBLISHED },
      }),
    );
  });

  it('transfers current responsibility without changing authorship', async () => {
    (brands.resolveBrand as jest.Mock).mockResolvedValue({ id: 'brand-a' });
    (brands.assertManagerAssignedToBrand as jest.Mock).mockResolvedValue('manager-b');
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.MANAGER });
    prisma.offer.findUnique.mockResolvedValue({
      id: 'offer-a',
      brandId: 'brand-a',
      currentManagerId: 'manager-a',
      createdByManagerId: 'manager-a',
      status: OfferStatus.DRAFT,
      brand: {},
    });
    prisma.offer.update.mockResolvedValue({
      id: 'offer-a',
      brandId: 'brand-a',
      currentManagerId: 'manager-b',
      createdByManagerId: 'manager-a',
    });
    const service = new OffersService(prisma, config, audit, brands);
    await service.updateResponsibility('manager-a', 'offer-a', 'brand-a', 'manager-b');
    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'offer-a' },
      data: { currentManagerId: 'manager-b' },
      include: expect.objectContaining({
        brand: true,
        currentManager: expect.any(Object),
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'OFFER_RESPONSIBILITY_CHANGED',
        metadata: { previousManagerId: 'manager-a', newManagerId: 'manager-b' },
      }),
    );
  });

  it('returns the current manager identity without exposing the nested profile relation', async () => {
    (brands.resolveBrand as jest.Mock).mockResolvedValue({ id: 'brand-a' });
    prisma.offer.findMany.mockResolvedValue([
      {
        id: 'offer-a',
        brandId: 'brand-a',
        currentManagerId: 'manager-a',
        currentManager: {
          id: 'manager-a',
          managerProfile: { displayName: 'Manager A' },
        },
      },
    ]);
    const service = new OffersService(prisma, config, audit, brands);

    await expect(service.listOwn('manager-a', 'brand-a')).resolves.toEqual([
      expect.objectContaining({
        currentManagerId: 'manager-a',
        currentManager: { id: 'manager-a', displayName: 'Manager A' },
      }),
    ]);
  });
});
