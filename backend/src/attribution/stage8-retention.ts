import { Prisma, PrismaClient } from "@prisma/client";

const redactedPayload = { redactedByRetention: true };
export type RetentionMode = "preview" | "apply";

function monthsBefore(now: Date, months: number) {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const endOfMonth = new Date(cutoff);
  endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);
  cutoff.setUTCDate(Math.min(day, endOfMonth.getUTCDate()));
  return cutoff;
}

export async function runStage8Retention(prisma: PrismaClient, mode: RetentionMode, now = new Date()) {
  const trackingBefore = monthsBefore(now, 13);
  const payloadBefore = monthsBefore(now, 24);
  const tracking = { receivedAt: { lt: trackingBefore } };
  const orders: Prisma.Stage8OrderEventWhereInput = {
    receivedAt: { lt: payloadBefore },
    processingStatus: "PROCESSED",
    NOT: { payload: { equals: redactedPayload } },
    OR: [
      { orderId: null },
      { order: { is: {
        disputes: { none: { status: "OPEN" } },
        attributionExceptions: { none: { status: { in: ["OPEN", "IN_REVIEW"] } } },
      } } },
    ],
  };
  if (mode === "preview") {
    const [trackingEventsEligible, orderPayloadsEligible] = await prisma.$transaction([
      prisma.trackingEvent.count({ where: tracking }),
      prisma.stage8OrderEvent.count({ where: orders }),
    ]);
    return { mode, trackingBefore, payloadBefore, trackingEventsEligible, orderPayloadsEligible };
  }
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(8221, 1324) AS acquired
    `;
    if (!lock.acquired) return { mode, trackingEventsDeleted: 0, orderPayloadsSanitized: 0, skipped: true };
    const deleted = await tx.trackingEvent.deleteMany({ where: tracking });
    const sanitized = await tx.stage8OrderEvent.updateMany({
      where: orders,
      data: { payload: redactedPayload },
    });
    return { mode, trackingEventsDeleted: deleted.count, orderPayloadsSanitized: sanitized.count, skipped: false };
  }, { timeout: 60_000 });
}
