import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("объясняет, что карточки не являются кнопками загрузки", () => {
  assert.match(
    source,
    /Материалы загружаются после сохранения оффера/
  );
  assert.match(
    source,
    /Это перечень поддерживаемых типов, а не кнопки загрузки/
  );
  assert.match(source, /Доступно в Creator Kit/);
});

test("кнопка сохраняет оффер и открывает реальную форму загрузки", () => {
  assert.match(source, /Сохранить оффер и открыть загрузку материалов/);
  assert.match(source, /submitOffer\(false, "creatorKit"\)/);
  assert.match(source, /brandTab: "creatorKit"/);
  assert.match(source, /creatorKitOfferId: saved\.id/);
  assert.match(source, /creatorKitFocus: "assets"/);
  assert.match(source, /id="creator-kit-assets-upload"/);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
});

test("Creator Kit выбирает оффер, из которого выполнен переход", () => {
  assert.match(source, /initialCreatorKitOfferId/);
  assert.match(source, /initialOfferId=\{initialCreatorKitOfferId\}/);
});

test("неподтверждённый бренд видит явную блокировку загрузки", () => {
  assert.match(source, /disabled=\{!uploadAllowed\}/);
  assert.match(source, /Загрузка файлов сейчас заблокирована: бренд ещё не подтверждён администратором/);
  assert.match(source, /Требуется подтверждение бренда/);
});
