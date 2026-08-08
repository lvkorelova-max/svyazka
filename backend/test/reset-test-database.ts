import { PrismaService } from '../src/prisma/prisma.service';

export async function resetTestDatabase(prisma: PrismaService) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_financial_cleanup = 'on'`);
    await tx.userNotification.deleteMany();
    await tx.notificationEvent.deleteMany();
    await tx.brandPaymentAllocation.deleteMany();
    await tx.brandPayment.deleteMany();
    await tx.financialDispute.deleteMany();
    await tx.ledgerPosting.deleteMany();
    await tx.ledgerTransaction.deleteMany();
    await tx.ledgerAccount.deleteMany();
    await tx.brandStatementLine.deleteMany();
    await tx.brandStatement.deleteMany();
    await tx.payoutItem.deleteMany();
    await tx.reconciliationRun.deleteMany();
    await tx.ledgerEntry.deleteMany();
    await tx.commission.deleteMany();
    await tx.payout.deleteMany();
    await tx.orderImportRow.deleteMany();
    await tx.order.deleteMany();
    await tx.orderImport.deleteMany();
    await tx.click.deleteMany();
    await tx.creatorProductAccessGrant.deleteMany();
    await tx.affiliateCommercialAgreement.deleteMany();
    await tx.affiliateRelationship.deleteMany();
    await tx.offerApplicationTermsAcceptance.deleteMany();
    await tx.offerApplicationTermsObservation.deleteMany();
    await tx.offerApplication.deleteMany();
    await tx.publicationRequirements.deleteMany();
    await tx.creatorKitRevisionAsset.deleteMany();
    await tx.creatorKitScenario.deleteMany();
    await tx.creatorKitFact.deleteMany();
    await tx.creatorKitClaim.deleteMany();
    await tx.creatorKitRule.deleteMany();
    await tx.creatorKitBrandContent.deleteMany();
    await tx.creatorKitProductContent.deleteMany();
    await tx.creatorKit.updateMany({
      data: { activeRevisionId: null, draftRevisionId: null },
    });
    await tx.offer.updateMany({
      data: {
        imageId: null,
        currentOfferVersionId: null,
        currentCommercialTermsId: null,
      },
    });
    await tx.offerVersion.deleteMany();
    await tx.commercialTermsVersion.deleteMany();
    await tx.creatorKitRevision.deleteMany();
    await tx.creatorKitAsset.deleteMany();
    await tx.creatorKit.deleteMany();
    await tx.offerImage.deleteMany();
    await tx.offer.deleteMany();
    await tx.authSession.deleteMany();
    await tx.passwordResetToken.deleteMany();
    await tx.adminRecoveryCode.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.creatorProfile.deleteMany();
    await tx.brandProfile.deleteMany();
    await tx.user.deleteMany();
  });
}
