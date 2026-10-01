import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMISSION_FILTERS,
  matchesCommissionFilter
} from "./commissionFilter.mjs";

test("любая комиссия не ограничивает каталог", () => {
  assert.equal(matchesCommissionFilter(0, COMMISSION_FILTERS.ANY), true);
  assert.equal(matchesCommissionFilter(14.5, COMMISSION_FILTERS.ANY), true);
  assert.equal(matchesCommissionFilter(100, COMMISSION_FILTERS.ANY), true);
});

test("менее 15% включает дробные значения ниже границы", () => {
  assert.equal(matchesCommissionFilter(14, COMMISSION_FILTERS.BELOW_15), true);
  assert.equal(matchesCommissionFilter(14.5, COMMISSION_FILTERS.BELOW_15), true);
  assert.equal(matchesCommissionFilter(14.99, COMMISSION_FILTERS.BELOW_15), true);
  assert.equal(matchesCommissionFilter(15, COMMISSION_FILTERS.BELOW_15), false);
});

test("15% и выше начинается ровно с 15%", () => {
  assert.equal(matchesCommissionFilter(14.99, COMMISSION_FILTERS.AT_LEAST_15), false);
  assert.equal(matchesCommissionFilter(15, COMMISSION_FILTERS.AT_LEAST_15), true);
  assert.equal(matchesCommissionFilter(15.01, COMMISSION_FILTERS.AT_LEAST_15), true);
  assert.equal(matchesCommissionFilter(25, COMMISSION_FILTERS.AT_LEAST_15), true);
});

test("неизвестный фильтр не показывает офферы", () => {
  assert.equal(matchesCommissionFilter(15, "Неизвестный фильтр"), false);
});
