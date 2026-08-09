import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("Creator Kit отображает серверное превью изображения с текстовым fallback", () => {
  assert.match(appSource, /previewUrl: asset\.previewUrl \|\| ""/);
  assert.match(appSource, /function AssetPreview\(\{ asset \}\)/);
  assert.match(appSource, /<img src=\{asset\.previewUrl\}/);
  assert.match(appSource, /onError=\{\(\) => setFailed\(true\)\}/);
});

test("миниатюра заполняет рамку без искажения списка материалов", () => {
  assert.match(stylesSource, /\.asset-preview\.has-image\s*\{[^}]*overflow: hidden/s);
  assert.match(stylesSource, /\.asset-preview img\s*\{[^}]*object-fit: cover/s);
});
