import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("App passes every AdminDashboard finance callback declared and used by the dashboard", () => {
  assert.match(
    appSource,
    /function AdminDashboard\([^)]*issueStatement[^)]*recordBrandPayment[^)]*resolveDispute[^)]*runReconciliation[^)]*\)/
  );
  assert.match(appSource, /onClick=\{runReconciliation\}/);
  assert.match(appSource, /onClick=\{\(\) => issueStatement\(statementForm\)\}/);
  assert.match(appSource, /onClick=\{\(\) => recordBrandPayment\(statement\)\}/);
  assert.match(appSource, /onClick=\{\(\) => resolveDispute\(/);

  const adminCall = appSource.match(/<AdminDashboard\b[^>]*\/>/)?.[0] || "";
  for (const prop of [
    "issueStatement",
    "recordBrandPayment",
    "resolveDispute",
    "runReconciliation"
  ]) {
    assert.match(adminCall, new RegExp(`${prop}={${prop}}`));
  }
});
