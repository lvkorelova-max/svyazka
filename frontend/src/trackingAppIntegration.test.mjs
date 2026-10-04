import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("reachable Tracking surface uses truthful Stage 8 wording and preserves CSV wiring", () => {
  assert.match(source, /function SalesTrackingLive\(\{ role, notify, preview, onUpload, onConfirm \}\)/);
  assert.match(source, /<SalesTrackingLive role=\{role\}/);
  assert.doesNotMatch(source, /Рабочий способ этапа 4/);
  assert.match(source, /api\("\/brand\/order-imports", \{ method: "POST", body: formData \}\)/);
  assert.match(source, /api\(`\/brand\/order-imports\/\$\{importId\}\/confirm`, \{ method: "POST" \}\)/);
  assert.match(source, /role === "brand" \? "Настройте tracker для сайта или загрузите подтверждённые заказы через CSV\./);
  assert.match(source, /: "Загрузите подтверждённые заказы через CSV\. Сервер проверяет данные до их обработки\."/);
  assert.match(source, /role === "brand" \? "02" : "01"/);
  assert.match(source, /role === "brand" \? "03" : "02"/);
});

test("only BRAND sees real tracker installation controls", () => {
  const liveStart = source.indexOf("function SalesTrackingLive");
  const liveEnd = source.indexOf("function BrandCreatorKitManager");
  const liveSource = source.slice(liveStart, liveEnd);
  assert.match(source, /\{role === "brand" && \(/);
  assert.match(liveSource, /\/brand\/tracker-installations/);
  assert.match(liveSource, /api\("\/brand\/tracker-installations", \{\s*method: "POST"/);
  assert.match(liveSource, /api\(`\/brand\/tracker-installations\/\$\{installationId\}\/activate`, \{ method: "POST" \}\)/);
  assert.match(liveSource, /api\(`\/brand\/tracker-installations\/\$\{installationId\}\/rotate-secret`, \{ method: "POST" \}\)/);
  assert.match(liveSource, /const \{ webhookSecret, \.\.\.installation \} = created/);
  assert.match(liveSource, /setTrackerSecret\(webhookSecret\)/);
  assert.match(liveSource, /setTrackerSecret\(rotated\.webhookSecret\)/);
  assert.match(liveSource, /setInstallations\(\(current\) => \[installation, \.\.\.current\]\)/);
  assert.doesNotMatch(liveSource, /setInstallations\(\(current\) => \[created, \.\.\.current\]\)/);
  assert.doesNotMatch(liveSource, /localStorage|sessionStorage/);
  assert.match(liveSource, /trackerScriptSnippet\(installation\.publicKey, getPublicBackendOrigin\(\)\)/);
  assert.match(source, /getPublicBackendOrigin/);
  assert.doesNotMatch(liveSource, /sk_live_|br_lunea_4821|track\.sviazka\.ru\/conversion/);
});
