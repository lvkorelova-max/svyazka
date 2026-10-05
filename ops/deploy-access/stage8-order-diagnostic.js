const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const brandName = process.env.SVYAZKA_DIAG_BRAND;
const from = new Date(process.env.SVYAZKA_DIAG_FROM);
const to = new Date(process.env.SVYAZKA_DIAG_TO);
const LIMIT = 200;

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function stageFor(row) {
  if (!row.event) {
    if (!row.order) {
      return row.clickSessionFound
        ? "CLICK_SESSION_WITHOUT_ORDER_EVENT"
        : "NO_CLICK_SESSION_OR_ORDER_EVENT";
    }
    const attributionStatus = row.order.attributionResult?.status;
    if (!attributionStatus || ["UNATTRIBUTED", "REVIEW_REQUIRED", "PENDING"].includes(attributionStatus)) {
      return "CANONICAL_ORDER_UNATTRIBUTED_OR_REVIEW_REQUIRED";
    }
    if (row.order.financialHandoffStatus !== "ACKNOWLEDGED" || !row.order.commission) {
      return "ATTRIBUTION_EXISTS_FINANCE_HANDOFF_INCOMPLETE";
    }
    return "ORDER_ATTRIBUTED_FINANCE_ACKNOWLEDGED_UI_PROJECTION_CANDIDATE";
  }
  if (!row.event.order) {
    return ["REJECTED", "DEAD_LETTER", "RETRY_PENDING", "CONFLICT"].includes(
      row.event.processingStatus,
    )
      ? "ORDER_EVENT_PROCESSING_FAILED_OR_REJECTED"
      : "ORDER_EVENT_WITHOUT_CANONICAL_ORDER";
  }
  const attributionStatus = row.event.order.currentAttributionResult?.status;
  if (!attributionStatus || ["UNATTRIBUTED", "REVIEW_REQUIRED", "PENDING"].includes(attributionStatus)) {
    return "CANONICAL_ORDER_UNATTRIBUTED_OR_REVIEW_REQUIRED";
  }
  if (
    row.event.order.financialHandoffStatus !== "ACKNOWLEDGED" ||
    !row.event.order.commission
  ) {
    return "ATTRIBUTION_EXISTS_FINANCE_HANDOFF_INCOMPLETE";
  }
  return "ORDER_ATTRIBUTED_FINANCE_ACKNOWLEDGED_UI_PROJECTION_CANDIDATE";
}

(async () => {
  try {
    const brands = await prisma.brandProfile.findMany({
      where: { brandName: { equals: brandName, mode: "insensitive" } },
      select: { id: true, brandName: true, timezone: true },
      take: LIMIT,
    });
    if (brands.length === 0) {
      console.log(JSON.stringify({
        status: "BRAND_NOT_FOUND",
        brandName,
        fromUtc: process.env.SVYAZKA_DIAG_FROM,
        toUtc: process.env.SVYAZKA_DIAG_TO,
      }));
      return;
    }
    if (brands.length > 1) {
      const candidates = await Promise.all(
        brands.map(async (candidate) => {
          const [integration, clickSessionCount, orderEventCount, canonicalOrderCount] =
            await Promise.all([
              prisma.tildaIntegration.findUnique({
                where: { brandId: candidate.id },
                select: {
                  id: true,
                  status: true,
                  lastWebhookAt: true,
                  lastOrderReceivedAt: true,
                  lastPaidOrderAt: true,
                  lastErrorCode: true,
                  lastErrorAt: true,
                  trackerInstallation: {
                    select: {
                      id: true,
                      status: true,
                      healthStatus: true,
                      lastEventAt: true,
                      lastWebhookAt: true,
                    },
                  },
                },
              }),
              prisma.clickSession.count({
                where: {
                  offer: { brandId: candidate.id },
                  OR: [
                    { firstClickedAt: { gte: from, lt: to } },
                    { lastSeenAt: { gte: from, lt: to } },
                  ],
                },
              }),
              prisma.stage8OrderEvent.count({
                where: {
                  brandId: candidate.id,
                  OR: [
                    { occurredAt: { gte: from, lt: to } },
                    { receivedAt: { gte: from, lt: to } },
                    { orderCreatedAt: { gte: from, lt: to } },
                  ],
                },
              }),
              prisma.order.count({
                where: { brandId: candidate.id, orderDate: { gte: from, lt: to } },
              }),
            ]);
          return {
            id: candidate.id,
            brandName: candidate.brandName,
            timezone: candidate.timezone,
            tildaIntegration: integration
              ? {
                  id: integration.id,
                  status: integration.status,
                  lastWebhookAt: iso(integration.lastWebhookAt),
                  lastOrderReceivedAt: iso(integration.lastOrderReceivedAt),
                  lastPaidOrderAt: iso(integration.lastPaidOrderAt),
                  lastErrorCode: integration.lastErrorCode,
                  lastErrorAt: iso(integration.lastErrorAt),
                  trackerInstallation: integration.trackerInstallation
                    ? {
                        id: integration.trackerInstallation.id,
                        status: integration.trackerInstallation.status,
                        healthStatus: integration.trackerInstallation.healthStatus,
                        lastEventAt: iso(integration.trackerInstallation.lastEventAt),
                        lastWebhookAt: iso(integration.trackerInstallation.lastWebhookAt),
                      }
                    : null,
                }
              : null,
            activity: {
              clickSessionCount,
              orderEventCount,
              canonicalOrderCount,
              hasActivity:
                clickSessionCount > 0 || orderEventCount > 0 || canonicalOrderCount > 0,
            },
          };
        }),
      );
      console.log(JSON.stringify({
        status: "BRAND_AMBIGUOUS",
        matchCount: brands.length,
        truncated: brands.length === LIMIT,
        candidates,
        fromUtc: process.env.SVYAZKA_DIAG_FROM,
        toUtc: process.env.SVYAZKA_DIAG_TO,
      }));
      return;
    }
    const brand = brands[0];

    const integration = await prisma.tildaIntegration.findUnique({
      where: { brandId: brand.id },
      select: {
        id: true,
        status: true,
        lastWebhookAt: true,
        lastWebhookTestAt: true,
        lastOrderReceivedAt: true,
        lastPaymentCheckAt: true,
        lastPaidOrderAt: true,
        lastErrorCode: true,
        lastErrorAt: true,
        trackerInstallation: {
          select: { id: true, status: true, healthStatus: true, lastEventAt: true, lastWebhookAt: true },
        },
      },
    });

    const sessions = await prisma.clickSession.findMany({
      where: {
        offer: { brandId: brand.id },
        OR: [
          { firstClickedAt: { gte: from, lt: to } },
          { lastSeenAt: { gte: from, lt: to } },
        ],
      },
      select: {
        id: true,
        publicAttributionId: true,
        firstClickedAt: true,
        lastSeenAt: true,
        expiresAt: true,
        status: true,
        creatorId: true,
        offerId: true,
        affiliateRelationshipId: true,
      },
      orderBy: { firstClickedAt: "asc" },
      take: LIMIT,
    });
    const sessionsByAttributionId = new Map(
      sessions.map((session) => [session.publicAttributionId, session]),
    );

    const events = await prisma.stage8OrderEvent.findMany({
      where: {
        brandId: brand.id,
        OR: [
          { occurredAt: { gte: from, lt: to } },
          { receivedAt: { gte: from, lt: to } },
          { orderCreatedAt: { gte: from, lt: to } },
        ],
      },
      select: {
        id: true,
        source: true,
        sourceNamespace: true,
        externalEventId: true,
        externalOrderId: true,
        canonicalOrderKey: true,
        eventType: true,
        occurredAt: true,
        receivedAt: true,
        processingStatus: true,
        lastErrorCode: true,
        attributionId: true,
        clickIdHint: true,
        creatorLinkCode: true,
        promoCode: true,
        order: {
          select: {
            id: true,
            externalOrderId: true,
            orderDate: true,
            amountMinor: true,
            currency: true,
            status: true,
            attributionSource: true,
            attributionIdentifier: true,
            affiliateRelationshipId: true,
            creatorId: true,
            offerId: true,
            financialHandoffStatus: true,
            currentAttributionResult: {
              select: {
                id: true,
                status: true,
                confidenceLevel: true,
                confidenceScore: true,
                reasonCodes: true,
                attributedAt: true,
                creatorId: true,
                affiliateRelationshipId: true,
              },
            },
            commission: {
              select: { id: true, status: true, creatorAmountMinor: true, platformAmountMinor: true },
            },
          },
        },
        tildaPaymentProbe: {
          select: {
            status: true,
            attemptCount: true,
            paidAt: true,
            transactionId: true,
            lastErrorCode: true,
          },
        },
      },
      orderBy: { occurredAt: "asc" },
      take: LIMIT,
    });
    const orders = await prisma.order.findMany({
      where: { brandId: brand.id, orderDate: { gte: from, lt: to } },
      select: {
        id: true,
        externalOrderId: true,
        orderDate: true,
        amountMinor: true,
        currency: true,
        status: true,
        attributionSource: true,
        attributionIdentifier: true,
        affiliateRelationshipId: true,
        creatorId: true,
        offerId: true,
        financialHandoffStatus: true,
        currentAttributionResult: {
          select: {
            id: true,
            status: true,
            confidenceLevel: true,
            confidenceScore: true,
            reasonCodes: true,
            attributedAt: true,
            creatorId: true,
            affiliateRelationshipId: true,
          },
        },
        commission: {
          select: { id: true, status: true, creatorAmountMinor: true, platformAmountMinor: true },
        },
      },
      orderBy: { orderDate: "asc" },
      take: LIMIT,
    });
    const eventOrderIds = new Set(events.map((event) => event.order?.id).filter(Boolean));
    const orderIds = [
      ...new Set([
        ...orders.map((order) => order.id),
        ...events.map((event) => event.order?.id).filter(Boolean),
      ]),
    ];
    const [exceptions, timeline, outboxEvents] = await Promise.all([
      prisma.attributionException.findMany({
        where: { brandId: brand.id, orderId: { in: orderIds } },
        select: { orderId: true, type: true, status: true, reasonCodes: true },
        take: LIMIT,
      }),
      prisma.orderTimelineEvent.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, eventType: true, occurredAt: true },
        orderBy: { occurredAt: "asc" },
        take: LIMIT,
      }),
      prisma.stage8OutboxEvent.findMany({
        where: {
          aggregateType: "Order",
          aggregateId: { in: orderIds },
        },
        select: {
          aggregateId: true,
          eventType: true,
          status: true,
          attemptCount: true,
          nextAttemptAt: true,
          processedAt: true,
          lastErrorCode: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: LIMIT,
      }),
    ]);
    const exceptionsByOrder = new Map();
    for (const exception of exceptions) {
      const list = exceptionsByOrder.get(exception.orderId) ?? [];
      list.push(exception);
      exceptionsByOrder.set(exception.orderId, list);
    }
    const timelineByOrder = new Map();
    for (const item of timeline) {
      const list = timelineByOrder.get(item.orderId) ?? [];
      list.push({ eventType: item.eventType, occurredAt: iso(item.occurredAt) });
      timelineByOrder.set(item.orderId, list);
    }
    const outboxByOrder = new Map();
    for (const item of outboxEvents) {
      const list = outboxByOrder.get(item.aggregateId) ?? [];
      list.push({
        eventType: item.eventType,
        status: item.status,
        attemptCount: item.attemptCount,
        nextAttemptAt: iso(item.nextAttemptAt),
        processedAt: iso(item.processedAt),
        lastErrorCode: item.lastErrorCode,
        createdAt: iso(item.createdAt),
      });
      outboxByOrder.set(item.aggregateId, list);
    }

    const rows = events.map((event) => {
      const clickSession =
        (event.attributionId && sessionsByAttributionId.get(event.attributionId)) ||
        null;
      const row = {
        externalOrderId: event.externalOrderId,
        event: {
          id: event.id,
          source: event.source,
          sourceNamespace: event.sourceNamespace,
          externalEventId: event.externalEventId,
          eventType: event.eventType,
          occurredAt: iso(event.occurredAt),
          receivedAt: iso(event.receivedAt),
          processingStatus: event.processingStatus,
          lastErrorCode: event.lastErrorCode,
          attributionIdPresent: Boolean(event.attributionId),
          clickIdHintPresent: Boolean(event.clickIdHint),
          creatorLinkCodePresent: Boolean(event.creatorLinkCode),
          promoCodePresent: Boolean(event.promoCode),
          tildaPaymentProbe: event.tildaPaymentProbe
            ? {
                status: event.tildaPaymentProbe.status,
                attemptCount: event.tildaPaymentProbe.attemptCount,
                paidAt: iso(event.tildaPaymentProbe.paidAt),
                transactionIdPresent: Boolean(event.tildaPaymentProbe.transactionId),
                lastErrorCode: event.tildaPaymentProbe.lastErrorCode,
              }
            : null,
        },
        clickSessionFound: Boolean(clickSession),
        clickSession: clickSession
          ? {
              id: clickSession.id,
              firstClickedAt: iso(clickSession.firstClickedAt),
              lastSeenAt: iso(clickSession.lastSeenAt),
              expiresAt: iso(clickSession.expiresAt),
              status: clickSession.status,
              creatorId: clickSession.creatorId,
              offerId: clickSession.offerId,
              affiliateRelationshipId: clickSession.affiliateRelationshipId,
            }
          : null,
        order: event.order
          ? {
              id: event.order.id,
              externalOrderId: event.order.externalOrderId,
              orderDate: iso(event.order.orderDate),
              amountMinor: event.order.amountMinor?.toString() ?? null,
              currency: event.order.currency,
              status: event.order.status,
              attributionSource: event.order.attributionSource,
              attributionIdentifier: event.order.attributionIdentifier,
              affiliateRelationshipId: event.order.affiliateRelationshipId,
              creatorId: event.order.creatorId,
              offerId: event.order.offerId,
              financialHandoffStatus: event.order.financialHandoffStatus,
              attributionResult: event.order.currentAttributionResult
                ? {
                    id: event.order.currentAttributionResult.id,
                    status: event.order.currentAttributionResult.status,
                    confidenceLevel: event.order.currentAttributionResult.confidenceLevel,
                    confidenceScore: event.order.currentAttributionResult.confidenceScore,
                    reasonCodes: event.order.currentAttributionResult.reasonCodes,
                    attributedAt: iso(event.order.currentAttributionResult.attributedAt),
                    creatorId: event.order.currentAttributionResult.creatorId,
                    affiliateRelationshipId: event.order.currentAttributionResult.affiliateRelationshipId,
                  }
                : null,
              commission: event.order.commission
                ? {
                    id: event.order.commission.id,
                    status: event.order.commission.status,
                    creatorAmountMinor: event.order.commission.creatorAmountMinor?.toString() ?? null,
                    platformAmountMinor: event.order.commission.platformAmountMinor?.toString() ?? null,
                  }
                : null,
              exceptions: exceptionsByOrder.get(event.order.id) ?? [],
              timeline: timelineByOrder.get(event.order.id) ?? [],
            }
          : null,
      };
      return { ...row, classification: stageFor(row) };
    });
    const eventAttributionIds = new Set(
      events.map((event) => event.attributionId).filter(Boolean),
    );
    for (const session of sessions) {
      if (eventAttributionIds.has(session.publicAttributionId)) continue;
      const row = {
        externalOrderId: null,
        event: null,
        clickSessionFound: true,
        clickSession: {
          id: session.id,
          firstClickedAt: iso(session.firstClickedAt),
          lastSeenAt: iso(session.lastSeenAt),
          expiresAt: iso(session.expiresAt),
          status: session.status,
          creatorId: session.creatorId,
          offerId: session.offerId,
          affiliateRelationshipId: session.affiliateRelationshipId,
        },
        order: null,
      };
      rows.push({ ...row, classification: stageFor(row) });
    }
    function presentOrder(order) {
      return {
        id: order.id,
        externalOrderId: order.externalOrderId,
        orderDate: iso(order.orderDate),
        amountMinor: order.amountMinor?.toString() ?? null,
        currency: order.currency,
        status: order.status,
        attributionSource: order.attributionSource,
        attributionIdentifier: order.attributionIdentifier,
        affiliateRelationshipId: order.affiliateRelationshipId,
        creatorId: order.creatorId,
        offerId: order.offerId,
        financialHandoffStatus: order.financialHandoffStatus,
        attributionResult: order.currentAttributionResult
          ? {
              id: order.currentAttributionResult.id,
              status: order.currentAttributionResult.status,
              confidenceLevel: order.currentAttributionResult.confidenceLevel,
              confidenceScore: order.currentAttributionResult.confidenceScore,
              reasonCodes: order.currentAttributionResult.reasonCodes,
              attributedAt: iso(order.currentAttributionResult.attributedAt),
              creatorId: order.currentAttributionResult.creatorId,
              affiliateRelationshipId: order.currentAttributionResult.affiliateRelationshipId,
            }
          : null,
        commission: order.commission
          ? {
              id: order.commission.id,
              status: order.commission.status,
              creatorAmountMinor: order.commission.creatorAmountMinor?.toString() ?? null,
              platformAmountMinor: order.commission.platformAmountMinor?.toString() ?? null,
            }
          : null,
        exceptions: exceptionsByOrder.get(order.id) ?? [],
        timeline: timelineByOrder.get(order.id) ?? [],
        outbox: outboxByOrder.get(order.id) ?? [],
      };
    }
    for (const order of orders) {
      if (eventOrderIds.has(order.id)) continue;
      const row = {
        externalOrderId: order.externalOrderId,
        event: null,
        clickSessionFound: false,
        clickSession: null,
        order: presentOrder(order),
      };
      rows.push({ ...row, classification: stageFor(row) });
    }
    rows.sort((left, right) =>
      String(left.externalOrderId).localeCompare(String(right.externalOrderId)),
    );

    console.log(JSON.stringify({
      status: "OK",
      brand: { id: brand.id, brandName: brand.brandName, timezone: brand.timezone },
      range: {
        fromUtc: process.env.SVYAZKA_DIAG_FROM,
        toUtc: process.env.SVYAZKA_DIAG_TO,
        semantics: "half_open_utc_[from,to)",
      },
      tildaIntegration: integration
        ? {
            id: integration.id,
            status: integration.status,
            lastWebhookAt: iso(integration.lastWebhookAt),
            lastWebhookTestAt: iso(integration.lastWebhookTestAt),
            lastOrderReceivedAt: iso(integration.lastOrderReceivedAt),
            lastPaymentCheckAt: iso(integration.lastPaymentCheckAt),
            lastPaidOrderAt: iso(integration.lastPaidOrderAt),
            lastErrorCode: integration.lastErrorCode,
            lastErrorAt: iso(integration.lastErrorAt),
            trackerInstallation: integration.trackerInstallation,
          }
        : null,
      clickSessions: {
        count: sessions.length,
        items: sessions.map((session) => ({
          id: session.id,
          firstClickedAt: iso(session.firstClickedAt),
          lastSeenAt: iso(session.lastSeenAt),
          expiresAt: iso(session.expiresAt),
          status: session.status,
          creatorId: session.creatorId,
          offerId: session.offerId,
          affiliateRelationshipId: session.affiliateRelationshipId,
        })),
      },
      events: rows,
      summary: {
        eventCount: events.length,
        canonicalOrderCount: orders.length,
        attributedOrderCount: orders.filter(
          (order) => order.currentAttributionResult?.status === "AUTO_ATTRIBUTED",
        ).length,
        financeAcknowledgedCount: orders.filter(
          (order) => order.financialHandoffStatus === "ACKNOWLEDGED",
        ).length,
      },
    }));
  } finally {
    await prisma.$disconnect();
  }
})().catch(() => {
  process.exitCode = 1;
});
