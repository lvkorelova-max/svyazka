export const COMMISSION_FILTERS = {
  ANY: "Любая комиссия",
  BELOW_15: "Менее 15%",
  AT_LEAST_15: "15% и выше"
};

export function matchesCommissionFilter(commissionPercent, filter) {
  if (filter === COMMISSION_FILTERS.ANY) return true;
  if (filter === COMMISSION_FILTERS.BELOW_15) return commissionPercent < 15;
  if (filter === COMMISSION_FILTERS.AT_LEAST_15) return commissionPercent >= 15;
  return false;
}
