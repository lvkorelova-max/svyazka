import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("объясняет, что список материалов доступен после сохранения оффера", () => {
  assert.match(
    source,
    /Какие материалы можно добавить после сохранения оффера/
  );
  assert.match(
    source,
    /Карточки ниже показывают доступные типы материалов/
  );
});

test("кнопка сохраняет оффер и открывает его Creator Kit", () => {
  assert.match(source, /Сохранить и перейти в Creator Kit/);
  assert.match(source, /submitOffer\(false, "creatorKit"\)/);
  assert.match(source, /brandTab: "creatorKit"/);
  assert.match(source, /creatorKitOfferId: saved\.id/);
});

test("Creator Kit выбирает оффер, из которого выполнен переход", () => {
  assert.match(source, /initialCreatorKitOfferId/);
  assert.match(source, /initialOfferId=\{initialCreatorKitOfferId\}/);
});
