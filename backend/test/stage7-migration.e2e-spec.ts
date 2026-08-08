import { PrismaClient } from '@prisma/client';

const describeMigration =
  process.env.STAGE7_MIGRATION_REHEARSAL === 'true'
    ? describe
    : describe.skip;

describeMigration('Stage 7 production-shaped migration backfill', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('preserves legacy pending rates and requires explicit economic review', async () => {
    const applications = await prisma.offerApplication.findMany({
      where: { status: 'PENDING' },
      include: {
        applicableCommercialTerms: true,
        termsObservation: true,
      },
      orderBy: { id: 'asc' },
    });
    expect(applications).toHaveLength(2);
    expect(
      applications
        .map(
          (application) =>
            application.termsObservation!.displayedCreatorEffectiveBps,
        )
        .sort((left, right) => left - right),
    ).toEqual([1200, 1500]);
    for (const application of applications) {
      expect(application.termsStatus).toBe('REACCEPTANCE_REQUIRED');
      expect(application.requiredCreatorAction).toBe(
        'ACCEPT_COMMERCIAL_TERMS',
      );
      expect(
        application.applicableCommercialTerms!.calculationPolicy,
      ).toBe('LEGACY_DIRECT_RATES_V1');
      expect(
        application.termsObservation!.displayedCreatorEffectiveBps,
      ).toBe(
        application.applicableCommercialTerms!.creatorEffectiveGmvBps,
      );
    }
    expect(await prisma.affiliateRelationship.count()).toBe(0);
    expect(
      await prisma.userNotification.count({
        where: { actionRequired: true, resolvedAt: null },
      }),
    ).toBe(2);
    expect(
      await prisma.offer.count({
        where: {
          currentOfferVersionId: { not: null },
          currentCommercialTermsId: { not: null },
        },
      }),
    ).toBe(await prisma.offer.count());
  });
});
