import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { suggestCreatorPromoCode } from "./promoCode.mjs";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("approval UI suggests a human-readable code and sends the edited initial code", () => {
  assert.equal(suggestCreatorPromoCode("Пеня Петунин"), "PETUNIN");
  assert.equal(suggestCreatorPromoCode("Ada Lovelace"), "LOVELACE");
  assert.match(source, /suggestCreatorPromoCode\(application\.creator\.displayName\)/);
  assert.match(
    source,
    /updateApplication\(application\.id, "approve", approvalPromoDrafts\[application\.id\]/,
  );
  assert.match(
    source,
    /action === "approve" && promoCode !== undefined[\s\S]*JSON\.stringify\(\{ promoCode \}\)/,
  );
  assert.match(source, /Этот код будет передан креатору/);
});
