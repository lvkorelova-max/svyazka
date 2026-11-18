import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { getOfferKitFormFields, buildOfferKitFields } from "./offerKitFields.mjs";
import { calculatePoolEconomics } from "./financeEconomics.mjs";
import { PRODUCT_FACTS_PLACEHOLDER } from "./offerProductFacts.mjs";
import { getOfferCategorySelectValue, OFFER_CATEGORY_OTHER, OFFER_CATEGORY_PRESETS } from "./offerCategories.mjs";
import { getOfferPreviewImage, validateOfferImageFile } from "./offerImage.mjs";

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");
const { transformSync } = require("esbuild");
const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const fn = name => ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
const serialize = vm.runInNewContext(source.slice(fn("creatorKitPayload").start, fn("creatorKitPayload").end) + "; creatorKitPayload;", { scenarioChannelValues: {} });
const plain = value => JSON.parse(JSON.stringify(value));
const initial = {
  factsRaw: [{ id: "private-id", type: "INGREDIENTS", value: "Состав продукта", accessLevel: "PRODUCT", requiresAffiliateApproval: true, sortOrder: 0 }],
  claimsRaw: [
    { id: "claim-a", type: "FORBIDDEN", value: "Медицинские обещания", accessLevel: "PRODUCT", requiresAffiliateApproval: true, sortOrder: 0 },
    { id: "claim-b", type: "ALLOWED", value: "Увлажняет", accessLevel: "DIGITAL", requiresAffiliateApproval: false, sortOrder: 1 },
  ],
  publicationRaw: {
    id: "publication-a", mandatoryMentions: ["Название продукта", "Цена"], hashtags: ["#реклама"],
    advertisingLabel: "Реклама", brandMention: "@bysola", approvalRequired: true,
    allowedPlatforms: ["VK"], accessLevel: "PRODUCT", requiresAffiliateApproval: true,
  },
};

test("existing form displays stored facts, claims and publication requirements", () => {
  assert.deepEqual(getOfferKitFormFields(initial), {
    productFacts: "Состав продукта", allowedClaims: "Увлажняет", forbiddenClaims: "Медицинские обещания",
    publicationRequirements: "Название продукта\nЦена",
  });
});

test("unchanged fields retain types, claim order and access restrictions without DTO metadata", () => {
  const dto = plain(serialize(buildOfferKitFields(getOfferKitFormFields(initial), initial)));
  assert.deepEqual(dto.facts[0], { type: "INGREDIENTS", value: "Состав продукта", accessLevel: "PRODUCT", requiresAffiliateApproval: true, sortOrder: 0 });
  assert.deepEqual(dto.claims.map(claim => claim.type), ["FORBIDDEN", "ALLOWED"]);
  assert.equal(dto.claims[0].requiresAffiliateApproval, true);
  assert.equal(dto.publicationRequirements.accessLevel, "PRODUCT");
  assert.equal(dto.publicationRequirements.brandMention, "@bysola");
  assert.equal(dto.publicationRequirements.approvalRequired, true);
  assert.equal(JSON.stringify(dto).includes("private-id"), false);
  assert.equal(JSON.stringify(dto).includes("publication-a"), false);
});

test("editing restricted facts never makes them digital or removes approval", () => {
  const form = { ...getOfferKitFormFields(initial), productFacts: "Исправленный состав" };
  const dto = plain(serialize(buildOfferKitFields(form, initial)));
  assert.equal(dto.facts[0].value, form.productFacts);
  assert.equal(dto.facts[0].accessLevel, "PRODUCT");
  assert.equal(dto.facts[0].requiresAffiliateApproval, true);
});

test("editing one claim type preserves the other type and its restrictions", () => {
  const form = { ...getOfferKitFormFields(initial), allowedClaims: "Мягко наносится; Увлажняет" };
  const dto = plain(serialize(buildOfferKitFields(form, initial)));
  assert.deepEqual(dto.claims.filter(claim => claim.type === "ALLOWED").map(claim => claim.value), ["Мягко наносится", "Увлажняет"]);
  const forbidden = dto.claims.find(claim => claim.type === "FORBIDDEN");
  assert.equal(forbidden.value, "Медицинские обещания");
  assert.equal(forbidden.accessLevel, "PRODUCT");
  assert.equal(forbidden.requiresAffiliateApproval, true);
});

test("new restricted claims inherit the policy of their original group", () => {
  const form = { ...getOfferKitFormFields(initial), forbiddenClaims: "Новый запрет" };
  const dto = plain(serialize(buildOfferKitFields(form, initial)));
  const claim = dto.claims.find(item => item.type === "FORBIDDEN");
  assert.equal(claim.accessLevel, "PRODUCT");
  assert.equal(claim.requiresAffiliateApproval, true);
});

test("clearing editable fields is explicit and preserves other publication settings", () => {
  const form = { productFacts: "", allowedClaims: "", forbiddenClaims: "", publicationRequirements: "" };
  const dto = plain(serialize(buildOfferKitFields(form, initial)));
  assert.deepEqual(dto.facts, []);
  assert.deepEqual(dto.claims, []);
  assert.deepEqual(dto.publicationRequirements.mandatoryMentions, []);
  assert.equal(dto.publicationRequirements.advertisingLabel, "Реклама");
  assert.deepEqual(dto.publicationRequirements.hashtags, ["#реклама"]);
  assert.deepEqual(dto.publicationRequirements.allowedPlatforms, ["VK"]);
  assert.equal(dto.publicationRequirements.approvalRequired, true);
});

test("new offers use entered text and no sample brand's requirements", () => {
  const empty = getOfferKitFormFields();
  assert.deepEqual(Object.values(empty), ["", "", "", ""]);
  const form = { productFacts: "Масла и пептиды", allowedClaims: "Увлажняет", forbiddenClaims: "Лечит", publicationRequirements: "Указать цену" };
  const dto = plain(serialize(buildOfferKitFields(form)));
  assert.equal(dto.facts[0].value, "Масла и пептиды");
  assert.equal(dto.facts[0].accessLevel, "DIGITAL");
  assert.deepEqual(dto.publicationRequirements.mandatoryMentions, ["Указать цену"]);
  assert.deepEqual(dto.publicationRequirements.hashtags, []);
  assert.equal(JSON.stringify(dto).includes("lunea"), false);
});

test("scenario-only updates omit every other section", () => {
  const dto = plain(serialize({ scenarios: [] }));
  assert.deepEqual(dto, { scenarios: [] });
});

test("the actual offer form sends edited text and reopens with that text", async () => {
  const slots = [];
  let cursor = 0, submitted;
  const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
  const context = vm.createContext({
    React: { createElement, Fragment: "fragment" },
    useState: value => {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = value;
      return [slots[slot], next => { slots[slot] = typeof next === "function" ? next(slots[slot]) : next; }];
    }, useEffect: () => {},
    getOfferKitFormFields, buildOfferKitFields, calculatePoolEconomics,
    PRODUCT_FACTS_PLACEHOLDER, getOfferCategorySelectValue, OFFER_CATEGORY_OTHER, OFFER_CATEGORY_PRESETS,
    getOfferPreviewImage, validateOfferImageFile, scenarioChannelValues: {}, digitalFormats: [], money: String,
    productImages: { skincare: "fallback", cosmetics: "fallback" }, offerImagePlaceholder: "/offer-placeholder.svg",
    OfferManagerSelect: "manager-selector", ScenarioEditor: "scenario-editor", OfferCard: "offer-card",
  });
  const page = fn("CreateOfferPage");
  vm.runInContext(transformSync(source.slice(page.start, page.end) + "; this.Page = CreateOfferPage;", { loader: "jsx" }).code, context);
  const props = {
    role: "manager", initialOffer: { id: "existing", apiStatus: "PUBLISHED", category: "Красота и уход", creatorKit: { ...initial, scenarios: [] } },
    publish: async value => { submitted = value; }, navigate: () => {}, managers: [],
  };
  const render = () => { cursor = 0; return context.Page(props); };
  const all = node => !node || typeof node !== "object" ? [] : [node, ...(node.props?.children || []).flat(Infinity).flatMap(all)];
  const edit = (label, value) => {
    const parent = all(render()).find(node => (node.props?.children || []).some(child => child?.type === "label" && child.props.children.includes(label)));
    const textarea = parent.props.children.find(child => child?.type === "textarea");
    textarea.props.onChange({ target: { value } });
  };
  edit("Факты о продукте", "Новое описание состава");
  edit("Разрешённые формулировки", "Увлажняет кожу");
  edit("Запрещённые формулировки", "Лечебный эффект");
  edit("Требования к публикации", "Указать актуальную цену");
  const button = all(render()).find(node => node.type === "button" && node.props.children.includes("Сохранить изменения"));
  await button.props.onClick();
  const dto = plain(serialize(submitted.creatorKit));
  assert.equal(dto.facts[0].value, "Новое описание состава");
  assert.equal(dto.claims.find(claim => claim.type === "ALLOWED").value, "Увлажняет кожу");
  assert.equal(dto.claims.find(claim => claim.type === "FORBIDDEN").value, "Лечебный эффект");
  assert.deepEqual(dto.publicationRequirements.mandatoryMentions, ["Указать актуальную цену"]);
  const reopened = getOfferKitFormFields({ factsRaw: dto.facts, claimsRaw: dto.claims, publicationRaw: dto.publicationRequirements });
  assert.equal(reopened.productFacts, "Новое описание состава");
  assert.equal(reopened.allowedClaims, "Увлажняет кожу");
});
