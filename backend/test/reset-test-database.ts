import { PrismaService } from '../src/prisma/prisma.service';

export async function resetStage8TrackerData(prisma: PrismaService) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'UPDATE "Order" SET "currentAttributionResultId" = NULL',
    );
    await tx.orderTimelineEvent.deleteMany();
    await tx.attributionEvidence.deleteMany();
    await tx.attributionException.deleteMany();
    await tx.tildaPaymentProbe.deleteMany();
    await tx.attributionResult.deleteMany();
    await tx.trackingEvent.deleteMany();
    await tx.clickSession.deleteMany();
    await tx.stage8OrderEvent.deleteMany();
    await tx.tildaIntegration.deleteMany();
    await tx.attributionRuleSet.deleteMany();
    await tx.integrationCredentialVersion.deleteMany();
    await tx.trackerInstallation.deleteMany();
  });
}

export async function resetTestDatabase(prisma: PrismaService) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.allow_financial_cleanup', 'on', true)`,
    );
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.allow_creator_promo_code_cleanup', 'on', true)`,
    );

    await tx.authSession.deleteMany();
    await tx.passwordResetToken.deleteMany();
    await tx.adminRecoveryCode.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.managerInvitation.deleteMany();
    await tx.userNotification.deleteMany();
    await tx.notificationEvent.deleteMany();
    await tx.ledgerEntry.deleteMany();
    await tx.ledgerPosting.deleteMany();
    await tx.ledgerTransaction.deleteMany();
    await tx.ledgerAccount.deleteMany();
    await tx.reconciliationRun.deleteMany();
    await tx.payoutItem.deleteMany();
    await tx.financialDispute.deleteMany();
    await tx.brandStatementLine.deleteMany();
    await tx.brandPaymentAllocation.deleteMany();
    await tx.brandPayment.deleteMany();
    await tx.brandStatement.deleteMany();
    await tx.commission.deleteMany();
    await tx.payout.deleteMany();
    await tx.$executeRawUnsafe(
      'UPDATE "Order" SET "currentAttributionResultId" = NULL',
    );
    await tx.orderTimelineEvent.deleteMany();
    await tx.attributionEvidence.deleteMany();
    await tx.attributionException.deleteMany();
    await tx.attributionResult.deleteMany();
    await tx.tildaPaymentProbe.deleteMany();
    await tx.stage8OrderEvent.deleteMany();
    await tx.stage8OutboxEvent.deleteMany();
    await tx.trackingEvent.deleteMany();
    await tx.clickSession.deleteMany();
    await tx.orderImportRow.deleteMany();
    await tx.order.deleteMany();
    await tx.click.deleteMany();
    await tx.orderImport.deleteMany();
    await tx.creatorPromoCode.deleteMany();
    await tx.creatorLink.deleteMany();
    await tx.creatorProductAccessGrant.deleteMany();
    await tx.affiliateCommercialAgreement.deleteMany();
    await tx.affiliateRelationship.deleteMany();
    await tx.offerApplicationTermsAcceptance.deleteMany();
    await tx.offerApplicationTermsObservation.deleteMany();
    await tx.offerApplication.deleteMany();
    await tx.publicationRequirements.deleteMany();
    await tx.creatorKitRevisionAsset.deleteMany();
    await tx.creatorKitAsset.deleteMany();
    await tx.creatorKitScenario.deleteMany();
    await tx.creatorKitFact.deleteMany();
    await tx.creatorKitClaim.deleteMany();
    await tx.creatorKitRule.deleteMany();
    await tx.creatorKitBrandContent.deleteMany();
    await tx.creatorKitProductContent.deleteMany();
    await tx.$executeRawUnsafe(
      'UPDATE "CreatorKit" SET "activeRevisionId" = NULL, "draftRevisionId" = NULL',
    );
    await tx.creatorKitRevision.deleteMany();
    await tx.creatorKit.deleteMany();
    await tx.offer.updateMany({
      data: { imageId: null },
    });
    await tx.offerImage.deleteMany();
    await tx.$executeRawUnsafe(
      'UPDATE "Offer" SET "currentOfferVersionId" = NULL, "currentCommercialTermsId" = NULL',
    );
    await tx.offerVersion.deleteMany();
    await tx.commercialTermsVersion.deleteMany();
    await tx.offer.deleteMany();
    await tx.tildaIntegration.deleteMany();
    await tx.attributionRuleSet.deleteMany();
    await tx.integrationCredentialVersion.deleteMany();
    await tx.trackerInstallation.deleteMany();
    await tx.brandManagerAssignment.deleteMany();
    await tx.managerProfile.deleteMany();
    await tx.creatorProfile.deleteMany();
    await tx.brandProfile.deleteMany();
    await tx.user.deleteMany();
  });
}
