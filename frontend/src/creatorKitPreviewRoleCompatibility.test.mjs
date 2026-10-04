import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("Creator Kit preview keeps BRAND simulation and routes MANAGER through ordinary preview", () => {
  assert.match(
    source,
    /function BrandCreatorKitManager\(\{\s*offers,\s*relationships,\s*role,/
  );
  assert.match(
    source,
    /<BrandCreatorKitManager offers=\{offers\} relationships=\{relationships\} role=\{role\}/
  );
  assert.match(
    source,
    /if \(role === "manager"\) \{\s*try \{\s*const nextKit = await onLoadPreview\(selectedOffer\.id, previewProduct, \{\s*source: previewSource,\s*affiliateApproved: previewAffiliate === "true"\s*\}\)/
  );
  assert.match(
    source,
    /if \(role === "manager"\)[\s\S]*?return;[\s\S]*?preview-as-creator/
  );
  assert.match(
    source,
    /role === "manager" \? "DIGITAL" : "NOT_GRANTED"/
  );
  assert.match(
    source,
    /role === "manager" \? "false" : "INACTIVE"/
  );
  assert.match(source, /role === "brand" \? \(/);
  assert.match(source, /<option value="DIGITAL">Digital Access<\/option>/);
  assert.match(source, /<option value="PRODUCT">Product Access<\/option>/);
  assert.match(source, /<option value="false">Нет<\/option>/);
  assert.match(source, /<option value="true">Есть<\/option>/);
});

test("ordinary Creator Kit preview maps source, access, and affiliate query parameters", () => {
  assert.match(
    source,
    /const loadCreatorKitPreview = async \(offerId, access = "DIGITAL", options = \{\}\)/
  );
  assert.match(
    source,
    /accessLevel: access\.toUpperCase\(\)/
  );
  assert.match(
    source,
    /source: options\.source === "PUBLISHED" \? "PUBLISHED" : "DRAFT"/
  );
  assert.match(
    source,
    /affiliateApproved: options\.affiliateApproved === false \? "false" : "true"/
  );
  assert.match(
    source,
    /creator-kit\/preview\?\$\{params\.toString\(\)\}/
  );
});
