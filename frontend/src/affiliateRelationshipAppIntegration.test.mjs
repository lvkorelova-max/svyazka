import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const dashboardStart = source.indexOf("function BrandDashboard");
const dashboardEnd = source.indexOf("function CreateOfferPage");
const dashboardSource = source.slice(dashboardStart, dashboardEnd);
const appStart = source.indexOf("function App()");
const appSource = source.slice(appStart);

test("BRAND and MANAGER consume and copy backend affiliate relationship values", () => {
  assert.match(dashboardSource, /\{relationship\.affiliateUrl\}/);
  assert.match(
    dashboardSource,
    /copyValue\(relationship\.affiliateUrl, "Партнёрская ссылка скопирована"\)/,
  );
  assert.match(dashboardSource, /<strong>\{relationship\.promoCode\}<\/strong>/);
  assert.match(
    dashboardSource,
    /copyValue\(relationship\.promoCode, "Промокод скопирован"\)/,
  );
  assert.doesNotMatch(dashboardSource, /\/go\/\$\{relationship\.affiliateCode\}/);
});

test("only BRAND receives promo replacement and Tilda provisioning controls", () => {
  assert.match(
    dashboardSource,
    /role === "brand" && relationship\.promoCodeDetails\?\.editable/,
  );
  assert.match(
    dashboardSource,
    /role === "brand" && relationship\.promoCodeDetails\?\.status === "PENDING_PROVISIONING"/,
  );
  assert.match(
    appSource,
    /api\(`\/brand\/affiliate-relationships\/\$\{relationshipId\}\/promo-code`, \{\s*method: "PATCH"/,
  );
  assert.match(
    appSource,
    /api\(`\/brand\/affiliate-relationships\/\$\{relationshipId\}\/promo-code\/confirm-tilda`, \{ method: "POST" \}\)/,
  );
  const brandCall = appSource.match(
    /page === "brand" && role === "brand" && <BrandDashboard[^]*?\/>/,
  )?.[0] ?? "";
  const managerCall = appSource.match(
    /page === "brand" && role === "manager" && activeBrandId && <BrandDashboard[^]*?\/>/,
  )?.[0] ?? "";
  assert.match(brandCall, /replacePromoCode=\{replaceCreatorPromoCode\}/);
  assert.match(brandCall, /confirmPromoCode=\{confirmCreatorPromoCode\}/);
  assert.doesNotMatch(managerCall, /replacePromoCode=|confirmPromoCode=/);
});

test("manager active-brand filters and responsibility wiring remain intact", () => {
  assert.match(dashboardSource, /relationshipFilter === "mine"/);
  assert.match(dashboardSource, /relationshipFilter === "unassigned"/);
  assert.match(
    dashboardSource,
    /onChangeRelationshipManager\(relationship\.id, managerId\)/,
  );
  assert.match(
    appSource,
    /api\(`\/brand\/affiliate-relationships\/\$\{relationshipId\}\/responsibility`, \{/,
  );
  assert.match(
    appSource,
    /role === "manager" && activeBrandId && <BrandDashboard/,
  );
});
