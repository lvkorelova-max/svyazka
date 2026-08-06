import test from "node:test";
import assert from "node:assert/strict";
import { buildDefaultPublicationRequirements } from "./publicationRequirements.mjs";

test("подставляет зарегистрированное название бренда", () => {
  assert.equal(
    buildDefaultPublicationRequirements("BYSOLA"),
    "Указать название и цену, добавить маркировку рекламы, упомянуть бренд «BYSOLA»."
  );
});

test("удаляет внешние пробелы из названия", () => {
  assert.equal(
    buildDefaultPublicationRequirements("  Мой бренд  "),
    "Указать название и цену, добавить маркировку рекламы, упомянуть бренд «Мой бренд»."
  );
});

test("использует нейтральный текст без названия", () => {
  assert.equal(
    buildDefaultPublicationRequirements(""),
    "Указать название и цену, добавить маркировку рекламы, упомянуть бренд."
  );
});

test("никогда не подставляет прежний шаблон @lunea", () => {
  assert.equal(buildDefaultPublicationRequirements("BYSOLA").includes("@lunea"), false);
  assert.equal(buildDefaultPublicationRequirements(null).includes("@lunea"), false);
});
