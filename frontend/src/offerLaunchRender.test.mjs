import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

test("renders offer launch review with the application's actual React hook imports", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const reactImport = source.match(/^import React,.*from "react";$/m)?.[0];
  assert.ok(reactImport);
  const start = source.indexOf("function OfferLaunchReview(");
  const end = source.indexOf("\nfunction App()", start);
  assert.ok(start > 0 && end > start);
  const isolated = reactImport + "\n" + source.slice(start, end) + "\nmodule.exports = OfferLaunchReview;";
  const { code } = transformSync(isolated, { loader: "jsx", format: "cjs", target: "node22" });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(createRequire(import.meta.url), module, module.exports);
  const markup = renderToStaticMarkup(React.createElement(module.exports, {
    review: {
      title: "Проверка запуска", document: { url: "/legal/brand-offer-archive/test/02_brand_offer.html", revision: "test" },
      card: { version: 1, currency: "RUB", calculationPolicy: "POOL_65_35_V1", totalCommissionPoolBps: 1500,
        creatorPoolShareBps: 6500, platformPoolShareBps: 3500, minimumPayoutMinor: "0",
        example: { base: "100000", creator: "9750", platform: "5250" } },
    },
    onClose() {}, onAccept() {},
  }));
  assert.match(markup, /Условия запуска оффера/);
  assert.match(markup, /brand-offer-archive\/test\/02_brand_offer.html/);
  assert.match(markup, /disabled=""/);
  assert.doesNotMatch(markup, /checked=""/);
});
