import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("App.jsx imports the finance calculator used by the offer form", () => {
  assert.match(
    appSource,
    /import \{ calculatePoolEconomics \} from "\.\/financeEconomics\.mjs";/
  );
  assert.match(appSource, /calculatePoolEconomics\(/);
});
