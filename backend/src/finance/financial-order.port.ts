import { ConflictException, Injectable } from '@nestjs/common';
import {
  CommissionStatus,
  OrderStatus,
  Prisma,
  Stage8OrderEventType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { calculateFinancialAmounts } from './finance-calculation';
import { FinanceService } from './finance.service';

@Injectable()
export class FinancialOrderPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
  ) {}

  async process(input: {
    orderId: string;
    orderEventId: string;
    attributionResultId: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const event = await tx.stage8OrderEvent.findUnique({
          where: { id: input.orderEventId },
        });
        const result = await tx.attributionResult.findUnique({
          where: { id: input.attributionResultId },
        });
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
        });
        if (!event || !result || !order) {
          throw new ConflictException(
            'Stage 8 financial handoff is incomplete',
          );
        }
        if (
          result.orderId !== order.id ||
          !result.affiliateCommercialAgreementId ||
          !result.affiliateRelationshipId ||
          !result.offerId
        ) {
          throw new ConflictException(
            'Financial handoff requires one immutable commercial agreement',
          );
        }
        const agreement = await tx.affiliateCommercialAgreement.findUnique({
          where: { id: result.affiliateCommercialAgreementId },
          include: { affiliateRelationship: true },
        });
        if (
          !agreement ||
          agreement.affiliateRelationshipId !==
            result.affiliateRelationshipId ||
          agreement.offerId !== result.offerId ||
          agreement.currency !== order.currency
        ) {
          throw new ConflictException(
            'Affiliate commercial agreement does not match the attributed order',
          );
        }

        if (event.eventType === Stage8OrderEventType.CHARGEBACK_OPENED) {
          return this.openChargeback(tx, order.id, event.id);
        }
        if (event.eventType === Stage8OrderEventType.CHARGEBACK_REVERSED) {
          return this.reverseChargeback(tx, order.id, event.id);
        }

        const amountMinor = order.amountMinor ?? BigInt(order.amountKopecks);
        const returnedAmountMinor =
          order.returnedAmountMinor ?? BigInt(order.returnedAmountKopecks);
        const commissionableAmountMinor =
          order.commissionableAmountMinor ?? amountMinor;
        const returnedCommissionableAmountMinor =
          order.commissionableAmountMinor === null
            ? returnedAmountMinor
            : order.returnedCommissionableAmountMinor;
        const eligibleAmount =
          order.status === OrderStatus.CANCELLED ||
          order.status === OrderStatus.RETURNED
            ? 0n
            : commissionableAmountMinor - returnedCommissionableAmountMinor;
        if (eligibleAmount < 0n) {
          throw new ConflictException('Returned amount exceeds order amount');
        }
        const amounts = calculateFinancialAmounts(eligibleAmount, agreement);
        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            offerId: result.offerId,
            affiliateRelationshipId: result.affiliateRelationshipId,
            affiliateCommercialAgreementId: agreement.id,
            creatorCommissionBps: agreement.creatorEffectiveGmvBps,
            platformCommissionBps: agreement.platformEffectiveGmvBps,
            totalCommissionPoolBps: agreement.totalCommissionPoolBps,
            creatorPoolShareBps: agreement.creatorPoolShareBps,
            platformPoolShareBps: agreement.platformPoolShareBps,
            totalCommissionAmountMinor: amounts.total,
            creatorCommissionAmountMinor: amounts.creator,
            platformCommissionAmountMinor: amounts.platform,
            commercialTermsVersionNumber:
              agreement.commercialTermsVersionNumber,
            calculationPolicy: agreement.calculationPolicy,
            attributedAt: result.attributedAt ?? result.createdAt,
            confirmedAt:
              order.status === OrderStatus.PAID ||
              order.status === OrderStatus.PARTIALLY_RETURNED
                ? (order.confirmedAt ?? event.occurredAt)
                : order.confirmedAt,
          },
        });
        await this.finance.syncStage8Commission(
          tx,
          updated,
          event.id,
          eligibleAmount,
        );
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            actorType: 'SYSTEM',
            action: 'STAGE8_FINANCIAL_ORDER_APPLIED',
            entityType: 'Order',
            entityId: order.id,
            requestId: event.requestId,
            metadata: {
              orderEventId: event.id,
              eventType: event.eventType,
              attributionResultId: result.id,
              affiliateCommercialAgreementId: agreement.id,
              orderAmountMinor: amountMinor.toString(),
              commissionableAmountMinor: commissionableAmountMinor.toString(),
              returnedCommissionableAmountMinor:
                returnedCommissionableAmountMinor.toString(),
            },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async openChargeback(
    tx: Prisma.TransactionClient,
    orderId: string,
    orderEventId: string,
  ) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { commission: true },
    });
    const existing = await tx.financialDispute.findFirst({
      where: {
        orderId,
        status: 'OPEN',
        reason: { startsWith: 'Stage 8 chargeback:' },
      },
    });
    if (!existing) {
      await tx.financialDispute.create({
        data: {
          brandId: order.brandId,
          orderId,
          commissionId: order.commission?.id ?? null,
          reason: `Stage 8 chargeback: ${orderEventId}`,
          openedByUserId: null,
          openedByType: 'SYSTEM',
        },
      });
    }
    if (order.commission && order.commission.status !== CommissionStatus.PAID) {
      await tx.commission.update({
        where: { id: order.commission.id },
        data: {
          status: CommissionStatus.DISPUTED,
          disputedAt: new Date(),
        },
      });
    }
    return order;
  }

  private async reverseChargeback(
    tx: Prisma.TransactionClient,
    orderId: string,
    orderEventId: string,
  ) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { commission: true },
    });
    await tx.financialDispute.updateMany({
      where: {
        orderId,
        status: 'OPEN',
        reason: { startsWith: 'Stage 8 chargeback:' },
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolution: `Chargeback reversed by authoritative event ${orderEventId}`,
      },
    });
    if (
      order.commission &&
      order.commission.status === CommissionStatus.DISPUTED
    ) {
      await tx.commission.update({
        where: { id: order.commission.id },
        data: {
          status: order.commission.payableAt
            ? CommissionStatus.PAYABLE
            : order.commission.holdUntil
              ? CommissionStatus.HOLD
              : CommissionStatus.CONFIRMED,
          disputedAt: null,
        },
      });
    }
    return order;
  }
}
