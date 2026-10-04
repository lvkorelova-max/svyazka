import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("Offers page imports its commission filter dependency", () => {
  assert.match(
    source,
    /import\s*\{\s*COMMISSION_FILTERS,\s*matchesCommissionFilter\s*\}\s*from\s*["']\.\/commissionFilter\.mjs["'];/
  );
  assert.match(source, /useState\(COMMISSION_FILTERS\.ANY\)/);
  assert.match(source, /matchesCommissionFilter\(offer\.commission, commission\)/);
  assert.match(source, /Object\.values\(COMMISSION_FILTERS\)/);
  assert.doesNotMatch(source, /const\s+COMMISSION_FILTERS\s*=/);
  assert.doesNotMatch(source, /function\s+matchesCommissionFilter\s*\(/);
});
