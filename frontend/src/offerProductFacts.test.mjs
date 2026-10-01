import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildOfferProductFacts,
  formatOfferProductFacts
} from "./offerProductFacts.mjs";

test("поле фактов подключено к состоянию формы и не является read-only", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const field = source.match(
    /<label className="form-label">Факты о продукте<\/label><textarea[^>]+>/
  )?.[0];

  assert.ok(field);
  assert.match(field, /value=\{form\.productFacts\}/);
  assert.match(field, /onChange=/);
  assert.doesNotMatch(field, /\breadOnly\b/);
});

test("форматирует существующие факты для редактируемого поля", () => {
  assert.equal(
    formatOfferProductFacts([
      { type: "INGREDIENTS", value: "Пептиды" },
      { type: "USAGE", value: "Наносить вечером" }
    ]),
    "Пептиды\nНаносить вечером"
  );
});

test("сохраняет типизированные факты без изменений, если текст не редактировали", () => {
  const initialFacts = [
    {
      type: "INGREDIENTS",
      value: "Пептиды",
      accessLevel: "PRODUCT",
      requiresAffiliateApproval: true,
      sortOrder: 4
    }
  ];

  assert.deepEqual(buildOfferProductFacts("Пептиды", initialFacts), [
    {
      ...initialFacts[0],
      sortOrder: 0
    }
  ]);
});

test("преобразует введённый текст в сохраняемый DIGITAL-факт", () => {
  assert.deepEqual(buildOfferProductFacts("  Подходит для ежедневного ухода  "), [
    {
      type: "FEATURES",
      value: "Подходит для ежедневного ухода",
      accessLevel: "DIGITAL",
      requiresAffiliateApproval: false,
      sortOrder: 0
    }
  ]);
});

test("пустое поле не создаёт факт", () => {
  assert.deepEqual(buildOfferProductFacts("   "), []);
});
