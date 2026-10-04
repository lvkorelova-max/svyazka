import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const loadFinanceBlock = source.slice(source.indexOf("const loadFinance = async"));

test("brand finance keeps overview and statements aligned with Promise.all results", () => {
  assert.match(
    loadFinanceBlock,
    /const \[ordersData, commissionsData, analyticsData, creatorAnalyticsData, overviewData, statementsData\] = await Promise\.all\(\[/
  );
  assert.match(loadFinanceBlock, /api\("\/brand\/finance\/overview"\)/);
  assert.match(loadFinanceBlock, /api\("\/brand\/statements"\)/);
  assert.match(
    loadFinanceBlock,
    /overview: overviewData, statements: statementsData/
  );
});
