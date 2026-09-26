import { PublicOffersController } from './offers.controller';

describe('PublicOffersController', () => {
  it('delegates the public catalog request to published offers', async () => {
    const offers = {
      listPublicPublished: jest.fn().mockResolvedValue([{ id: 'offer-a' }]),
    };
    const controller = new PublicOffersController(offers as any);

    await expect(controller.listPublished()).resolves.toEqual([{ id: 'offer-a' }]);
    expect(offers.listPublicPublished).toHaveBeenCalledTimes(1);
  });
});
