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
  AttributionSource,
  CommissionStatus,
  LedgerEntryType,
  Order,
  OrderImportAction,
  OrderImportRowStatus,
  OrderImportStatus,
  OrderStatus,
  PayoutStatus,
  Prisma,
} from '@prisma/client';
import { CreatePayoutDto } from './dto/create-payout.dto';
import {
  CreatorAnalyticsQueryDto,
  ListFinanceQueryDto,
} from './dto/list-finance-query.dto';
import { CsvRecord, parseCsv } from './csv';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BrandAccessService } from '../brand-access/brand-access.service';

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
                externalOrderId: row.externalOrderId!,
                orderDate: row.orderDate!,
                amountKopecks: row.amountKopecks!,
                returnedAmountKopecks: row.returnedAmountKopecks ?? 0,
                currency: row.currency!,
                status: row.orderStatus!,
                attributionSource: row.attributionSource!,
                affiliateCode: row.affiliateCode,
                promoCode: row.promoCode,
                clickId: row.clickId,
                creatorCommissionBps: row.creatorCommissionBpsSnapshot!,
                platformCommissionBps: row.platformCommissionBpsSnapshot!,
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
    return this.paginateOrders(
      { affiliateRelationship: { creatorId: creator.id } },
      query,
    );
  }

  async listCreatorCommissions(userId: string, query: ListFinanceQueryDto) {
    const creator = await this.getCreator(userId);
    return this.paginateCommissions({ creatorId: creator.id }, query);
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

  async listAdminCommissions(query: ListFinanceQueryDto) {
    return this.paginateCommissions({}, query);
  }

  async listLedgerEntries(query: ListFinanceQueryDto) {
    return this.paginate('ledgerEntry', {}, query, {
      createdAt: query.sortDirection ?? 'desc',
    });
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
            status: CommissionStatus.AVAILABLE,
            payoutId: null,
            hasPostPayoutDebt: false,
          },
        });
        if (commissions.length !== uniqueIds.length) {
          throw new ConflictException('Часть комиссий уже недоступна для выплаты');
        }
        const creatorIds = new Set(commissions.map((commission) => commission.creatorId));
        if (creatorIds.size !== 1) {
          throw new BadRequestException('Один payout может принадлежать только одному креатору');
        }
        const amount = commissions.reduce(
          (sum, commission) => sum + BigInt(commission.creatorAmountKopecks),
          0n,
        );
        if (amount <= 0n) throw new BadRequestException('Сумма выплаты должна быть больше нуля');
        const payout = await tx.payout.create({
          data: {
            creatorId: commissions[0].creatorId,
            amountKopecks: amount,
            createdByUserId: adminUserId,
            reference: dto.reference?.trim() || null,
          },
        });
        const reserved = await tx.commission.updateMany({
          where: {
            id: { in: uniqueIds },
            status: CommissionStatus.AVAILABLE,
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
            metadata: { amountKopecks: amount.toString(), commissionsCount: uniqueIds.length },
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
          include: { commissions: true },
        });
        if (!payout) throw new NotFoundException('Выплата не найдена');
        if (payout.status === PayoutStatus.PAID) return payout;
        if (payout.status !== PayoutStatus.APPROVED) {
          throw new ConflictException('Сначала подтвердите выплату');
        }
        if (
          payout.commissions.some(
            (commission) =>
              commission.status !== CommissionStatus.AVAILABLE ||
              commission.hasPostPayoutDebt,
          )
        ) {
          throw new ConflictException('Состав выплаты изменился после подтверждения');
        }
        const currentAmount = payout.commissions.reduce(
          (sum, commission) => sum + BigInt(commission.creatorAmountKopecks),
          0n,
        );
        if (currentAmount !== payout.amountKopecks) {
          throw new ConflictException('Сумма выплаты больше не совпадает с комиссиями');
        }
        for (const commission of payout.commissions) {
          await tx.ledgerEntry.upsert({
            where: { eventKey: `payout:${payout.id}:commission:${commission.id}` },
            update: {},
            create: {
              commissionId: commission.id,
              creatorId: commission.creatorId,
              orderId: commission.orderId,
              payoutId: payout.id,
              type: LedgerEntryType.PAYOUT,
              amountKopecks: -commission.creatorAmountKopecks,
              eventKey: `payout:${payout.id}:commission:${commission.id}`,
            },
          });
        }
        await tx.commission.updateMany({
          where: { payoutId: payout.id, status: CommissionStatus.AVAILABLE },
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
            status: CommissionStatus.AVAILABLE,
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

  private async buildPreviewRows(
    brandId: string,
    orderImportId: string,
    records: CsvRecord[],
  ): Promise<Prisma.OrderImportRowCreateManyInput[]> {
    const offers = await this.prisma.offer.findMany({ where: { brandId } });
    const relationships = await this.prisma.affiliateRelationship.findMany({
      where: { offer: { brandId } },
      include: { offer: true },
    });
    const clickIds = records.map((row) => row.click_id).filter(Boolean);
    const clicks = await this.prisma.click.findMany({
      where: { id: { in: clickIds }, offer: { brandId } },
      include: { affiliateRelationship: { include: { offer: true } } },
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

      const bps =
        existing ??
        (offer
          ? {
              creatorCommissionBps: offer.creatorCommissionBps,
              platformCommissionBps: offer.platformCommissionBps,
            }
          : null);
      const commissionBase =
        orderStatus === OrderStatus.CANCELLED || orderStatus === OrderStatus.RETURNED
          ? 0
          : Math.max(0, (amountKopecks ?? 0) - returnedAmountKopecks);
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
        attributionSource: selected?.source ?? AttributionSource.UNATTRIBUTED,
        existingOrderId: existing?.id ?? null,
        creatorCommissionBpsSnapshot: bps?.creatorCommissionBps ?? null,
        platformCommissionBpsSnapshot: bps?.platformCommissionBps ?? null,
        previewCreatorAmountKopecks:
          selected && bps
            ? this.calculateCommission(commissionBase, bps.creatorCommissionBps)
            : 0,
        previewPlatformAmountKopecks:
          selected && bps
            ? this.calculateCommission(commissionBase, bps.platformCommissionBps)
            : 0,
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
  ) {
    if (!order.affiliateRelationshipId) return;
    const relationship = await tx.affiliateRelationship.findUnique({
      where: { id: order.affiliateRelationshipId },
    });
    if (!relationship) throw new ConflictException('Партнёрская связь заказа не найдена');
    const current = await tx.commission.findUnique({ where: { orderId: order.id } });
    const base =
      order.status === OrderStatus.CANCELLED || order.status === OrderStatus.RETURNED
        ? 0
        : order.amountKopecks - order.returnedAmountKopecks;
    const creatorTarget = this.calculateCommission(base, order.creatorCommissionBps);
    const platformTarget = this.calculateCommission(base, order.platformCommissionBps);
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
          status,
          holdUntil: shouldAccrue ? holdUntil : null,
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
      }
      return;
    }

    if (current.status === CommissionStatus.PENDING && shouldAccrue) {
      await tx.commission.update({
        where: { id: current.id },
        data: {
          creatorAmountKopecks: creatorTarget,
          platformAmountKopecks: platformTarget,
          status: CommissionStatus.HOLD,
          holdUntil,
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
        status:
          current.status === CommissionStatus.PAID
            ? CommissionStatus.PAID
            : creatorTarget === 0
              ? CommissionStatus.REVERSED
              : current.status,
        debtAmountKopecks: postPayoutDebt,
        hasPostPayoutDebt: postPayoutDebt > 0,
      },
    });
  }

  private calculateCommission(amountKopecks: number, bps: number) {
    const result = (BigInt(amountKopecks) * BigInt(bps) + 5_000n) / 10_000n;
    if (result > 2_147_483_647n) throw new BadRequestException('Комиссия превышает лимит');
    return Number(result);
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
