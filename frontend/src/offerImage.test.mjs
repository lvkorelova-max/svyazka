import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_IMAGE_MAX_BYTES,
  getOfferPreviewImage,
  validateOfferImageFile
} from "./offerImage.mjs";

test("принимает локальные JPG, PNG и WebP в пределах 25 МБ", () => {
  assert.equal(
    validateOfferImageFile({ name: "product.JPG", type: "image/jpeg", size: 1024 }),
    ""
  );
  assert.equal(
    validateOfferImageFile({
      name: "product.png",
      type: "image/png",
      size: OFFER_IMAGE_MAX_BYTES
    }),
    ""
  );
  assert.equal(
    validateOfferImageFile({ name: "product.webp", type: "image/webp", size: 2048 }),
    ""
  );
});

test("отклоняет несовпадающие типы, SVG, пустые и слишком большие изображения", () => {
  assert.match(
    validateOfferImageFile({ name: "product.png", type: "image/jpeg", size: 1024 }),
    /JPG, PNG и WebP/
  );
  assert.match(
    validateOfferImageFile({ name: "product.svg", type: "image/svg+xml", size: 1024 }),
    /JPG, PNG и WebP/
  );
  assert.match(
    validateOfferImageFile({ name: "product.webp", type: "image/webp", size: 0 }),
    /пуст/
  );
  assert.match(
    validateOfferImageFile({
      name: "product.webp",
      type: "image/webp",
      size: OFFER_IMAGE_MAX_BYTES + 1
    }),
    /25 МБ/
  );
});

test("preview предпочитает локальный файл, затем сохранённое изображение и fallback", () => {
  assert.equal(
    getOfferPreviewImage(
      "blob:local-preview",
      "https://files.test/saved",
      "fallback.jpg"
    ),
    "blob:local-preview"
  );
  assert.equal(
    getOfferPreviewImage("", "https://files.test/saved", "fallback.jpg"),
    "https://files.test/saved"
  );
  assert.equal(getOfferPreviewImage("", "", "fallback.jpg"), "fallback.jpg");
});
