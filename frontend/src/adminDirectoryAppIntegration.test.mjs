import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("App.jsx imports every admin directory helper used by the Admin dashboard", () => {
  assert.match(
    appSource,
    /import\s*\{\s*countActiveApplications,\s*getAdminApplicationStatus,\s*getAdminCreatorStatus\s*\}\s*from "\.\/adminDirectory\.mjs";/
  );
  assert.match(appSource, /countActiveApplications\(/);
  assert.match(appSource, /getAdminApplicationStatus\(/);
  assert.match(appSource, /getAdminCreatorStatus\(/);
});
