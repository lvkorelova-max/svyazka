import { CommercialCalculationPolicy, OfferStatus, Prisma } from '@prisma/client';
import { OffersService } from './offers.service';

function setup() {
  const terms = {
    id: 'terms-1', version: 1, contractFingerprint: 'fingerprint-1',
    calculationPolicy: CommercialCalculationPolicy.POOL_65_35_V1,
    totalCommissionPoolBps: 1500, creatorPoolShareBps: 6500, platformPoolShareBps: 3500,
    creatorEffectiveGmvBps: 975, platformEffectiveGmvBps: 525,
    minimumPayoutMinor: 50000n, currency: 'RUB',
  };
  const offer = {
    id: 'offer', title: 'Offer', brandId: 'brand', brand: { userId: 'owner' },
    productUrl: 'https://example.test/product', status: OfferStatus.DRAFT,
    currentVersion: { id: 'draft' }, currentOfferVersionId: 'draft',
    currentCommercialTermsId: terms.id, currentCommercialTerms: terms,
  };
  const tx = {
    offer: { update: jest.fn().mockResolvedValue({ ...offer, status: OfferStatus.PUBLISHED }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = {
    offer: { findUnique: jest.fn().mockResolvedValue(offer) },
    $transaction: jest.fn(fn => fn(tx)),
  };
  const settings: Record<string, string> = {
    LEGAL_BRAND_OFFER_REVISION: 'v1', LEGAL_BRAND_OFFER_SHA256: 'a'.repeat(64),
  };
  const service = new OffersService(
    db as any,
    { get: (name: string) => settings[name] } as any,
    { record: jest.fn(), requestId: () => 'request' } as any,
    { resolveBrand: async () => ({ id: 'brand' }) } as any,
    { createOfferVersion: jest.fn().mockResolvedValue({ id: 'published' }) } as any,
  );
  const review = () => service.publishReview('owner', 'offer');
  const publish = (confirmation?: { accepted: boolean; reviewHash: string }, userId = 'owner') =>
    service.transition(userId, 'offer', OfferStatus.PUBLISHED, 'brand', confirmation);
  return { offer, tx, db, review, publish, settings };
}

it('binds launch to the reviewed document and terms, with transactional acceptance', async () => {
  const h = setup();
  const review = await h.review();
  if (!review.required) throw new Error('Expected review');
  expect(review.card.example).toEqual({ base: '100000', creator: '9750', platform: '5250' });
  await expect(h.publish()).rejects.toMatchObject({ status: 409 });
  await expect(h.publish({ accepted: true, reviewHash: review.reviewHash }, 'manager')).rejects.toMatchObject({ status: 403 });
  expect(h.db.$transaction).not.toHaveBeenCalled();
  await h.publish({ accepted: true, reviewHash: review.reviewHash });
  expect(h.tx.offer.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
    where: { id: 'offer', status: OfferStatus.DRAFT, AND: { currentOfferVersionId: 'draft', currentCommercialTermsId: 'terms-1' } },
  }));
  expect(h.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      actorUserId: 'owner', action: 'OFFER_LAUNCH_TERMS_ACCEPTED',
      metadata: expect.objectContaining({
        document: review.document, commercialTermsVersionId: 'terms-1', publishedOfferVersionId: 'published',
      }),
    }),
  }));
});

it.each(['card', 'document', 'content'])('rejects confirmation after the %s changes', async change => {
  const h = setup();
  const review = await h.review();
  if (!review.required) throw new Error('Expected review');
  if (change === 'card') h.offer.currentCommercialTerms.contractFingerprint = 'new';
  if (change === 'document') h.settings.LEGAL_BRAND_OFFER_REVISION = 'v2';
  if (change === 'content') h.offer.currentOfferVersionId = 'new';
  await expect(h.publish({ accepted: true, reviewHash: review.reviewHash })).rejects.toMatchObject({ status: 409 });
  expect(h.db.$transaction).not.toHaveBeenCalled();
});

it('rejects a competing edit between validation and publication without logging acceptance', async () => {
  const h = setup();
  const review = await h.review();
  if (!review.required) throw new Error('Expected review');
  h.tx.offer.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Not found', { code: 'P2025', clientVersion: 'test' }));
  await expect(h.publish({ accepted: true, reviewHash: review.reviewHash })).rejects.toMatchObject({ status: 409 });
  expect(h.tx.auditLog.create).not.toHaveBeenCalled();
});
