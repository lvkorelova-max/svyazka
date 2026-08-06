export const OFFER_CATEGORY_OTHER = "Другое";

export const OFFER_CATEGORY_PRESETS = [
  "Красота и уход",
  "Одежда и обувь",
  "Дом и интерьер",
  "Аксессуары",
  "Материнство и дети",
  "Спорт и фитнес",
  "Путешествия",
  "Еда и напитки",
  "Здоровье и благополучие",
  "Электроника и гаджеты",
  "Образование",
  "Хобби и творчество",
  "Зоотовары",
  "Авто",
  "Услуги и сервисы"
];

export function getOfferCategorySelectValue(category) {
  return OFFER_CATEGORY_PRESETS.includes(category)
    ? category
    : OFFER_CATEGORY_OTHER;
}
