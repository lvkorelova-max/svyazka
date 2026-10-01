import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AffiliateRelationship,
  AffiliateRelationshipStatus,
  AttributionSource,
  BrandPaymentStatus,
  BrandStatementStatus,
  CommercialCalculationPolicy,
  CommissionStatus,
  FinancialDisputeStatus,
  LedgerAccountType,
  LedgerPostingDirection,
  LedgerEntryType,
  LedgerTransactionType,
  Order,
  OrderImportAction,
  OrderImportRowStatus,
  OrderImportStatus,
  OrderStatus,
  PayoutStatus,
  Prisma,
  ReconciliationStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { CreatePayoutDto } from './dto/create-payout.dto';
import {
  CreatorAnalyticsQueryDto,
  ListFinanceQueryDto,
} from './dto/list-finance-query.dto';
import { CsvRecord, parseCsv } from './csv';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BrandAccessService } from '../brand-access/brand-access.service';
import {
  IssueBrandStatementDto,
  OpenFinancialDisputeDto,
  RecordBrandPaymentDto,
  ResolveFinancialDisputeDto,
} from './dto/settlement.dto';
import {
  calculateBpsHalfUp,
  calculateFinancialAmounts,
  commissionBaseForSync,
} from './finance-calculation';

type CsvUpload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type RelationshipWithOffer = AffiliateRelationship & {
  offer: {
    id: string;
    brandId: string;
    creatorCommissionBps: number;
    platformCommissionBps: number;
  };
  commercialAgreement: {
    id: string;
    commercialTermsVersionNumber: number;
    calculationPolicy: CommercialCalculationPolicy;
    totalCommissionPoolBps: number;
    creatorPoolShareBps: number;
    platformPoolShareBps: number;
    creatorEffectiveGmvBps: number;
    platformEffectiveGmvBps: number;
    currency: string;
  } | null;
};

const CSV_STATUS: Record<string, OrderStatus> = {
  pending: OrderStatus.PENDING,
  paid: OrderStatus.PAID,
  cancelled: OrderStatus.CANCELLED,
  returned: OrderStatus.RETURNED,
  partially_returned: OrderStatus.PARTIALLY_RETURNED,
};

const PAID_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PARTIALLY_RETURNED,
  OrderStatus.RETURNED,
];

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly brands: BrandAccessService,
  ) {}

  async createOrderImport(userId: string, file: CsvUpload | undefined, maxBytes: number, activeBrandId?: string) {
    if (!file) throw new BadRequestException('Выберите CSV-файл');
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Поддерживаются только CSV-файлы');
    }
    if (
      !['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv'].includes(
        file.mimetype,
      )
    ) {
      throw new BadRequestException('Недопустимый MIME-тип CSV-файла');
    }
    if (file.size < 1 || file.size > maxBytes) {
      throw new BadRequestException(`Размер CSV должен быть от 1 до ${maxBytes} байт`);
    }

    const brand = await this.getBrand(userId, activeBrandId);
    const orderImport = await this.prisma.orderImport.create({
      data: {
        brandId: brand.id,
        originalFileName: file.originalname.slice(0, 255),
        fileChecksum: createHash('sha256').update(file.buffer).digest('hex'),
        status: OrderImportStatus.UPLOADED,
      },
    });

    try {
      await this.prisma.orderImport.update({
        where: { id: orderImport.id },
        data: { status: OrderImportStatus.VALIDATING },
      });
      const records = parseCsv(file.buffer);
      const maxRows = this.getPositiveInteger('ORDER_IMPORT_MAX_ROWS', 10_000);
      if (records.length > maxRows) {
        throw new BadRequestException(`CSV содержит более ${maxRows} строк`);
      }
      const previewRows = await this.buildPreviewRows(brand.id, orderImport.id, records);
      const validRows = previewRows.filter(
        (row) => row.status === OrderImportRowStatus.VALID,
      ).length;
      const duplicateRows = previewRows.filter(
        (row) => row.status === OrderImportRowStatus.DUPLICATE,
      ).length;
      const invalidRows = previewRows.length - validRows - duplicateRows;

      await this.prisma.$transaction([
        this.prisma.orderImportRow.createMany({ data: previewRows }),
        this.prisma.orderImport.update({
          where: { id: orderImport.id },
          data: {
            status: OrderImportStatus.READY,
            totalRows: previewRows.length,
            validRows,
            invalidRows,
            duplicateRows,
            errorSummary: {
              invalidRows,
              conflictRows: previewRows.filter(
                (row) => row.status === OrderImportRowStatus.CONFLICT,
              ).length,
            },
          },
        }),
      ]);
      const preview = await this.getOrderImportPreview(userId, orderImport.id, activeBrandId);
      await this.audit.record({
        actorUserId: userId,
        action: 'ORDER_IMPORT_PREVIEW_CREATED',
        entityType: 'OrderImport',
        entityId: orderImport.id,
        metadata: {
          totalRows: preview.totalRows,
          validRows: preview.validRows,
          invalidRows: preview.invalidRows,
          duplicateRows: preview.duplicateRows,
        },
      });
      return preview;
    } catch (error) {
      await this.prisma.orderImport.update({
        where: { id: orderImport.id },
        data: {
          status: OrderImportStatus.FAILED,
          errorSummary: {
            message: error instanceof Error ? error.message : 'Ошибка обработки CSV',
          },
        },
      });
      throw error;
    }
  }

  async getOrderImportPreview(userId: string, importId: string, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    const orderImport = await this.prisma.orderImport.findFirst({
      where: { id: importId, brandId: brand.id },
      include: {
        rows: {
          orderBy: { rowNumber: 'asc' },
          include: {
            attributedRelationship: {
              include: { creator: { select: { id: true, displayName: true } } },
            },
          },
        },
      },
    });
    if (!orderImport) throw new NotFoundException('Импорт заказов не найден');
    return orderImport;
  }

  async confirmOrderImport(userId: string, importId: string, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    const orderImport = await this.prisma.orderImport.findFirst({
      where: { id: importId, brandId: brand.id },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!orderImport) throw new NotFoundException('Импорт заказов не найден');
    if (orderImport.status === OrderImportStatus.IMPORTED) {
      return { id: orderImport.id, status: orderImport.status, idempotent: true };
    }
    if (orderImport.status !== OrderImportStatus.READY) {
      throw new ConflictException('Импорт ещё не готов к подтверждению');
    }

    const applied = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.orderImport.updateMany({
          where: { id: orderImport.id, status: OrderImportStatus.READY },
          data: { status: OrderImportStatus.VALIDATING },
        });
        if (claimed.count !== 1) throw new ConflictException('Импорт уже подтверждается');
        let created = 0;
        let updated = 0;

        for (const row of orderImport.rows) {
          if (row.status !== OrderImportRowStatus.VALID) continue;
          const offer = await tx.offer.findFirst({
            where: { id: row.offerId ?? undefined, brandId: brand.id },
          });
          if (!offer) throw new ForbiddenException(`Строка ${row.rowNumber}: оффер недоступен`);

          let order: Order;
          if (row.action === OrderImportAction.CREATE) {
            const attributedRelationship = row.attributedRelationshipId
              ? await tx.affiliateRelationship.findUnique({
                  where: { id: row.attributedRelationshipId },
                  select: { currentManagerId: true },
                })
              : null;
            order = await tx.order.create({
              data: {
                brandId: brand.id,
                offerId: offer.id,
                orderImportId: orderImport.id,
                affiliateRelationshipId: row.attributedRelationshipId,
                affiliateCommercialAgreementId:
                  row.affiliateCommercialAgreementId,
                externalOrderId: row.externalOrderId!,
                orderDate: row.orderDate!,
                amountKopecks: row.amountKopecks!,
                returnedAmountKopecks: row.returnedAmountKopecks ?? 0,
                amountMinor: BigInt(row.amountKopecks!),
                returnedAmountMinor: BigInt(row.returnedAmountKopecks ?? 0),
                currency: row.currency!,
                status: row.orderStatus!,
                attributionSource: row.attributionSource!,
                attributionIdentifier:
                  row.clickId?.toString() ??
                  row.affiliateCode ??
                  row.promoCode ??
                  null,
                attributedAt: row.attributedRelationshipId ? new Date() : null,
                affiliateCode: row.affiliateCode,
                promoCode: row.promoCode,
                clickId: row.clickId,
                creatorCommissionBps: row.creatorCommissionBpsSnapshot!,
                platformCommissionBps: row.platformCommissionBpsSnapshot!,
                totalCommissionPoolBps: row.totalCommissionPoolBpsSnapshot,
                creatorPoolShareBps: row.creatorPoolShareBpsSnapshot,
                platformPoolShareBps: row.platformPoolShareBpsSnapshot,
                commercialTermsVersionNumber:
                  row.commercialTermsVersionSnapshot,
                calculationPolicy: row.calculationPolicySnapshot,
                totalCommissionAmountMinor:
                  BigInt(row.previewCreatorAmountKopecks ?? 0) +
                  BigInt(row.previewPlatformAmountKopecks ?? 0),
                creatorCommissionAmountMinor: BigInt(
                  row.previewCreatorAmountKopecks ?? 0,
                ),
                platformCommissionAmountMinor: BigInt(
                  row.previewPlatformAmountKopecks ?? 0,
                ),
                confirmedAt:
                  row.orderStatus === OrderStatus.PAID ||
                  row.orderStatus === OrderStatus.PARTIALLY_RETURNED
                    ? new Date()
                    : null,
                managerIdAtAttribution: attributedRelationship?.currentManagerId ?? null,
              },
            });
            created += 1;
          } else if (row.action === OrderImportAction.UPDATE && row.existingOrderId) {
            const existing = await tx.order.findFirst({
              where: { id: row.existingOrderId, brandId: brand.id },
            });
            if (!existing) {
              throw new ConflictException(`Строка ${row.rowNumber}: заказ был изменён`);
            }
            order = await tx.order.update({
              where: { id: existing.id },
              data: {
                status: row.orderStatus!,
                returnedAmountKopecks: row.returnedAmountKopecks ?? 0,
                returnedAmountMinor: BigInt(
                  row.returnedAmountKopecks ?? 0,
                ),
                orderImportId: orderImport.id,
                importedAt: new Date(),
              },
            });
            if (
              existing.status !== row.orderStatus ||
              existing.returnedAmountKopecks !== (row.returnedAmountKopecks ?? 0)
            ) {
              await tx.auditLog.create({
                data: {
                  actorUserId: userId,
                  action: 'ORDER_STATUS_CHANGED',
                  entityType: 'Order',
                  entityId: existing.id,
                  requestId: this.audit.requestId(),
                  metadata: {
                    previousStatus: existing.status,
                    nextStatus: row.orderStatus,
                    previousReturnedAmountKopecks: existing.returnedAmountKopecks,
                    nextReturnedAmountKopecks: row.returnedAmountKopecks ?? 0,
                    orderImportId: orderImport.id,
                  },
                },
              });
            }
            updated += 1;
          } else {
            continue;
          }
          await this.syncCommission(tx, order, row.id);
        }

        await tx.orderImport.update({
          where: { id: orderImport.id },
          data: { status: OrderImportStatus.IMPORTED, completedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'ORDER_IMPORT_CONFIRMED',
            entityType: 'OrderImport',
            entityId: orderImport.id,
            requestId: this.audit.requestId(),
            metadata: { created, updated },
          },
        });
        return { created, updated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { id: orderImport.id, status: OrderImportStatus.IMPORTED, ...applied };
  }

  async listBrandOrders(userId: string, query: ListFinanceQueryDto, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    return this.paginateOrders({ brandId: brand.id }, query);
  }

  async getBrandOrder(userId: string, orderId: string, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, brandId: brand.id },
      include: {
        offer: true,
        commission: { include: { creator: true, ledgerEntries: true } },
        affiliateRelationship: { include: { creator: true } },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  async listBrandCommissions(userId: string, query: ListFinanceQueryDto, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    return this.paginateCommissions({ order: { brandId: brand.id } }, query);
  }

  async getBrandAnalytics(userId: string, query: ListFinanceQueryDto, activeBrandId?: string) {
    const report = await this.getCreatorAnalytics(userId, {
      ...query,
      sortBy: 'netSalesKopecks',
    } as CreatorAnalyticsQueryDto, activeBrandId);
    return report.total;
  }

  async getBrandFinanceOverview(
    userId: string,
    query: ListFinanceQueryDto,
  ) {
    const brand = await this.getBrand(userId);
    const orderWhere: Prisma.OrderWhereInput = {
      brandId: brand.id,
      orderDate: this.orderDateRange(query),
      ...(query.offerId ? { offerId: query.offerId } : {}),
    };
    const [orders, commissions, statements] = await Promise.all([
      this.prisma.order.findMany({ where: orderWhere }),
      this.prisma.commission.findMany({ where: { order: orderWhere } }),
      this.prisma.brandStatement.findMany({
        where: {
          brandId: brand.id,
          ...(query.dateFrom || query.dateTo
            ? { periodStart: this.orderDateRange(query) }
            : {}),
        },
      }),
    ]);
    const attributedGmv = orders
      .filter((order) => order.affiliateRelationshipId)
      .reduce((sum, order) => sum + BigInt(order.amountKopecks), 0n);
    const pendingGmv = orders
      .filter((order) => order.status === OrderStatus.PENDING)
      .reduce((sum, order) => sum + BigInt(order.amountKopecks), 0n);
    const confirmedGmv = orders
      .filter((order) => PAID_ORDER_STATUSES.includes(order.status))
      .reduce(
        (sum, order) =>
          sum +
          BigInt(
            order.status === OrderStatus.RETURNED
              ? 0
              : order.amountKopecks - order.returnedAmountKopecks,
          ),
        0n,
      );
    const creatorAccrued = commissions.reduce(
      (sum, commission) =>
        sum +
        (commission.creatorAmountMinor ??
          BigInt(commission.creatorAmountKopecks)),
      0n,
    );
    const platformAccrued = commissions.reduce(
      (sum, commission) =>
        sum +
        (commission.platformAmountMinor ??
          BigInt(commission.platformAmountKopecks)),
      0n,
    );
    const totalDue = statements.reduce(
      (sum, statement) => sum + statement.totalDueMinor,
      0n,
    );
    const paid = statements.reduce(
      (sum, statement) => sum + statement.paidMinor,
      0n,
    );
    const now = new Date();
    return {
      currency: this.singleCurrency(orders.map((order) => order.currency)),
      attributedGmvMinor: attributedGmv,
      pendingGmvMinor: pendingGmv,
      confirmedGmvMinor: confirmedGmv,
      creatorCommissionsAccruedMinor: creatorAccrued,
      platformFeesAccruedMinor: platformAccrued,
      totalPayableMinor: totalDue,
      paidMinor: paid,
      unpaidMinor: totalDue - paid,
      overdueMinor: statements
        .filter(
          (statement) =>
            statement.dueAt &&
            statement.dueAt < now &&
            statement.status !== BrandStatementStatus.PAID,
        )
        .reduce(
          (sum, statement) =>
            sum + (statement.totalDueMinor - statement.paidMinor),
          0n,
        ),
      returnsMinor: orders.reduce(
        (sum, order) => sum + BigInt(order.returnedAmountKopecks),
        0n,
      ),
      recoverableMinor: commissions.reduce(
        (sum, commission) => sum + commission.recoverableAmountMinor,
        0n,
      ),
    };
  }

  async getCreatorAnalytics(userId: string, query: CreatorAnalyticsQueryDto, activeBrandId?: string) {
    const brand = await this.getBrand(userId, activeBrandId);
    if (query.offerId) await this.assertOwnedOffer(brand.id, query.offerId);
    const range = this.orderDateRange(query);
    const orderWhere: Prisma.OrderWhereInput = {
      brandId: brand.id,
      orderDate: range,
      ...(query.offerId ? { offerId: query.offerId } : {}),
      ...(query.creatorId
        ? { affiliateRelationship: { creatorId: query.creatorId } }
        : {}),
      ...(query.orderStatus ? { status: query.orderStatus } : {}),
      ...(query.attributionSource
        ? { attributionSource: query.attributionSource }
        : {}),
      affiliateRelationshipId: { not: null },
    };
    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      include: {
        affiliateRelationship: { include: { creator: true } },
        commission: true,
      },
    });
    const clickWhere: Prisma.ClickWhereInput = {
      offer: { brandId: brand.id },
      clickedAt: range,
      ...(query.offerId ? { offerId: query.offerId } : {}),
      ...(query.creatorId ? { creatorId: query.creatorId } : {}),
    };
    const clicks = await this.prisma.click.findMany({
      where: clickWhere,
      include: { creator: { select: { displayName: true } } },
    });

    const rows = new Map<string, ReturnType<typeof this.emptyCreatorAnalytics>>();
    for (const click of clicks) {
      const row =
        rows.get(click.creatorId) ??
        this.emptyCreatorAnalytics(click.creatorId, click.creator.displayName);
      row.clicksCount += 1;
      rows.set(click.creatorId, row);
    }
    for (const order of orders) {
      const creator = order.affiliateRelationship!.creator;
      const row =
        rows.get(creator.id) ?? this.emptyCreatorAnalytics(creator.id, creator.displayName);
      row.creatorName = creator.displayName;
      row.ordersCount += 1;
      const amount = BigInt(order.amountKopecks);
      if (PAID_ORDER_STATUSES.includes(order.status)) {
        row.paidOrdersCount += 1;
        row.grossSalesKopecks += amount;
      }
      if (order.status === OrderStatus.CANCELLED) {
        row.cancelledAmountKopecks += amount;
      }
      if (order.status === OrderStatus.RETURNED) {
        row.returnedAmountKopecks += amount;
      } else if (order.status === OrderStatus.PARTIALLY_RETURNED) {
        row.returnedAmountKopecks += BigInt(order.returnedAmountKopecks);
      }
      if (order.status === OrderStatus.PAID) {
        row.netSalesKopecks += amount;
        row.netOrdersCount += 1;
      } else if (order.status === OrderStatus.PARTIALLY_RETURNED) {
        row.netSalesKopecks += amount - BigInt(order.returnedAmountKopecks);
        row.netOrdersCount += 1;
      }
      if (order.commission) {
        row.creatorCommissionKopecks += BigInt(
          order.commission.creatorAmountKopecks - order.commission.debtAmountKopecks,
        );
        row.platformCommissionKopecks += BigInt(order.commission.platformAmountKopecks);
      }
      rows.set(creator.id, row);
    }

    const finalized = [...rows.values()].map((row) => this.finalizeCreatorAnalytics(row));
    const total = this.finalizeCreatorAnalytics(
      finalized.reduce(
        (sum, row) => ({
          creatorId: 'total',
          creatorName: 'Итого',
          clicksCount: sum.clicksCount + row.clicksCount,
          ordersCount: sum.ordersCount + row.ordersCount,
          paidOrdersCount: sum.paidOrdersCount + row.paidOrdersCount,
          grossSalesKopecks: sum.grossSalesKopecks + row.grossSalesKopecks,
          cancelledAmountKopecks:
            sum.cancelledAmountKopecks + row.cancelledAmountKopecks,
          returnedAmountKopecks: sum.returnedAmountKopecks + row.returnedAmountKopecks,
          netSalesKopecks: sum.netSalesKopecks + row.netSalesKopecks,
          creatorCommissionKopecks:
            sum.creatorCommissionKopecks + row.creatorCommissionKopecks,
          platformCommissionKopecks:
            sum.platformCommissionKopecks + row.platformCommissionKopecks,
          netOrdersCount: sum.netOrdersCount + row.netOrdersCount,
        }),
        this.emptyCreatorAnalytics('total', 'Итого'),
      ),
    );
    const sortBy = query.sortBy || 'netSalesKopecks';
    const direction = query.sortDirection === 'asc' ? 1 : -1;
    finalized.sort((left, right) => {
      const a = left[sortBy as keyof typeof left];
      const b = right[sortBy as keyof typeof right];
      if (typeof a === 'bigint' && typeof b === 'bigint') return a === b ? 0 : a > b ? direction : -direction;
      return String(a ?? '').localeCompare(String(b ?? ''), 'ru') * direction;
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    return {
      items: finalized.slice((page - 1) * pageSize, page * pageSize),
      total,
      pagination: { page, pageSize, totalItems: finalized.length },
      period: { dateFrom: query.dateFrom ?? null, dateTo: query.dateTo ?? null },
    };
  }

  async listCreatorClicks(userId: string, query: ListFinanceQueryDto) {
    const creator = await this.getCreator(userId);
    const where: Prisma.ClickWhereInput = {
      creatorId: creator.id,
      clickedAt: this.orderDateRange(query),
      ...(query.offerId ? { offerId: query.offerId } : {}),
    };
    return this.paginate('click', where, query, { clickedAt: query.sortDirection ?? 'desc' });
  }

  async listCreatorOrders(userId: string, query: ListFinanceQueryDto) {
    const creator = await this.getCreator(userId);
    const result = await this.paginateOrders(
      { affiliateRelationship: { creatorId: creator.id } },
      query,
    );
    return {
      ...result,
      items: result.items.map((order) => this.presentCreatorOrder(order)),
    };
  }

  async listCreatorCommissions(userId: string, query: ListFinanceQueryDto) {
    const creator = await this.getCreator(userId);
    const result = await this.paginateCommissions(
      { creatorId: creator.id },
      query,
    );
    return {
      ...result,
      items: result.items.map((commission) =>
        this.presentCreatorCommission(commission),
      ),
    };
  }

  async getCreatorEarningsSummary(userId: string) {
    const creator = await this.getCreator(userId);
    const [commissions, ledger, orders, clicksCount] = await Promise.all([
      this.prisma.commission.findMany({ where: { creatorId: creator.id } }),
      this.prisma.ledgerEntry.findMany({ where: { creatorId: creator.id } }),
      this.prisma.order.findMany({
        where: { affiliateRelationship: { creatorId: creator.id } },
      }),
      this.prisma.click.count({ where: { creatorId: creator.id } }),
    ]);
    const sumStatus = (status: CommissionStatus) =>
      commissions
        .filter((commission) => commission.status === status)
        .reduce((sum, commission) => sum + BigInt(commission.creatorAmountKopecks), 0n);
    return {
      clicksCount,
      ordersCount: orders.length,
      grossSalesKopecks: orders
        .filter((order) => PAID_ORDER_STATUSES.includes(order.status))
        .reduce((sum, order) => sum + BigInt(order.amountKopecks), 0n),
      holdKopecks: sumStatus(CommissionStatus.HOLD),
      availableKopecks: sumStatus(CommissionStatus.AVAILABLE),
      paidKopecks: ledger
        .filter((entry) => entry.type === LedgerEntryType.PAYOUT)
        .reduce((sum, entry) => sum + BigInt(-entry.amountKopecks), 0n),
      reversedKopecks: ledger
        .filter((entry) => entry.type === LedgerEntryType.REVERSAL)
        .reduce((sum, entry) => sum + BigInt(-entry.amountKopecks), 0n),
      debtKopecks: commissions.reduce(
        (sum, commission) => sum + BigInt(commission.debtAmountKopecks),
        0n,
      ),
    };
  }

  async listCreatorPayouts(userId: string, query: ListFinanceQueryDto) {
    const creator = await this.getCreator(userId);
    const result = await this.paginate(
      'payout',
      { creatorId: creator.id },
      query,
      { createdAt: query.sortDirection ?? 'desc' },
    );
    return {
      ...result,
      items: result.items.map((payout: any) => ({
        id: payout.id,
        amountMinor: payout.amountKopecks,
        currency: payout.currency,
        status: payout.status,
        reference: payout.reference,
        createdAt: payout.createdAt,
        approvedAt: payout.approvedAt,
        paidAt: payout.paidAt,
        cancelledAt: payout.cancelledAt,
        items: (payout.commissions ?? []).map((commission: any) =>
          this.presentCreatorCommission(commission),
        ),
      })),
    };
  }

  async listBrandStatements(userId: string) {
    const brand = await this.getBrand(userId);
    return this.prisma.brandStatement.findMany({
      where: { brandId: brand.id },
      include: { lines: true, payments: { include: { payment: true } } },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listAdminStatements() {
    return this.prisma.brandStatement.findMany({
      include: {
        brand: { select: { id: true, brandName: true } },
        lines: true,
        payments: { include: { payment: true } },
      },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listAdminDisputes() {
    return this.prisma.financialDispute.findMany({
      include: {
        brand: { select: { id: true, brandName: true } },
        order: true,
        commission: true,
        statement: true,
      },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getAdminFinanceOverview() {
    const [brandCount, creatorCount, orders, commissions, statements, payouts] =
      await Promise.all([
        this.prisma.brandProfile.count(),
        this.prisma.creatorProfile.count(),
        this.prisma.order.findMany(),
        this.prisma.commission.findMany(),
        this.prisma.brandStatement.findMany(),
        this.prisma.payout.findMany(),
      ]);
    return {
      brandCount,
      creatorCount,
      attributedGmvMinor: orders
        .filter((order) => order.affiliateRelationshipId)
        .reduce((sum, order) => sum + BigInt(order.amountKopecks), 0n),
      creatorCommissionsMinor: commissions.reduce(
        (sum, commission) =>
          sum +
          (commission.creatorAmountMinor ??
            BigInt(commission.creatorAmountKopecks)),
        0n,
      ),
      platformRevenueMinor: commissions.reduce(
        (sum, commission) =>
          sum +
          (commission.platformAmountMinor ??
            BigInt(commission.platformAmountKopecks)),
        0n,
      ),
      brandObligationsMinor: statements.reduce(
        (sum, statement) => sum + statement.totalDueMinor,
        0n,
      ),
      unpaidObligationsMinor: statements.reduce(
        (sum, statement) =>
          sum + statement.totalDueMinor - statement.paidMinor,
        0n,
      ),
      paidPayoutsMinor: payouts
        .filter((payout) => payout.status === PayoutStatus.PAID)
        .reduce((sum, payout) => sum + payout.amountKopecks, 0n),
      openDisputes: await this.prisma.financialDispute.count({
        where: { status: FinancialDisputeStatus.OPEN },
      }),
    };
  }

  async listAdminCommissions(query: ListFinanceQueryDto) {
    return this.paginateCommissions({}, query);
  }

  async listLedgerEntries(query: ListFinanceQueryDto) {
    return this.paginate('ledgerEntry', {}, query, {
      createdAt: query.sortDirection ?? 'desc',
    });
  }

  async listLedgerTransactions(query: ListFinanceQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const [items, totalItems] = await Promise.all([
      this.prisma.ledgerTransaction.findMany({
        include: {
          postings: {
            include: { account: true },
            orderBy: { createdAt: 'asc' },
          },
          order: { select: { id: true, externalOrderId: true } },
          commission: { select: { id: true, creatorId: true, offerId: true } },
          payout: { select: { id: true, creatorId: true, status: true } },
          statement: { select: { id: true, brandId: true, status: true } },
        },
        orderBy: { createdAt: query.sortDirection ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ledgerTransaction.count(),
    ]);
    return { items, pagination: { page, pageSize, totalItems } };
  }

  async listPayouts(query: ListFinanceQueryDto) {
    return this.paginate('payout', {}, query, {
      createdAt: query.sortDirection ?? 'desc',
    });
  }

  async createPayout(adminUserId: string, dto: CreatePayoutDto) {
    const uniqueIds = [...new Set(dto.commissionIds)];
    if (uniqueIds.length !== dto.commissionIds.length) {
      throw new BadRequestException('Список комиссий содержит дубли');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const commissions = await tx.commission.findMany({
          where: {
            id: { in: uniqueIds },
            status: {
              in: [CommissionStatus.AVAILABLE, CommissionStatus.PAYABLE],
            },
            payoutId: null,
          },
          include: {
            affiliateRelationship: { include: { commercialAgreement: true } },
          },
        });
        if (commissions.length !== uniqueIds.length) {
          throw new ConflictException('Часть комиссий уже недоступна для выплаты');
        }
        const creatorIds = new Set(commissions.map((commission) => commission.creatorId));
        if (creatorIds.size !== 1) {
          throw new BadRequestException('Один payout может принадлежать только одному креатору');
        }
        const currencies = new Set(commissions.map((commission) => commission.currency));
        if (currencies.size !== 1) {
          throw new BadRequestException(
            'Один payout не может объединять разные валюты',
          );
        }
        const currency = commissions[0].currency;
        const grossAmount = commissions.reduce(
          (sum, commission) =>
            sum +
            (commission.creatorAmountMinor ??
              BigInt(commission.creatorAmountKopecks)),
          0n,
        );
        const recoverable = await tx.commission.aggregate({
          where: {
            creatorId: commissions[0].creatorId,
            recoverableAmountMinor: { gt: 0n },
          },
          _sum: { recoverableAmountMinor: true },
        });
        let recoveryRemaining =
          recoverable._sum.recoverableAmountMinor ?? 0n;
        const payoutItems = commissions.map((commission) => {
          const gross =
            commission.creatorAmountMinor ??
            BigInt(commission.creatorAmountKopecks);
          const recovery =
            recoveryRemaining > gross ? gross : recoveryRemaining;
          recoveryRemaining -= recovery;
          return {
            commissionId: commission.id,
            affiliateRelationshipId: commission.affiliateRelationshipId,
            creatorId: commission.creatorId,
            amountMinor: gross - recovery,
            recoveryAmountMinor: recovery,
            currency,
          };
        });
        const amount = payoutItems.reduce(
          (sum, item) => sum + item.amountMinor,
          0n,
        );
        if (amount <= 0n) {
          throw new BadRequestException(
            'Вся выбранная сумма направляется на погашение recoverable balance',
          );
        }
        const minimumPayoutMinor = commissions.reduce(
          (maximum, commission) => {
            const threshold =
              commission.affiliateRelationship.commercialAgreement
                ?.minimumPayoutMinor ?? 0n;
            return threshold > maximum ? threshold : maximum;
          },
          0n,
        );
        if (amount < minimumPayoutMinor) {
          throw new BadRequestException(
            `Минимальная сумма выплаты: ${minimumPayoutMinor.toString()} ${currency}`,
          );
        }
        const payout = await tx.payout.create({
          data: {
            creatorId: commissions[0].creatorId,
            amountKopecks: amount,
            currency,
            createdByUserId: adminUserId,
            reference: dto.reference?.trim() || null,
            payoutItems: {
              create: payoutItems,
            },
          },
        });
        const reserved = await tx.commission.updateMany({
          where: {
            id: { in: uniqueIds },
            status: {
              in: [CommissionStatus.AVAILABLE, CommissionStatus.PAYABLE],
            },
            payoutId: null,
          },
          data: { payoutId: payout.id },
        });
        if (reserved.count !== uniqueIds.length) {
          throw new ConflictException('Комиссии были изменены во время создания выплаты');
        }
        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            action: 'PAYOUT_CREATED',
            entityType: 'Payout',
            entityId: payout.id,
            requestId: this.audit.requestId(),
            metadata: {
              amountKopecks: amount.toString(),
              grossAmountMinor: grossAmount.toString(),
              recoveryAmountMinor: (grossAmount - amount).toString(),
              commissionsCount: uniqueIds.length,
            },
          },
        });
        return tx.payout.findUnique({
          where: { id: payout.id },
          include: { commissions: true, creator: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async approvePayout(adminUserId: string, payoutId: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Выплата не найдена');
    if (payout.status === PayoutStatus.APPROVED || payout.status === PayoutStatus.PAID) {
      return payout;
    }
    if (payout.status !== PayoutStatus.DRAFT) {
      throw new ConflictException('Выплату нельзя подтвердить в текущем статусе');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.APPROVED,
          approvedAt: new Date(),
          approvedByUserId: adminUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'PAYOUT_APPROVED',
          entityType: 'Payout',
          entityId: payout.id,
          requestId: this.audit.requestId(),
          metadata: { amountKopecks: payout.amountKopecks.toString() },
        },
      });
      return updated;
    });
  }

  async markPayoutPaid(adminUserId: string, payoutId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const payout = await tx.payout.findUnique({
          where: { id: payoutId },
          include: { commissions: true, payoutItems: true },
        });
        if (!payout) throw new NotFoundException('Выплата не найдена');
        if (payout.status === PayoutStatus.PAID) return payout;
        if (payout.status !== PayoutStatus.APPROVED) {
          throw new ConflictException('Сначала подтвердите выплату');
        }
        if (
          payout.commissions.some(
            (commission) =>
              (commission.status !== CommissionStatus.AVAILABLE &&
                commission.status !== CommissionStatus.PAYABLE) ||
              commission.hasPostPayoutDebt,
          )
        ) {
          throw new ConflictException('Состав выплаты изменился после подтверждения');
        }
        const currentAmount = payout.payoutItems.reduce(
          (sum, item) => sum + item.amountMinor,
          0n,
        );
        if (currentAmount !== payout.amountKopecks) {
          throw new ConflictException('Сумма выплаты больше не совпадает с комиссиями');
        }
        for (const commission of payout.commissions) {
          const payoutItem = payout.payoutItems.find(
            (item) => item.commissionId === commission.id,
          );
          if (!payoutItem) {
            throw new ConflictException(
              'Payout item отсутствует для выбранной комиссии',
            );
          }
          if (payoutItem.amountMinor === 0n) continue;
          if (payoutItem.amountMinor > BigInt(2_147_483_647)) {
            throw new ConflictException(
              'Сумма payout item превышает legacy ledger limit',
            );
          }
          await tx.ledgerEntry.upsert({
            where: { eventKey: `payout:${payout.id}:commission:${commission.id}` },
            update: {},
            create: {
              commissionId: commission.id,
              creatorId: commission.creatorId,
              orderId: commission.orderId,
              payoutId: payout.id,
              type: LedgerEntryType.PAYOUT,
              amountKopecks: -Number(payoutItem.amountMinor),
              eventKey: `payout:${payout.id}:commission:${commission.id}`,
            },
          });
        }
        await this.createBalancedTransaction(tx, {
          type: LedgerTransactionType.PAYOUT,
          eventKey: `payout:${payout.id}:financial`,
          currency: payout.currency,
          payoutId: payout.id,
          source: 'ADMIN_MANUAL_PAYOUT',
          postings: [
            {
              accountType: LedgerAccountType.CREATOR_PAYABLE,
              ownerType: 'CreatorProfile',
              ownerId: payout.creatorId,
              direction: LedgerPostingDirection.DEBIT,
              amount: payout.amountKopecks,
            },
            {
              accountType: LedgerAccountType.CASH_CLEARING,
              ownerType: 'Platform',
              ownerId: 'svyazka',
              direction: LedgerPostingDirection.CREDIT,
              amount: payout.amountKopecks,
            },
          ],
        });
        const recoveryAmount = payout.payoutItems.reduce(
          (sum, item) => sum + item.recoveryAmountMinor,
          0n,
        );
        if (recoveryAmount > 0n) {
          await this.createBalancedTransaction(tx, {
            type: LedgerTransactionType.RECOVERY,
            eventKey: `payout:${payout.id}:recoverable-offset`,
            currency: payout.currency,
            payoutId: payout.id,
            source: 'CREATOR_CARRY_FORWARD_RECOVERY',
            postings: [
              {
                accountType: LedgerAccountType.CREATOR_PAYABLE,
                ownerType: 'CreatorProfile',
                ownerId: payout.creatorId,
                direction: LedgerPostingDirection.DEBIT,
                amount: recoveryAmount,
              },
              {
                accountType: LedgerAccountType.CREATOR_RECOVERABLE,
                ownerType: 'CreatorProfile',
                ownerId: payout.creatorId,
                direction: LedgerPostingDirection.CREDIT,
                amount: recoveryAmount,
              },
            ],
          });
          let remaining = recoveryAmount;
          const debts = await tx.commission.findMany({
            where: {
              creatorId: payout.creatorId,
              recoverableAmountMinor: { gt: 0n },
            },
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          });
          for (const debt of debts) {
            if (remaining <= 0n) break;
            const recovered =
              remaining > debt.recoverableAmountMinor
                ? debt.recoverableAmountMinor
                : remaining;
            const next = debt.recoverableAmountMinor - recovered;
            await tx.commission.update({
              where: { id: debt.id },
              data: {
                recoverableAmountMinor: next,
                debtAmountKopecks:
                  next > BigInt(2_147_483_647) ? 2_147_483_647 : Number(next),
                hasPostPayoutDebt: next > 0n,
              },
            });
            remaining -= recovered;
          }
          if (remaining !== 0n) {
            throw new ConflictException(
              'Recoverable balance changed during payout',
            );
          }
        }
        await tx.commission.updateMany({
          where: {
            payoutId: payout.id,
            status: {
              in: [CommissionStatus.AVAILABLE, CommissionStatus.PAYABLE],
            },
          },
          data: { status: CommissionStatus.PAID },
        });
        const updated = await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: PayoutStatus.PAID,
            paidAt: new Date(),
            paidByUserId: adminUserId,
          },
          include: { commissions: true, creator: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            action: 'PAYOUT_MARKED_PAID',
            entityType: 'Payout',
            entityId: payout.id,
            requestId: this.audit.requestId(),
            metadata: { amountKopecks: payout.amountKopecks.toString() },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async cancelPayout(adminUserId: string, payoutId: string, reason?: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const payout = await tx.payout.findUnique({
          where: { id: payoutId },
          include: { commissions: true, creator: true },
        });
        if (!payout) throw new NotFoundException('Выплата не найдена');
        if (payout.status === PayoutStatus.CANCELLED) return payout;
        if (payout.status === PayoutStatus.PAID) {
          throw new ConflictException('Выплаченную выплату отменить нельзя');
        }
        if (
          payout.status !== PayoutStatus.DRAFT &&
          payout.status !== PayoutStatus.APPROVED
        ) {
          throw new ConflictException('Выплату нельзя отменить в текущем статусе');
        }
        const payoutEntries = await tx.ledgerEntry.count({
          where: { payoutId: payout.id, type: LedgerEntryType.PAYOUT },
        });
        if (payoutEntries > 0) {
          throw new ConflictException('Выплата уже содержит записи ledger');
        }
        await tx.commission.updateMany({
          where: {
            payoutId: payout.id,
            status: {
              in: [CommissionStatus.AVAILABLE, CommissionStatus.PAYABLE],
            },
          },
          data: { payoutId: null },
        });
        const updated = await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: PayoutStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledByUserId: adminUserId,
            cancellationReason: reason?.trim() || null,
          },
          include: { commissions: true, creator: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            action: 'PAYOUT_CANCELLED',
            entityType: 'Payout',
            entityId: payout.id,
            requestId: this.audit.requestId(),
            metadata: { previousStatus: payout.status, reason: reason?.trim() || null },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async releaseHold(adminUserId: string) {
    const result = await this.prisma.commission.updateMany({
      where: {
        status: CommissionStatus.HOLD,
        holdUntil: { lte: new Date() },
        payoutId: null,
      },
      data: { status: CommissionStatus.AVAILABLE },
    });
    await this.audit.record({
      actorUserId: adminUserId,
      action: 'COMMISSION_HOLD_RELEASED',
      entityType: 'Commission',
      entityId: 'batch',
      metadata: { released: result.count },
    });
    return { released: result.count };
  }

  async issueBrandStatement(
    adminUserId: string,
    dto: IssueBrandStatementDto,
  ) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    const dueAt = new Date(dto.dueAt);
    if (periodStart >= periodEnd) {
      throw new BadRequestException('Начало периода должно быть раньше окончания');
    }
    if (dueAt <= periodEnd) {
      throw new BadRequestException('Срок оплаты должен быть после конца периода');
    }
    const currency = dto.currency.toUpperCase();

    return this.prisma.$transaction(
      async (tx) => {
        const brand = await tx.brandProfile.findUnique({
          where: { id: dto.brandId },
        });
        if (!brand) throw new NotFoundException('Бренд не найден');

        const existing = await tx.brandStatement.findFirst({
          where: {
            brandId: brand.id,
            periodStart,
            periodEnd,
            currency,
            correctedStatementId: null,
            status: { not: BrandStatementStatus.CORRECTED },
          },
        });
        if (existing) return existing;

        const transactions = await tx.ledgerTransaction.findMany({
          where: {
            currency,
            createdAt: { gte: periodStart, lt: periodEnd },
            order: { brandId: brand.id },
            type: {
              in: [
                LedgerTransactionType.ACCRUAL,
                LedgerTransactionType.REVERSAL,
                LedgerTransactionType.ADJUSTMENT,
                LedgerTransactionType.RECOVERY,
              ],
            },
          },
          include: {
            order: { select: { id: true, offerId: true } },
            commission: { select: { id: true } },
            postings: { include: { account: true } },
          },
          orderBy: { createdAt: 'asc' },
        });

        const lines = transactions.map((transaction) => {
          const sign =
            transaction.type === LedgerTransactionType.ACCRUAL ? 1n : -1n;
          const creator = transaction.postings
            .filter(
              (posting) =>
                posting.account.accountType ===
                  LedgerAccountType.CREATOR_PAYABLE ||
                posting.account.accountType ===
                  LedgerAccountType.CREATOR_RECOVERABLE,
            )
            .reduce((sum, posting) => sum + posting.amountMinor, 0n);
          const platform = transaction.postings
            .filter(
              (posting) =>
                posting.account.accountType ===
                LedgerAccountType.PLATFORM_REVENUE,
            )
            .reduce((sum, posting) => sum + posting.amountMinor, 0n);

          return {
            offerId: transaction.order!.offerId,
            orderId: transaction.orderId,
            commissionId: transaction.commissionId,
            lineType: transaction.type,
            creatorAmountMinor: creator * sign,
            platformAmountMinor: platform * sign,
            adjustmentMinor:
              transaction.type === LedgerTransactionType.ADJUSTMENT
                ? (creator + platform) * sign
                : 0n,
            description: transaction.reason,
          };
        });

        const creatorObligations = lines.reduce(
          (sum, line) =>
            line.lineType === LedgerTransactionType.ACCRUAL
              ? sum + line.creatorAmountMinor
              : sum,
          0n,
        );
        const platformFee = lines.reduce(
          (sum, line) =>
            line.lineType === LedgerTransactionType.ACCRUAL
              ? sum + line.platformAmountMinor
              : sum,
          0n,
        );
        const reversals = lines
          .filter((line) => line.lineType === LedgerTransactionType.REVERSAL)
          .reduce(
            (sum, line) =>
              sum - line.creatorAmountMinor - line.platformAmountMinor,
            0n,
          );
        const adjustments = lines.reduce(
          (sum, line) => sum + line.adjustmentMinor,
          0n,
        );
        const totalDue =
          creatorObligations + platformFee - reversals + adjustments;
        if (totalDue < 0n) {
          throw new ConflictException('Statement total cannot be negative');
        }

        const hashPayload = {
          brandId: brand.id,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          currency,
          lines: lines.map((line) => ({
            ...line,
            creatorAmountMinor: line.creatorAmountMinor.toString(),
            platformAmountMinor: line.platformAmountMinor.toString(),
            adjustmentMinor: line.adjustmentMinor.toString(),
          })),
        };
        const issuedAt = new Date();
        const statement = await tx.brandStatement.create({
          data: {
            brandId: brand.id,
            periodStart,
            periodEnd,
            currency,
            status: BrandStatementStatus.ISSUED,
            creatorObligationsMinor: creatorObligations,
            platformFeeMinor: platformFee,
            reversalsMinor: reversals,
            adjustmentsMinor: adjustments,
            totalDueMinor: totalDue,
            issuedAt,
            dueAt,
            issuedByUserId: adminUserId,
            contentHash: createHash('sha256')
              .update(
                JSON.stringify(hashPayload, (_key, value) =>
                  typeof value === 'bigint' ? value.toString() : value,
                ),
              )
              .digest('hex'),
            lines: { create: lines },
          },
          include: { lines: true },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            action: 'BRAND_STATEMENT_ISSUED',
            entityType: 'BrandStatement',
            entityId: statement.id,
            requestId: this.audit.requestId(),
            metadata: {
              brandId: brand.id,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
              currency,
              totalDueMinor: totalDue.toString(),
              contentHash: statement.contentHash,
            },
          },
        });
        return statement;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async recordBrandPayment(
    adminUserId: string,
    dto: RecordBrandPaymentDto,
  ) {
    const amountMinor = this.parsePositiveBigInt(dto.amountMinor, 'amountMinor');
    const currency = dto.currency.toUpperCase();
    const allocationInputs = dto.allocations.map((allocation) => ({
      statementId: allocation.statementId,
      amountMinor: this.parsePositiveBigInt(
        allocation.amountMinor,
        'allocation.amountMinor',
      ),
    }));
    const allocated = allocationInputs.reduce(
      (sum, allocation) => sum + allocation.amountMinor,
      0n,
    );
    if (allocated > amountMinor) {
      throw new BadRequestException('Распределение превышает сумму платежа');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const statements = await tx.brandStatement.findMany({
          where: {
            id: { in: allocationInputs.map((item) => item.statementId) },
          },
        });
        if (statements.length !== allocationInputs.length) {
          throw new NotFoundException('Часть statements не найдена');
        }

        for (const statement of statements) {
          if (
            statement.brandId !== dto.brandId ||
            statement.currency !== currency
          ) {
            throw new BadRequestException(
              'Payment allocation must use one Brand and currency',
            );
          }
          if (statement.status === BrandStatementStatus.CORRECTED) {
            throw new ConflictException('Исправленный statement нельзя оплачивать');
          }
        }

        const payment = await tx.brandPayment.create({
          data: {
            brandId: dto.brandId,
            currency,
            amountMinor,
            status:
              allocationInputs.length > 0
                ? BrandPaymentStatus.ALLOCATED
                : BrandPaymentStatus.RECORDED,
            reference: dto.reference?.trim() || null,
            paidAt: new Date(dto.paidAt),
            recordedByUserId: adminUserId,
            allocations: {
              create: allocationInputs,
            },
          },
          include: { allocations: true },
        });

        for (const allocation of allocationInputs) {
          const statement = statements.find(
            (item) => item.id === allocation.statementId,
          )!;
          const nextPaid = statement.paidMinor + allocation.amountMinor;
          if (nextPaid > statement.totalDueMinor) {
            throw new ConflictException(
              'Распределение превышает остаток по statement',
            );
          }
          await tx.brandStatement.update({
            where: { id: statement.id },
            data: {
              paidMinor: nextPaid,
              status:
                nextPaid === statement.totalDueMinor
                  ? BrandStatementStatus.PAID
                  : statement.status,
              paidAt:
                nextPaid === statement.totalDueMinor
                  ? new Date(dto.paidAt)
                  : statement.paidAt,
            },
          });
          await this.createBalancedTransaction(tx, {
            type: LedgerTransactionType.SETTLEMENT,
            eventKey: `brand-payment:${payment.id}:statement:${statement.id}`,
            currency,
            statementId: statement.id,
            source: 'ADMIN_RECORDED_BRAND_PAYMENT',
            postings: [
              {
                accountType: LedgerAccountType.CASH_CLEARING,
                ownerType: 'Platform',
                ownerId: 'svyazka',
                direction: LedgerPostingDirection.DEBIT,
                amount: allocation.amountMinor,
              },
              {
                accountType: LedgerAccountType.BRAND_OBLIGATION,
                ownerType: 'BrandProfile',
                ownerId: dto.brandId,
                direction: LedgerPostingDirection.CREDIT,
                amount: allocation.amountMinor,
              },
            ],
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            action: 'BRAND_PAYMENT_RECORDED',
            entityType: 'BrandPayment',
            entityId: payment.id,
            requestId: this.audit.requestId(),
            metadata: {
              brandId: dto.brandId,
              currency,
              amountMinor: amountMinor.toString(),
              allocationsCount: allocationInputs.length,
            },
          },
        });
        return payment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listAdminBrandPayments() {
    return this.prisma.brandPayment.findMany({
      include: {
        brand: {
          select: {
            id: true,
            brandName: true,
          },
        },
        allocations: {
          include: {
            statement: {
              select: {
                id: true,
                periodStart: true,
                periodEnd: true,
                totalDueMinor: true,
                paidMinor: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async openDispute(userId: string, dto: OpenFinancialDisputeDto) {
    const brand = await this.getBrand(userId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: dto.orderId, brandId: brand.id },
        include: { commission: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');

      const existing = await tx.financialDispute.findFirst({
        where: { orderId: order.id, status: FinancialDisputeStatus.OPEN },
      });
      if (existing) return existing;

      const dispute = await tx.financialDispute.create({
        data: {
          brandId: brand.id,
          orderId: order.id,
          commissionId: order.commission?.id ?? null,
          reason: dto.reason.trim(),
          openedByUserId: userId,
        },
      });
      if (order.commission) {
        await tx.commission.update({
          where: { id: order.commission.id },
          data: {
            status: CommissionStatus.DISPUTED,
            disputedAt: new Date(),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'FINANCIAL_DISPUTE_OPENED',
          entityType: 'FinancialDispute',
          entityId: dispute.id,
          requestId: this.audit.requestId(),
          metadata: {
            orderId: order.id,
            commissionId: order.commission?.id ?? null,
          },
        },
      });
      return dispute;
    });
  }

  async resolveDispute(
    adminUserId: string,
    disputeId: string,
    dto: ResolveFinancialDisputeDto,
  ) {
    if ((dto.adjustmentMinor ?? 0) !== 0) {
      throw new BadRequestException(
        'Финансовая корректировка должна оформляться отдельным adjustment',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const dispute = await tx.financialDispute.findUnique({
        where: { id: disputeId },
        include: { commission: { include: { payout: true } } },
      });
      if (!dispute) throw new NotFoundException('Dispute не найден');
      if (dispute.status !== FinancialDisputeStatus.OPEN) return dispute;

      const resolvedAt = new Date();
      const resolution = dto.resolution.trim();
      const updated = await tx.financialDispute.update({
        where: { id: dispute.id },
        data: {
          status: FinancialDisputeStatus.RESOLVED,
          resolvedAt,
          resolution,
        },
      });
      if (dispute.commission?.status === CommissionStatus.DISPUTED) {
        await tx.commission.update({
          where: { id: dispute.commission.id },
          data: {
            status:
              dispute.commission.payout?.status === PayoutStatus.PAID
                ? CommissionStatus.PAID
                : dispute.commission.payableAt
                  ? CommissionStatus.PAYABLE
                  : dispute.commission.holdUntil
                    ? CommissionStatus.HOLD
                    : CommissionStatus.PENDING,
            disputedAt: null,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'FINANCIAL_DISPUTE_RESOLVED',
          entityType: 'FinancialDispute',
          entityId: dispute.id,
          requestId: this.audit.requestId(),
          metadata: {
            orderId: dispute.orderId,
            resolution,
          },
        },
      });
      return updated;
    });
  }

  async runReconciliation(adminUserId: string) {
    const [transactions, orders, commissions, payouts, statements, allocations] =
      await Promise.all([
        this.prisma.ledgerTransaction.findMany({ include: { postings: true } }),
        this.prisma.order.findMany({
          where: { affiliateCommercialAgreementId: { not: null } },
        }),
        this.prisma.commission.findMany({
          include: {
            ledgerTransactions: {
              include: { postings: { include: { account: true } } },
            },
          },
        }),
        this.prisma.payout.findMany({ include: { payoutItems: true } }),
        this.prisma.brandStatement.findMany({ include: { lines: true } }),
        this.prisma.brandPaymentAllocation.findMany(),
      ]);
    const mismatches: Array<Record<string, string>> = [];
    for (const transaction of transactions) {
      const debit = transaction.postings
        .filter((posting) => posting.direction === LedgerPostingDirection.DEBIT)
        .reduce((sum, posting) => sum + posting.amountMinor, 0n);
      const credit = transaction.postings
        .filter((posting) => posting.direction === LedgerPostingDirection.CREDIT)
        .reduce((sum, posting) => sum + posting.amountMinor, 0n);
      if (debit !== credit) {
        mismatches.push({
          type: 'UNBALANCED_LEDGER_TRANSACTION',
          entityId: transaction.id,
        });
      }
    }
    for (const order of orders) {
      if (
        order.totalCommissionAmountMinor !== null &&
        order.creatorCommissionAmountMinor !== null &&
        order.platformCommissionAmountMinor !== null &&
        order.totalCommissionAmountMinor !==
          order.creatorCommissionAmountMinor +
            order.platformCommissionAmountMinor
      ) {
        mismatches.push({
          type: 'ORDER_COMMISSION_IDENTITY',
          entityId: order.id,
        });
      }
    }
    for (const payout of payouts) {
      const itemTotal = payout.payoutItems.reduce(
        (sum, item) => sum + item.amountMinor,
        0n,
      );
      if (itemTotal !== payout.amountKopecks) {
        mismatches.push({ type: 'PAYOUT_ITEMS_TOTAL', entityId: payout.id });
      }
    }
    for (const commission of commissions) {
      const accrualCreator = commission.ledgerTransactions
        .filter(
          (transaction) => transaction.type === LedgerTransactionType.ACCRUAL,
        )
        .flatMap((transaction) => transaction.postings)
        .filter(
          (posting) =>
            posting.direction === LedgerPostingDirection.CREDIT &&
            posting.account.accountType === LedgerAccountType.CREATOR_PAYABLE &&
            posting.amountMinor > 0n,
        )
        .reduce((sum, posting) => sum + posting.amountMinor, 0n);
      const reversedCreator = commission.ledgerTransactions
        .filter(
          (transaction) => transaction.type === LedgerTransactionType.REVERSAL,
        )
        .flatMap((transaction) => transaction.postings)
        .filter(
          (posting) =>
            posting.direction === LedgerPostingDirection.DEBIT &&
            (posting.account.accountType ===
              LedgerAccountType.CREATOR_PAYABLE ||
              posting.account.accountType ===
                LedgerAccountType.CREATOR_RECOVERABLE) &&
            posting.amountMinor > 0n,
        )
        .reduce((sum, posting) => sum + posting.amountMinor, 0n);
      if (reversedCreator > accrualCreator) {
        mismatches.push({
          type: 'COMMISSION_REVERSAL_EXCEEDS_ACCRUAL',
          entityId: commission.id,
        });
      }
    }
    for (const statement of statements) {
      const creatorLineTotal = statement.lines.reduce(
        (sum, line) =>
          line.lineType === LedgerTransactionType.ACCRUAL
            ? sum + line.creatorAmountMinor
            : sum,
        0n,
      );
      const platformLineTotal = statement.lines.reduce(
        (sum, line) =>
          line.lineType === LedgerTransactionType.ACCRUAL
            ? sum + line.platformAmountMinor
            : sum,
        0n,
      );
      const reversalLineTotal = statement.lines
        .filter((line) => line.lineType === LedgerTransactionType.REVERSAL)
        .reduce(
          (sum, line) =>
            sum - line.creatorAmountMinor - line.platformAmountMinor,
          0n,
        );
      const adjustmentLineTotal = statement.lines.reduce(
        (sum, line) => sum + line.adjustmentMinor,
        0n,
      );
      if (
        statement.totalDueMinor !==
          statement.creatorObligationsMinor +
            statement.platformFeeMinor -
            statement.reversalsMinor +
            statement.adjustmentsMinor ||
        statement.creatorObligationsMinor !== creatorLineTotal ||
        statement.platformFeeMinor !== platformLineTotal ||
        statement.reversalsMinor !== reversalLineTotal ||
        statement.adjustmentsMinor !== adjustmentLineTotal
      ) {
        mismatches.push({
          type: 'STATEMENT_TOTAL',
          entityId: statement.id,
        });
      }
      const allocated = allocations
        .filter((allocation) => allocation.statementId === statement.id)
        .reduce((sum, allocation) => sum + allocation.amountMinor, 0n);
      if (
        allocated !== statement.paidMinor ||
        allocated > statement.totalDueMinor
      ) {
        mismatches.push({
          type: 'STATEMENT_PAYMENT_ALLOCATION',
          entityId: statement.id,
        });
      }
    }
    const status =
      mismatches.length === 0
        ? ReconciliationStatus.PASSED
        : ReconciliationStatus.FAILED;
    const run = await this.prisma.reconciliationRun.create({
      data: {
        status,
        scope: 'PLATFORM',
        mismatchCount: mismatches.length,
        details: { mismatches },
        requestId: this.audit.requestId(),
      },
    });
    await this.audit.record({
      actorUserId: adminUserId,
      action: 'FINANCIAL_RECONCILIATION_RUN',
      entityType: 'ReconciliationRun',
      entityId: run.id,
      metadata: { status, mismatchCount: mismatches.length },
    });
    return run;
  }

  async syncStage8Commission(
    tx: Prisma.TransactionClient,
    order: Order,
    eventId: string,
    eligibleAmountMinor?: bigint,
  ) {
    return this.syncCommission(tx, order, eventId, eligibleAmountMinor);
  }

  private async buildPreviewRows(
    brandId: string,
    orderImportId: string,
    records: CsvRecord[],
  ): Promise<Prisma.OrderImportRowCreateManyInput[]> {
    const offers = await this.prisma.offer.findMany({ where: { brandId } });
    const relationships = await this.prisma.affiliateRelationship.findMany({
      where: { offer: { brandId } },
      include: { offer: true, commercialAgreement: true },
    });
    const clickIds = records.map((row) => row.click_id).filter(Boolean);
    const clicks = await this.prisma.click.findMany({
      where: { id: { in: clickIds }, offer: { brandId } },
      include: {
        affiliateRelationship: {
          include: { offer: true, commercialAgreement: true },
        },
      },
    });
    const externalIds = records.map((row) => row.external_order_id).filter(Boolean);
    const existingOrders = await this.prisma.order.findMany({
      where: { brandId, externalOrderId: { in: externalIds } },
    });
    const offerMap = new Map(offers.map((offer) => [offer.id, offer]));
    const affiliateMap = new Map(
      relationships.map((relationship) => [relationship.affiliateCode, relationship]),
    );
    const promoMap = new Map(
      relationships.map((relationship) => [relationship.promoCode, relationship]),
    );
    const clickMap = new Map(clicks.map((click) => [click.id, click]));
    const existingMap = new Map(
      existingOrders.map((order) => [order.externalOrderId, order]),
    );

    const seenExternalIds = new Map<string, string>();
    return records.map((record, index) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const externalOrderId = record.external_order_id?.slice(0, 160) || null;
      if (!externalOrderId) errors.push('external_order_id обязателен');
      const orderDate = this.parseDate(record.order_date);
      if (!orderDate) errors.push('order_date должен быть датой ISO 8601');
      const amountKopecks = this.parseKopecks(record.amount_kopecks);
      if (amountKopecks === null) errors.push('amount_kopecks должен быть целым числом');
      const currency = record.currency?.toUpperCase() || null;
      if (currency !== 'RUB') errors.push('На этапе MVP поддерживается только RUB');
      const orderStatus = CSV_STATUS[record.status?.toLowerCase()];
      if (!orderStatus) errors.push('Неизвестный status');
      let returnedAmountKopecks = this.parseOptionalKopecks(
        record.returned_amount_kopecks,
      );
      if (returnedAmountKopecks === null) {
        errors.push('returned_amount_kopecks должен быть целым числом');
        returnedAmountKopecks = 0;
      }
      if (orderStatus === OrderStatus.RETURNED && amountKopecks !== null) {
        returnedAmountKopecks = amountKopecks;
      } else if (orderStatus === OrderStatus.PARTIALLY_RETURNED) {
        if (
          !returnedAmountKopecks ||
          amountKopecks === null ||
          returnedAmountKopecks >= amountKopecks
        ) {
          errors.push(
            'Для partially_returned укажите returned_amount_kopecks от 1 до суммы заказа',
          );
        }
      } else if (returnedAmountKopecks !== 0) {
        errors.push('returned_amount_kopecks допустим только для возврата');
      }

      const resolved: Array<{
        source: AttributionSource;
        relationship: RelationshipWithOffer;
      }> = [];
      const click = record.click_id ? clickMap.get(record.click_id) : undefined;
      if (record.click_id && !click) warnings.push('Неизвестный click_id');
      if (click) {
        resolved.push({
          source: AttributionSource.CLICK_ID,
          relationship: click.affiliateRelationship,
        });
        if (orderDate && click.clickedAt > orderDate) {
          errors.push('click_id создан позже даты заказа');
        }
      }
      const affiliateRelationship = record.affiliate_code
        ? affiliateMap.get(record.affiliate_code)
        : undefined;
      if (record.affiliate_code && !affiliateRelationship) {
        warnings.push('Неизвестный affiliate_code');
      }
      if (affiliateRelationship) {
        resolved.push({
          source: AttributionSource.AFFILIATE_CODE,
          relationship: affiliateRelationship,
        });
      }
      const promoRelationship = record.promo_code
        ? promoMap.get(record.promo_code.toUpperCase())
        : undefined;
      if (record.promo_code && !promoRelationship) warnings.push('Неизвестный promo_code');
      if (promoRelationship) {
        resolved.push({
          source: AttributionSource.PROMO_CODE,
          relationship: promoRelationship,
        });
      }
      for (const item of resolved) {
        if (
          orderDate &&
          (item.relationship.createdAt > orderDate ||
            (item.relationship.revokedAt && orderDate >= item.relationship.revokedAt))
        ) {
          errors.push('Партнёрский код не действовал на дату заказа');
        }
      }
      const relationshipIds = new Set(resolved.map((item) => item.relationship.id));
      const conflict = relationshipIds.size > 1;
      if (conflict) errors.push('Идентификаторы указывают на разных креаторов');
      const selected =
        resolved.find((item) => item.source === AttributionSource.CLICK_ID) ??
        resolved.find((item) => item.source === AttributionSource.AFFILIATE_CODE) ??
        resolved.find((item) => item.source === AttributionSource.PROMO_CODE);
      const requestedOfferId = record.offer_id || null;
      if (requestedOfferId && !offerMap.has(requestedOfferId)) {
        errors.push('offer_id не принадлежит бренду');
      }
      if (
        selected &&
        requestedOfferId &&
        selected.relationship.offerId !== requestedOfferId
      ) {
        errors.push('offer_id конфликтует с партнёрским идентификатором');
      }
      const offerId = selected?.relationship.offerId ?? requestedOfferId;
      const offer = offerId ? offerMap.get(offerId) : undefined;
      if (!offer) errors.push('Невозможно определить оффер');
      const existing = externalOrderId ? existingMap.get(externalOrderId) : undefined;
      if (
        selected &&
        this.isStage7FinancialActivationEnabled() &&
        !existing &&
        (selected.relationship.status !== AffiliateRelationshipStatus.ACTIVE ||
          !selected.relationship.commercialAgreement)
      ) {
        errors.push(
          'Новая финансовая атрибуция требует активной партнёрской связи с коммерческим соглашением',
        );
      }
      let action: OrderImportAction = OrderImportAction.CREATE;
      let rowStatus: OrderImportRowStatus = conflict
        ? OrderImportRowStatus.CONFLICT
        : errors.length
          ? OrderImportRowStatus.INVALID
          : OrderImportRowStatus.VALID;
      if (existing && rowStatus === OrderImportRowStatus.VALID) {
        const immutableMismatch =
          existing.amountKopecks !== amountKopecks ||
          existing.currency !== currency ||
          existing.offerId !== offerId ||
          existing.affiliateRelationshipId !== (selected?.relationship.id ?? null);
        if (immutableMismatch) {
          errors.push('Повторный заказ изменяет сумму, валюту, оффер или атрибуцию');
          rowStatus = OrderImportRowStatus.CONFLICT;
          action = OrderImportAction.SKIP;
        } else if (
          existing.status === orderStatus &&
          existing.returnedAmountKopecks === returnedAmountKopecks
        ) {
          rowStatus = OrderImportRowStatus.DUPLICATE;
          action = OrderImportAction.SKIP;
        } else if (
          orderStatus &&
          !this.isAllowedOrderTransition(
            existing.status,
            orderStatus,
            existing.returnedAmountKopecks,
            returnedAmountKopecks,
          )
        ) {
          errors.push(`Недопустимый переход ${existing.status} → ${orderStatus}`);
          rowStatus = OrderImportRowStatus.INVALID;
          action = OrderImportAction.SKIP;
        } else {
          action = OrderImportAction.UPDATE;
        }
      }

      if (externalOrderId) {
        const fingerprint = JSON.stringify({
          orderDate: orderDate?.toISOString() ?? null,
          amountKopecks,
          returnedAmountKopecks,
          currency,
          orderStatus: orderStatus ?? null,
          offerId: offerId ?? null,
          relationshipId: selected?.relationship.id ?? null,
        });
        const firstFingerprint = seenExternalIds.get(externalOrderId);
        if (firstFingerprint !== undefined) {
          action = OrderImportAction.SKIP;
          if (firstFingerprint === fingerprint) {
            rowStatus = OrderImportRowStatus.DUPLICATE;
            warnings.push('Повтор external_order_id внутри текущего CSV');
          } else {
            rowStatus = OrderImportRowStatus.CONFLICT;
            errors.push('external_order_id повторяется с другими данными внутри текущего CSV');
          }
        } else {
          seenExternalIds.set(externalOrderId, fingerprint);
        }
      }

      const agreement = selected?.relationship.commercialAgreement ?? null;
      const bps = existing
        ? {
            creatorCommissionBps: existing.creatorCommissionBps,
            platformCommissionBps: existing.platformCommissionBps,
          }
        : agreement
          ? {
              creatorCommissionBps: agreement.creatorEffectiveGmvBps,
              platformCommissionBps: agreement.platformEffectiveGmvBps,
            }
          : offer
            ? {
                creatorCommissionBps: offer.creatorCommissionBps,
                platformCommissionBps: offer.platformCommissionBps,
              }
            : null;
      const commissionBase =
        orderStatus === OrderStatus.CANCELLED || orderStatus === OrderStatus.RETURNED
          ? 0
          : Math.max(0, (amountKopecks ?? 0) - returnedAmountKopecks);
      const previewAmounts =
        selected && bps
          ? agreement
            ? this.calculateAgreementAmounts(commissionBase, agreement)
            : {
                creator: this.calculateCommission(
                  commissionBase,
                  bps.creatorCommissionBps,
                ),
                platform: this.calculateCommission(
                  commissionBase,
                  bps.platformCommissionBps,
                ),
                total:
                  this.calculateCommission(
                    commissionBase,
                    bps.creatorCommissionBps,
                  ) +
                  this.calculateCommission(
                    commissionBase,
                    bps.platformCommissionBps,
                  ),
              }
          : { creator: 0, platform: 0, total: 0 };
      return {
        orderImportId,
        rowNumber: index + 2,
        status: rowStatus,
        action,
        externalOrderId,
        orderDate,
        amountKopecks,
        returnedAmountKopecks,
        currency,
        orderStatus: orderStatus ?? null,
        affiliateCode: record.affiliate_code || null,
        promoCode: record.promo_code?.toUpperCase() || null,
        clickId: click?.id ?? null,
        offerId: offer?.id ?? null,
        attributedRelationshipId: selected?.relationship.id ?? null,
        affiliateCommercialAgreementId:
          existing?.affiliateCommercialAgreementId ?? agreement?.id ?? null,
        attributionSource: selected?.source ?? AttributionSource.UNATTRIBUTED,
        existingOrderId: existing?.id ?? null,
        creatorCommissionBpsSnapshot: bps?.creatorCommissionBps ?? null,
        platformCommissionBpsSnapshot: bps?.platformCommissionBps ?? null,
        totalCommissionPoolBpsSnapshot:
          existing?.totalCommissionPoolBps ??
          agreement?.totalCommissionPoolBps ??
          null,
        creatorPoolShareBpsSnapshot:
          existing?.creatorPoolShareBps ?? agreement?.creatorPoolShareBps ?? null,
        platformPoolShareBpsSnapshot:
          existing?.platformPoolShareBps ??
          agreement?.platformPoolShareBps ??
          null,
        commercialTermsVersionSnapshot:
          existing?.commercialTermsVersionNumber ??
          agreement?.commercialTermsVersionNumber ??
          null,
        calculationPolicySnapshot:
          existing?.calculationPolicy ?? agreement?.calculationPolicy ?? null,
        previewCreatorAmountKopecks: previewAmounts.creator,
        previewPlatformAmountKopecks: previewAmounts.platform,
        errors,
        warnings,
        rawData: record,
      };
    });
  }

  private async syncCommission(
    tx: Prisma.TransactionClient,
    order: Order,
    eventId: string,
    baseOverrideMinor?: bigint,
  ) {
    if (!order.affiliateRelationshipId) return;
    const relationship = await tx.affiliateRelationship.findUnique({
      where: { id: order.affiliateRelationshipId },
      include: { commercialAgreement: true },
    });
    if (!relationship) throw new ConflictException('Партнёрская связь заказа не найдена');
    if (
      this.isStage7FinancialActivationEnabled() &&
      (!relationship.commercialAgreement ||
        order.affiliateCommercialAgreementId !==
          relationship.commercialAgreement.id)
    ) {
      throw new ConflictException(
        'Финансовый заказ должен использовать активное коммерческое соглашение',
      );
    }
    const current = await tx.commission.findUnique({ where: { orderId: order.id } });
    const baseMinor = commissionBaseForSync(order, baseOverrideMinor);
    const base = Number(baseMinor);
    const targets = relationship.commercialAgreement
      ? this.calculateAgreementAmounts(base, relationship.commercialAgreement)
      : {
          creator: this.calculateCommission(base, order.creatorCommissionBps),
          platform: this.calculateCommission(base, order.platformCommissionBps),
          total:
            this.calculateCommission(base, order.creatorCommissionBps) +
            this.calculateCommission(base, order.platformCommissionBps),
        };
    const creatorTarget = targets.creator;
    const platformTarget = targets.platform;
    const shouldAccrue =
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.PARTIALLY_RETURNED;
    const holdUntil = new Date(
      Date.now() + this.getPositiveInteger('COMMISSION_HOLD_DAYS', 14) * 86_400_000,
    );

    if (!current) {
      const status = shouldAccrue
        ? CommissionStatus.HOLD
        : order.status === OrderStatus.PENDING
          ? CommissionStatus.PENDING
          : CommissionStatus.REVERSED;
      const commission = await tx.commission.create({
        data: {
          orderId: order.id,
          affiliateRelationshipId: relationship.id,
          creatorId: relationship.creatorId,
          offerId: order.offerId,
          creatorAmountKopecks: creatorTarget,
          platformAmountKopecks: platformTarget,
          creatorAmountMinor: BigInt(creatorTarget),
          platformAmountMinor: BigInt(platformTarget),
          totalAmountMinor: BigInt(targets.total),
          currency: order.currency,
          status,
          holdUntil: shouldAccrue ? holdUntil : null,
          confirmedAt: shouldAccrue ? new Date() : null,
        },
      });
      if (shouldAccrue) {
        await tx.ledgerEntry.create({
          data: {
            commissionId: commission.id,
            creatorId: relationship.creatorId,
            orderId: order.id,
            type: LedgerEntryType.ACCRUAL,
            amountKopecks: creatorTarget,
            eventKey: `order:${order.id}:accrual`,
            metadata: { platformAmountKopecks: platformTarget },
          },
        });
        await this.createAccrualTransaction(
          tx,
          order,
          commission.id,
          creatorTarget,
          platformTarget,
          `order:${order.id}:financial-accrual`,
        );
      }
      return;
    }

    if (current.status === CommissionStatus.PENDING && shouldAccrue) {
      await tx.commission.update({
        where: { id: current.id },
        data: {
          creatorAmountKopecks: creatorTarget,
          platformAmountKopecks: platformTarget,
          creatorAmountMinor: BigInt(creatorTarget),
          platformAmountMinor: BigInt(platformTarget),
          totalAmountMinor: BigInt(targets.total),
          status: CommissionStatus.HOLD,
          holdUntil,
          confirmedAt: new Date(),
        },
      });
      await tx.ledgerEntry.upsert({
        where: { eventKey: `order:${order.id}:accrual` },
        update: {},
        create: {
          commissionId: current.id,
          creatorId: current.creatorId,
          orderId: order.id,
          type: LedgerEntryType.ACCRUAL,
          amountKopecks: creatorTarget,
          eventKey: `order:${order.id}:accrual`,
          metadata: { platformAmountKopecks: platformTarget },
        },
      });
      await this.createAccrualTransaction(
        tx,
        order,
        current.id,
        creatorTarget,
        platformTarget,
        `order:${order.id}:financial-accrual`,
      );
      return;
    }

    const currentCreatorNet =
      current.status === CommissionStatus.PAID
        ? current.creatorAmountKopecks - current.debtAmountKopecks
        : current.creatorAmountKopecks;
    const creatorDelta = creatorTarget - currentCreatorNet;
    const platformDelta = platformTarget - current.platformAmountKopecks;
    const ledgerAmounts = await tx.ledgerEntry.findMany({
      where: {
        commissionId: current.id,
        type: { in: [LedgerEntryType.ACCRUAL, LedgerEntryType.REVERSAL] },
      },
      select: { type: true, amountKopecks: true },
    });
    const accrued = ledgerAmounts
      .filter((entry) => entry.type === LedgerEntryType.ACCRUAL)
      .reduce((sum, entry) => sum + entry.amountKopecks, 0);
    const reversed = ledgerAmounts
      .filter((entry) => entry.type === LedgerEntryType.REVERSAL)
      .reduce((sum, entry) => sum + -entry.amountKopecks, 0);
    const reversibleBalance = Math.max(0, accrued - reversed);
    const reversalAmount = creatorDelta < 0
      ? Math.min(-creatorDelta, reversibleBalance)
      : 0;
    if (reversalAmount > 0) {
      await tx.ledgerEntry.upsert({
        where: { eventKey: `order:${order.id}:reversal:${eventId}` },
        update: {},
        create: {
          commissionId: current.id,
          creatorId: current.creatorId,
          orderId: order.id,
          type: LedgerEntryType.REVERSAL,
          amountKopecks: -reversalAmount,
          eventKey: `order:${order.id}:reversal:${eventId}`,
          metadata: {
            platformAmountKopecks: platformDelta,
            returnedAmountKopecks: order.returnedAmountKopecks,
            postPayout: current.status === CommissionStatus.PAID,
          },
        },
      });
    }
    const platformReversal = platformDelta < 0 ? -platformDelta : 0;
    if (reversalAmount > 0 || platformReversal > 0) {
      await this.createReversalTransaction(
        tx,
        order,
        current.id,
        reversalAmount,
        platformReversal,
        current.status === CommissionStatus.PAID,
        `order:${order.id}:financial-reversal:${eventId}`,
      );
    }
    const postPayoutDebt =
      current.status === CommissionStatus.PAID && reversalAmount > 0
        ? current.debtAmountKopecks + reversalAmount
        : current.debtAmountKopecks;
    await tx.commission.update({
      where: { id: current.id },
      data: {
        creatorAmountKopecks:
          current.status === CommissionStatus.PAID
            ? current.creatorAmountKopecks
            : creatorTarget,
        platformAmountKopecks: platformTarget,
        creatorAmountMinor:
          current.status === CommissionStatus.PAID
            ? current.creatorAmountMinor
            : BigInt(creatorTarget),
        platformAmountMinor: BigInt(platformTarget),
        totalAmountMinor:
          current.status === CommissionStatus.PAID
            ? (current.creatorAmountMinor ?? BigInt(current.creatorAmountKopecks)) +
              BigInt(platformTarget)
            : BigInt(creatorTarget + platformTarget),
        status:
          current.status === CommissionStatus.PAID
            ? CommissionStatus.PAID
            : creatorTarget === 0
              ? CommissionStatus.REVERSED
              : current.status,
        debtAmountKopecks: postPayoutDebt,
        recoverableAmountMinor: BigInt(postPayoutDebt),
        hasPostPayoutDebt: postPayoutDebt > 0,
      },
    });
  }

  private calculateAgreementAmounts(
    amountMinor: number | bigint,
    agreement: {
      calculationPolicy: CommercialCalculationPolicy;
      totalCommissionPoolBps: number;
      creatorPoolShareBps: number;
      creatorEffectiveGmvBps: number;
      platformEffectiveGmvBps: number;
    },
  ) {
    const result = calculateFinancialAmounts(BigInt(amountMinor), agreement);
    return {
      total: this.toLegacyMoneyNumber(result.total),
      creator: this.toLegacyMoneyNumber(result.creator),
      platform: this.toLegacyMoneyNumber(result.platform),
    };
  }

  private async createAccrualTransaction(
    tx: Prisma.TransactionClient,
    order: Order,
    commissionId: string,
    creatorAmount: number,
    platformAmount: number,
    eventKey: string,
  ) {
    const total = creatorAmount + platformAmount;
    if (total <= 0) return;
    await this.createBalancedTransaction(tx, {
      type: LedgerTransactionType.ACCRUAL,
      eventKey,
      currency: order.currency,
      orderId: order.id,
      commissionId,
      source: 'ORDER_STATUS',
      postings: [
        {
          accountType: LedgerAccountType.BRAND_OBLIGATION,
          ownerType: 'BrandProfile',
          ownerId: order.brandId,
          direction: LedgerPostingDirection.DEBIT,
          amount: total,
        },
        {
          accountType: LedgerAccountType.CREATOR_PAYABLE,
          ownerType: 'CreatorProfile',
          ownerId: (
            await tx.commission.findUniqueOrThrow({
              where: { id: commissionId },
              select: { creatorId: true },
            })
          ).creatorId,
          direction: LedgerPostingDirection.CREDIT,
          amount: creatorAmount,
        },
        {
          accountType: LedgerAccountType.PLATFORM_REVENUE,
          ownerType: 'Platform',
          ownerId: 'svyazka',
          direction: LedgerPostingDirection.CREDIT,
          amount: platformAmount,
        },
      ],
    });
  }

  private async createReversalTransaction(
    tx: Prisma.TransactionClient,
    order: Order,
    commissionId: string,
    creatorAmount: number,
    platformAmount: number,
    postPayout: boolean,
    eventKey: string,
  ) {
    const total = creatorAmount + platformAmount;
    if (total <= 0) return;
    const commission = await tx.commission.findUniqueOrThrow({
      where: { id: commissionId },
      select: { creatorId: true },
    });
    await this.createBalancedTransaction(tx, {
      type: LedgerTransactionType.REVERSAL,
      eventKey,
      currency: order.currency,
      orderId: order.id,
      commissionId,
      source: 'ORDER_RETURN_OR_CANCELLATION',
      postings: [
        {
          accountType: postPayout
            ? LedgerAccountType.CREATOR_RECOVERABLE
            : LedgerAccountType.CREATOR_PAYABLE,
          ownerType: 'CreatorProfile',
          ownerId: commission.creatorId,
          direction: LedgerPostingDirection.DEBIT,
          amount: creatorAmount,
        },
        {
          accountType: LedgerAccountType.PLATFORM_REVENUE,
          ownerType: 'Platform',
          ownerId: 'svyazka',
          direction: LedgerPostingDirection.DEBIT,
          amount: platformAmount,
        },
        {
          accountType: LedgerAccountType.BRAND_OBLIGATION,
          ownerType: 'BrandProfile',
          ownerId: order.brandId,
          direction: LedgerPostingDirection.CREDIT,
          amount: total,
        },
      ],
    });
  }

  private async createBalancedTransaction(
    tx: Prisma.TransactionClient,
    input: {
      type: LedgerTransactionType;
      eventKey: string;
      currency: string;
      orderId?: string;
      commissionId?: string;
      payoutId?: string;
      statementId?: string;
      source: string;
      reason?: string;
      postings: Array<{
        accountType: LedgerAccountType;
        ownerType: string;
        ownerId: string;
        direction: LedgerPostingDirection;
        amount: number | bigint;
      }>;
    },
  ) {
    const existing = await tx.ledgerTransaction.findUnique({
      where: { eventKey: input.eventKey },
    });
    if (existing) return existing;
    const postings = input.postings.filter(
      (posting) => BigInt(posting.amount) > 0n,
    );
    const debit = postings
      .filter((posting) => posting.direction === LedgerPostingDirection.DEBIT)
      .reduce((sum, posting) => sum + BigInt(posting.amount), 0n);
    const credit = postings
      .filter((posting) => posting.direction === LedgerPostingDirection.CREDIT)
      .reduce((sum, posting) => sum + BigInt(posting.amount), 0n);
    if (debit !== credit || debit <= 0n) {
      throw new ConflictException('Ledger transaction is not balanced');
    }
    const accountIds: string[] = [];
    for (const posting of postings) {
      const account = await tx.ledgerAccount.upsert({
        where: {
          accountType_ownerType_ownerId_currency: {
            accountType: posting.accountType,
            ownerType: posting.ownerType,
            ownerId: posting.ownerId,
            currency: input.currency,
          },
        },
        update: {},
        create: {
          accountType: posting.accountType,
          ownerType: posting.ownerType,
          ownerId: posting.ownerId,
          currency: input.currency,
        },
      });
      accountIds.push(account.id);
    }
    return tx.ledgerTransaction.create({
      data: {
        type: input.type,
        eventKey: input.eventKey,
        currency: input.currency,
        orderId: input.orderId,
        commissionId: input.commissionId,
        payoutId: input.payoutId,
        statementId: input.statementId,
        source: input.source,
        reason: input.reason,
        requestId: this.audit.requestId(),
        postings: {
          create: postings.map((posting, index) => ({
            accountId: accountIds[index],
            direction: posting.direction,
            amountMinor: BigInt(posting.amount),
          })),
        },
      },
    });
  }

  private calculateCommission(amountKopecks: number, bps: number) {
    return this.toLegacyMoneyNumber(
      calculateBpsHalfUp(BigInt(amountKopecks), bps),
    );
  }

  private toLegacyMoneyNumber(value: bigint) {
    if (value > 2_147_483_647n) {
      throw new BadRequestException('Комиссия превышает лимит');
    }
    return Number(value);
  }

  private isAllowedOrderTransition(
    from: OrderStatus,
    to: OrderStatus,
    previousReturned: number,
    nextReturned: number,
  ) {
    if (from === to) {
      return (
        from === OrderStatus.PARTIALLY_RETURNED && nextReturned > previousReturned
      );
    }
    const transitions: Record<OrderStatus, OrderStatus[]> = {
      PENDING: [OrderStatus.PAID, OrderStatus.CANCELLED],
      PAID: [
        OrderStatus.CANCELLED,
        OrderStatus.RETURNED,
        OrderStatus.PARTIALLY_RETURNED,
      ],
      PARTIALLY_RETURNED: [OrderStatus.RETURNED],
      CANCELLED: [],
      RETURNED: [],
    };
    return transitions[from].includes(to);
  }

  private parseDate(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseKopecks(value?: string) {
    if (!value || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : null;
  }

  private parseOptionalKopecks(value?: string) {
    if (!value) return 0;
    return this.parseKopecks(value);
  }

  private parsePositiveBigInt(value: string, field: string) {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new BadRequestException(
        `${field} должен быть положительным целым числом`,
      );
    }
    const parsed = BigInt(value);
    if (parsed > 9_223_372_036_854_775_807n) {
      throw new BadRequestException(`${field} превышает допустимый лимит`);
    }
    return parsed;
  }

  private singleCurrency(currencies: string[]) {
    const unique = [...new Set(currencies)];
    return unique.length === 1 ? unique[0] : unique.length === 0 ? null : 'MULTI';
  }

  private orderDateRange(query: Pick<ListFinanceQueryDto, 'dateFrom' | 'dateTo'>) {
    if (!query.dateFrom && !query.dateTo) return undefined;
    return {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo
        ? { lte: new Date(`${query.dateTo.slice(0, 10)}T23:59:59.999Z`) }
        : {}),
    };
  }

  private async paginateOrders(base: Prisma.OrderWhereInput, query: ListFinanceQueryDto) {
    if (query.offerId && 'brandId' in base) {
      await this.assertOwnedOffer(String(base.brandId), query.offerId);
    }
    const where: Prisma.OrderWhereInput = {
      ...base,
      orderDate: this.orderDateRange(query),
      ...(query.offerId ? { offerId: query.offerId } : {}),
      ...(query.orderStatus ? { status: query.orderStatus } : {}),
      ...(query.attributionSource
        ? { attributionSource: query.attributionSource }
        : {}),
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const [items, totalItems] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          offer: { select: { id: true, title: true } },
          affiliateRelationship: {
            include: { creator: { select: { id: true, displayName: true } } },
          },
          commission: true,
        },
        orderBy: { [query.sortBy ?? 'orderDate']: query.sortDirection ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, pagination: { page, pageSize, totalItems } };
  }

  private async paginateCommissions(
    base: Prisma.CommissionWhereInput,
    query: ListFinanceQueryDto,
  ) {
    const orderFilter: Prisma.OrderWhereInput = {
      orderDate: this.orderDateRange(query),
      ...(query.orderStatus ? { status: query.orderStatus } : {}),
      ...(query.attributionSource
        ? { attributionSource: query.attributionSource }
        : {}),
    };
    const where: Prisma.CommissionWhereInput = {
      AND: [base, { order: orderFilter }],
      ...(query.offerId ? { offerId: query.offerId } : {}),
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const [items, totalItems] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        include: {
          creator: true,
          offer: { select: { id: true, title: true } },
          order: true,
          payout: true,
        },
        orderBy: { createdAt: query.sortDirection ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.commission.count({ where }),
    ]);
    return { items, pagination: { page, pageSize, totalItems } };
  }

  private async paginate(
    model: 'click' | 'ledgerEntry' | 'payout',
    where: object,
    query: ListFinanceQueryDto,
    orderBy: object,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const delegate = this.prisma[model] as any;
    const [items, totalItems] = await Promise.all([
      delegate.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include:
          model === 'click'
            ? { offer: { select: { id: true, title: true } } }
            : model === 'ledgerEntry'
              ? { creator: true, order: true, commission: true, payout: true }
              : { creator: true, commissions: true },
      }),
      delegate.count({ where }),
    ]);
    return { items, pagination: { page, pageSize, totalItems } };
  }

  private presentCreatorOrder(order: any): Record<string, unknown> {
    const {
      brandId: _brandId,
      platformCommissionBps: _platformCommissionBps,
      totalCommissionPoolBps: _totalCommissionPoolBps,
      creatorPoolShareBps: _creatorPoolShareBps,
      platformPoolShareBps: _platformPoolShareBps,
      totalCommissionAmountMinor: _totalCommissionAmountMinor,
      platformCommissionAmountMinor: _platformCommissionAmountMinor,
      commercialTermsVersionNumber: _commercialTermsVersionNumber,
      affiliateCommercialAgreementId: _affiliateCommercialAgreementId,
      commission,
      ...safeOrder
    } = order;
    return {
      ...safeOrder,
      creatorEffectiveBps: order.creatorCommissionBps,
      creatorCommissionAmountMinor: order.creatorCommissionAmountMinor,
      commission: commission
        ? this.presentCreatorCommission(commission)
        : null,
    };
  }

  private presentCreatorCommission(
    commission: any,
  ): Record<string, unknown> {
    const {
      platformAmountKopecks: _platformAmountKopecks,
      platformAmountMinor: _platformAmountMinor,
      totalAmountMinor: _totalAmountMinor,
      debtAmountKopecks: _debtAmountKopecks,
      recoverableAmountMinor: _recoverableAmountMinor,
      hasPostPayoutDebt: _hasPostPayoutDebt,
      creator,
      order,
      payout,
      ...safeCommission
    } = commission;
    return {
      ...safeCommission,
      creatorAmountMinor:
        commission.creatorAmountMinor ??
        BigInt(commission.creatorAmountKopecks),
      offer: commission.offer,
      order: order
        ? this.presentCreatorOrder({ ...order, commission: null })
        : undefined,
      payout: payout
        ? {
            id: payout.id,
            amountMinor: payout.amountKopecks,
            currency: payout.currency,
            status: payout.status,
            createdAt: payout.createdAt,
            paidAt: payout.paidAt,
          }
        : undefined,
    };
  }

  private emptyCreatorAnalytics(creatorId: string, creatorName: string) {
    return {
      creatorId,
      creatorName,
      clicksCount: 0,
      ordersCount: 0,
      paidOrdersCount: 0,
      grossSalesKopecks: 0n,
      cancelledAmountKopecks: 0n,
      returnedAmountKopecks: 0n,
      netSalesKopecks: 0n,
      creatorCommissionKopecks: 0n,
      platformCommissionKopecks: 0n,
      netOrdersCount: 0,
    };
  }

  private finalizeCreatorAnalytics(row: ReturnType<typeof this.emptyCreatorAnalytics>) {
    return {
      ...row,
      averageOrderValueKopecks:
        row.netOrdersCount === 0
          ? 0n
          : (row.netSalesKopecks + BigInt(Math.floor(row.netOrdersCount / 2))) /
            BigInt(row.netOrdersCount),
      conversionRate:
        row.clicksCount === 0
          ? null
          : Number((row.paidOrdersCount / row.clicksCount).toFixed(4)),
    };
  }

  private getPositiveInteger(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private isStage7FinancialActivationEnabled() {
    return (
      this.config.get<string>('STAGE7_FINANCE_ENABLED') === 'true' &&
      this.config.get<string>('STAGE7_FINANCIAL_ACTIVATION_ENABLED') ===
        'true'
    );
  }

  private async getBrand(userId: string, activeBrandId?: string) {
    return this.brands.resolveBrand(userId, activeBrandId);
  }

  private async getCreator(userId: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!creator) throw new ForbiddenException('Профиль креатора не найден');
    return creator;
  }

  private async assertOwnedOffer(brandId: string, offerId: string) {
    const offer = await this.prisma.offer.findFirst({ where: { id: offerId, brandId } });
    if (!offer) throw new ForbiddenException('Нет доступа к офферу');
    return offer;
  }
}
