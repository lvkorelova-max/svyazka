import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePoolEconomics,
  getApplicationUiState
} from "./financeEconomics.mjs";

test("15% pool показывает креатору 9.75% и платформе 5.25%", () => {
  const result = calculatePoolEconomics(1500, 1_000_000);
  assert.equal(result.creatorEffectiveBps, 975);
  assert.equal(result.platformEffectiveBps, 525);
  assert.equal(result.totalCommissionMinor, 150_000);
  assert.equal(result.creatorAmountMinor, 97_500);
  assert.equal(result.platformAmountMinor, 52_500);
});

test("двухэтапное округление сохраняет точное равенство pool", () => {
  const result = calculatePoolEconomics(1500, 199_900);
  assert.equal(
    result.creatorAmountMinor + result.platformAmountMinor,
    result.totalCommissionMinor
  );
});

test("UI требует действие только при смене коммерческих условий", () => {
  assert.equal(
    getApplicationUiState({
      status: "PENDING",
      termsStatus: "REACCEPTANCE_REQUIRED"
    }),
    "TERMS_CHANGED"
  );
  assert.equal(
    getApplicationUiState({
      status: "PENDING",
      termsStatus: "CURRENT_REACCEPTED"
    }),
    "CREATOR_REACCEPTED"
  );
});
