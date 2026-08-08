import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const expectedRates = (process.env.EXPECTED_PENDING_LEGACY_RATES ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number)
      .sort((left, right) => left - right);
    const applications = await prisma.offerApplication.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        termsStatus: true,
        requiredCreatorAction: true,
        applicableCommercialTerms: {
          select: {
            calculationPolicy: true,
            creatorEffectiveGmvBps: true,
            platformEffectiveGmvBps: true,
          },
        },
        termsObservation: {
          select: { displayedCreatorEffectiveBps: true },
        },
      },
      orderBy: { id: 'asc' },
    });
    const observedRates = applications
      .map(
        (application) =>
          application.termsObservation?.displayedCreatorEffectiveBps,
      )
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right);
    const versionedOffers = await prisma.offer.count({
      where: {
        currentOfferVersionId: { not: null },
        currentCommercialTermsId: { not: null },
      },
    });
    const offers = await prisma.offer.count();
    const actionRequiredNotifications = await prisma.userNotification.count({
      where: { actionRequired: true, resolvedAt: null },
    });
    const relationships = await prisma.affiliateRelationship.count();

    const errors: string[] = [];
    for (const application of applications) {
      if (application.termsStatus !== 'REACCEPTANCE_REQUIRED') {
        errors.push(`application ${application.id} does not require reacceptance`);
      }
      if (
        application.requiredCreatorAction !== 'ACCEPT_COMMERCIAL_TERMS'
      ) {
        errors.push(`application ${application.id} has no required creator action`);
      }
      if (
        application.applicableCommercialTerms?.calculationPolicy !==
        'LEGACY_DIRECT_RATES_V1'
      ) {
        errors.push(`application ${application.id} was reinterpreted as pool`);
      }
      if (
        application.termsObservation?.displayedCreatorEffectiveBps !==
        application.applicableCommercialTerms?.creatorEffectiveGmvBps
      ) {
        errors.push(`application ${application.id} observation rate changed`);
      }
    }
    if (
      expectedRates.length > 0 &&
      JSON.stringify(observedRates) !== JSON.stringify(expectedRates)
    ) {
      errors.push(
        `legacy rates mismatch: expected ${expectedRates.join(',')}, got ${observedRates.join(',')}`,
      );
    }
    if (offers !== versionedOffers) {
      errors.push(`only ${versionedOffers}/${offers} offers have both versions`);
    }
    if (actionRequiredNotifications !== applications.length) {
      errors.push(
        `expected ${applications.length} action-required notifications, got ${actionRequiredNotifications}`,
      );
    }
    if (relationships !== 0) {
      errors.push(`pending backfill created ${relationships} relationships`);
    }
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    console.log(
      JSON.stringify({
        status: 'PASSED',
        pendingApplications: applications.length,
        preservedLegacyRatesBps: observedRates,
        versionedOffers,
        actionRequiredNotifications,
        relationships,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration validation failed');
  process.exitCode = 1;
});
