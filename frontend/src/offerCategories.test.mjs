import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_CATEGORY_OTHER,
  OFFER_CATEGORY_PRESETS,
  getOfferCategorySelectValue
} from "./offerCategories.mjs";

test("список содержит основные новые категории", () => {
  for (const category of [
    "Материнство и дети",
    "Спорт и фитнес",
    "Путешествия",
    "Еда и напитки"
  ]) {
    assert.equal(OFFER_CATEGORY_PRESETS.includes(category), true);
  }
});

test("предустановленные категории уникальны и помещаются в поле БД", () => {
  assert.equal(new Set(OFFER_CATEGORY_PRESETS).size, OFFER_CATEGORY_PRESETS.length);
  assert.equal(OFFER_CATEGORY_PRESETS.every((category) => category.length <= 120), true);
});

test("известная категория восстанавливается в списке при редактировании", () => {
  assert.equal(
    getOfferCategorySelectValue("Путешествия"),
    "Путешествия"
  );
});

test("пользовательская категория открывается как Другое", () => {
  assert.equal(
    getOfferCategorySelectValue("Экотовары"),
    OFFER_CATEGORY_OTHER
  );
  assert.equal(getOfferCategorySelectValue(""), OFFER_CATEGORY_OTHER);
});
