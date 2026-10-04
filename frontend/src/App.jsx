import React, { useEffect, useMemo, useState } from "react";
import {
  api,
  getPublicBackendOrigin,
  restoreSession,
  setAccessToken,
  setActiveBrandId as setApiActiveBrandId
} from "./api/client";
import {
  COMMISSION_FILTERS,
  matchesCommissionFilter
} from "./commissionFilter.mjs";
import {
  OFFER_CATEGORY_OTHER,
  OFFER_CATEGORY_PRESETS,
  getOfferCategorySelectValue
} from "./offerCategories.mjs";
import {
  getOfferPreviewImage,
  validateOfferImageFile
} from "./offerImage.mjs";
import {
  PRODUCT_FACTS_PLACEHOLDER,
  formatOfferProductFacts
} from "./offerProductFacts.mjs";
import {
  calculatePoolEconomics,
  getApplicationUiState
} from "./financeEconomics.mjs";
import {
  buildTrackerInstallationPayload,
  trackerScriptSnippet
} from "./trackingIntegration.mjs";
import {
  countActiveApplications,
  getAdminApplicationStatus,
  getAdminCreatorStatus
} from "./adminDirectory.mjs";

const productImages = {
  skincare: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=1200&q=85",
  cosmetics: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=1200&q=85",
  shoes: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=85",
  watch: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=85",
  perfume: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=1200&q=85",
  home: "https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=1200&q=85"
};

const money = (value) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " ₽";

const moneyKopecks = (value) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(value || 0) / 100) + " ₽";

const digitalFormats = [
  "wishlist",
  "подборка товаров",
  "новость о запуске",
  "обзор характеристик",
  "разбор состава",
  "рассказ о бренде",
  "публикация промокода",
  "использование официальных материалов бренда"
];

const assetBlueprints = [
  ["Главное фото продукта", "Фото", "JPG · 2400×3000", true, true, true, false, "31.12.2026"],
  ["Вертикальное видео 9:16", "Вертикальное видео", "MP4 · 1080×1920", true, true, true, false, "31.12.2026"],
  ["Горизонтальный ролик", "Горизонтальное видео", "MP4 · 1920×1080", false, true, false, true, "30.11.2026"],
  ["Продукт без фона", "PNG продукта", "PNG · 2000×2000", true, true, true, false, "31.12.2026"],
  ["Логотип бренда", "Логотип", "SVG + PNG", false, false, true, false, "31.12.2026"],
  ["Утренний lifestyle", "Lifestyle-контент", "JPG · 2400×1600", true, true, true, false, "15.07.2026"],
  ["Текстура крупным планом", "Видео текстуры", "MP4 · 1080×1920", true, true, false, false, "31.12.2026"],
  ["Официальное применение", "Видео использования", "MP4 · 1080×1920", false, false, false, true, "31.12.2026"],
  ["Баннер запуска", "Рекламный баннер", "JPG · 1200×628", false, false, true, false, "30.09.2026"]
];

const assetTypeLabels = {
  PHOTO: "Фото",
  VERTICAL_VIDEO: "Вертикальное видео",
  HORIZONTAL_VIDEO: "Горизонтальное видео",
  PRODUCT_PNG: "PNG продукта",
  LOGO: "Логотип",
  LIFESTYLE: "Lifestyle-контент",
  TEXTURE_VIDEO: "Видео текстуры",
  USAGE_VIDEO: "Видео использования",
  BANNER: "Рекламный баннер",
  DOCUMENT: "Документ"
};

const scenarioChannelLabels = {
  REELS: "Reels",
  STORIES: "Stories",
  TELEGRAM: "Telegram",
  THREADS: "Threads",
  POST: "Пост",
  SHORT_REVIEW: "Короткий обзор",
  SELECTION: "Подборка"
};

const factTypeLabels = {
  DESCRIPTION: "Описание",
  BENEFITS: "Преимущества",
  INGREDIENTS: "Состав",
  USAGE: "Способ применения",
  PRICE: "Цена",
  VOLUME: "Объём",
  COUNTRY: "Страна производства",
  TARGET_AUDIENCE: "Целевая аудитория",
  FEATURES: "Особенности продукта",
  LIMITATIONS: "Возможные ограничения"
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
};

function mapCreatorKit(kit, offer) {
  const policy = kit?.offerPolicy?.promotionWithoutProduct || offer?.promotionWithoutProduct || "LIMITED";
  const publication = kit?.publicationRequirements;
  const facts = Object.fromEntries((kit?.facts || []).map((fact) => [factTypeLabels[fact.type] || fact.type, fact.value]));
  const scenarios = (kit?.scenarios || []).map((scenario) => ({
    ...scenario,
    channelValue: scenario.channel,
    channel: scenarioChannelLabels[scenario.channel] || scenario.channel,
    idea: scenario.mainIdea || scenario.idea || ""
  }));
  const productScenarios = scenarios.filter((scenario) => scenario.accessLevel === "PRODUCT");

  return {
    loaded: Boolean(kit),
    promotionWithoutSample: policy === "YES" ? "yes" : policy === "NO" ? "no" : "restricted",
    allowedDigitalFormats: kit?.offerPolicy?.allowedPromotionFormats || offer?.allowedPromotionFormats || [],
    productAccessFormats: productScenarios.map((scenario) => scenario.title),
    completeness: kit?.completeness?.percent || 0,
    completenessMissing: kit?.completeness?.missingSections || [],
    completenessSections: kit?.completeness?.sections || [],
    readyToPublish: Boolean(kit?.completeness?.readyToPublish),
    revision: kit?.revision || kit?.accessContext?.revision || null,
    accessContext: kit?.accessContext || {},
    brandContent: {
      description: kit?.brandContent?.description || "",
      history: kit?.brandContent?.history || "",
      values: kit?.brandContent?.values || [],
      positioning: kit?.brandContent?.positioning || "",
      accessLevel: kit?.brandContent?.accessLevel || "DIGITAL",
      requiresAffiliateApproval: Boolean(kit?.brandContent?.requiresAffiliateApproval)
    },
    productContent: {
      description: kit?.productContent?.description || "",
      benefits: kit?.productContent?.benefits || [],
      usageInstructions: kit?.productContent?.usageInstructions || "",
      accessLevel: kit?.productContent?.accessLevel || "DIGITAL",
      requiresAffiliateApproval: Boolean(kit?.productContent?.requiresAffiliateApproval)
    },
    assets: (kit?.assets || []).map((asset) => ({
      id: asset.id,
      name: asset.title,
      type: assetTypeLabels[asset.assetType] || asset.assetType,
      assetType: asset.assetType,
      accessLevel: asset.accessLevel,
      format: `${String(asset.extension || "").toUpperCase()} · ${formatBytes(asset.byteSize)}`,
      editable: asset.editable,
      textAllowed: asset.textAllowed,
      paidAds: asset.paidAdsAllowed,
      approvalRequired: asset.approvalRequired,
      requiresAffiliateApproval: asset.requiresAffiliateApproval,
      expires: asset.expiresAt ? new Date(asset.expiresAt).toLocaleDateString("ru-RU") : "Без срока",
      active: asset.status === "READY",
      status: asset.status,
      originalFileName: asset.originalFileName,
      previewUrl: asset.previewUrl || ""
    })),
    scenarios,
    facts,
    factsRaw: kit?.facts || [],
    allowedClaims: (kit?.claims || []).filter((claim) => claim.type === "ALLOWED").map((claim) => claim.value),
    forbiddenClaims: (kit?.claims || []).filter((claim) => claim.type === "FORBIDDEN").map((claim) => claim.value),
    noSampleRules: (kit?.rules || []).map((rule) => rule.value),
    claimsRaw: kit?.claims || [],
    rulesRaw: kit?.rules || [],
    publicationRaw: publication || null,
    publicationRequirements: publication ? {
      "Обязательные упоминания": publication.mandatoryMentions.join(", ") || "Не заданы",
      "Маркировка рекламы": publication.advertisingLabel || "Не задана",
      "Хэштеги": publication.hashtags.join(" ") || "Не заданы",
      "Упоминание бренда": publication.brandMention || "Не задано",
      "Согласование": publication.approvalRequired ? "Требуется" : "Не требуется",
      "Разрешённые площадки": publication.allowedPlatforms.join(", ") || "Не заданы"
    } : {},
    creatorTools: null,
    analytics: null
  };
}

function buildCreatorKit(offer) {
  const title = offer.title || "товар";
  return {
    promotionWithoutSample: "restricted",
    allowedDigitalFormats: [...digitalFormats],
    productAccessFormats: ["личный обзор", "распаковка", "нанесение", "отзыв", "сравнение после использования"],
    completeness: 86,
    assets: assetBlueprints.map((asset, index) => ({
      id: `${offer.id || 0}-asset-${index + 1}`,
      name: asset[0],
      type: asset[1],
      format: asset[2],
      editable: asset[3],
      textAllowed: asset[4],
      paidAds: asset[5],
      approvalRequired: asset[6],
      expires: asset[7],
      active: index !== 5,
      downloads: 18 + index * 7
    })),
    scenarios: [
      { channel: "Reels", title: "Три факта о продукте", idea: "Соберите динамичную подборку официальных кадров и трёх проверяемых преимуществ." },
      { channel: "Stories", title: "Wishlist с промокодом", idea: "Покажите, почему товар оказался в вашем списке желаний, не создавая впечатления личного опыта." },
      { channel: "Telegram", title: "Разбор состава", idea: "Выберите 3–4 компонента из банка фактов и объясните их роль простым языком." },
      { channel: "Threads", title: "Новость о запуске", idea: "Расскажите о запуске и задайте аудитории вопрос о привычках в категории." },
      { channel: "Пост", title: "История бренда", idea: "Адаптируйте факты о происхождении бренда под свой редакционный стиль." },
      { channel: "Короткий обзор", title: "Обзор характеристик", idea: "Сопоставьте основные характеристики, цену и аудиторию без заявления о личном тестировании." },
      { channel: "Подборка", title: "Товары для спокойного утра", idea: `Включите «${title}» в тематическую подборку вместе с другими релевантными товарами.` }
    ],
    facts: {
      "Описание": offer.description,
      "Преимущества": "Понятная система применения, продуманная упаковка, официальные материалы для подробного знакомства.",
      "Состав": offer.category === "Красота и уход" ? "Глицерин, сквалан, пантенол и комплекс увлажняющих компонентов." : "Подробный состав и характеристики указаны в технической карточке.",
      "Способ применения": "Следуйте официальной инструкции бренда. Не изменяйте способ применения без согласования.",
      "Цена": money(offer.price),
      "Объём": offer.category === "Красота и уход" ? "3 продукта · 150 мл суммарно" : "1 единица",
      "Страна производства": "Россия",
      "Целевая аудитория": "Покупатели, которые ценят понятный состав, современный дизайн и прозрачные характеристики.",
      "Особенности продукта": "Можно начать продвижение с официальными материалами в форматах Digital Access.",
      "Возможные ограничения": "Индивидуальная реакция возможна. Не использовать медицинские и гарантированные обещания."
    },
    allowedClaims: ["«Подходит для ежедневного ухода»", "«Бренд указывает в составе…»", "«В набор входят три продукта»"],
    forbiddenClaims: ["«Я протестировала и точно рекомендую» до получения образца", "«Гарантированно решает проблему»", "«Подходит абсолютно всем»"],
    noSampleRules: [
      "Использовать только официальные материалы бренда.",
      "Отделять факты о продукте от личного мнения.",
      "Не показывать инсценированное применение продукта.",
      "Не утверждать, что продукт был получен или протестирован."
    ],
    publicationRequirements: {
      "Обязательные упоминания": "Название продукта и актуальная цена",
      "Маркировка рекламы": "Обязательна в соответствии с форматом публикации",
      "Хэштеги": "#реклама #LUNEA",
      "Упоминание бренда": `@${String(offer.brand || "brand").toLowerCase()}`,
      "Согласование": "Нужно для видео использования и платного продвижения",
      "Разрешённые площадки": "VK, Telegram, Threads, короткие видео и личный блог"
    },
    creatorTools: null,
    analytics: null
  };
}

const initialOffers = [
  {
    id: 1,
    brand: "LUNEA",
    title: "Восстанавливающий набор для ухода",
    category: "Красота и уход",
    price: 6490,
    commission: 18,
    threshold: 5,
    image: productImages.skincare,
    status: "active",
    applications: 24,
    sales: 83,
    description: "Система ежедневного ухода для восстановления защитного барьера кожи. В набор входят мягкое очищение, сыворотка и крем без отдушек.",
    terms: "Нативная интеграция в контент об уходе, образе жизни или осознанном потреблении. Запрещены медицинские обещания.",
    materials: "7 фото, 3 коротких видео, тезисы и продуктовая памятка"
  },
  {
    id: 2,
    brand: "FORMA",
    title: "Кроссовки для города Run 02",
    category: "Одежда и обувь",
    price: 8990,
    commission: 14,
    threshold: 4,
    image: productImages.shoes,
    status: "active",
    applications: 18,
    sales: 41,
    description: "Лёгкие городские кроссовки с амортизирующей подошвой и дышащим верхом. Модель подходит для прогулок и повседневных маршрутов.",
    terms: "Контент о городском образе жизни, спорте или гардеробе. В кадре должна быть видна модель и ключевые детали.",
    materials: "10 фото, 4 вертикальных видео, таблица размеров"
  },
  {
    id: 3,
    brand: "SEVER",
    title: "Парфюмерная вода 04 / Белый чай",
    category: "Красота и уход",
    price: 5200,
    commission: 20,
    threshold: 6,
    image: productImages.perfume,
    status: "active",
    applications: 31,
    sales: 69,
    description: "Сдержанная композиция с нотами белого чая, бергамота и светлого дерева. Универсальный аромат для ежедневного использования.",
    terms: "Подходит для эстетичного и lifestyle-контента. Не использовать сравнения с другими парфюмерными брендами.",
    materials: "8 фото, mood-видео, описание нот и история аромата"
  },
  {
    id: 4,
    brand: "KONTUR",
    title: "Наручные часы Line S",
    category: "Аксессуары",
    price: 12400,
    commission: 12,
    threshold: 3,
    image: productImages.watch,
    status: "active",
    applications: 12,
    sales: 26,
    description: "Минималистичные часы в стальном корпусе с сапфировым стеклом и сменным ремешком из натуральной кожи.",
    terms: "Интеграции в контент о стиле, работе и повседневных ритуалах. Необходим крупный план циферблата.",
    materials: "6 фото, 2 видео, технические характеристики"
  },
  {
    id: 5,
    brand: "MIRA",
    title: "Набор декоративной косметики Base",
    category: "Красота и уход",
    price: 4300,
    commission: 16,
    threshold: 5,
    image: productImages.cosmetics,
    status: "active",
    applications: 27,
    sales: 57,
    description: "Базовый набор для естественного макияжа: тон, кремовые румяна и тушь. Формулы подходят для ежедневного использования.",
    terms: "Beauty-обзоры, уроки макияжа и повседневный lifestyle-контент. Требуется демонстрация результата.",
    materials: "12 фото, 5 видео, свотчи и продуктовые тезисы"
  },
  {
    id: 6,
    brand: "Точка дома",
    title: "Стул из массива Ясень 01",
    category: "Дом и интерьер",
    price: 15900,
    commission: 11,
    threshold: 2,
    image: productImages.home,
    status: "active",
    applications: 9,
    sales: 14,
    description: "Лаконичный обеденный стул из массива ясеня с натуральным покрытием. Спроектирован для небольших городских интерьеров.",
    terms: "Контент об интерьере, ремонте или организации пространства. Желателен общий план помещения.",
    materials: "9 фото, чертежи, варианты отделки и памятка по уходу"
  }
].map((offer) => ({ ...offer, creatorKit: buildCreatorKit(offer) }));

const pageTitles = {
  home: "Главная",
  catalog: "Каталог",
  offer: "Оффер",
  register: "Регистрация",
  login: "Вход",
  creator: "Кабинет креатора",
  brand: "Кабинет бренда",
  manager: "Выбор бренда",
  create: "Создание оффера",
  admin: "Админ-панель",
  "manager-invitation": "Приглашение менеджера"
};

const managerBrandStorageKey = (userId) => `svyazka:manager-active-brand:${userId}`;
const managerInvitationStorageKey = "svyazka:pending-manager-invitation";

function managerInvitationTokenFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/manager-invitations\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function Status({ type = "", children }) {
  return <span className={`status ${type}`}>{children}</span>;
}

function BrandLogo({ onClick }) {
  return (
    <button className="brand-mark" onClick={onClick} aria-label="Перейти на главную">
      <span className="brand-symbol" aria-hidden="true"></span>
      <span className="brand-name">Связка</span>
    </button>
  );
}

function Header({ page, role, navigate, logout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const cabinetPage = role === "manager" ? "brand" : role;

  const go = (target, options = {}) => {
    setMobileOpen(false);
    navigate(target, options);
  };

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <BrandLogo onClick={() => go("home")} />
        <nav className="nav" aria-label="Основная навигация">
          <button className={`nav-button ${page === "catalog" ? "active" : ""}`} onClick={() => go("catalog")}>Офферы</button>
          <button className="nav-button" onClick={() => go("home", { anchor: "how" })}>Как это работает</button>
          {role === "creator" && <button className={`nav-button ${page === "creator" ? "active" : ""}`} onClick={() => go("creator")}>Мой кабинет</button>}
          {["brand", "manager"].includes(role) && <button className={`nav-button ${page === "brand" ? "active" : ""}`} onClick={() => go("brand")}>Кабинет бренда</button>}
          {role === "admin" && <button className={`nav-button ${page === "admin" ? "active" : ""}`} onClick={() => go("admin")}>Админ-панель</button>}
        </nav>
        <div className="top-actions">
          {role === "guest" ? (
            <>
              <button className="button secondary small" onClick={() => go("login")}>Войти</button>
              <button className="button small" onClick={() => go("register")}>Регистрация</button>
            </>
          ) : (
            <>
              <button className="button secondary small" onClick={() => go(cabinetPage)}>Кабинет</button>
              <button className="button ghost small" onClick={logout}>Выйти</button>
            </>
          )}
          <button
            className="icon-button mobile-menu-button"
            aria-label="Открыть меню"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? "×" : "☰"}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="mobile-drawer">
          <button className="button secondary" onClick={() => go("catalog")}>Каталог офферов</button>
          <button className="button secondary" onClick={() => go(role === "guest" ? "register" : cabinetPage)}>Кабинет</button>
          {role === "guest"
            ? <button className="button" onClick={() => go("login")}>Войти</button>
            : <button className="button ghost" onClick={logout}>Выйти</button>}
        </div>
      )}
    </header>
  );
}

function ManagerBrandSelector({ brands, activeBrandId, onSelect, compact = false }) {
  if (!brands.length) {
    return (
      <main className="dashboard-main">
        <div className="container">
          <div className="panel empty-state">
            У вас пока нет активных назначений на бренды.
          </div>
        </div>
      </main>
    );
  }

  const selectedBrand = brands.find((brand) => brand.id === activeBrandId) || brands[0];
  const brandName = selectedBrand?.brandName || selectedBrand?.legalName || selectedBrand?.id;
  const selector = brands.length === 1 ? (
    <div className="manager-brand-current">
      <span>Текущий бренд</span>
      <strong>{brandName}</strong>
    </div>
  ) : (
    <label className="manager-brand-select">
      <span>{compact ? "Активный бренд" : "Выберите бренд для работы"}</span>
      <select
        value={activeBrandId || ""}
        onChange={(event) => event.target.value && onSelect(event.target.value)}
      >
        {!activeBrandId && <option value="">Выберите бренд</option>}
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.brandName || brand.legalName || brand.id}
          </option>
        ))}
      </select>
    </label>
  );

  if (compact) {
    return <div className="container manager-brand-context">{selector}</div>;
  }

  return (
    <main className="dashboard-main">
      <div className="container">
        <div className="panel manager-brand-selector">
          <h1>Выберите бренд</h1>
          <p>Активный бренд определяет данные и действия в кабинете.</p>
          {selector}
        </div>
      </div>
    </main>
  );
}

function OfferCard({ offer, onOpen }) {
  const reward = Math.round(offer.price * offer.commission / 100);
  return (
    <article className="offer-card" onClick={() => onOpen(offer)} tabIndex="0" onKeyDown={(event) => event.key === "Enter" && onOpen(offer)}>
      <div className="offer-image">
        <img src={offer.image} alt={offer.title} />
      </div>
      <div className="offer-card-body">
        <div className="offer-meta">
          <span>{offer.brand}</span>
          <span>{offer.category}</span>
        </div>
        <h3>{offer.title}</h3>
        <div className="kit-card-line">
          <span className="kit-mini-badge">Creator Kit</span>
          <span>Digital Access доступен</span>
        </div>
        <div className="offer-terms">
          <div>
            <span className="term-label">Вы заработаете</span>
            <span className="term-value">{offer.commission}% · {money(reward)}</span>
          </div>
          <div>
            <span className="term-label">Товар после</span>
            <span className="term-value">{offer.threshold} продаж</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function Footer({ navigate }) {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <BrandLogo onClick={() => navigate("home")} />
        <span>Демонстрационный прототип · Все данные тестовые</span>
      </div>
    </footer>
  );
}

function HomePage({ offers, navigate, openOffer }) {
  return (
    <main className="page">
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">Партнёрские продажи физических товаров</span>
            <h1>Бренды и креаторы в одной системе</h1>
            <p className="hero-copy">
              Креаторы зарабатывают на подтверждённых продажах, бренды получают прозрачный канал продвижения. Продукт для тестирования становится доступен после результата.
            </p>
            <div className="hero-actions">
              <button className="button" onClick={() => navigate("catalog")}>Смотреть офферы <span aria-hidden="true">→</span></button>
              <button className="button secondary" onClick={() => navigate("register", { role: "brand" })}>Разместить оффер</button>
            </div>
            <div className="hero-proof">
              <div className="proof-item">
                <span className="proof-value">До 20%</span>
                <span className="proof-label">комиссия с подтверждённой продажи</span>
              </div>
              <div className="proof-item">
                <span className="proof-value">Без закупки</span>
                <span className="proof-label">креатор начинает с готовых материалов</span>
              </div>
              <div className="proof-item">
                <span className="proof-value">По результату</span>
                <span className="proof-label">товар доступен после заданного порога</span>
              </div>
            </div>
          </div>
          <div className="hero-visual" aria-label="Пример товарного оффера">
            <div className="hero-product">
              <img src={productImages.skincare} alt="Набор средств для ухода" />
            </div>
            <div className="floating-panel">
              <div className="floating-panel-label">Прогресс до получения товара</div>
              <div className="floating-panel-value">3 из 5 продаж</div>
              <div className="mini-progress"><span style={{ width: "60%" }}></span></div>
              <div className="floating-caption">
                <span>Подтверждено 3</span>
                <span>Осталось 2</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section alt" id="how">
        <div className="container">
          <div className="section-heading">
            <h2>Сначала продажи. Затем продукт для тестирования.</h2>
            <p>Креатор начинает продвижение с готовых материалов бренда и персональной ссылки. Это делает сотрудничество понятным для обеих сторон.</p>
          </div>
          <div className="steps">
            {[
              ["01", "Выберите оффер", "Изучите товар, размер комиссии и условие получения продукта."],
              ["02", "Подайте заявку", "После одобрения откроются Creator Kit и персональная ссылка."],
              ["03", "Получайте комиссию", "Вознаграждение начисляется только с подтверждённых продаж."],
              ["04", "Запросите товар", "Когда порог продаж достигнут, в кабинете появится право запроса."]
            ].map(([number, title, copy]) => (
              <div className="step" key={number}>
                <span className="step-number">{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>Офферы с понятными условиями</h2>
            <button className="text-button" onClick={() => navigate("catalog")}>Весь каталог →</button>
          </div>
          <div className="offer-grid">
            {offers.slice(0, 3).map((offer) => <OfferCard key={offer.id} offer={offer} onOpen={openOffer} />)}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container audience-grid">
          <div className="audience-block">
            <span className="eyebrow">Креаторам</span>
            <h3>Монетизируйте доверие аудитории</h3>
            <p>Выбирайте товары под свой контент, используйте материалы бренда и отслеживайте подтверждённые продажи в одном кабинете.</p>
            <button className="button secondary" onClick={() => navigate("register", { role: "creator" })}>Стать креатором</button>
          </div>
          <div className="audience-block dark">
            <span className="eyebrow">Брендам</span>
            <h3>Платите за измеримый результат</h3>
            <p>Управляйте условиями оффера, рассматривайте заявки и получайте продажи через релевантных авторов.</p>
            <button className="button" onClick={() => navigate("register", { role: "brand" })}>Разместить оффер</button>
          </div>
        </div>
      </section>
      <Footer navigate={navigate} />
    </main>
  );
}

function CatalogPage({ offers, openOffer, navigate, role }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Все категории");
  const [commission, setCommission] = useState(COMMISSION_FILTERS.ANY);
  const categories = ["Все категории", ...new Set(offers.map((offer) => offer.category))];
  const filtered = offers.filter((offer) => {
    const matchesQuery = `${offer.title} ${offer.brand}`.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = category === "Все категории" || offer.category === category;
    const matchesCommission = matchesCommissionFilter(offer.commission, commission);
    return matchesQuery && matchesCategory && matchesCommission && offer.status === "active";
  });

  return (
    <main className="page">
      <div className="container">
        <div className="page-head">
          <div className="page-head-row">
            <div>
              <span className="eyebrow">Каталог</span>
              <h1>Офферы брендов</h1>
              <p>Выбирайте товары, сравнивайте комиссию и заранее смотрите, сколько подтверждённых продаж потребуется для запроса продукта.</p>
            </div>
            {role !== "manager" && <button className="button secondary" onClick={() => navigate("register", { role: "creator" })}>Стать креатором</button>}
          </div>
        </div>
        <div className="catalog-toolbar">
          <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по товару или бренду" />
          <select className="select-field" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="select-field" value={commission} onChange={(event) => setCommission(event.target.value)}>
            {Object.values(COMMISSION_FILTERS).map((label) => <option key={label}>{label}</option>)}
          </select>
        </div>
        <div className="catalog-count">Найдено офферов: {filtered.length}</div>
        {filtered.length ? (
          <div className="offer-grid" style={{ paddingBottom: 80 }}>
            {filtered.map((offer) => <OfferCard key={offer.id} offer={offer} onOpen={openOffer} />)}
          </div>
        ) : (
          <div className="empty-state">По заданным условиям офферы не найдены.</div>
        )}
      </div>
      <Footer navigate={navigate} />
    </main>
  );
}

function PermissionValue({ value }) {
  return <span className={`permission-value ${value ? "yes" : "no"}`}>{value ? "Разрешено" : "Нет"}</span>;
}

function AssetPreview({ asset }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [asset.previewUrl]);

  const label = asset.type.slice(0, 2).toUpperCase();
  return (
    <span className={`asset-preview ${asset.previewUrl && !failed ? "has-image" : ""}`}>
      {asset.previewUrl && !failed
        ? <img src={asset.previewUrl} alt={`Превью: ${asset.name}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : label}
    </span>
  );
}

function CreatorKitLoadError({ onRetry }) {
  return (
    <section className="creator-kit">
      <div className="empty-state">
        <h2>Не удалось загрузить Creator Kit</h2>
        <p>Материалы креатора временно недоступны. Повторите попытку.</p>
        <button className="button secondary" onClick={onRetry}>Повторить</button>
      </div>
    </section>
  );
}

function CreatorKit({ offer, mode = "creator", hasProductAccess = false, notify, onToggleAsset, onDownloadAsset, onRetry }) {
  if (mode === "creator" && (offer.creatorKitError || !offer.creatorKit)) {
    return <CreatorKitLoadError onRetry={onRetry} />;
  }
  return (
    <CreatorKitContent
      offer={offer}
      mode={mode}
      hasProductAccess={hasProductAccess}
      notify={notify}
      onToggleAsset={onToggleAsset}
      onDownloadAsset={onDownloadAsset}
    />
  );
}

function CreatorKitContent({ offer, mode = "creator", hasProductAccess = false, notify, onToggleAsset, onDownloadAsset }) {
  const kit = offer.creatorKit || buildCreatorKit(offer);
  const [selectedAssets, setSelectedAssets] = useState(kit.assets.filter((asset) => asset.active).slice(0, 2).map((asset) => asset.id));
  const [kitTab, setKitTab] = useState("assets");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftScenario, setDraftScenario] = useState(kit.scenarios[0]?.title || "");

  useEffect(() => {
    setSelectedAssets(kit.assets.filter((asset) => asset.active).slice(0, 2).map((asset) => asset.id));
    setDraftScenario(kit.scenarios[0]?.title || "");
  }, [offer.id, kit.assets.length, kit.scenarios.length]);

  const toggleSelected = (assetId) => {
    setSelectedAssets(selectedAssets.includes(assetId) ? selectedAssets.filter((id) => id !== assetId) : [...selectedAssets, assetId]);
  };

  const copy = (value, message) => {
    if (navigator.clipboard) navigator.clipboard.writeText(value).catch(() => {});
    notify(message);
  };

  return (
    <section className={`creator-kit ${mode === "brand" ? "brand-mode" : ""}`}>
      <div className="creator-kit-header">
        <div>
          <span className="eyebrow">Материалы для продвижения</span>
          <h2>Creator Kit</h2>
          <p>Используйте проверенные факты и официальные материалы. Идеи можно адаптировать под свой стиль и площадку.</p>
        </div>
        <div className="access-badges">
          <span className={`access-badge digital ${kit.promotionWithoutSample === "no" ? "unavailable" : ""}`}>
            <b>Digital Access</b>
            <small>{kit.promotionWithoutSample === "no" ? "Продукт обязателен" : "Доступен без образца"}</small>
          </span>
          <span className={`access-badge product ${hasProductAccess ? "unlocked" : "locked"}`}>
            <b>{hasProductAccess ? "Product Access" : "Product Access · закрыт"}</b>
            <small>{hasProductAccess ? "Ручной доступ для пилота" : "Выдаётся брендом вручную"}</small>
          </span>
        </div>
      </div>

      <div className="creator-warning">
        <span className="warning-mark">!</span>
        <div>
          <strong>Не утверждайте, что вы лично использовали или тестировали продукт, если физический образец ещё не был получен.</strong>
          <p>До открытия Product Access доступны только официальные материалы, проверяемые факты и разрешённые форматы.</p>
        </div>
      </div>

      {kit.promotionWithoutSample === "restricted" && (
        <div className="digital-formats-line">
          <strong>Разрешено без физического образца</strong>
          <div className="format-chips">
            {kit.allowedDigitalFormats.map((format) => <span key={format}>{format}</span>)}
          </div>
        </div>
      )}

      <div className="kit-tabs">
        {[
          ["assets", "Материалы"],
          ["scenarios", "Сценарии"],
          ["facts", "Факты и правила"],
          ["tools", "Инструменты"]
        ].map(([id, label]) => (
          <button className={`kit-tab ${kitTab === id ? "active" : ""}`} onClick={() => setKitTab(id)} key={id}>{label}</button>
        ))}
      </div>

      {kitTab === "assets" && (
        <div className="kit-content">
          <div className="kit-section-heading">
            <div>
              <h3>Библиотека визуальных материалов</h3>
              <p>{kit.assets.filter((asset) => asset.active).length} активных файлов · выбрано {selectedAssets.length}</p>
            </div>
            {mode === "creator" && (
              <div className="row-actions">
                <button className="button secondary small" disabled title="Пакетное скачивание не входит в этап MVP">Скачать все материалы</button>
                <button className="button small" disabled title="Пакетное скачивание не входит в этап MVP">Скачать выбранные материалы</button>
              </div>
            )}
          </div>
          <div className="asset-list">
            {kit.assets.map((asset) => (
              <div className={`asset-item ${!asset.active ? "disabled" : ""}`} key={asset.id}>
                {mode === "creator" ? (
                  <label className="asset-select">
                    <input type="checkbox" checked={selectedAssets.includes(asset.id)} disabled={!asset.active} onChange={() => toggleSelected(asset.id)} />
                    <AssetPreview asset={asset} />
                  </label>
                ) : (
                  <AssetPreview asset={asset} />
                )}
                <div className="asset-main">
                  <strong>{asset.name}</strong>
                  <span>{asset.type} · {asset.format}</span>
                </div>
                <div className="asset-permissions">
                  <span><small>Редактирование</small><PermissionValue value={asset.editable} /></span>
                  <span><small>Добавлять текст</small><PermissionValue value={asset.textAllowed} /></span>
                  <span><small>Платная реклама</small><PermissionValue value={asset.paidAds} /></span>
                  <span><small>Согласование</small><PermissionValue value={asset.approvalRequired} /></span>
                </div>
                <div className="asset-expiry">
                  <small>Действует до</small>
                  <strong>{asset.expires}</strong>
                  {mode === "brand" && <span>Статистика не собирается</span>}
                </div>
                <div className="asset-file-actions">
                  <button className="button secondary small" disabled={!["READY", "DISABLED"].includes(asset.status)} onClick={() => onDownloadAsset(offer.id, asset.id, mode)}>Скачать</button>
                  {mode === "brand" && ["READY", "DISABLED"].includes(asset.status) && (
                    <button className={`asset-toggle ${asset.active ? "on" : ""}`} onClick={() => onToggleAsset(offer.id, asset.id, asset.active)}>
                      {asset.active ? "Активен" : "Отключён"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!kit.assets.length && <div className="empty-state">Для этого уровня доступа пока нет активных материалов.</div>}
          </div>
        </div>
      )}

      {kitTab === "scenarios" && (
        <div className="kit-content">
          <div className="kit-section-heading">
            <div><h3>Готовые сценарии</h3><p>Это идеи для адаптации, а не обязательный текст публикации.</p></div>
          </div>
          <div className="scenario-grid">
            {kit.scenarios.map((scenario) => (
              <article className="scenario-card" key={`${scenario.channel}-${scenario.title}`}>
                <Status type="success">{scenario.channel}</Status>
                <h4>{scenario.title}</h4>
                <p>{scenario.idea}</p>
                {mode === "creator" && <button className="text-button" onClick={() => { setDraftScenario(scenario.title); setDraftOpen(true); }}>Использовать идею →</button>}
              </article>
            ))}
          </div>
          {!kit.scenarios.length && <div className="empty-state">Сценарии для этого уровня доступа пока не заполнены.</div>}
          <div className={`product-access-panel ${hasProductAccess ? "unlocked" : ""}`}>
            <div>
              <span className="access-lock">{hasProductAccess ? "✓" : "×"}</span>
              <div>
                <h3>Product Access</h3>
                <p>{hasProductAccess ? "Бренд вручную открыл Product Access для закрытого пилота. Это не подтверждает отправку или получение образца." : "Product Access выдаётся брендом вручную и не означает отправку физического образца."}</p>
              </div>
            </div>
            <div className="format-chips">
              {kit.productAccessFormats.map((format) => <span className={hasProductAccess ? "" : "locked"} key={format}>{format}</span>)}
            </div>
          </div>
        </div>
      )}

      {kitTab === "facts" && (
        <div className="kit-content">
          <div className="rules-requirements">
            <div>
              <h3>О бренде</h3>
              {kit.brandContent.description ? <p>{kit.brandContent.description}</p> : <p>Раздел пока не заполнен.</p>}
              {kit.brandContent.history && <p>{kit.brandContent.history}</p>}
              {kit.brandContent.positioning && <p><strong>Позиционирование:</strong> {kit.brandContent.positioning}</p>}
              {!!kit.brandContent.values.length && <p><strong>Ценности:</strong> {kit.brandContent.values.join(", ")}</p>}
            </div>
            <div>
              <h3>О продукте</h3>
              {kit.productContent.description ? <p>{kit.productContent.description}</p> : <p>Раздел пока не заполнен.</p>}
              {!!kit.productContent.benefits.length && <p><strong>Преимущества:</strong> {kit.productContent.benefits.join(", ")}</p>}
              {kit.productContent.usageInstructions && <p><strong>Применение:</strong> {kit.productContent.usageInstructions}</p>}
            </div>
          </div>
          <div className="kit-section-heading"><div><h3>Банк фактов о продукте</h3><p>Формулировки основаны на данных бренда и могут использоваться без заявления о личном опыте.</p></div></div>
          <div className="facts-grid">
            {Object.entries(kit.facts).map(([label, value]) => (
              <div className="fact-item" key={label}><span>{label}</span><p>{value}</p></div>
            ))}
          </div>
          <div className="claims-grid">
            <div className="claim-panel allowed">
              <h3>Разрешённые формулировки</h3>
              {kit.allowedClaims.map((claim) => <p key={claim}>✓ {claim}</p>)}
            </div>
            <div className="claim-panel forbidden">
              <h3>Запрещённые формулировки</h3>
              {kit.forbiddenClaims.map((claim) => <p key={claim}>× {claim}</p>)}
            </div>
          </div>
          <div className="rules-requirements">
            <div>
              <h3>Правила продвижения без продукта</h3>
              <ol>{kit.noSampleRules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
            </div>
            <div>
              <h3>Требования к публикации</h3>
              {Object.entries(kit.publicationRequirements).map(([label, value]) => (
                <div className="requirement-row" key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {kitTab === "tools" && (
        <div className="kit-content">
          <div className="kit-section-heading"><div><h3>Персональные инструменты креатора</h3><p>Ссылка и промокод создаются после одобрения заявки брендом.</p></div></div>
          {kit.creatorTools ? (
            <div className="creator-tools-grid">
              <div className="tool-card link-tool">
                <span>Партнёрская ссылка</span>
                <strong>{kit.creatorTools.link}</strong>
                <button className="button small" onClick={() => copy(kit.creatorTools.link, "Партнёрская ссылка скопирована")}>Скопировать ссылку</button>
              </div>
              <div className="tool-card promo-tool">
                <span>Промокод</span>
                <strong>{kit.creatorTools.promoCode}</strong>
                <button className="button secondary small" onClick={() => copy(kit.creatorTools.promoCode, "Промокод скопирован")}>Скопировать промокод</button>
              </div>
              <div className="tool-card compact"><span>Статус связи</span><strong>{kit.creatorTools.status === "ACTIVE" ? "Активна" : kit.creatorTools.status}</strong></div>
              <div className="tool-card compact"><span>Комиссия</span><strong>{offer.commission}%</strong></div>
            </div>
          ) : (
            <div className="empty-state">Активная партнёрская связь ещё не создана.</div>
          )}
        </div>
      )}

      {draftOpen && mode === "creator" && (
        <div className="draft-panel">
          <div className="draft-panel-head">
            <div><span className="eyebrow">Ручной черновик</span><h3>Адаптируйте идею под свой стиль</h3></div>
            <button className="icon-button" aria-label="Закрыть" onClick={() => setDraftOpen(false)}>×</button>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Сценарий</label>
              <select className="select-field" value={draftScenario} onChange={(event) => setDraftScenario(event.target.value)}>
                {kit.scenarios.map((scenario) => <option key={scenario.title}>{scenario.title}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Площадка</label>
              <select className="select-field"><option>Telegram</option><option>VK</option><option>Threads</option><option>Короткое видео</option></select>
            </div>
            <div className="form-group full">
              <label className="form-label">Ваш текст</label>
              <textarea className="textarea" placeholder="Напишите собственный текст, опираясь на разрешённые факты и формулировки…" />
            </div>
          </div>
          <div className="form-actions">
            <button className="button secondary" onClick={() => setDraftOpen(false)}>Закрыть</button>
            <button className="button" onClick={() => notify("Черновик сохранён только в интерфейсе прототипа")}>Сохранить черновик</button>
          </div>
        </div>
      )}
    </section>
  );
}

function OfferPage({ offer, applicationStatus, role, apply, navigate, notify, onToggleAsset, onDownloadAsset, onRetryCreatorKit }) {
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [applicationMessage, setApplicationMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!offer) return null;
  const reward = Math.round(offer.price * offer.commission / 100);
  const action = () => {
    if (role !== "creator") {
      navigate("register", { role: "creator", offerId: offer.id });
      return;
    }
    if (applicationStatus === "none" || ["rejected", "cancelled"].includes(applicationStatus)) setApplicationOpen(true);
    else navigate("creator");
  };

  const submitApplication = async () => {
    setSubmitting(true);
    const saved = await apply(offer.id, applicationMessage);
    setSubmitting(false);
    if (saved) {
      setApplicationOpen(false);
      setApplicationMessage("");
    }
  };

  const buttonLabel =
    role !== "creator" ? "Подать заявку" :
    applicationStatus === "none" || ["rejected", "cancelled"].includes(applicationStatus) ? "Подать заявку" :
    applicationStatus === "pending" ? "Перейти к заявкам" :
    "Перейти в кабинет";

  return (
    <main className="offer-page">
      <div className="container">
        <div className="breadcrumbs">
          <button onClick={() => navigate("catalog")}>Каталог</button>
          <span>/</span>
          <span>{offer.brand}</span>
        </div>
        <div className="offer-layout">
          <div className="offer-gallery-main">
            <img src={offer.image} alt={offer.title} />
          </div>
          <div className="offer-detail">
            <div className="brand-line">{offer.brand} · {offer.category}</div>
            <h1>{offer.title}</h1>
            <div className="price-line">
              <span className="price">{money(offer.price)}</span>
              <span className="commission">Вы заработаете {offer.commission}% · {money(reward)} с подтверждённой продажи</span>
            </div>
            <p className="description">{offer.description}</p>
            <div className="eligibility-box">
              <h3>Товар доступен после {offer.threshold} подтверждённых продаж</h3>
              <p>До достижения порога используйте материалы бренда и персональную партнёрскую ссылку. После выполнения условия в кабинете появится кнопка запроса.</p>
              <div className="eligibility-sequence">
                <span>Заявка</span><b>→</b><span>Ссылка</span><b>→</b><span>{offer.threshold} продаж</span><b>→</b><span>Запрос товара</span>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row"><span>Условия</span><strong>{offer.terms}</strong></div>
              <div className="detail-row"><span>Creator Kit</span><strong>{role === "guest" ? "Доступен после входа креатора" : `Digital Access · ${offer.creatorKit?.assets?.filter((asset) => asset.active).length || 0} материалов`}</strong></div>
              <div className="detail-row"><span>Начисление</span><strong>После подтверждения продажи</strong></div>
            </div>
            {applicationStatus === "pending" && <p><Status type="pending">Заявка на рассмотрении</Status></p>}
            {applicationStatus === "approved" && <p><Status type="success">Заявка одобрена</Status></p>}
            {applicationStatus === "rejected" && <p><Status type="danger">Предыдущая заявка отклонена</Status></p>}
            {applicationStatus === "cancelled" && <p><Status>Предыдущая заявка отменена</Status></p>}
            <button className="button wide" onClick={action}>{buttonLabel}</button>
          </div>
        </div>
        {applicationOpen && role === "creator" && (
          <div className="draft-panel">
            <div className="draft-panel-head">
              <div><span className="eyebrow">Заявка бренду</span><h3>Расскажите, как планируете продвигать товар</h3></div>
              <button className="icon-button" aria-label="Закрыть" onClick={() => setApplicationOpen(false)}>×</button>
            </div>
            <div className="form-group">
              <label className="form-label">Сообщение, необязательно</label>
              <textarea className="textarea" maxLength={2000} value={applicationMessage} onChange={(event) => setApplicationMessage(event.target.value)} placeholder="Кратко опишите аудиторию и предполагаемый формат публикации." />
            </div>
            <div className="form-actions">
              <button className="button secondary" onClick={() => setApplicationOpen(false)}>Отмена</button>
              <button className="button" disabled={submitting} onClick={submitApplication}>{submitting ? "Отправка…" : "Отправить заявку"}</button>
            </div>
          </div>
        )}
        {role !== "guest" && (
          <CreatorKit
            offer={offer}
            mode="creator"
            hasProductAccess={false}
            notify={notify}
            onToggleAsset={onToggleAsset}
            onDownloadAsset={onDownloadAsset}
            onRetry={() => onRetryCreatorKit(offer.id)}
          />
        )}
      </div>
    </main>
  );
}

function RegisterPage({ presetRole, complete, navigate }) {
  const [step, setStep] = useState(presetRole ? 2 : 1);
  const [selectedRole, setSelectedRole] = useState(presetRole || "");
  const [form, setForm] = useState({});

  useEffect(() => {
    if (presetRole) {
      setSelectedRole(presetRole);
      setStep(2);
    }
  }, [presetRole]);

  const update = (key, value) => setForm({ ...form, [key]: value });

  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <div>
          <BrandLogo onClick={() => navigate("home")} />
          <h1>{selectedRole === "brand" ? "Создайте новый канал партнёрских продаж" : "Начните с офферов, подходящих вашей аудитории"}</h1>
          <p>{selectedRole === "brand" ? "Настройте комиссию, загрузите материалы и рассматривайте заявки креаторов." : "Сравнивайте условия, получайте персональные ссылки и следите за прогрессом до получения товара."}</p>
        </div>
        <div className="auth-note">Аккаунт сохраняется в локальной базе PostgreSQL. Используйте только тестовые данные.</div>
      </aside>
      <section className="auth-main">
        <div className="auth-panel">
          {step === 1 ? (
            <>
              <h2>Выберите роль</h2>
              <p>Роль определит состав кабинета и доступные действия.</p>
              <div className="role-cards">
                <button className="role-card" onClick={() => { setSelectedRole("creator"); setStep(2); }}>
                  <span className="role-glyph">К</span>
                  <h3>Креатор</h3>
                  <p>Выбирать офферы, получать ссылки и зарабатывать комиссию.</p>
                </button>
                <button className="role-card" onClick={() => { setSelectedRole("brand"); setStep(2); }}>
                  <span className="role-glyph">Б</span>
                  <h3>Бренд</h3>
                  <p>Размещать товары, задавать условия и рассматривать заявки.</p>
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>{selectedRole === "creator" ? "Регистрация креатора" : "Регистрация бренда"}</h2>
              <p>Заполните основные данные для создания тестового аккаунта.</p>
              <div className="form-grid">
                {selectedRole === "creator" ? (
                  <>
                    <div className="form-group full">
                      <label className="form-label">Имя</label>
                      <input className="field" value={form.name || ""} onChange={(e) => update("name", e.target.value)} placeholder="Анна Лебедева" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input className="field" type="email" value={form.email || ""} onChange={(e) => update("email", e.target.value)} placeholder="anna@example.ru" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Тематика</label>
                      <select className="select-field" value={form.topic || ""} onChange={(e) => update("topic", e.target.value)}>
                        <option value="">Выберите тематику</option>
                        <option>Красота и уход</option>
                        <option>Мода</option>
                        <option>Дом и интерьер</option>
                        <option>Образ жизни</option>
                      </select>
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Основная площадка</label>
                      <input className="field" value={form.channel || ""} onChange={(e) => update("channel", e.target.value)} placeholder="https://..." />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Пароль</label>
                      <input className="field" type="password" value={form.password || ""} onChange={(e) => update("password", e.target.value)} placeholder="Не менее 10 символов, буквы и цифры" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="form-group full">
                      <label className="form-label">Название компании</label>
                      <input className="field" value={form.company || ""} onChange={(e) => update("company", e.target.value)} placeholder="Название бренда" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Представитель</label>
                      <input className="field" value={form.name || ""} onChange={(e) => update("name", e.target.value)} placeholder="Имя и фамилия" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input className="field" type="email" value={form.email || ""} onChange={(e) => update("email", e.target.value)} placeholder="name@brand.ru" />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Сайт бренда</label>
                      <input className="field" value={form.website || ""} onChange={(e) => update("website", e.target.value)} placeholder="https://..." />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Пароль</label>
                      <input className="field" type="password" value={form.password || ""} onChange={(e) => update("password", e.target.value)} placeholder="Не менее 10 символов, буквы и цифры" />
                    </div>
                  </>
                )}
              </div>
              <div className="form-actions">
                <button className="button ghost" onClick={() => setStep(1)}>← Назад</button>
                <button className="button" onClick={() => complete(selectedRole, form)}>Создать аккаунт</button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function LoginPage({ login, verifyMfa, navigate }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [challengeToken, setChallengeToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const submitLogin = async () => {
    const challenge = await login(form);
    if (challenge?.mfaRequired) setChallengeToken(challenge.challengeToken);
  };
  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <div>
          <BrandLogo onClick={() => navigate("home")} />
          <h1>Продолжите работу в своём кабинете</h1>
          <p>Сессия восстанавливается после перезагрузки через защищённую refresh-cookie.</p>
        </div>
        <div className="auth-note">Для локальной разработки используйте тестовые аккаунты из README.</div>
      </aside>
      <section className="auth-main">
        <div className="auth-panel">
          <h2>{challengeToken ? "Подтверждение входа" : "Вход"}</h2>
          <p>{challengeToken ? "Введите код из приложения-аутентификатора или одноразовый recovery code." : "Введите email и пароль тестового аккаунта."}</p>
          <div className="form-grid">
            {challengeToken ? (
              <div className="form-group full">
                <label className="form-label">Код MFA</label>
                <input className="field" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} autoComplete="one-time-code" />
              </div>
            ) : (
              <>
                <div className="form-group full">
                  <label className="form-label">Email</label>
                  <input className="field" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                </div>
                <div className="form-group full">
                  <label className="form-label">Пароль</label>
                  <input className="field" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
                </div>
              </>
            )}
          </div>
          <div className="form-actions">
            <button className="button ghost" onClick={() => challengeToken ? setChallengeToken("") : navigate("home")}>← Назад</button>
            <button className="button" onClick={() => challengeToken ? verifyMfa(challengeToken, mfaCode) : submitLogin()}>
              {challengeToken ? "Подтвердить" : "Войти"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function DashboardLayout({ roleLabel, items, active, setActive, children }) {
  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-role">{roleLabel}</div>
        <nav className="sidebar-nav">
          {items.map((item) => (
            <button key={item.id} className={`sidebar-item ${active === item.id ? "active" : ""}`} onClick={() => setActive(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <section className="dashboard-content">{children}</section>
    </main>
  );
}

const applicationStatusLabels = {
  PENDING: "На рассмотрении",
  APPROVED: "Одобрена",
  REJECTED: "Отклонена",
  CANCELLED: "Отменена",
  WITHDRAWN: "Отозвана"
};

function applicationUiState(application) {
  return getApplicationUiState(application);
}

function formatRateBps(bps) {
  const value = Number(bps || 0) / 100;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

const relationshipStatusLabels = {
  ACTIVE: "Активна",
  PAUSED: "Приостановлена",
  REVOKED: "Отозвана"
};

function CreatorDashboard({ user, applications, relationships, offers, finance, notifications, acceptTerms, withdrawApplication, copyValue, navigate }) {
  const [tab, setTab] = useState("offers");
  const activeRelationships = relationships.filter((item) => item.status === "ACTIVE");
  const displayName = user?.profile?.displayName || user?.name || "креатор";
  const actionRequired = applications.filter((item) => applicationUiState(item) === "TERMS_CHANGED");

  return (
    <DashboardLayout
      roleLabel="Кабинет креатора"
      items={[
        { id: "offers", label: "Мои офферы" },
        { id: "applications", label: actionRequired.length ? `Заявки (${actionRequired.length})` : "Заявки" },
        { id: "links", label: "Партнёрские ссылки" },
        { id: "rewards", label: "Вознаграждения" }
      ]}
      active={tab}
      setActive={setTab}
    >
      <div className="dashboard-header">
        <div>
          <h1>Здравствуйте, {displayName}</h1>
          <p>Ваши заявки и действующие партнёрские связи.</p>
        </div>
        <button className="button" onClick={() => navigate("catalog")}>Найти оффер</button>
      </div>
      <div className="creator-warning compact-warning">
        <span className="warning-mark">i</span>
        <strong>Заявки, партнёрские ссылки, клики, продажи и комиссии загружаются с сервера. Непрочитанных уведомлений: {notifications.counts?.unread || 0}.</strong>
      </div>
      {!!actionRequired.length && (
        <div className="panel">
          <div className="panel-header"><h2>Требуется действие</h2><Status type="danger">{actionRequired.length}</Status></div>
          <div className="panel-body">
            {actionRequired.map((application) => (
              <div className="tool-card" key={application.id}>
                <span><strong>Условия оффера изменились</strong> · {application.offer.title}</span>
                <span>Предыдущая ставка: {formatRateBps(application.latestAcceptedTerms?.creatorEffectiveGmvBps || application.termsObservation?.displayedCreatorEffectiveBps)}</span>
                <span>Новая ставка: {formatRateBps(application.applicableCommercialTerms?.creatorEffectiveGmvBps)}</span>
                <div className="row-actions">
                  <button className="button" onClick={() => acceptTerms(application)}>Принять новые условия</button>
                  <button className="button ghost" onClick={() => withdrawApplication(application.id)}>Отозвать заявку</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="stats-grid">
        <div className="stat-card"><span className="stat-label">Активные связи</span><span className="stat-value">{activeRelationships.length}</span><span className="stat-note">с рабочей ссылкой</span></div>
        <div className="stat-card"><span className="stat-label">На рассмотрении</span><span className="stat-value">{applications.filter((item) => item.status === "PENDING").length}</span><span className="stat-note">заявок</span></div>
        <div className="stat-card"><span className="stat-label">Одобрено</span><span className="stat-value">{applications.filter((item) => item.status === "APPROVED").length}</span><span className="stat-note">заявок</span></div>
        <div className="stat-card"><span className="stat-label">Продажи</span><span className="stat-value">{finance.summary?.ordersCount || 0}</span><span className="stat-note">{moneyKopecks(finance.summary?.grossSalesKopecks)} оборота</span></div>
      </div>

      {tab === "offers" && (
        <div className="panel">
          <div className="panel-header"><h2>Партнёрские офферы</h2><Status type="success">{activeRelationships.length} активных</Status></div>
          <div className="panel-body">
            {relationships.map((relationship) => {
              const offer = offers.find((item) => item.id === relationship.offerId);
              if (!offer) return null;
              return (
                <div className="creator-offer" key={relationship.id}>
                  <div className="creator-offer-image"><img src={offer.image} alt="" /></div>
                  <div>
                    <h3>{offer.title}</h3>
                    <p>{offer.brand} · ваша ставка {formatRateBps(relationship.commercialAgreement?.creatorEffectiveGmvBps || offer.creatorEffectiveBps)}</p>
                  </div>
                  <div><Status type={relationship.status === "ACTIVE" ? "success" : relationship.status === "REVOKED" ? "danger" : "pending"}>{relationshipStatusLabels[relationship.status]}</Status></div>
                  <div className="creator-offer-actions">
                    <button className="button secondary small" onClick={() => navigate("offer", { offerId: offer.id })}>Creator Kit</button>
                  </div>
                </div>
              );
            })}
            {!relationships.length && <div className="empty-state">Одобренных партнёрских офферов пока нет.</div>}
          </div>
        </div>
      )}

      {tab === "applications" && (
        <div className="panel">
          <div className="panel-header"><h2>Мои заявки</h2></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Оффер</th><th>Бренд</th><th>Дата</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {applications.map((application) => {
                  const uiState = applicationUiState(application);
                  return <tr key={application.id}>
                    <td><span className="table-title">{application.offer.title}</span>{application.message && <span className="table-subtitle">{application.message}</span>}</td>
                    <td>{application.offer.brand.brandName}</td>
                    <td>{new Date(application.createdAt).toLocaleDateString("ru-RU")}</td>
                    <td><Status type={uiState === "APPROVED" ? "success" : ["REJECTED", "WITHDRAWN", "TERMS_CHANGED"].includes(uiState) ? "danger" : "pending"}>{uiState === "TERMS_CHANGED" ? "Условия изменились" : uiState === "CREATOR_REACCEPTED" ? "Новые условия приняты" : applicationStatusLabels[application.status]}</Status></td>
                    <td>{application.status === "PENDING" && <button className="button secondary small" onClick={() => withdrawApplication(application.id)}>Отозвать</button>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {!applications.length && <div className="empty-state">Вы ещё не подавали заявки.</div>}
        </div>
      )}

      {tab === "links" && (
        <div className="panel">
          <div className="panel-header"><h2>Мои партнёрские ссылки</h2></div>
          <div className="panel-body">
            {relationships.map((relationship) => (
              <div className="tool-card link-tool" key={relationship.id}>
                <span>{relationship.offer.title} · {relationshipStatusLabels[relationship.status]}</span>
                <strong>{relationship.affiliateUrl}</strong>
                <div className="row-actions">
                  <button className="button small" disabled={relationship.status !== "ACTIVE"} onClick={() => copyValue(relationship.affiliateUrl, "Партнёрская ссылка скопирована")}>Скопировать ссылку</button>
                  <button className="button secondary small" disabled={relationship.status !== "ACTIVE"} onClick={() => copyValue(relationship.promoCode, "Промокод скопирован")}>Промокод: {relationship.promoCode}</button>
                </div>
              </div>
            ))}
            {!relationships.length && <div className="empty-state">Партнёрские ссылки появятся после одобрения заявки.</div>}
          </div>
        </div>
      )}

      {tab === "rewards" && (
        <div className="panel">
          <div className="panel-header"><h2>Продажи и вознаграждения</h2><Status type="success">Подключено</Status></div>
          <div className="stats-grid panel-body">
            <div className="stat-card"><span className="stat-label">Клики</span><span className="stat-value">{finance.summary?.clicksCount || 0}</span></div>
            <div className="stat-card"><span className="stat-label">В hold</span><span className="stat-value">{moneyKopecks(finance.summary?.holdKopecks)}</span></div>
            <div className="stat-card"><span className="stat-label">Доступно</span><span className="stat-value">{moneyKopecks(finance.summary?.availableKopecks)}</span></div>
            <div className="stat-card"><span className="stat-label">Выплачено</span><span className="stat-value">{moneyKopecks(finance.summary?.paidKopecks)}</span></div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Заказ</th><th>Оффер</th><th>Сумма</th><th>Статус</th><th>Комиссия</th></tr></thead>
              <tbody>
                {(finance.orders?.items || []).map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.externalOrderId}</strong><span className="table-subtitle">{new Date(order.orderDate).toLocaleDateString("ru-RU")}</span></td>
                    <td>{order.offer.title}</td>
                    <td>{moneyKopecks(order.amountKopecks)}</td>
                    <td><Status type={order.status === "PAID" ? "success" : ["RETURNED", "CANCELLED"].includes(order.status) ? "danger" : "pending"}>{order.status}</Status></td>
                    <td>{order.commission ? moneyKopecks(order.commission.creatorAmountKopecks) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!finance.orders?.items?.length && <div className="empty-state">Атрибутированных продаж пока нет.</div>}
          {Number(finance.summary?.debtKopecks || 0) > 0 && <div className="creator-warning compact-warning"><span className="warning-mark">!</span><strong>Задолженность после возвратов: {moneyKopecks(finance.summary.debtKopecks)}</strong></div>}
          {!!finance.payouts?.items?.length && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Дата</th><th>Сумма</th><th>Валюта</th><th>Статус</th></tr></thead>
                <tbody>{finance.payouts.items.map((payout) => <tr key={payout.id}><td>{new Date(payout.createdAt).toLocaleDateString("ru-RU")}</td><td>{moneyKopecks(payout.amountKopecks)}</td><td>{payout.currency}</td><td><Status type={payout.status === "PAID" ? "success" : "pending"}>{payout.status}</Status></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

function TrackingStatus({ stage }) {
  const steps = [
    "Не подключено",
    "Подключение обнаружено",
    "Тестовая конверсия получена",
    "Интеграция работает"
  ];

  return (
    <div className="tracking-status" aria-label={`Статус: ${steps[stage]}`}>
      {steps.map((label, index) => (
        <div className={`tracking-status-step ${index < stage ? "complete" : ""} ${index === stage ? "active" : ""}`} key={label}>
          <span className="tracking-status-dot">{index < stage ? "✓" : index + 1}</span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function SalesTracking({ notify }) {
  const [trackingStage, setTrackingStage] = useState(0);
  const [secretVersion, setSecretVersion] = useState(1);
  const [csvName, setCsvName] = useState("");
  const [csvChecked, setCsvChecked] = useState(false);

  const trackingCode = `<script>
  window.sviazka = {
    brandId: "br_lunea_4821",
    endpoint: "https://track.sviazka.ru/conversion"
  };
</script>`;

  const copy = (value, message) => {
    if (navigator.clipboard) navigator.clipboard.writeText(value).catch(() => {});
    notify(message);
  };

  const downloadTemplate = () => {
    const csv = "order_id,affiliate_code,amount,currency,status,created_at\\nORD-1001,TESTCODE123,6490,RUB,confirmed,2026-07-27T10:00:00+07:00\\n";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "sviazka-orders-template.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Шаблон CSV скачан");
  };

  const previewOrders = [
    { id: "ORD-1042", partner: "TESTCODE123", amount: 6490, status: "Подтверждён" },
    { id: "ORD-1043", partner: "maria-7k2", amount: 6490, status: "Подтверждён" },
    { id: "ORD-1044", partner: "elena-3p8", amount: 7200, status: "Ожидает" }
  ];

  return (
    <div className="tracking-page">
      <section className="tracking-overview">
        <div className="tracking-overview-copy">
          <span className="eyebrow">Текущий статус</span>
          <h2>{["Отслеживание не подключено", "Код установки обнаружен", "Тестовая конверсия получена", "Продажи передаются корректно"][trackingStage]}</h2>
          <p>Выберите один способ интеграции. Все проверки в прототипе демонстрационные и не отправляют реальные данные.</p>
        </div>
        <TrackingStatus stage={trackingStage} />
      </section>

      <section className="tracking-section">
        <div className="tracking-section-head">
          <div>
            <span className="tracking-number">01</span>
            <h2>Готовые интеграции с CMS</h2>
            <p>Подключение без ручной установки кода.</p>
          </div>
          <Status>Скоро</Status>
        </div>
        <div className="cms-grid">
          {[
            ["Shopify", "SH"],
            ["Tilda", "TI"],
            ["WooCommerce", "WC"],
            ["InSales", "IS"],
            ["Bitrix", "BX"]
          ].map(([name, glyph]) => (
            <div className="cms-card" key={name}>
              <span className="cms-glyph">{glyph}</span>
              <strong>{name}</strong>
              <Status>Скоро</Status>
            </div>
          ))}
        </div>
      </section>

      <section className="tracking-section">
        <div className="tracking-section-head">
          <div>
            <span className="tracking-number">02</span>
            <h2>Универсальный код отслеживания</h2>
            <p>Добавьте индивидуальный JavaScript-код бренда на страницу подтверждения заказа.</p>
          </div>
          <Status type={trackingStage >= 1 ? "success" : ""}>{trackingStage >= 1 ? "Код обнаружен" : "Не подключено"}</Status>
        </div>
        <div className="code-block">
          <div className="code-block-head">
            <span>Код бренда LUNEA</span>
            <span>JavaScript</span>
          </div>
          <pre>{trackingCode}</pre>
        </div>
        <div className="integration-actions">
          <button className="button secondary" onClick={() => copy(trackingCode, "Код скопирован")}>Скопировать код</button>
          <button className="button" onClick={() => { setTrackingStage(Math.max(trackingStage, 1)); notify("Установка обнаружена в демонстрационном режиме"); }}>Проверить установку</button>
          <button className="button ghost" onClick={() => notify("Инструкция подготовлена для отправки разработчику")}>Отправить разработчику</button>
        </div>
      </section>

      <section className="tracking-section">
        <div className="tracking-section-head">
          <div>
            <span className="tracking-number">03</span>
            <h2>Server-to-server API</h2>
            <p>Передавайте подтверждённые заказы напрямую с сервера магазина.</p>
          </div>
          <Status type={trackingStage >= 2 ? "success" : ""}>{trackingStage >= 2 ? "Тест получен" : "Не подключено"}</Status>
        </div>
        <div className="api-credentials">
          <div className="credential-row">
            <span>API endpoint</span>
            <code>https://api.sviazka.ru/v1/conversions</code>
            <button className="text-button" onClick={() => copy("https://api.sviazka.ru/v1/conversions", "Endpoint скопирован")}>Копировать</button>
          </div>
          <div className="credential-row">
            <span>Brand ID</span>
            <code>br_lunea_4821</code>
            <button className="text-button" onClick={() => copy("br_lunea_4821", "Brand ID скопирован")}>Копировать</button>
          </div>
          <div className="credential-row">
            <span>Секретный ключ</span>
            <code>sk_live_••••••••••••{String(8290 + secretVersion).slice(-4)}</code>
            <button className="text-button" onClick={() => { setSecretVersion(secretVersion + 1); notify("Демонстрационный секретный ключ обновлён"); }}>Регенерировать</button>
          </div>
        </div>
        <div className="integration-actions">
          <button className="button secondary" onClick={() => notify("Документация API откроется после подключения backend")}>Документация ↗</button>
          <button className="button" onClick={() => { setTrackingStage(Math.max(trackingStage, 2)); notify("Тестовая конверсия получена"); }}>Тест соединения</button>
        </div>
      </section>

      <section className="tracking-section">
        <div className="tracking-section-head">
          <div>
            <span className="tracking-number">04</span>
            <h2>Ручной импорт CSV</h2>
            <p>Загрузите подтверждённые заказы по готовому шаблону.</p>
          </div>
          <Status type={csvChecked ? "success" : ""}>{csvChecked ? "Проверено" : "Файл не загружен"}</Status>
        </div>
        <div className="csv-toolbar">
          <button className="button secondary" onClick={downloadTemplate}>Скачать шаблон</button>
          <label className="button secondary file-button">
            Загрузить файл
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files && event.target.files[0];
                if (file) {
                  setCsvName(file.name);
                  setCsvChecked(false);
                  notify(`Файл «${file.name}» добавлен`);
                }
              }}
            />
          </label>
          <span className="csv-file-name">{csvName || "Файл не выбран"}</span>
        </div>

        {csvName && (
          <div className="csv-preview">
            <div className="panel-header">
              <h3>Предпросмотр заказов</h3>
              <button className="button small" onClick={() => { setCsvChecked(true); setTrackingStage(3); notify("Ошибок не найдено. Импорт готов"); }}>Проверить ошибки</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Заказ</th><th>Partner ID</th><th>Сумма</th><th>Статус</th></tr></thead>
                <tbody>
                  {previewOrders.map((order) => (
                    <tr key={order.id}>
                      <td><strong>{order.id}</strong></td>
                      <td>{order.partner}</td>
                      <td>{money(order.amount)}</td>
                      <td><Status type={order.status === "Подтверждён" ? "success" : "pending"}>{order.status}</Status></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {csvChecked && <div className="validation-result">Ошибок не найдено · 3 заказа готовы к демонстрационному импорту</div>}
          </div>
        )}

        <div className="import-history">
          <h3>История импортов</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Файл</th><th>Дата</th><th>Заказы</th><th>Ошибки</th><th>Статус</th></tr></thead>
              <tbody>
                <tr><td><strong>orders_july_24.csv</strong></td><td>24.07.2026, 16:40</td><td>18</td><td>0</td><td><Status type="success">Импортирован</Status></td></tr>
                <tr><td><strong>orders_july_18.csv</strong></td><td>18.07.2026, 11:15</td><td>12</td><td>2</td><td><Status type="danger">Есть ошибки</Status></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="tracking-scenario">
        <strong>Пользовательский сценарий</strong>
        <span>Выбрать способ → установить код или настроить передачу → запустить проверку → получить тестовую конверсию → увидеть статус «Интеграция работает».</span>
      </section>
    </div>
  );
}

function SalesTrackingLive({ role, notify, preview, onUpload, onConfirm }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [installations, setInstallations] = useState([]);
  const [trackerForm, setTrackerForm] = useState({
    name: "",
    primaryDomain: "",
    allowedOrigins: "",
    consentMode: "REQUIRED"
  });
  const [trackerSecret, setTrackerSecret] = useState(null);
  const [trackerSnippet, setTrackerSnippet] = useState("");
  const [trackerBusy, setTrackerBusy] = useState(false);

  const loadInstallations = async () => {
    if (role !== "brand") return;
    try {
      setInstallations(await api("/brand/tracker-installations"));
    } catch (error) {
      notify(error.message);
    }
  };

  useEffect(() => {
    if (role === "brand") {
      loadInstallations();
    } else {
      setInstallations([]);
      setTrackerSecret(null);
      setTrackerSnippet("");
    }
  }, [role]);

  const createTrackerInstallation = async (event) => {
    event.preventDefault();
    setTrackerBusy(true);
    setTrackerSecret(null);
    try {
      const created = await api("/brand/tracker-installations", {
        method: "POST",
        body: JSON.stringify(buildTrackerInstallationPayload(trackerForm))
      });
      const { webhookSecret, ...installation } = created;
      setTrackerSecret(webhookSecret);
      setTrackerSnippet(trackerScriptSnippet(installation.publicKey, getPublicBackendOrigin()));
      setInstallations((current) => [installation, ...current]);
      notify("Установка tracker создана. Сохраните секрет сейчас.");
    } catch (error) {
      notify(error.message);
    } finally {
      setTrackerBusy(false);
    }
  };

  const activateTrackerInstallation = async (installationId) => {
    setTrackerBusy(true);
    try {
      const updated = await api(`/brand/tracker-installations/${installationId}/activate`, { method: "POST" });
      setInstallations((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      notify("Установка tracker активирована");
    } catch (error) {
      notify(error.message);
    } finally {
      setTrackerBusy(false);
    }
  };

  const rotateTrackerSecret = async (installationId) => {
    setTrackerBusy(true);
    setTrackerSecret(null);
    try {
      const rotated = await api(`/brand/tracker-installations/${installationId}/rotate-secret`, { method: "POST" });
      setTrackerSecret(rotated.webhookSecret);
      notify("Секрет обновлён. Сохраните его сейчас.");
    } catch (error) {
      notify(error.message);
    } finally {
      setTrackerBusy(false);
    }
  };

  const downloadTemplate = () => {
    const content = [
      "external_order_id,order_date,amount_kopecks,currency,status,returned_amount_kopecks,affiliate_code,promo_code,click_id,offer_id",
      "ORDER-1001,2026-07-31T10:00:00.000Z,249000,RUB,paid,,AFFILIATE_CODE,,,,"
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "svyazka-orders-template.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Шаблон CSV скачан");
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await onUpload(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tracking-page">
      <section className="tracking-overview">
        <div className="tracking-overview-copy">
          <span className="eyebrow">Stage 8</span>
          <h2>Передача заказов и атрибуция продаж</h2>
          <p>{role === "brand" ? "Настройте tracker для сайта или загрузите подтверждённые заказы через CSV. Сервер проверяет данные до их обработки." : "Загрузите подтверждённые заказы через CSV. Сервер проверяет данные до их обработки."}</p>
        </div>
        <Status type={preview?.status === "IMPORTED" ? "success" : preview ? "pending" : ""}>
          {preview?.status === "IMPORTED" ? "Импортировано" : preview ? "Готово к проверке" : "Файл не загружен"}
        </Status>
      </section>

      {role === "brand" && (
        <section className="tracking-section">
          <div className="tracking-section-head">
            <div>
              <span className="tracking-number">01</span>
              <h2>JavaScript tracker</h2>
              <p>Создайте установку для домена магазина. Секрет показывается только сразу после создания или ротации.</p>
            </div>
          </div>
          <form className="panel-body form-grid" onSubmit={createTrackerInstallation}>
            <div className="form-group"><label className="form-label">Название установки</label><input className="field" required value={trackerForm.name} onChange={(event) => setTrackerForm((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Основной домен</label><input className="field" required placeholder="shop.example.com" value={trackerForm.primaryDomain} onChange={(event) => setTrackerForm((current) => ({ ...current, primaryDomain: event.target.value }))} /></div>
            <div className="form-group full"><label className="form-label">Разрешённые origins</label><input className="field" required placeholder="https://shop.example.com" value={trackerForm.allowedOrigins} onChange={(event) => setTrackerForm((current) => ({ ...current, allowedOrigins: event.target.value }))} /><small className="stat-note">Укажите HTTPS origins через запятую.</small></div>
            <div className="form-group"><label className="form-label">Consent mode</label><select className="select-field" value={trackerForm.consentMode} onChange={(event) => setTrackerForm((current) => ({ ...current, consentMode: event.target.value }))}><option value="REQUIRED">REQUIRED</option><option value="ASSUMED_BY_BRAND">ASSUMED_BY_BRAND</option><option value="SESSION_ONLY">SESSION_ONLY</option></select></div>
            <div className="form-actions full"><button className="button" type="submit" disabled={trackerBusy}>{trackerBusy ? "Сохраняем…" : "Создать установку"}</button></div>
          </form>

          {!!trackerSecret && (
            <div className="creator-warning compact-warning">
              <span className="warning-mark">!</span>
              <strong>Секрет показан один раз. Скопируйте его сейчас и не публикуйте в браузерном коде.</strong>
              <code>{trackerSecret}</code>
            </div>
          )}
          {!!trackerSnippet && (
            <div className="code-block">
              <div className="code-block-head"><span>Установка tracker</span><span>JavaScript</span></div>
              <pre>{trackerSnippet}</pre>
            </div>
          )}

          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Установка</th><th>Домен</th><th>Статус</th><th>Здоровье</th><th></th></tr></thead>
              <tbody>{installations.map((installation) => (
                <tr key={installation.id}>
                  <td><strong>{installation.name}</strong><span className="table-subtitle">{installation.publicKey}</span><code>{trackerScriptSnippet(installation.publicKey, getPublicBackendOrigin())}</code></td>
                  <td>{installation.primaryDomain}</td>
                  <td><Status type={installation.status === "ACTIVE" ? "success" : "pending"}>{installation.status}</Status></td>
                  <td>{installation.healthStatus || "—"}</td>
                  <td><div className="row-actions">
                    {installation.status !== "ACTIVE" && <button className="button small" type="button" disabled={trackerBusy} onClick={() => activateTrackerInstallation(installation.id)}>Активировать</button>}
                    <button className="button secondary small" type="button" disabled={trackerBusy} onClick={() => { setTrackerSnippet(trackerScriptSnippet(installation.publicKey, getPublicBackendOrigin())); rotateTrackerSecret(installation.id); }}>Ротировать секрет</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!installations.length && <div className="empty-state">Установки tracker ещё не созданы.</div>}
        </section>
      )}

      <section className="tracking-section">
        <div className="tracking-section-head">
            <div><span className="tracking-number">{role === "brand" ? "02" : "01"}</span><h2>Импорт и предпросмотр CSV</h2><p>Поддерживаются статусы pending, paid, cancelled, returned и partially_returned.</p></div>
        </div>
        <div className="csv-toolbar">
          <button className="button secondary" onClick={downloadTemplate}>Скачать шаблон</button>
          <label className="button secondary file-button">
            Выбрать CSV
            <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </label>
          <span className="csv-file-name">{file?.name || "Файл не выбран"}</span>
          <button className="button" disabled={!file || busy} onClick={upload}>{busy ? "Проверяем…" : "Загрузить и проверить"}</button>
        </div>
      </section>

      {preview && (
        <section className="tracking-section">
          <div className="tracking-section-head">
            <div><span className="tracking-number">{role === "brand" ? "03" : "02"}</span><h2>Предпросмотр заказов</h2><p>Валидные строки: {preview.validRows}; ошибки и конфликты: {preview.invalidRows}; дубли: {preview.duplicateRows}.</p></div>
            <button className="button" disabled={preview.status !== "READY" || preview.validRows === 0} onClick={() => onConfirm(preview.id)}>Подтвердить импорт</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Строка</th><th>Заказ</th><th>Атрибуция</th><th>Сумма</th><th>Комиссия</th><th>Проверка</th></tr></thead>
              <tbody>
                {(preview.rows || []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.rowNumber}</td>
                    <td><span className="table-title">{row.externalOrderId || "Не указан"}</span><span className="table-subtitle">{row.orderStatus || "Статус не распознан"}</span></td>
                    <td>{row.attributedRelationship?.creator?.displayName || "Не атрибутирован"}<span className="table-subtitle">{row.attributionSource}</span></td>
                    <td>{moneyKopecks(row.amountKopecks)}</td>
                    <td>{moneyKopecks(row.previewCreatorAmountKopecks)}</td>
                    <td>
                      <Status type={row.status === "VALID" ? "success" : row.status === "DUPLICATE" ? "pending" : "danger"}>{row.status}</Status>
                      {!!row.errors?.length && <span className="table-subtitle">{row.errors.join("; ")}</span>}
                      {!!row.warnings?.length && <span className="table-subtitle">{row.warnings.join("; ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="creator-warning compact-warning">
        <span className="warning-mark">i</span>
        <strong>Установки tracker и CSV используют серверную проверку. Подключение Tilda и signed server-to-server API на этом экране пока не настраивается.</strong>
      </div>
    </div>
  );
}

function BrandCreatorKitManager({
  offers,
  relationships,
  role,
  verificationStatus,
  initialOfferId,
  initialFocus,
  notify,
  onToggleAsset,
  onDownloadAsset,
  onUploadAsset,
  onLoadPreview,
  onSaveScenarios,
  onReload
}) {
  const brandOffers = offers;
  const [selectedOfferId, setSelectedOfferId] = useState(
    brandOffers.some((offer) => offer.id === initialOfferId)
      ? initialOfferId
      : brandOffers[0]?.id || null
  );
  const [preview, setPreview] = useState(false);
  const [previewSource, setPreviewSource] = useState("DRAFT");
  const [previewProduct, setPreviewProduct] = useState(role === "manager" ? "DIGITAL" : "NOT_GRANTED");
  const [previewAffiliate, setPreviewAffiliate] = useState(role === "manager" ? "false" : "INACTIVE");
  const [previewCreatorId, setPreviewCreatorId] = useState("");
  const [previewKit, setPreviewKit] = useState(null);
  const [scenarioDrafts, setScenarioDrafts] = useState([]);
  const [scenariosLoaded, setScenariosLoaded] = useState(false);
  const [scenarioErrors, setScenarioErrors] = useState({});
  const [savingScenarios, setSavingScenarios] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFocused, setUploadFocused] = useState(false);
  const [editor, setEditor] = useState(null);
  const [scenarioForm, setScenarioForm] = useState({
    id: "",
    channel: "REELS",
    title: "",
    hook: "",
    mainIdea: "",
    structure: "",
    cta: "",
    accessLevel: "DIGITAL",
    requiresAffiliateApproval: false
  });
  const [uploadForm, setUploadForm] = useState({
    file: null,
    title: "",
    assetType: "PHOTO",
    accessLevel: "DIGITAL",
    editable: false,
    textAllowed: false,
    paidAdsAllowed: false,
    approvalRequired: false,
    requiresAffiliateApproval: false,
    expiresAt: ""
  });
  const selectedOffer = brandOffers.find((offer) => offer.id === selectedOfferId) || brandOffers[0];
  const kit = selectedOffer
    ? (preview && previewKit ? previewKit : selectedOffer.creatorKit || buildCreatorKit(selectedOffer))
    : null;
  const displayedOffer = selectedOffer
    ? {
        ...selectedOffer,
        creatorKit: kit
          ? { ...kit, scenarios: preview ? (kit.scenarios || []) : scenariosLoaded ? scenarioDrafts : [] }
          : null
      }
    : null;
  const uploadAllowed = verificationStatus === "VERIFIED";
  const offerRelationships = relationships.filter((item) => item.offerId === selectedOffer?.id);
  const relevantCreators = Array.from(
    new Map(offerRelationships.map((item) => [item.creator.id, item.creator])).values()
  );

  useEffect(() => {
    if (!["assets", "scenarios"].includes(initialFocus) || uploadFocused || !editor || !selectedOffer) return undefined;
    const timer = window.setTimeout(() => {
      const targetId = initialFocus === "scenarios" ? "creator-kit-scenarios" : "creator-kit-assets-upload";
      const targetSection = document.getElementById(targetId);
      if (!targetSection) return;
      targetSection.scrollIntoView({ behavior: "smooth", block: "start" });
      const focusSelector = initialFocus === "scenarios" ? 'input:not([type]), input[type="text"]' : 'input[type="file"]';
      targetSection.querySelector(focusSelector)?.focus({ preventScroll: true });
      setUploadFocused(true);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [editor, initialFocus, selectedOffer, uploadFocused]);

  const updateUpload = (key, value) => setUploadForm((current) => ({ ...current, [key]: value }));
  const resetEditor = (sourceKit) => setEditor(sourceKit);

  useEffect(() => {
    const loadedScenarios = selectedOffer?.creatorKitScenariosLoaded && Array.isArray(selectedOffer.creatorKit?.scenarios);
    setScenariosLoaded(Boolean(loadedScenarios));
    setScenarioErrors({});
    setScenarioDrafts(loadedScenarios ? selectedOffer.creatorKit.scenarios.map((scenario) => ({
      channel: scenarioChannelValues[scenario.channel] || scenario.channel,
      title: scenario.title || "",
      idea: scenario.idea || "",
      accessLevel: scenario.accessLevel || "DIGITAL",
      requiresAffiliateApproval: Boolean(scenario.requiresAffiliateApproval)
    })) : []);
  }, [selectedOffer?.id, selectedOffer?.creatorKitScenariosLoaded, selectedOffer?.creatorKit?.scenarios]);

  const loadPreview = async () => {
    if (!selectedOffer) return;
    if (role === "manager") {
      try {
        const nextKit = await onLoadPreview(selectedOffer.id, previewProduct, {
          source: previewSource,
          affiliateApproved: previewAffiliate === "true"
        });
        setPreviewKit(nextKit);
      } catch (error) {
        notify(error.message);
      }
      return;
    }
    if (!previewCreatorId) {
      notify("Сначала одобрите заявку креатора и выберите его для предпросмотра");
      return;
    }
    try {
      const raw = await api(`/brand/offers/${selectedOffer.id}/creator-kit/preview-as-creator`, {
        method: "POST",
        body: JSON.stringify({
          source: previewSource,
          ...(previewCreatorId ? { creatorId: previewCreatorId } : {}),
          productAccess: previewProduct,
          affiliateApproval: previewAffiliate
        })
      });
      setPreviewKit(mapCreatorKit(raw, selectedOffer));
    } catch (error) {
      notify(error.message);
    }
  };

  useEffect(() => {
    if (!selectedOffer?.creatorKit) return;
    resetEditor(selectedOffer.creatorKit);
    setPreviewKit(null);
  }, [selectedOffer?.id, selectedOffer?.creatorKit?.revision?.id]);

  useEffect(() => {
    if (!relevantCreators.some((creator) => creator.id === previewCreatorId)) {
      setPreviewCreatorId(relevantCreators[0]?.id || "");
    }
  }, [selectedOffer?.id, offerRelationships.length]);

  useEffect(() => {
    if (preview && selectedOffer) loadPreview();
  }, [preview, previewSource, previewProduct, previewAffiliate, previewCreatorId, selectedOffer?.id]);

  const refresh = async () => {
    await onReload();
  };

  const saveScenario = async () => {
    if (!selectedOffer) return;
    const payload = {
      channel: scenarioForm.channel,
      title: scenarioForm.title,
      hook: scenarioForm.hook || undefined,
      mainIdea: scenarioForm.mainIdea,
      structure: scenarioForm.structure || undefined,
      cta: scenarioForm.cta || undefined,
      accessLevel: scenarioForm.accessLevel,
      requiresAffiliateApproval: scenarioForm.requiresAffiliateApproval,
      sortOrder: scenarioForm.id
        ? selectedOffer.creatorKit.scenarios.find((item) => item.id === scenarioForm.id)?.sortOrder || 0
        : selectedOffer.creatorKit.scenarios.length
    };
    try {
      await api(
        scenarioForm.id
          ? `/brand/offers/${selectedOffer.id}/creator-kit/scenarios/${scenarioForm.id}`
          : `/brand/offers/${selectedOffer.id}/creator-kit/scenarios`,
        { method: scenarioForm.id ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      setScenarioForm({ id: "", channel: "REELS", title: "", hook: "", mainIdea: "", structure: "", cta: "", accessLevel: "DIGITAL", requiresAffiliateApproval: false });
      await refresh();
      notify("Сценарий сохранён");
    } catch (error) {
      notify(error.message);
    }
  };

  const editScenario = (scenario) => setScenarioForm({
    id: scenario.id,
    channel: scenario.channelValue || scenarioChannelValues[scenario.channel] || "REELS",
    title: scenario.title,
    hook: scenario.hook || "",
    mainIdea: scenario.mainIdea || scenario.idea || "",
    structure: scenario.structure || "",
    cta: scenario.cta || "",
    accessLevel: scenario.accessLevel || "DIGITAL",
    requiresAffiliateApproval: Boolean(scenario.requiresAffiliateApproval)
  });

  const removeScenario = async (scenarioId) => {
    try {
      await api(`/brand/offers/${selectedOffer.id}/creator-kit/scenarios/${scenarioId}`, { method: "DELETE" });
      await refresh();
      notify("Сценарий удалён");
    } catch (error) {
      notify(error.message);
    }
  };

  const moveScenario = async (scenarioId, direction) => {
    const ids = selectedOffer.creatorKit.scenarios.map((item) => item.id);
    const index = ids.indexOf(scenarioId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await api(`/brand/offers/${selectedOffer.id}/creator-kit/scenarios/reorder`, {
        method: "PUT",
        body: JSON.stringify({ scenarioIds: ids })
      });
      await refresh();
    } catch (error) {
      notify(error.message);
    }
  };

  const submitUpload = async (event) => {
    event.preventDefault();
    if (!selectedOffer) return;
    if (!uploadForm.file) {
      notify("Выберите файл");
      return;
    }
    setUploading(true);
    try {
      await onUploadAsset(selectedOffer.id, uploadForm);
      setUploadForm((current) => ({ ...current, file: null, title: "", expiresAt: "" }));
    } catch {
      // Сообщение об ошибке показывает общий обработчик приложения.
    } finally {
      setUploading(false);
    }
  };

  const saveScenarios = async () => {
    if (!selectedOffer || !scenariosLoaded) return;
    const errors = {};
    scenarioDrafts.forEach((scenario, index) => {
      const titleLength = String(scenario.title || "").trim().length;
      const ideaLength = String(scenario.idea || "").trim().length;
      if (titleLength < 3 || titleLength > 200 || ideaLength < 10 || ideaLength > 5000) {
        errors[index] = {
          ...(titleLength < 3 ? { title: "Название должно содержать минимум 3 символа." } : {}),
          ...(titleLength > 200 ? { title: "Название не должно превышать 200 символов." } : {}),
          ...(ideaLength < 10 ? { idea: "Идея должна содержать минимум 10 символов." } : {}),
          ...(ideaLength > 5000 ? { idea: "Идея не должна превышать 5000 символов." } : {})
        };
      }
    });
    if (Object.keys(errors).length) {
      setScenarioErrors(errors);
      notify("Проверьте поля сценариев");
      return;
    }
    setScenarioErrors({});
    setSavingScenarios(true);
    try {
      await onSaveScenarios(selectedOffer.id, scenarioDrafts);
    } finally {
      setSavingScenarios(false);
    }
  };

  if (!selectedOffer) return <div className="empty-state">Создайте оффер, чтобы заполнить Creator Kit.</div>;
  if (!kit || !editor) return <div className="empty-state">Загрузка Creator Kit…</div>;

  return (
    <div className="brand-kit-manager">
      <div className="brand-kit-toolbar">
        <div className="form-group">
          <label className="form-label">Оффер</label>
          <select className="select-field" value={selectedOffer.id} onChange={(event) => setSelectedOfferId(event.target.value)}>
            {brandOffers.map((offer) => <option value={offer.id} key={offer.id}>{offer.title}</option>)}
          </select>
        </div>
        <button className={`button ${preview ? "secondary" : ""}`} onClick={() => { setPreview(!preview); setPreviewKit(null); }}>
          {preview ? "Вернуться к управлению" : "Предпросмотр глазами креатора"}
        </button>
      </div>

      <div className="kit-analytics-grid">
        <div className="kit-completeness-card">
          <div className="completion-ring" style={{ "--completion": `${kit.completeness * 3.6}deg` }}>
            <span>{kit.completeness}%</span>
          </div>
          <div><span>Заполненность Creator Kit</span><strong>{kit.readyToPublish ? "Основные разделы заполнены" : "Требуется заполнение"}</strong><small>{kit.completenessMissing.length ? `Не хватает: ${kit.completenessMissing.join(", ")}` : "Обязательные разделы заполнены"}</small></div>
        </div>
        <div className="stat-card"><span className="stat-label">Скачивания материалов</span><span className="stat-value">—</span><span className="stat-note">не собираются на этапе MVP</span></div>
        <div className="stat-card"><span className="stat-label">Креаторы использовали</span><span className="stat-value">—</span><span className="stat-note">аналитика будет добавлена позднее</span></div>
        <div className="stat-card"><span className="stat-label">Активные материалы</span><span className="stat-value">{kit.assets.filter((asset) => asset.active).length}</span><span className="stat-note">из {kit.assets.length} загруженных</span></div>
      </div>

      {!preview && (
        <>
          <section className="creator-kit-form-block panel">
            {scenariosLoaded ? (
              <>
                <ScenarioEditor
                  scenarios={scenarioDrafts}
                  errors={scenarioErrors}
                  onChange={(nextScenarios) => {
                    setScenarioDrafts(nextScenarios);
                    setScenarioErrors({});
                  }}
                  disabled={savingScenarios}
                />
                <div className="form-actions">
                  <button className="button" type="button" onClick={saveScenarios} disabled={savingScenarios}>
                    {savingScenarios ? "Сохранение…" : "Сохранить сценарии"}
                  </button>
                </div>
              </>
            ) : (
              <div className="creator-warning compact-warning">
                <span className="warning-mark">!</span>
                <strong>Сценарии Creator Kit не загружены. Редактор не подставляет демонстрационные данные.</strong>
              </div>
            )}
          </section>
          <form id="creator-kit-assets-upload" className="creator-kit-upload panel" onSubmit={submitUpload}>
          <div className="panel-header"><div><h2>Добавить материал</h2><p>Файл загружается напрямую в приватное хранилище и подтверждается сервером.</p></div></div>
          {initialFocus === "assets" && (
            <div className="creator-kit-upload-arrival" role="status">
              <strong>Оффер сохранён.</strong>
              <span>{uploadAllowed ? "Выберите файл ниже и нажмите «Загрузить материал»." : "Загрузка станет доступна после подтверждения бренда администратором."}</span>
            </div>
          )}
          {!uploadAllowed && (
            <div className="creator-warning compact-warning">
              <span className="warning-mark">!</span>
              <strong>Загрузка файлов сейчас заблокирована: бренд ещё не подтверждён администратором. После статуса VERIFIED здесь станет доступна кнопка загрузки. Остальные настройки Creator Kit можно заполнять сейчас.</strong>
            </div>
          )}
          <div className="panel-body form-grid">
            <div className="form-group full">
              <label className="form-label">Файл</label>
              <input className="field" type="file" disabled={!uploadAllowed} accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.pdf" onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setUploadForm((current) => ({ ...current, file, title: current.title || file?.name.replace(/\.[^.]+$/, "") || "" }));
              }} />
              <small className="stat-note">Изображения и PDF до 25 МБ, видео до 500 МБ. SVG и архивы не принимаются.</small>
            </div>
            <div className="form-group"><label className="form-label">Название</label><input className="field" value={uploadForm.title} onChange={(event) => updateUpload("title", event.target.value)} /></div>
            <div className="form-group"><label className="form-label">Тип</label><select className="select-field" value={uploadForm.assetType} onChange={(event) => updateUpload("assetType", event.target.value)}>{Object.entries(assetTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Уровень доступа</label><select className="select-field" value={uploadForm.accessLevel} onChange={(event) => updateUpload("accessLevel", event.target.value)}><option value="DIGITAL">Digital Access</option><option value="PRODUCT">Product Access</option></select></div>
            <div className="form-group"><label className="form-label">Срок действия</label><input className="field" type="date" value={uploadForm.expiresAt} onChange={(event) => updateUpload("expiresAt", event.target.value)} /></div>
            <div className="form-group full">
              <div className="checkbox-grid compact">
                {[
                  ["editable", "Разрешено редактирование"],
                  ["textAllowed", "Можно добавлять текст"],
                  ["paidAdsAllowed", "Можно использовать в платной рекламе"],
                  ["approvalRequired", "Требуется согласование"],
                  ["requiresAffiliateApproval", "Только для одобренных партнёров"]
                ].map(([key, label]) => <label className={uploadForm[key] ? "checked" : ""} key={key}><input type="checkbox" checked={uploadForm[key]} onChange={(event) => updateUpload(key, event.target.checked)} /><span>{label}</span></label>)}
              </div>
            </div>
          </div>
          <div className="form-actions"><button className="button" type="submit" disabled={uploading || !uploadAllowed}>{!uploadAllowed ? "Требуется подтверждение бренда" : uploading ? "Загрузка…" : "Загрузить материал"}</button></div>
          </form>
        </>
      )}

      {preview && (
        <>
        <div className="preview-notice">
          <div>
            <strong>Предпросмотр глазами креатора</strong>
            <span>Симуляция не создаёт партнёрскую связь и не выдаёт Product Access.</span>
          </div>
          <button className="button secondary small" type="button" onClick={loadPreview}>Обновить preview</button>
        </div>
        <div className="brand-kit-toolbar preview-controls">
          <div className="form-group"><label className="form-label">Версия</label><select className="select-field" value={previewSource} onChange={(event) => setPreviewSource(event.target.value)}><option value="DRAFT">Текущий черновик</option><option value="PUBLISHED">Опубликованная версия</option></select></div>
          {role === "brand" ? (
            <>
              <div className="form-group"><label className="form-label">Креатор</label><select className="select-field" value={previewCreatorId} onChange={(event) => setPreviewCreatorId(event.target.value)}><option value="">Выберите креатора</option>{relevantCreators.map((creator) => <option value={creator.id} key={creator.id}>{creator.displayName}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Product Access</label><select className="select-field" value={previewProduct} onChange={(event) => setPreviewProduct(event.target.value)}><option value="NOT_GRANTED">Нет</option><option value="GRANTED">Есть</option>{previewCreatorId && <option value="ACTUAL">Фактический</option>}</select></div>
              <div className="form-group"><label className="form-label">Affiliate approval</label><select className="select-field" value={previewAffiliate} onChange={(event) => setPreviewAffiliate(event.target.value)}><option value="INACTIVE">Нет</option><option value="ACTIVE">Есть</option>{previewCreatorId && <option value="ACTUAL">Фактический</option>}</select></div>
            </>
          ) : (
            <>
              <div className="form-group"><label className="form-label">Уровень доступа</label><select className="select-field" value={previewProduct} onChange={(event) => setPreviewProduct(event.target.value)}><option value="DIGITAL">Digital Access</option><option value="PRODUCT">Product Access</option></select></div>
              <div className="form-group"><label className="form-label">Affiliate approval</label><select className="select-field" value={previewAffiliate} onChange={(event) => setPreviewAffiliate(event.target.value)}><option value="false">Нет</option><option value="true">Есть</option></select></div>
            </>
          )}
        </div>
        </>
      )}

      <CreatorKit
        offer={displayedOffer}
        mode={preview ? "creator" : "brand"}
        hasProductAccess={preview ? Boolean(previewKit?.accessContext?.hasProductAccess) : false}
        notify={notify}
        onToggleAsset={onToggleAsset}
        onDownloadAsset={onDownloadAsset}
      />
    </div>
  );
}

function BrandTeamPanel({ managers, invitations, onInvite, onRevokeInvitation, onRemoveManager, notify }) {
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ displayName: "", email: "" });
  const [createdInvitation, setCreatedInvitation] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submitInvitation = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const invitation = await onInvite(inviteForm);
      setCreatedInvitation(invitation);
      setInviteForm({ displayName: "", email: "" });
      setShowInviteForm(false);
    } catch {
      // Parent action reports the API error.
    } finally {
      setSubmitting(false);
    }
  };

  const copyInvitationLink = async () => {
    if (!createdInvitation?.invitationUrl) return;
    try {
      await navigator.clipboard?.writeText(createdInvitation.invitationUrl);
      notify("Ссылка приглашения скопирована");
    } catch {
      notify("Не удалось скопировать ссылку");
    }
  };

  const confirmRemove = (manager) => {
    const displayName = manager.manager?.managerProfile?.displayName || manager.manager?.email || "этого менеджера";
    if (!window.confirm(`Удалить ${displayName} из команды? Его офферы и партнёры этого бренда станут неназначенными.`)) return;
    onRemoveManager(manager.managerId);
  };

  return (
    <div className="team-panel">
      <div className="dashboard-header">
        <div>
          <h1>Команда</h1>
          <p>Управляйте менеджерами бренда и приглашениями.</p>
        </div>
        <button className="button" onClick={() => setShowInviteForm((current) => !current)}>
          {showInviteForm ? "Отмена" : "Пригласить менеджера"}
        </button>
      </div>

      {showInviteForm && (
        <form className="panel team-invite-form" onSubmit={submitInvitation}>
          <div className="panel-header"><h2>Новое приглашение</h2></div>
          <div className="panel-body form-grid">
            <div className="form-group">
              <label className="form-label">Имя менеджера</label>
              <input
                className="field"
                value={inviteForm.displayName}
                onChange={(event) => setInviteForm((current) => ({ ...current, displayName: event.target.value }))}
                required
                minLength={2}
                maxLength={160}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="field"
                type="email"
                value={inviteForm.email}
                onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                required
                maxLength={320}
              />
            </div>
          </div>
          <div className="form-actions">
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Создание…" : "Создать приглашение"}
            </button>
          </div>
        </form>
      )}

      {createdInvitation && (
        <div className="panel team-invitation-created">
          <div>
            <strong>Приглашение создано</strong>
            <span>Скопируйте ссылку и отправьте её менеджеру вручную.</span>
          </div>
          <div className="team-invitation-link">
            <input className="field" value={createdInvitation.invitationUrl} readOnly />
            <button className="button secondary small" onClick={copyInvitationLink}>Скопировать ссылку</button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header"><h2>Активные менеджеры</h2></div>
        {managers.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Менеджер</th><th>Email</th><th>Назначен</th><th></th></tr></thead>
              <tbody>
                {managers.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      <span className="table-title">{assignment.manager?.managerProfile?.displayName || "Без имени"}</span>
                      <span className="table-subtitle">{assignment.manager?.status === "ACTIVE" ? "Активный аккаунт" : "Аккаунт недоступен"}</span>
                    </td>
                    <td>{assignment.manager?.email || "—"}</td>
                    <td>{assignment.assignedAt ? new Date(assignment.assignedAt).toLocaleDateString("ru-RU") : "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button className="button ghost small" onClick={() => confirmRemove(assignment)}>Удалить</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state">Активных менеджеров пока нет.</div>}
      </div>

      <div className="panel">
        <div className="panel-header"><h2>Приглашения</h2></div>
        {invitations.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Получатель</th><th>Статус</th><th>Создано</th><th>Истекает</th><th></th></tr></thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td><span className="table-title">{invitation.displayName}</span><span className="table-subtitle">{invitation.email}</span></td>
                    <td><Status type={invitation.status === "PENDING" ? "pending" : invitation.status === "ACCEPTED" ? "success" : "danger"}>{invitation.status === "PENDING" ? "Ожидает принятия" : invitation.status === "ACCEPTED" ? "Принято" : invitation.status === "EXPIRED" ? "Истекло" : "Отозвано"}</Status></td>
                    <td>{invitation.createdAt ? new Date(invitation.createdAt).toLocaleDateString("ru-RU") : "—"}</td>
                    <td>{invitation.expiresAt ? new Date(invitation.expiresAt).toLocaleDateString("ru-RU") : "—"}</td>
                    <td>
                      {invitation.status === "PENDING" && (
                        <div className="row-actions">
                          <button className="button ghost small" onClick={() => onRevokeInvitation(invitation.id)}>Отозвать</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state">Приглашений пока нет.</div>}
      </div>
    </div>
  );
}

function BrandDashboard({ user, role, managerBrands, activeBrandId, onSelectManagerBrand, offers, applications, relationships, finance, orderImportPreview, initialTab = "offers", initialCreatorKitOfferId, initialCreatorKitFocus, updateApplication, transitionRelationship, replacePromoCode, confirmPromoCode, copyValue, navigate, notify, onToggleAsset, onDownloadAsset, onUploadAsset, onLoadPreview, onSaveScenarios, onReload, transitionOffer, onUploadOrders, onConfirmOrders, canManageTeam, teamManagers, teamInvitations, onInviteManager, onRevokeInvitation, onRemoveManager, onChangeOfferManager, onChangeRelationshipManager }) {
  const [tab, setTab] = useState(initialTab);
  const [offerFilter, setOfferFilter] = useState("all");
  const [relationshipFilter, setRelationshipFilter] = useState("all");
  const [promoDrafts, setPromoDrafts] = useState({});
  const isManager = role === "manager";
  const visibleOffers = isManager
    ? offers.filter((offer) => (
      offerFilter === "mine"
        ? offer.currentManagerId === user?.id
        : offerFilter === "unassigned"
          ? offer.currentManagerId == null
          : true
    ))
    : offers;
  const visibleRelationships = isManager
    ? relationships.filter((relationship) => (
      relationshipFilter === "mine"
        ? relationship.currentManagerId === user?.id
        : relationshipFilter === "unassigned"
          ? relationship.currentManagerId == null
          : true
    ))
    : relationships;
  const items = [
    { id: "offers", label: "Офферы" },
    { id: "applications", label: "Заявки" },
    { id: "partners", label: "Партнёры" },
    { id: "sales", label: "Продажи" },
    { id: "creatorKit", label: "Creator Kit" },
    { id: "tracking", label: "Отслеживание продаж" },
    ...(canManageTeam ? [{ id: "team", label: "Команда" }] : [])
  ];

  return (
    <DashboardLayout
      roleLabel="Кабинет бренда"
      items={items}
      active={tab}
      setActive={setTab}
    >
      {tab === "team" && canManageTeam ? (
        <BrandTeamPanel
          managers={teamManagers}
          invitations={teamInvitations}
          onInvite={onInviteManager}
          onRevokeInvitation={onRevokeInvitation}
          onRemoveManager={onRemoveManager}
          notify={notify}
        />
      ) : tab === "tracking" ? (
        <div className="dashboard-header">
          <div>
            <h1>Подключение отслеживания продаж</h1>
            <p>Настройте передачу подтверждённых заказов для расчёта партнёрских комиссий.</p>
          </div>
        </div>
      ) : tab === "creatorKit" ? (
        <div className="dashboard-header">
          <div>
            <h1>Creator Kit</h1>
            <p>Управляйте материалами, правилами использования и доступом креаторов.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="dashboard-header">
            <div>
              {role === "manager" && managerBrands.length > 1 ? (
                <select
                  className="dashboard-brand-heading-select"
                  value={activeBrandId || ""}
                  onChange={(event) => event.target.value && onSelectManagerBrand(event.target.value)}
                  aria-label="Текущий бренд"
                >
                  {managerBrands.map((brand) => (
                    <option key={brand.id} value={brand.id}>{brand.brandName || brand.legalName || brand.id}</option>
                  ))}
                </select>
              ) : (
                <h1>{user?.profile?.brandName || "Без названия"}</h1>
              )}
              <p>Управление офферами и заявками креаторов.</p>
            </div>
            <button className="button" onClick={() => navigate("create")}>＋ Создать оффер</button>
          </div>
          <div className="stats-grid">
            <div className="stat-card"><span className="stat-label">Активные офферы</span><span className="stat-value">{offers.filter((item) => item.status === "active").length}</span><span className="stat-note">доступны в каталоге</span></div>
            <div className="stat-card"><span className="stat-label">Заявки креаторов</span><span className="stat-value">{applications.length}</span><span className="stat-note">{applications.filter((item) => item.status === "PENDING").length} требуют решения</span></div>
            <div className="stat-card"><span className="stat-label">Активные партнёры</span><span className="stat-value">{relationships.filter((item) => item.status === "ACTIVE").length}</span><span className="stat-note">с рабочей ссылкой</span></div>
            <div className="stat-card"><span className="stat-label">Чистые продажи</span><span className="stat-value">{moneyKopecks(finance.analytics?.netSalesKopecks)}</span><span className="stat-note">{finance.analytics?.ordersCount || 0} заказов</span></div>
          </div>
        </>
      )}

      {tab === "offers" && (
        <div className="panel">
          <div className="panel-header">
            <h2>Офферы</h2>
            {isManager && (
              <label className="offer-filter-control">
                <span className="table-subtitle">Показать</span>
                <select className="select-field compact-select" value={offerFilter} onChange={(event) => setOfferFilter(event.target.value)}>
                  <option value="all">Все</option>
                  <option value="mine">Мои</option>
                  <option value="unassigned">Без менеджера</option>
                </select>
              </label>
            )}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Оффер</th><th>Статус</th><th>Creator Kit</th><th>Комиссия</th><th>Заявки</th><th>Продажи</th><th></th></tr></thead>
              <tbody>
                {visibleOffers.map((offer) => (
                  <tr key={offer.id}>
                    <td>
                      <span className="table-title">{offer.title}</span>
                      <span className="table-subtitle">{money(offer.price)}</span>
                      <OfferManagerSelect
                        offer={offer}
                        managers={teamManagers}
                        onChange={(managerId) => onChangeOfferManager(offer.id, managerId)}
                      />
                    </td>
                    <td><Status type={offer.status === "active" ? "success" : "pending"}>{offer.statusLabel}</Status></td>
                    <td><strong>{offer.creatorKit.completeness}%</strong><span className="table-subtitle"> заполнено</span></td>
                    <td><strong>{offer.totalCommission}% всего</strong><span className="table-subtitle">креатору {offer.commission}%</span></td><td>{applications.filter((item) => item.offerId === offer.id).length}</td><td>—</td>
                    <td>
                      <div className="row-actions">
                        <button className="button secondary small" onClick={() => navigate("offer", { offerId: offer.id })}>Открыть</button>
                        {offer.apiStatus !== "ARCHIVED" && <button className="button secondary small" onClick={() => navigate("create", { editOfferId: offer.id })}>Редактировать</button>}
                        {offer.apiStatus === "DRAFT" && <button className="button small" onClick={() => transitionOffer(offer.id, "publish")}>Опубликовать</button>}
                        {offer.apiStatus === "PUBLISHED" && <button className="button secondary small" onClick={() => transitionOffer(offer.id, "pause")}>Приостановить</button>}
                        {offer.apiStatus === "PAUSED" && <button className="button small" onClick={() => transitionOffer(offer.id, "publish")}>Возобновить</button>}
                        {["DRAFT", "PUBLISHED", "PAUSED"].includes(offer.apiStatus) && <button className="button ghost small" onClick={() => transitionOffer(offer.id, "archive")}>В архив</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visibleOffers.length && <div className="empty-state">Офферов по выбранному фильтру нет.</div>}
        </div>
      )}

      {tab === "applications" && (
        <div className="panel">
          <div className="panel-header"><h2>Заявки креаторов</h2><Status type="success">Подключено</Status></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Креатор</th><th>Оффер</th><th>Сообщение</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {applications.map((application) => {
                  const uiState = applicationUiState(application);
                  const approvalBlocked = uiState === "TERMS_CHANGED";
                  return <tr key={application.id}>
                    <td><span className="table-title">{application.creator.displayName}</span><span className="table-subtitle">{application.creator.description || "Описание профиля не заполнено"}</span></td>
                    <td>{application.offer.title}</td>
                    <td>{application.message || "Без сообщения"}{approvalBlocked && <span className="table-subtitle">Старая ставка: {formatRateBps(application.latestAcceptedTerms?.creatorEffectiveGmvBps || application.termsObservation?.displayedCreatorEffectiveBps)} · текущая: {formatRateBps(application.applicableCommercialTerms?.creatorEffectiveGmvBps)}</span>}</td>
                    <td><Status type={application.status === "APPROVED" ? "success" : application.status === "REJECTED" || approvalBlocked ? "danger" : "pending"}>{approvalBlocked ? "Ожидается согласие креатора" : uiState === "CREATOR_REACCEPTED" ? "Новые условия приняты" : applicationStatusLabels[application.status]}</Status></td>
                    <td>
                      {application.status === "PENDING" && (
                        <div className="row-actions">
                          <button className="button secondary small" onClick={() => updateApplication(application.id, "reject")}>Отклонить</button>
                          <button className="button small" disabled={approvalBlocked} title={approvalBlocked ? "Креатор должен принять текущие коммерческие условия" : ""} onClick={() => updateApplication(application.id, "approve")}>Одобрить</button>
                        </div>
                      )}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {!applications.length && <div className="empty-state">Заявок на ваши офферы пока нет.</div>}
        </div>
      )}

      {tab === "partners" && (
        <div className="panel">
          <div className="panel-header">
            <h2>Партнёры бренда</h2>
            {isManager && (
              <label className="offer-filter-control">
                <span className="table-subtitle">Показать</span>
                <select className="select-field compact-select" value={relationshipFilter} onChange={(event) => setRelationshipFilter(event.target.value)}>
                  <option value="all">Все</option>
                  <option value="mine">Мои</option>
                  <option value="unassigned">Без менеджера</option>
                </select>
              </label>
            )}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Креатор</th><th>Оффер</th><th>Партнёрская ссылка</th><th>Промокод</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {visibleRelationships.map((relationship) => (
                  <tr key={relationship.id}>
                    <td><span className="table-title">{relationship.creator.displayName}</span><span className="table-subtitle">{relationship.creator.description || "Описание профиля не заполнено"}</span></td>
                    <td>
                      <span className="table-title">{relationship.offer.title}</span>
                      <RelationshipManagerSelect
                        relationship={relationship}
                        managers={teamManagers}
                        onChange={(managerId) => onChangeRelationshipManager(relationship.id, managerId)}
                      />
                    </td>
                    <td>
                      <span className="table-subtitle">{relationship.affiliateUrl}</span>
                      <button className="button secondary small" type="button" disabled={!relationship.affiliateUrl} onClick={() => copyValue(relationship.affiliateUrl, "Партнёрская ссылка скопирована")}>Скопировать ссылку</button>
                    </td>
                    <td>
                      <strong>{relationship.promoCode}</strong>
                      <div className="row-actions">
                        <button className="button secondary small" type="button" disabled={!relationship.promoCode} onClick={() => copyValue(relationship.promoCode, "Промокод скопирован")}>Скопировать промокод</button>
                      </div>
                      {relationship.promoCodeDetails && (
                        <>
                          <span className="table-subtitle">
                            {relationship.promoCodeDetails.discountType === "PERCENT"
                              ? `Скидка покупателю ${relationship.promoCodeDetails.discountBps / 100}%`
                              : relationship.promoCodeDetails.discountType === "FIXED_AMOUNT"
                                ? `Скидка покупателю ${moneyKopecks(relationship.promoCodeDetails.discountAmountMinor)}`
                                : "Без скидки покупателю"}
                          </span>
                          <span className="table-subtitle">
                            {relationship.promoCodeDetails.status === "ACTIVE"
                              ? "Проверен реальным событием заказа"
                              : relationship.promoCodeDetails.status === "PROVISIONING_CONFIRMED"
                                ? "Добавление подтверждено, нужен тестовый заказ"
                                : relationship.promoCodeDetails.status === "PENDING_PROVISIONING"
                                  ? "Нужно добавить в Tilda"
                                  : relationship.promoCodeDetails.status}
                          </span>
                        </>
                      )}
                      {role === "brand" && relationship.promoCodeDetails?.editable && (
                        <div className="row-actions">
                          <input
                            className="field"
                            value={promoDrafts[relationship.id] ?? relationship.promoCode}
                            maxLength={40}
                            onChange={(event) => setPromoDrafts((current) => ({ ...current, [relationship.id]: event.target.value }))}
                            aria-label={`Новый промокод для ${relationship.creator.displayName}`}
                          />
                          <button className="button secondary small" type="button" onClick={async () => {
                            const changed = await replacePromoCode(relationship.id, promoDrafts[relationship.id] ?? relationship.promoCode);
                            if (changed) setPromoDrafts((current) => ({ ...current, [relationship.id]: changed.promoCode }));
                          }}>Изменить до первого заказа</button>
                        </div>
                      )}
                    </td>
                    <td><Status type={relationship.status === "ACTIVE" ? "success" : relationship.status === "REVOKED" ? "danger" : "pending"}>{relationshipStatusLabels[relationship.status]}</Status></td>
                    <td>
                      <div className="row-actions">
                        {relationship.status === "ACTIVE" && <button className="button secondary small" onClick={() => transitionRelationship(relationship.id, "pause")}>Приостановить</button>}
                        {relationship.status === "PAUSED" && <button className="button small" onClick={() => transitionRelationship(relationship.id, "activate")}>Активировать</button>}
                        {relationship.status !== "REVOKED" && <button className="button ghost small" onClick={() => transitionRelationship(relationship.id, "revoke")}>Отозвать</button>}
                        {role === "brand" && relationship.promoCodeDetails?.status === "PENDING_PROVISIONING" && <button className="button small" type="button" onClick={() => confirmPromoCode(relationship.id)}>Код добавлен в Tilda</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visibleRelationships.length && <div className="empty-state">Партнёров по выбранному фильтру нет.</div>}
        </div>
      )}

      {tab === "sales" && (
        <div className="panel">
          <div className="panel-header"><h2>Продажи и комиссии</h2><Status type="success">Подключено</Status></div>
          <div className="stats-grid panel-body">
            <div className="stat-card"><span className="stat-label">Валовые продажи</span><span className="stat-value">{moneyKopecks(finance.analytics?.grossSalesKopecks)}</span></div>
            <div className="stat-card"><span className="stat-label">Чистые продажи</span><span className="stat-value">{moneyKopecks(finance.analytics?.netSalesKopecks)}</span></div>
            <div className="stat-card"><span className="stat-label">Комиссии креаторов</span><span className="stat-value">{moneyKopecks(finance.analytics?.creatorCommissionKopecks)}</span></div>
            <div className="stat-card"><span className="stat-label">Комиссия платформы</span><span className="stat-value">{moneyKopecks(finance.analytics?.platformCommissionKopecks)}</span></div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Заказ</th><th>Креатор</th><th>Оффер</th><th>Сумма</th><th>Атрибуция</th><th>Статус</th></tr></thead>
              <tbody>
                {(finance.orders?.items || []).map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.externalOrderId}</strong><span className="table-subtitle">{new Date(order.orderDate).toLocaleDateString("ru-RU")}</span></td>
                    <td>{order.affiliateRelationship?.creator?.displayName || "Не атрибутирован"}</td>
                    <td>{order.offer.title}</td>
                    <td>{moneyKopecks(order.amountKopecks)}</td>
                    <td>{order.attributionSource}</td>
                    <td><Status type={order.status === "PAID" ? "success" : ["RETURNED", "CANCELLED"].includes(order.status) ? "danger" : "pending"}>{order.status}</Status></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!finance.orders?.items?.length && <div className="empty-state">Импортированных заказов пока нет.</div>}
          {!!finance.creatorAnalytics?.items?.length && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Креатор</th><th>Клики</th><th>Оплаченные заказы</th><th>Чистые продажи</th><th>Комиссия</th><th>Конверсия</th></tr></thead>
                <tbody>{finance.creatorAnalytics.items.map((row) => <tr key={row.creatorId}><td><strong>{row.creatorName}</strong></td><td>{row.clicksCount}</td><td>{row.paidOrdersCount}</td><td>{moneyKopecks(row.netSalesKopecks)}</td><td>{moneyKopecks(row.creatorCommissionKopecks)}</td><td>{row.conversionRate === null ? "—" : `${(row.conversionRate * 100).toFixed(1)}%`}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "finance" && (
        <div className="panel">
          <div className="panel-header"><h2>Финансовый обзор</h2><Status type="success">Серверный расчёт</Status></div>
          <div className="stats-grid panel-body">
            <div className="stat-card"><span className="stat-label">Атрибутированный GMV</span><span className="stat-value">{moneyKopecks(finance.overview?.attributedGmvMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Подтверждённый GMV</span><span className="stat-value">{moneyKopecks(finance.overview?.confirmedGmvMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Креаторам</span><span className="stat-value">{moneyKopecks(finance.overview?.creatorCommissionsAccruedMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Связке</span><span className="stat-value">{moneyKopecks(finance.overview?.platformFeesAccruedMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">К оплате</span><span className="stat-value">{moneyKopecks(finance.overview?.totalPayableMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Оплачено</span><span className="stat-value">{moneyKopecks(finance.overview?.paidMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Не оплачено</span><span className="stat-value">{moneyKopecks(finance.overview?.unpaidMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Просрочено</span><span className="stat-value">{moneyKopecks(finance.overview?.overdueMinor)}</span></div>
          </div>
        </div>
      )}

      {tab === "statements" && (
        <div className="panel">
          <div className="panel-header"><h2>Settlement statements</h2><Status type="success">Неизменяемые после выпуска</Status></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Период</th><th>Креаторам</th><th>Связке</th><th>К оплате</th><th>Оплачено</th><th>Статус</th></tr></thead>
              <tbody>{(finance.statements || []).map((statement) => <tr key={statement.id}><td>{new Date(statement.periodStart).toLocaleDateString("ru-RU")} — {new Date(statement.periodEnd).toLocaleDateString("ru-RU")}</td><td>{moneyKopecks(statement.creatorObligationsMinor)}</td><td>{moneyKopecks(statement.platformFeeMinor)}</td><td>{moneyKopecks(statement.totalDueMinor)}</td><td>{moneyKopecks(statement.paidMinor)}</td><td><Status type={statement.status === "PAID" ? "success" : statement.status === "OVERDUE" ? "danger" : "pending"}>{statement.status}</Status></td></tr>)}</tbody>
            </table>
          </div>
          {!finance.statements?.length && <div className="empty-state">Выпущенных statements пока нет.</div>}
        </div>
      )}

      {tab === "tracking" && <SalesTrackingLive role={role} notify={notify} preview={orderImportPreview} onUpload={onUploadOrders} onConfirm={onConfirmOrders} />}
      {tab === "creatorKit" && <BrandCreatorKitManager offers={offers} relationships={relationships} role={role} verificationStatus={user?.profile?.verificationStatus} initialOfferId={initialCreatorKitOfferId} initialFocus={initialCreatorKitFocus} notify={notify} onToggleAsset={onToggleAsset} onDownloadAsset={onDownloadAsset} onUploadAsset={onUploadAsset} onLoadPreview={onLoadPreview} onSaveScenarios={onSaveScenarios} onReload={onReload} />}
    </DashboardLayout>
  );
}

function CreateOfferPage({ publish, navigate, initialOffer, brandName, uploadAllowed, managers, onChangeOfferManager }) {
  const initialProductFacts = initialOffer?.creatorKit?.factsRaw || [];
  const scenariosLoaded = !initialOffer || Array.isArray(initialOffer.creatorKit?.scenarios);
  const defaultScenarios = scenariosLoaded && initialOffer?.creatorKit?.scenarios
    ? initialOffer.creatorKit.scenarios.map((scenario) => ({
        channel: scenarioChannelValues[scenario.channel] || scenario.channel,
        title: scenario.title,
        idea: scenario.idea,
        accessLevel: scenario.accessLevel || "DIGITAL",
        requiresAffiliateApproval: Boolean(scenario.requiresAffiliateApproval)
      }))
    : [];
  const [form, setForm] = useState({
    title: initialOffer?.title || "Набор для ночного ухода Renewal",
    category: initialOffer?.category || "Красота и уход",
    description: initialOffer?.description || "Ночной уход для восстановления и увлажнения кожи.",
    productUrl: initialOffer?.productUrl || "https://example.test/products/renewal",
    price: initialOffer?.price ?? 7200,
    commission: initialOffer?.totalCommission ?? initialOffer?.commission ?? 15,
    threshold: initialOffer?.threshold ?? 5,
    terms: "Нативная интеграция в контент об уходе и образе жизни.",
    promotionWithoutSample: initialOffer?.creatorKit?.promotionWithoutSample || "restricted",
    allowedDigitalFormats: initialOffer?.creatorKit?.allowedDigitalFormats || [...digitalFormats],
    productFacts: formatOfferProductFacts(initialProductFacts),
    allowedClaims: "Подходит для ежедневного ухода; бренд указывает в составе…",
    forbiddenClaims: "Я протестировала и рекомендую; гарантированно решает проблему",
    publicationRequirements: "Указать название и цену, добавить маркировку рекламы, упомянуть @lunea.",
    scenarios: defaultScenarios
  });
  const [scenarioErrors, setScenarioErrors] = useState({});
  const [categoryError, setCategoryError] = useState("");
  const [imageError, setImageError] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  const update = (key, value) => setForm({ ...form, [key]: value });
  const categorySelectValue = getOfferCategorySelectValue(form.category);
  const updateCategory = (value) => {
    setCategoryError("");
    update("category", value);
  };
  const selectCategory = (value) => {
    if (value === OFFER_CATEGORY_OTHER) {
      updateCategory(categorySelectValue === OFFER_CATEGORY_OTHER ? form.category : "");
      return;
    }
    updateCategory(value);
  };
  const toggleFormat = (format) => {
    update(
      "allowedDigitalFormats",
      form.allowedDigitalFormats.includes(format)
        ? form.allowedDigitalFormats.filter((item) => item !== format)
        : [...form.allowedDigitalFormats, format]
    );
  };
  const previewEconomics = calculatePoolEconomics(
    Math.round(form.commission * 100),
    Math.round(form.price * 100)
  );
  const creatorPreviewRate = previewEconomics.creatorEffectiveBps / 100;
  const platformPreviewRate = previewEconomics.platformEffectiveBps / 100;
  const previewBase = {
    ...form,
    commission: creatorPreviewRate,
    totalCommission: form.commission,
    id: 99,
    brand: brandName || initialOffer?.brand || "Бренд",
    image: getOfferPreviewImage(
      imagePreviewUrl,
      initialOffer?.image,
      initialOffer ? productImages.skincare : productImages.cosmetics
    ),
    status: "review",
    applications: 0,
    sales: 0
  };
  const previewOffer = {
    ...previewBase,
    creatorKit: {
      ...buildCreatorKit(previewBase),
      promotionWithoutSample: form.promotionWithoutSample,
      allowedDigitalFormats: form.allowedDigitalFormats,
      scenarios: form.scenarios,
      allowedClaims: form.allowedClaims.split(";").map((item) => item.trim()).filter(Boolean),
      forbiddenClaims: form.forbiddenClaims.split(";").map((item) => item.trim()).filter(Boolean)
    },
    creatorKitScenariosLoaded: scenariosLoaded
  };
  const validateScenarios = () => {
    const errors = {};
    form.scenarios.forEach((scenario, index) => {
      const titleLength = String(scenario.title || "").trim().length;
      const ideaLength = String(scenario.idea || "").trim().length;
      if (titleLength < 3 || titleLength > 200 || ideaLength < 10 || ideaLength > 5000) {
        errors[index] = {
          ...(titleLength < 3 ? { title: "Название должно содержать минимум 3 символа." } : {}),
          ...(titleLength > 200 ? { title: "Название не должно превышать 200 символов." } : {}),
          ...(ideaLength < 10 ? { idea: "Идея должна содержать минимум 10 символов." } : {}),
          ...(ideaLength > 5000 ? { idea: "Идея не должна превышать 5000 символов." } : {})
        };
      }
    });
    setScenarioErrors(errors);
    return Object.keys(errors).length === 0;
  };
  const submitOffer = async (shouldPublish, destination = "offers") => {
    const category = form.category.trim();
    if (!category) {
      setCategoryError("Укажите свою категорию.");
      return;
    }
    const nextImageError = validateOfferImageFile(imageFile);
    if (nextImageError) {
      setImageError(nextImageError);
      return;
    }
    setImageError("");
    setSaving(true);
    try {
      await publish(
        { ...previewOffer, category, imageFile },
        shouldPublish,
        initialOffer?.id,
        { destination }
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="create-page">
      <div className="container">
        <div className="breadcrumbs"><button onClick={() => navigate("brand")}>Кабинет бренда</button><span>/</span><span>Новый оффер</span></div>
        <div className="page-head" style={{ paddingTop: 0 }}>
          <div className="page-head-row">
            <div><span className="eyebrow">Новый оффер</span><h1>Создание оффера</h1><p>Укажите информацию о товаре, партнёрские условия и настройте Creator Kit.</p></div>
          </div>
        </div>
        <div className="create-layout">
          <div>
            {initialOffer && (
              <section className="form-section">
                <h2>Ответственный менеджер</h2>
                <p>Все менеджеры бренда видят этот оффер. Ответственный нужен для рабочего распределения.</p>
                <OfferManagerSelect
                  offer={initialOffer}
                  managers={managers}
                  onChange={(managerId) => onChangeOfferManager(initialOffer.id, managerId)}
                />
              </section>
            )}
            <section className="form-section">
              <h2>Товар</h2>
              <p>Основная информация, которую увидит креатор.</p>
              <div className="form-grid">
                <div className="form-group full"><label className="form-label">Название</label><input className="field" value={form.title} onChange={(e) => update("title", e.target.value)} /></div>
                <div className="form-group">
                  <label className="form-label">Категория</label>
                  <select className="select-field" value={categorySelectValue} onChange={(event) => selectCategory(event.target.value)}>
                    {OFFER_CATEGORY_PRESETS.map((category) => <option key={category}>{category}</option>)}
                    <option value={OFFER_CATEGORY_OTHER}>{OFFER_CATEGORY_OTHER}</option>
                  </select>
                  {categorySelectValue === OFFER_CATEGORY_OTHER && (
                    <>
                      <input
                        className="field"
                        value={form.category}
                        onChange={(event) => updateCategory(event.target.value)}
                        placeholder="Например, экотовары или книги"
                        maxLength={120}
                        aria-invalid={Boolean(categoryError)}
                        aria-describedby="offer-category-hint"
                      />
                      <span id="offer-category-hint" className={`form-hint ${categoryError ? "error" : ""}`}>
                        {categoryError || "Уточнение сохранится как отдельная категория и поможет расширить список."}
                      </span>
                    </>
                  )}
                </div>
                <div className="form-group"><label className="form-label">Цена, ₽</label><input className="field" type="number" value={form.price} onChange={(e) => update("price", Number(e.target.value))} /></div>
                <div className="form-group full"><label className="form-label">Ссылка на товар</label><input className="field" type="url" value={form.productUrl} onChange={(e) => update("productUrl", e.target.value)} placeholder="https://brand.ru/products/product" /></div>
                <div className="form-group full"><label className="form-label">Описание</label><textarea className="textarea" value={form.description} onChange={(e) => update("description", e.target.value)} /></div>
                <div className="form-group full">
                  <label className="form-label">Изображение товара</label>
                  <input
                    className="field"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    disabled={!uploadAllowed}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setImageError("");
                      setImageFile(file);
                    }}
                    aria-invalid={Boolean(imageError)}
                    aria-describedby="offer-image-hint"
                  />
                  <span id="offer-image-hint" className={`form-hint ${imageError ? "error" : ""}`}>
                    {imageError ||
                      (!uploadAllowed
                        ? "Загрузка доступна после подтверждения бренда администратором."
                        : imageFile
                          ? `${imageFile.name} — изображение справа уже обновлено.`
                          : initialOffer?.imageUrl
                            ? "Текущее изображение сохранено. Выберите новый файл, чтобы заменить его."
                            : "Выберите JPG, PNG или WebP до 25 МБ — изображение справа обновится сразу.")}
                  </span>
                </div>
              </div>
            </section>
            <section className="form-section">
              <h2>Партнёрские условия</h2>
              <p>Укажите общий commission pool. Распределение 65/35 рассчитывает сервер.</p>
              <div className="form-grid">
                <div className="form-group"><label className="form-label">Общая комиссия Brand, %</label><input className="field" type="number" min="0" max="100" step="0.01" value={form.commission} onChange={(e) => update("commission", Number(e.target.value))} /></div>
                <div className="form-group"><label className="form-label">Креатор получает</label><div className="field" aria-live="polite">{creatorPreviewRate}% от GMV</div></div>
                <div className="form-group"><label className="form-label">Service fee Связки</label><div className="field" aria-live="polite">{platformPreviewRate}% от GMV</div></div>
                <div className="form-group"><label className="form-label">Продаж до запроса товара</label><input className="field" type="number" value={form.threshold} onChange={(e) => update("threshold", Number(e.target.value))} /></div>
                <div className="form-group full"><label className="form-label">Условия продвижения</label><textarea className="textarea" value={form.terms} onChange={(e) => update("terms", e.target.value)} /></div>
              </div>
            </section>
            <section className="form-section">
              <h2>Creator Kit — материалы для продвижения</h2>
              <p>Настройте, как креатор может рассказывать о товаре до и после получения образца.</p>
              <div className="form-group">
                <label className="form-label">Можно ли продвигать товар без физического образца?</label>
                <div className="policy-options">
                  {[
                    ["yes", "Да", "Все материалы Digital Access доступны после одобрения заявки."],
                    ["no", "Нет, продукт обязателен", "Материалы откроются только после ручной выдачи Product Access брендом."],
                    ["restricted", "Да, но только в разрешённых форматах", "Креатор увидит выбранные форматы и правила без личного тестирования."]
                  ].map(([value, title, copy]) => (
                    <label className={`policy-option ${form.promotionWithoutSample === value ? "selected" : ""}`} key={value}>
                      <input type="radio" name="sample-policy" checked={form.promotionWithoutSample === value} onChange={() => update("promotionWithoutSample", value)} />
                      <span><strong>{title}</strong><small>{copy}</small></span>
                    </label>
                  ))}
                </div>
              </div>

              {form.promotionWithoutSample === "restricted" && (
                <div className="form-group creator-format-picker">
                  <label className="form-label">Разрешённые форматы Digital Access</label>
                  <div className="checkbox-grid">
                    {digitalFormats.map((format) => (
                      <label className={form.allowedDigitalFormats.includes(format) ? "checked" : ""} key={format}>
                        <input type="checkbox" checked={form.allowedDigitalFormats.includes(format)} onChange={() => toggleFormat(format)} />
                        <span>{format}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="creator-kit-form-block">
                <div>
                  <h3>Материалы загружаются после сохранения оффера</h3>
                  <p>Это перечень поддерживаемых типов, а не кнопки загрузки. Сохраните оффер — мы сразу откроем форму выбора файла в Creator Kit.</p>
                </div>
                <div className="material-type-grid">
                  {["Фото", "Вертикальные видео", "Горизонтальные видео", "PNG без фона", "Логотипы", "Lifestyle-контент", "Видео текстуры", "Видео использования", "Рекламные баннеры"].map((type, index) => (
                    <span key={type}>{type}<small>Доступно в Creator Kit</small></span>
                  ))}
                </div>
                <div className="upload-box">
                  <strong>Следующий шаг</strong>
                  <span>Сохраните оффер. На следующем экране выберите файл и нажмите «Загрузить материал».</span>
                  <button className="button" type="button" disabled={saving} onClick={() => submitOffer(false, "creatorKit")}>
                    {saving ? "Сохраняем…" : "Сохранить оффер и открыть загрузку материалов"}
                  </button>
                </div>
              </div>

              <div className="creator-kit-form-block">
                {!scenariosLoaded && initialOffer ? (
                  <div className="creator-warning compact-warning">
                    <span className="warning-mark">!</span>
                    <strong>Сценарии этого Creator Kit ещё не загружены. Сохранение Offer не изменит их.</strong>
                  </div>
                ) : (
                  <ScenarioEditor
                    scenarios={form.scenarios}
                    errors={scenarioErrors}
                    onChange={(scenarios) => {
                      update("scenarios", scenarios);
                      setScenarioErrors({});
                    }}
                    disabled={!scenariosLoaded}
                  />
                )}
                <div className="form-grid compact-form-grid">
                  <div className="form-group"><label className="form-label">Факты о продукте</label><textarea className="textarea" value={form.productFacts} onChange={(event) => update("productFacts", event.target.value)} placeholder={PRODUCT_FACTS_PLACEHOLDER} /></div>
                  <div className="form-group"><label className="form-label">Требования к публикации</label><textarea className="textarea" value={form.publicationRequirements} onChange={(e) => update("publicationRequirements", e.target.value)} /></div>
                  <div className="form-group"><label className="form-label">Разрешённые формулировки</label><textarea className="textarea" value={form.allowedClaims} onChange={(e) => update("allowedClaims", e.target.value)} /></div>
                  <div className="form-group"><label className="form-label">Запрещённые формулировки</label><textarea className="textarea" value={form.forbiddenClaims} onChange={(e) => update("forbiddenClaims", e.target.value)} /></div>
                </div>
              </div>

              <div className="creator-warning compact-warning">
                <span className="warning-mark">!</span>
                <strong>Не утверждайте, что вы лично использовали или тестировали продукт, если физический образец ещё не был получен.</strong>
              </div>
            </section>
            <div className="form-actions">
              {(!initialOffer || initialOffer.apiStatus === "DRAFT") && <button className="button secondary" onClick={() => validateScenarios() && publish(previewOffer, false, initialOffer?.id)}>Сохранить черновик</button>}
              <button className="button" onClick={() => validateScenarios() && publish(previewOffer, !initialOffer || initialOffer.apiStatus === "DRAFT", initialOffer?.id)}>
                {initialOffer && initialOffer.apiStatus !== "DRAFT" ? "Сохранить изменения" : "Опубликовать оффер"}
              </button>
            </div>
          </div>
          <aside className="preview-sticky">
            <div className="preview-label">Предпросмотр карточки</div>
            <OfferCard offer={previewOffer} onOpen={() => {}} />
            <div className="panel" style={{ marginTop: 14 }}>
              <div className="panel-body">
                <span className="term-label">Общий расход Brand с одной продажи</span>
                <strong style={{ fontSize: 22 }}>{money(Math.round(form.price * form.commission / 100))}</strong>
                <span className="stat-note">Креатор: {money(Math.round(form.price * creatorPreviewRate / 100))} · Связка: {money(Math.round(form.price * platformPreviewRate / 100))}</span>
              </div>
            </div>
            <div className="panel" style={{ marginTop: 14 }}>
              <div className="panel-body">
                <span className="term-label">Creator Kit</span>
                <strong style={{ display: "block", marginTop: 5 }}>Digital Access · {form.allowedDigitalFormats.length} форматов</strong>
                <span className="stat-note">Product Access выдаётся брендом вручную в закрытом пилоте</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function AdminDashboard({ user, offers, brands, creators, applications, operationalReadiness, finance, createPayout, approvePayout, markPayoutPaid, cancelPayout, issueStatement, recordBrandPayment, resolveDispute, runReconciliation, verifyBrand, changeAdminPassword, beginAdminMfa, confirmAdminMfa }) {
  const [tab, setTab] = useState("offers");
  const [securityForm, setSecurityForm] = useState({ currentPassword: "", newPassword: "", code: "" });
  const [mfaEnrollment, setMfaEnrollment] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [statementForm, setStatementForm] = useState(() => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 10));
    return {
      brandId: "",
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      dueAt: due.toISOString().slice(0, 10),
      currency: "RUB"
    };
  });
  const [disputeResolutions, setDisputeResolutions] = useState({});

  const updateSecurity = (key, value) => setSecurityForm((current) => ({ ...current, [key]: value }));

  if (user?.mustChangePassword || !user?.mfaEnabled) {
    return (
      <DashboardLayout roleLabel="Администрирование" items={[{ id: "security", label: "Безопасность" }]} active="security" setActive={() => {}}>
        <div className="dashboard-header"><div><h1>Настройка безопасности</h1><p>Финансовые и административные действия закрыты до завершения настройки.</p></div></div>
        {user?.mustChangePassword ? (
          <div className="panel">
            <div className="panel-header"><div><h2>Смените временный пароль</h2><p>После смены потребуется войти заново.</p></div></div>
            <div className="panel-body form-grid">
              <div className="form-group"><label className="form-label">Текущий пароль</label><input className="field" type="password" value={securityForm.currentPassword} onChange={(event) => updateSecurity("currentPassword", event.target.value)} /></div>
              <div className="form-group"><label className="form-label">Новый пароль</label><input className="field" type="password" value={securityForm.newPassword} onChange={(event) => updateSecurity("newPassword", event.target.value)} /></div>
            </div>
            <div className="form-actions"><button className="button" onClick={() => changeAdminPassword(securityForm.currentPassword, securityForm.newPassword)}>Сменить пароль</button></div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-header"><div><h2>Подключите TOTP</h2><p>Второй фактор обязателен до работы с выплатами.</p></div></div>
            <div className="panel-body form-grid">
              {!mfaEnrollment && <div className="form-group"><label className="form-label">Текущий пароль</label><input className="field" type="password" value={securityForm.currentPassword} onChange={(event) => updateSecurity("currentPassword", event.target.value)} /></div>}
              {mfaEnrollment && <>
                <div className="form-group full"><label className="form-label">Секрет TOTP</label><input className="field" readOnly value={mfaEnrollment.secret} /></div>
                <div className="form-group full"><label className="form-label">URI для приложения-аутентификатора</label><input className="field" readOnly value={mfaEnrollment.otpauthUrl} /></div>
                <div className="form-group"><label className="form-label">Код из приложения</label><input className="field" inputMode="numeric" value={securityForm.code} onChange={(event) => updateSecurity("code", event.target.value)} /></div>
              </>}
            </div>
            <div className="form-actions">{!mfaEnrollment ? <button className="button" onClick={async () => setMfaEnrollment(await beginAdminMfa(securityForm.currentPassword))}>Начать настройку</button> : <button className="button" onClick={async () => setRecoveryCodes(await confirmAdminMfa(securityForm.code))}>Подтвердить TOTP</button>}</div>
            {!!recoveryCodes.length && <div className="creator-warning compact-warning"><span className="warning-mark">!</span><strong>Сохраните одноразовые recovery codes в защищённом месте: {recoveryCodes.join(" · ")}</strong></div>}
          </div>
        )}
      </DashboardLayout>
    );
  }
  return (
    <DashboardLayout
      roleLabel="Администрирование"
      items={[
        { id: "offers", label: "Офферы" },
        { id: "brands", label: "Бренды" },
        { id: "creators", label: "Креаторы" },
        { id: "applications", label: "Заявки" },
        { id: "finance", label: "Финансы" },
        { id: "statements", label: "Statements" },
        { id: "disputes", label: "Disputes" },
        { id: "payouts", label: "Выплаты" },
        { id: "ledger", label: "Ledger" }
      ]}
      active={tab}
      setActive={setTab}
    >
      <div className="dashboard-header">
        <div><h1>Админ-панель</h1><p>Обзор данных и статусов закрытого пилота.</p></div>
      </div>
      <div className="creator-warning compact-warning">
        <span className="warning-mark">!</span>
        <strong>Бренды, креаторы, заявки и финансы подключены к серверу. Список офферов в ADMIN пока остаётся демонстрационным.</strong>
      </div>
      <div className="creator-warning compact-warning">
        <span className="warning-mark">!</span>
        <strong>Файловый pipeline MVP не включает антивирусную проверку. Использовать только в закрытом пилоте с проверенными брендами. Перед публичным запуском подключить quarantine, ClamAV и worker</strong>
      </div>
      {operationalReadiness?.status === "DEGRADED" && (
        <div className="creator-warning compact-warning">
          <span className="warning-mark">!</span>
          <strong>Критическое предупреждение: резервные копии отсутствуют или устарели. Основной сервис работает, но приглашать пользователей запрещено до успешного PostgreSQL и MinIO backup.</strong>
        </div>
      )}
      <div className="stats-grid">
        <div className="stat-card"><span className="stat-label">Бренды</span><span className="stat-value">{finance.overview?.brandCount || 0}</span><span className="stat-note">в финансовом контуре</span></div>
        <div className="stat-card"><span className="stat-label">Креаторы</span><span className="stat-value">{creators.length}</span><span className="stat-note">зарегистрировано</span></div>
        <div className="stat-card"><span className="stat-label">Офферы</span><span className="stat-value">{offers.length}</span><span className="stat-note">{offers.filter((item) => item.status === "review").length} на проверке</span></div>
        <div className="stat-card"><span className="stat-label">Активные заявки</span><span className="stat-value">{countActiveApplications(applications)}</span><span className="stat-note">требуют обработки</span></div>
      </div>

      {tab === "offers" && (
        <div className="panel">
          <div className="panel-header"><h2>Офферы</h2></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Оффер</th><th>Бренд</th><th>Комиссия</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {offers.map((offer) => (
                  <tr key={offer.id}>
                    <td><span className="table-title">{offer.title}</span><span className="table-subtitle">{offer.category}</span></td>
                    <td>{offer.brand}</td><td>{offer.commission}%</td>
                    <td><Status type={offer.status === "active" ? "success" : offer.status === "rejected" ? "danger" : "pending"}>{offer.status === "active" ? "Активен" : offer.status === "rejected" ? "Отклонён" : "На проверке"}</Status></td>
                    <td>
                      <div className="row-actions">
                        <button className="button secondary small" disabled title="Функция пока не подключена">Отклонить</button>
                        <button className="button small" disabled title="Функция пока не подключена">Активировать</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "brands" && (
        <div className="panel">
          <div className="panel-header"><h2>Бренды пилота</h2><Status type="success">Подключено</Status></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Бренд</th><th>Email</th><th>Офферы</th><th>Доступ к файлам</th><th></th></tr></thead><tbody>{brands.map((brand) => <tr key={brand.id}><td><strong>{brand.brandName}</strong></td><td>{brand.user.email}</td><td>{brand._count?.offers || 0}</td><td><Status type={brand.verificationStatus === "VERIFIED" ? "success" : "pending"}>{brand.verificationStatus === "VERIFIED" ? "Подтверждён" : "Ожидает проверки"}</Status></td><td>{brand.verificationStatus !== "VERIFIED" && <button className="button small" onClick={() => verifyBrand(brand.id)}>Подтвердить</button>}</td></tr>)}</tbody></table></div>
          {!brands.length && <div className="empty-state">Зарегистрированных брендов пока нет.</div>}
        </div>
      )}

      {tab === "creators" && (
        <div className="panel">
          <div className="panel-header"><h2>Креаторы</h2><Status type="success">{creators.length} зарегистрировано</Status></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Креатор</th><th>О профиле</th><th>Заявки</th><th>Активные офферы</th><th>Статус</th></tr></thead>
              <tbody>
                {creators.map((creator) => {
                  const creatorStatus = getAdminCreatorStatus(creator);
                  return (
                    <tr key={creator.id}>
                      <td><strong>{creator.displayName}</strong></td>
                      <td>{creator.description || "Не указано"}</td>
                      <td>{creator._count?.applications || 0}</td>
                      <td>{creator._count?.affiliateRelationships || 0}</td>
                      <td><Status type={creatorStatus.type}>{creatorStatus.label}</Status></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!creators.length && <div className="empty-state">Зарегистрированных креаторов пока нет.</div>}
        </div>
      )}

      {tab === "applications" && (
        <div className="panel">
          <div className="panel-header"><h2>Заявки</h2><Status type="pending">{countActiveApplications(applications)} активных</Status></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Креатор</th><th>Бренд</th><th>Оффер</th><th>Дата</th><th>Статус</th></tr></thead>
              <tbody>
                {applications.map((application) => {
                  const applicationStatus = getAdminApplicationStatus(application);
                  return (
                    <tr key={application.id}>
                      <td>{application.creator.displayName}</td>
                      <td>{application.offer.brand.brandName}</td>
                      <td>{application.offer.title}</td>
                      <td>{new Date(application.createdAt).toLocaleDateString("ru-RU")}</td>
                      <td><Status type={applicationStatus.type}>{applicationStatus.label}</Status></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!applications.length && <div className="empty-state">Заявок от креаторов пока нет.</div>}
        </div>
      )}
      {tab === "finance" && (
        <div className="panel">
          <div className="panel-header"><h2>Финансы платформы</h2><button className="button small" onClick={runReconciliation}>Запустить reconciliation</button></div>
          <div className="stats-grid panel-body">
            <div className="stat-card"><span className="stat-label">Creator-attributed GMV</span><span className="stat-value">{moneyKopecks(finance.overview?.attributedGmvMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Комиссии креаторов</span><span className="stat-value">{moneyKopecks(finance.overview?.creatorCommissionsMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Доход Связки</span><span className="stat-value">{moneyKopecks(finance.overview?.platformRevenueMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Brand obligations</span><span className="stat-value">{moneyKopecks(finance.overview?.brandObligationsMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Не оплачено</span><span className="stat-value">{moneyKopecks(finance.overview?.unpaidObligationsMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Выплачено креаторам</span><span className="stat-value">{moneyKopecks(finance.overview?.paidPayoutsMinor)}</span></div>
            <div className="stat-card"><span className="stat-label">Открытые disputes</span><span className="stat-value">{finance.overview?.openDisputes || 0}</span></div>
          </div>
        </div>
      )}
      {tab === "statements" && (
        <div className="panel">
          <div className="panel-header"><h2>Brand statements</h2><Status type="success">Immutable after issue</Status></div>
          <div className="panel-body form-grid">
            <div className="form-group"><label className="form-label">Бренд</label><select className="field" value={statementForm.brandId} onChange={(event) => setStatementForm((current) => ({ ...current, brandId: event.target.value }))}><option value="">Выберите бренд</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.brandName}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Валюта</label><input className="field" value={statementForm.currency} maxLength={3} onChange={(event) => setStatementForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></div>
            <div className="form-group"><label className="form-label">Начало периода</label><input className="field" type="date" value={statementForm.periodStart} onChange={(event) => setStatementForm((current) => ({ ...current, periodStart: event.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Конец периода</label><input className="field" type="date" value={statementForm.periodEnd} onChange={(event) => setStatementForm((current) => ({ ...current, periodEnd: event.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Срок оплаты</label><input className="field" type="date" value={statementForm.dueAt} onChange={(event) => setStatementForm((current) => ({ ...current, dueAt: event.target.value }))} /></div>
            <div className="form-actions"><button className="button" disabled={!statementForm.brandId} onClick={() => issueStatement(statementForm)}>Выпустить statement</button></div>
          </div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Бренд</th><th>Период</th><th>Креаторам</th><th>Связке</th><th>К оплате</th><th>Оплачено</th><th>Статус</th><th></th></tr></thead><tbody>{(finance.statements || []).map((statement) => <tr key={statement.id}><td>{statement.brand?.brandName}</td><td>{new Date(statement.periodStart).toLocaleDateString("ru-RU")} — {new Date(statement.periodEnd).toLocaleDateString("ru-RU")}</td><td>{moneyKopecks(statement.creatorObligationsMinor)}</td><td>{moneyKopecks(statement.platformFeeMinor)}</td><td>{moneyKopecks(statement.totalDueMinor)}</td><td>{moneyKopecks(statement.paidMinor)}</td><td><Status type={statement.status === "PAID" ? "success" : statement.status === "OVERDUE" ? "danger" : "pending"}>{statement.status}</Status></td><td>{statement.status !== "PAID" && BigInt(statement.totalDueMinor || 0) > BigInt(statement.paidMinor || 0) && <button className="button small" onClick={() => recordBrandPayment(statement)}>Зафиксировать оплату остатка</button>}</td></tr>)}</tbody></table></div>
          {!finance.statements?.length && <div className="empty-state">Statements ещё не выпущены.</div>}
          {!!finance.payments?.length && <div className="table-wrap"><table className="data-table"><thead><tr><th>Дата платежа</th><th>Бренд</th><th>Сумма</th><th>Референс</th><th>Статус</th></tr></thead><tbody>{finance.payments.map((payment) => <tr key={payment.id}><td>{new Date(payment.paidAt).toLocaleDateString("ru-RU")}</td><td>{payment.brand?.brandName}</td><td>{moneyKopecks(payment.amountMinor)}</td><td>{payment.reference || "—"}</td><td><Status type={payment.status === "CANCELLED" ? "danger" : "success"}>{payment.status}</Status></td></tr>)}</tbody></table></div>}
        </div>
      )}
      {tab === "disputes" && (
        <div className="panel">
          <div className="panel-header"><h2>Financial disputes</h2><Status type="pending">{finance.disputes?.filter((item) => item.status === "OPEN").length || 0} открыто</Status></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Бренд</th><th>Заказ</th><th>Причина</th><th>Дата</th><th>Статус</th><th>Решение</th></tr></thead><tbody>{(finance.disputes || []).map((dispute) => <tr key={dispute.id}><td>{dispute.brand?.brandName}</td><td>{dispute.order?.externalOrderId}</td><td>{dispute.reason}</td><td>{new Date(dispute.openedAt).toLocaleDateString("ru-RU")}</td><td><Status type={dispute.status === "OPEN" ? "danger" : "success"}>{dispute.status}</Status></td><td>{dispute.status === "OPEN" ? <div className="row-actions"><input className="field" value={disputeResolutions[dispute.id] || ""} placeholder="Итог проверки" onChange={(event) => setDisputeResolutions((current) => ({ ...current, [dispute.id]: event.target.value }))} /><button className="button small" disabled={(disputeResolutions[dispute.id] || "").trim().length < 5} onClick={() => resolveDispute(dispute.id, disputeResolutions[dispute.id])}>Закрыть спор</button></div> : dispute.resolution || "—"}</td></tr>)}</tbody></table></div>
          {!finance.disputes?.length && <div className="empty-state">Disputes отсутствуют.</div>}
        </div>
      )}
      {tab === "payouts" && (
        <div className="panel">
          <div className="panel-header"><h2>Ручные выплаты</h2><Status type="success">Подключено</Status></div>
          <div className="panel-body">
            <h3>Доступные комиссии</h3>
            {(finance.commissions?.items || []).filter((item) => item.status === "AVAILABLE" && !item.payoutId).map((commission) => (
              <div className="tool-card" key={commission.id}>
                <span>{commission.creator.displayName} · {commission.offer.title}</span>
                <strong>{moneyKopecks(commission.creatorAmountKopecks)}</strong>
                <button className="button small" onClick={() => createPayout([commission.id])}>Создать payout</button>
              </div>
            ))}
            {!(finance.commissions?.items || []).some((item) => item.status === "AVAILABLE" && !item.payoutId) && <div className="empty-state">Комиссий, доступных к выплате, пока нет.</div>}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Креатор</th><th>Сумма</th><th>Референс</th><th>Статус</th><th></th></tr></thead>
              <tbody>{(finance.payouts?.items || []).map((payout) => (
                <tr key={payout.id}>
                  <td>{payout.creator.displayName}</td><td>{moneyKopecks(payout.amountKopecks)}</td><td>{payout.reference || "—"}</td>
                  <td><Status type={payout.status === "PAID" ? "success" : "pending"}>{payout.status}</Status></td>
                  <td><div className="row-actions">{payout.status === "DRAFT" && <button className="button secondary small" onClick={() => approvePayout(payout.id)}>Подтвердить</button>}{payout.status === "APPROVED" && <button className="button small" onClick={() => markPayoutPaid(payout.id)}>Отметить выплаченным</button>}{["DRAFT", "APPROVED"].includes(payout.status) && <button className="button ghost small" onClick={() => cancelPayout(payout.id)}>Отменить</button>}</div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {(finance.commissions?.items || []).filter((item) => item.hasPostPayoutDebt).map((commission) => <div className="creator-warning compact-warning" key={commission.id}><span className="warning-mark">!</span><strong>Возврат после выплаты: {commission.creator.displayName}, задолженность {moneyKopecks(commission.debtAmountKopecks)}</strong></div>)}
        </div>
      )}
      {tab === "ledger" && (
        <div className="panel">
          <div className="panel-header"><h2>Balanced ledger transactions</h2><Status type="success">Append-only</Status></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Событие</th><th>Источник</th><th>Заказ / Payout / Statement</th><th>Debit</th><th>Credit</th><th>Валюта</th></tr></thead><tbody>{(finance.ledger?.items || []).map((entry) => { const debit = (entry.postings || []).filter((posting) => posting.direction === "DEBIT").reduce((sum, posting) => sum + BigInt(posting.amountMinor), 0n); const credit = (entry.postings || []).filter((posting) => posting.direction === "CREDIT").reduce((sum, posting) => sum + BigInt(posting.amountMinor), 0n); return <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString("ru-RU")}</td><td><strong>{entry.type}</strong><span className="table-subtitle">{entry.eventKey}</span></td><td>{entry.source}</td><td>{entry.order?.externalOrderId || entry.payout?.id || entry.statement?.id || "—"}</td><td>{moneyKopecks(debit)}</td><td>{moneyKopecks(credit)}</td><td>{entry.currency}</td></tr>; })}</tbody></table></div>
        </div>
      )}
    </DashboardLayout>
  );
}

const STATUS_LABELS = {
  DRAFT: "Черновик",
  MODERATION: "На модерации",
  PUBLISHED: "Опубликован",
  PAUSED: "Приостановлен",
  ARCHIVED: "В архиве"
};

function toUiOffer(offer, creatorKitResponse = null) {
  const creatorEffectiveBps = offer.creatorEffectiveBps ?? offer.creatorCommissionBps;
  const totalCommissionPoolBps = offer.totalCommissionPoolBps ?? creatorEffectiveBps;
  const base = {
    id: offer.id,
    brand: offer.brand?.brandName || "Бренд",
    title: offer.title,
    category: offer.category || "Товары",
    price: offer.productPriceKopecks / 100,
    commission: creatorEffectiveBps / 100,
    creatorEffectiveBps,
    totalCommission: totalCommissionPoolBps / 100,
    totalCommissionPoolBps,
    platformEffectiveBps: offer.platformEffectiveBps ?? null,
    offerVersion: offer.offerVersion ?? null,
    commercialTermsVersion: offer.commercialTermsVersion ?? null,
    calculationPolicy: offer.calculationPolicy || "LEGACY_DIRECT_RATES_V1",
    currency: offer.currency || "RUB",
    threshold: offer.productRequirementSales || 0,
    imageUrl: offer.imageUrl || "",
    image: offer.imageUrl || productImages.skincare,
    status: offer.status === "PUBLISHED" ? "active" : offer.status.toLowerCase(),
    apiStatus: offer.status,
    statusLabel: STATUS_LABELS[offer.status] || offer.status,
    applications: 0,
    sales: 0,
    description: offer.description,
    productUrl: offer.productUrl || "",
    terms: "Условия продвижения указаны брендом в карточке оффера.",
    materials: "Материалы Creator Kit хранятся в приватном файловом хранилище.",
    promotionWithoutProduct: offer.promotionWithoutProduct,
    allowedPromotionFormats: offer.allowedPromotionFormats || [],
    currentManagerId: offer.currentManagerId || null,
    currentManager: offer.currentManager || null,
    creatorKitScenariosLoaded: Boolean(creatorKitResponse && Array.isArray(creatorKitResponse.scenarios))
  };
  const creatorKit = creatorKitResponse
    ? mapCreatorKit(creatorKitResponse, offer)
    : mapCreatorKit({ offerPolicy: { promotionWithoutProduct: offer.promotionWithoutProduct, allowedPromotionFormats: offer.allowedPromotionFormats } }, offer);
  return { ...base, creatorKit };
}

function managerDisplayName(manager) {
  return manager?.displayName || manager?.managerProfile?.displayName || manager?.email || "Без менеджера";
}

function OfferManagerSelect({ offer, managers, onChange, disabled = false }) {
  return (
    <label className="offer-manager-control" onClick={(event) => event.stopPropagation()}>
      <span className="table-subtitle">Ответственный менеджер</span>
      <select
        className="select-field compact-select"
        value={offer.currentManagerId || ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Без менеджера</option>
        {managers.map((assignment) => {
          const manager = assignment.manager || assignment;
          const managerId = assignment.managerId || manager.id;
          return <option value={managerId} key={managerId}>{managerDisplayName(manager)}</option>;
        })}
      </select>
    </label>
  );
}

function RelationshipManagerSelect({ relationship, managers, onChange }) {
  return (
    <label className="offer-manager-control" onClick={(event) => event.stopPropagation()}>
      <span className="table-subtitle">Ответственный менеджер</span>
      <select
        className="select-field compact-select"
        value={relationship.currentManagerId || ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Без менеджера</option>
        {managers.map((assignment) => {
          const manager = assignment.manager || assignment;
          const managerId = assignment.managerId || manager.id;
          return <option value={managerId} key={managerId}>{managerDisplayName(manager)}</option>;
        })}
      </select>
    </label>
  );
}

const scenarioChannelValues = Object.fromEntries(Object.entries(scenarioChannelLabels).map(([key, value]) => [value, key]));

function creatorKitPayload(kit) {
  return {
    brandContent: {
      description: kit.brandContent?.description || undefined,
      history: kit.brandContent?.history || undefined,
      values: kit.brandContent?.values || [],
      positioning: kit.brandContent?.positioning || undefined,
      accessLevel: kit.brandContent?.accessLevel || "DIGITAL",
      requiresAffiliateApproval: Boolean(kit.brandContent?.requiresAffiliateApproval)
    },
    productContent: {
      description: kit.productContent?.description || undefined,
      benefits: kit.productContent?.benefits || [],
      usageInstructions: kit.productContent?.usageInstructions || undefined,
      accessLevel: kit.productContent?.accessLevel || "DIGITAL",
      requiresAffiliateApproval: Boolean(kit.productContent?.requiresAffiliateApproval)
    },
    scenarios: (kit.scenarios || []).map((scenario, index) => ({
      channel: scenario.channelValue || scenarioChannelValues[scenario.channel] || scenario.channel,
      title: scenario.title,
      mainIdea: scenario.mainIdea || scenario.idea,
      hook: scenario.hook || undefined,
      structure: scenario.structure || undefined,
      cta: scenario.cta || undefined,
      accessLevel: scenario.accessLevel || "DIGITAL",
      requiresAffiliateApproval: scenario.requiresAffiliateApproval || false,
      sortOrder: index
    }))
  };
}

function ScenarioEditor({ scenarios, errors = {}, onChange, disabled = false, emptyMessage = "Сценариев пока нет. Добавьте первый сценарий." }) {
  const updateScenario = (index, key, value) => {
    onChange(scenarios.map((scenario, scenarioIndex) => (
      scenarioIndex === index ? { ...scenario, [key]: value } : scenario
    )));
  };

  const addScenario = () => {
    onChange([
      ...scenarios,
      {
        channel: "REELS",
        title: "",
        idea: "",
        accessLevel: "DIGITAL",
        requiresAffiliateApproval: false
      }
    ]);
  };

  const removeScenario = (index) => {
    onChange(scenarios.filter((_, scenarioIndex) => scenarioIndex !== index));
  };

  return (
    <>
      <div className="panel-header">
        <div><h3>Сценарии</h3><p>Добавьте идеи, которые креатор сможет адаптировать под свой стиль.</p></div>
        <button className="button secondary small" type="button" onClick={addScenario} disabled={disabled}>＋ Добавить сценарий</button>
      </div>
      <div className="scenario-editor-list">
        {scenarios.map((scenario, index) => (
          <div className="scenario-editor-row" key={scenario.id || `scenario-${index}`}>
            <div className="scenario-editor-row-head">
              <strong>Сценарий {index + 1}</strong>
              <button className="text-button danger" type="button" onClick={() => removeScenario(index)} disabled={disabled}>Удалить</button>
            </div>
            <div className="form-grid compact-form-grid">
              <div className="form-group">
                <label className="form-label">Канал</label>
                <select className="select-field" value={scenario.channel} disabled={disabled} onChange={(event) => updateScenario(index, "channel", event.target.value)}>
                  {Object.entries(scenarioChannelLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Уровень доступа</label>
                <select className="select-field" value={scenario.accessLevel} disabled={disabled} onChange={(event) => updateScenario(index, "accessLevel", event.target.value)}>
                  <option value="DIGITAL">Digital Access</option>
                  <option value="PRODUCT">Product Access</option>
                </select>
              </div>
              <div className="form-group full">
                <label className="form-label">Название сценария</label>
                <input className="field" value={scenario.title} minLength={3} maxLength={200} disabled={disabled} onChange={(event) => updateScenario(index, "title", event.target.value)} placeholder="Например: Три факта о продукте" />
                {errors[index]?.title && <span className="form-error">{errors[index].title}</span>}
              </div>
              <div className="form-group full">
                <label className="form-label">Идея</label>
                <textarea className="textarea" value={scenario.idea} minLength={10} maxLength={5000} disabled={disabled} onChange={(event) => updateScenario(index, "idea", event.target.value)} placeholder="Опишите, как креатор может адаптировать эту идею." />
                {errors[index]?.idea && <span className="form-error">{errors[index].idea}</span>}
              </div>
              <label className={`checkbox-inline ${scenario.requiresAffiliateApproval ? "checked" : ""}`}>
                <input type="checkbox" checked={scenario.requiresAffiliateApproval} disabled={disabled} onChange={(event) => updateScenario(index, "requiresAffiliateApproval", event.target.checked)} />
                <span>Только для одобренных партнёров</span>
              </label>
            </div>
          </div>
        ))}
        {!scenarios.length && <div className="empty-state">{emptyMessage}</div>}
      </div>
    </>
  );
}

function ManagerInvitationPage({ token, user, role, navigate, notify, onAcceptExisting }) {
  const [invitation, setInvitation] = useState(null);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invitationError, setInvitationError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [existingAccepted, setExistingAccepted] = useState(false);

  const continueToLogin = () => {
    try {
      window.sessionStorage.setItem(managerInvitationStorageKey, token);
    } catch {
      // The invitation token remains in the current URL when storage is unavailable.
    }
    navigate("login");
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    api(`/manager-invitations/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!active) return;
        setInvitation(data);
      })
      .catch((requestError) => {
        if (active) setInvitationError(requestError.message || "Приглашение недействительно или истекло");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    const passwordIsValid = password.length >= 10 && /[a-zа-яё]/i.test(password) && /\d/.test(password);
    if (!passwordIsValid) {
      setSubmitError("Пароль должен содержать минимум 10 символов, хотя бы 1 букву и 1 цифру");
      return;
    }
    if (password !== passwordConfirmation) {
      setSubmitError("Пароли не совпадают");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      await api(`/manager-invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        body: JSON.stringify({ password })
      });
      setAccepted(true);
      notify("Аккаунт менеджера создан. Выполните вход.");
    } catch (requestError) {
      setSubmitError(requestError.message || "Не удалось принять приглашение");
    } finally {
      setSubmitting(false);
    }
  };

  const acceptExisting = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      await onAcceptExisting(token);
      setExistingAccepted(true);
      notify("Бренд добавлен в ваш аккаунт менеджера.");
    } catch (requestError) {
      setSubmitError(requestError.message || "Не удалось принять приглашение");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <main className="auth-main"><div className="auth-panel"><h2>Проверяем приглашение…</h2></div></main>;
  }

  if (accepted) {
    return (
      <main className="auth-page">
        <section className="auth-main">
          <div className="auth-panel">
            <h2>Приглашение принято</h2>
            <p>Аккаунт менеджера создан. Войдите с адресом приглашения и новым паролем.</p>
            <div className="form-actions">
              <button className="button" onClick={() => navigate("login")}>Перейти ко входу</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (existingAccepted) {
    return (
      <main className="auth-page">
        <section className="auth-main">
          <div className="auth-panel">
            <h2>Приглашение принято</h2>
            <p>Новый бренд добавлен среди доступных вам брендов.</p>
            <div className="form-actions">
              <button className="button" onClick={() => navigate("brand", { asRole: "manager" })}>Открыть кабинет бренда</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (invitationError || !invitation?.valid) {
    return (
      <main className="auth-page">
        <section className="auth-main">
          <div className="auth-panel">
            <h2>Приглашение недоступно</h2>
            <p>{invitationError || "Приглашение недействительно, отозвано или истекло."}</p>
            <div className="form-actions">
              <button className="button secondary" onClick={continueToLogin}>Перейти ко входу</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (invitation.existingManagerAccount) {
    const authenticatedManager = role === "manager" && Boolean(user?.id);
    return (
      <main className="auth-page">
        <section className="auth-main">
          <div className="auth-panel">
            <h2>Нужен вход менеджера</h2>
            <p>Этот email уже связан с аккаунтом MANAGER. Войдите в существующий аккаунт, чтобы принять приглашение.</p>
            {authenticatedManager ? (
              <>
                {submitError && <span className="form-error">{submitError}</span>}
                <button className="button" onClick={acceptExisting} disabled={submitting}>
                  {submitting ? "Принимаем приглашение…" : "Принять приглашение"}
                </button>
              </>
            ) : null}
            <div className="form-actions">
              {!authenticatedManager && <button className="button" onClick={continueToLogin}>Перейти ко входу</button>}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <div>
          <BrandLogo onClick={() => navigate("home")} />
          <h1>Вас приглашают в команду бренда</h1>
          <p>Создайте пароль, чтобы открыть рабочий кабинет менеджера.</p>
        </div>
      </aside>
      <section className="auth-main">
        <div className="auth-panel">
          <h2>{invitation.brand?.name || "Приглашение менеджера"}</h2>
          <p>Имя: <strong>{invitation.displayName}</strong></p>
          <p>Email: <strong>{invitation.email}</strong></p>
          <p>Приглашение действительно до {new Date(invitation.expiresAt).toLocaleDateString("ru-RU")}.</p>
          <form className="form-grid" onSubmit={submit}>
            <div className="form-group full">
              <span className="form-label">Имя в приглашении</span>
              <div className="field">{invitation.displayName}</div>
            </div>
            <div className="form-group full">
              <label className="form-label">Новый пароль</label>
              <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
              <span className="form-hint">Минимум 10 символов, хотя бы 1 буква и 1 цифра.</span>
              {submitError && submitError !== "Пароли не совпадают" && <span className="form-error">{submitError}</span>}
            </div>
            <div className="form-group full">
              <label className="form-label">Повторите пароль</label>
              <input className="field" type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" required />
              {submitError === "Пароли не совпадают" && <span className="form-error">{submitError}</span>}
            </div>
            <div className="form-actions full">
              <button className="button" type="submit" disabled={submitting}>{submitting ? "Создаём аккаунт…" : "Создать аккаунт менеджера"}</button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [page, setPage] = useState("home");
  const [invitationToken] = useState(() => {
    const pathToken = managerInvitationTokenFromPath();
    if (pathToken) return pathToken;
    try {
      return window.sessionStorage.getItem(managerInvitationStorageKey);
    } catch {
      return null;
    }
  });
  const [role, setRole] = useState("guest");
  const [user, setUser] = useState(null);
  const [offers, setOffers] = useState([]);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [editingOfferId, setEditingOfferId] = useState(null);
  const [brandDashboardTarget, setBrandDashboardTarget] = useState({
    tab: "offers",
    creatorKitOfferId: null,
    creatorKitFocus: null
  });
  const [registerRole, setRegisterRole] = useState("");
  const [applications, setApplications] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [creatorFinance, setCreatorFinance] = useState({ clicks: { items: [] }, orders: { items: [] }, commissions: { items: [] }, payouts: { items: [] }, summary: {} });
  const [creatorNotifications, setCreatorNotifications] = useState({ items: [], counts: { unread: 0, actionRequired: 0 } });
  const [brandFinance, setBrandFinance] = useState({ orders: { items: [] }, commissions: { items: [] }, analytics: {}, creatorAnalytics: { items: [] }, overview: {}, statements: [] });
  const [adminFinance, setAdminFinance] = useState({ commissions: { items: [] }, payouts: { items: [] }, ledger: { items: [] }, overview: {}, statements: [], payments: [], disputes: [] });
  const [adminBrands, setAdminBrands] = useState([]);
  const [adminCreators, setAdminCreators] = useState([]);
  const [adminApplications, setAdminApplications] = useState([]);
  const [operationalReadiness, setOperationalReadiness] = useState(null);
  const [orderImportPreview, setOrderImportPreview] = useState(null);
  const [managerBrands, setManagerBrands] = useState([]);
  const [activeBrandId, setActiveBrandId] = useState(null);
  const [activeBrandProfile, setActiveBrandProfile] = useState(null);
  const [teamManagers, setTeamManagers] = useState([]);
  const [teamInvitations, setTeamInvitations] = useState([]);
  const [toast, setToast] = useState("");
  const [sessionReady, setSessionReady] = useState(false);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.id === selectedOfferId) || offers[0],
    [offers, selectedOfferId]
  );

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  const roleFromUser = (nextUser) => nextUser?.role?.toLowerCase() || "guest";

  const canOpen = (target, currentRole = role) => {
    if (["brand", "create"].includes(target)) return ["brand", "manager"].includes(currentRole);
    if (target === "manager") return currentRole === "manager";
    if (target === "creator") return currentRole === "creator";
    if (target === "admin") return currentRole === "admin";
    return true;
  };

  const loadFinance = async (currentRole) => {
    if (["brand", "manager"].includes(currentRole)) {
      const [ordersData, commissionsData, analyticsData, creatorAnalyticsData, overviewData, statementsData] = await Promise.all([
        api("/brand/orders?pageSize=100"),
        api("/brand/commissions?pageSize=100"),
        api("/brand/analytics"),
        api("/brand/analytics/creators?pageSize=100"),
        api("/brand/finance/overview"),
        api("/brand/statements")
      ]);
      setBrandFinance({ orders: ordersData, commissions: commissionsData, analytics: analyticsData, creatorAnalytics: creatorAnalyticsData, overview: overviewData, statements: statementsData });
    } else if (currentRole === "creator") {
      const [clicksData, ordersData, commissionsData, summaryData, payoutsData, notificationsData, notificationCounts] = await Promise.all([
        api("/creator/clicks?pageSize=100"),
        api("/creator/orders?pageSize=100"),
        api("/creator/commissions?pageSize=100"),
        api("/creator/earnings-summary"),
        api("/creator/payouts?pageSize=100"),
        api("/creator/notifications"),
        api("/creator/notifications/unread-count")
      ]);
      setCreatorFinance({ clicks: clicksData, orders: ordersData, commissions: commissionsData, payouts: payoutsData, summary: summaryData });
      setCreatorNotifications({ items: notificationsData, counts: notificationCounts });
    } else if (currentRole === "admin") {
      const [commissionsData, payoutsData, ledgerData, brandsData, creatorsData, applicationsData, readinessData, overviewData, statementsData, paymentsData, disputesData] = await Promise.all([
        api("/admin/commissions?pageSize=100"),
        api("/admin/payouts?pageSize=100"),
        api("/admin/ledger-transactions?pageSize=100"),
        api("/admin/brands"),
        api("/admin/creators"),
        api("/admin/applications"),
        api("/admin/operations/readiness"),
        api("/admin/finance/overview"),
        api("/admin/statements"),
        api("/admin/brand-payments"),
        api("/admin/disputes")
      ]);
      setAdminFinance({ commissions: commissionsData, payouts: payoutsData, ledger: ledgerData, overview: overviewData, statements: statementsData, payments: paymentsData, disputes: disputesData });
      setAdminBrands(brandsData);
      setAdminCreators(creatorsData);
      setAdminApplications(applicationsData);
      setOperationalReadiness(readinessData);
    }
  };

  const loadBrandTeam = async () => {
    const [managersData, invitationsData] = await Promise.all([
      api("/brand/team/managers"),
      api("/brand/team/invitations")
    ]);
    setTeamManagers(managersData);
    setTeamInvitations(invitationsData);
  };

  const loadActiveManagers = async () => {
    const managersData = await api("/brand/team/managers");
    setTeamManagers(managersData);
  };

  const navigate = (target, options = {}) => {
    if (options.role) setRegisterRole(options.role);
    if (options.offerId) setSelectedOfferId(options.offerId);
    if (target === "create") setEditingOfferId(options.editOfferId || null);
    const nextRole = options.asRole || role;
    const safeTarget = canOpen(target, nextRole) ? target : "login";
    setPage(safeTarget);
    window.history.pushState({ page: safeTarget }, "", `#${safeTarget}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (nextRole === "manager" && safeTarget === "catalog") {
      loadPublicOffers().catch((error) => notify(error.message));
    } else if (nextRole === "manager" && safeTarget === "brand" && activeBrandId) {
      loadOffers("manager").catch((error) => notify(error.message));
    }
    if (options.anchor) {
      window.setTimeout(() => {
        const element = document.getElementById(options.anchor);
        if (element) window.scrollTo({ top: Math.max(0, element.offsetTop - 72), behavior: "smooth" });
      }, 60);
    }
  };

  const loadOffers = async (currentRole = role) => {
    if (["brand", "manager"].includes(currentRole)) {
      if (currentRole === "brand") {
        await loadBrandTeam();
      } else {
        await loadActiveManagers();
      }
      const data = await api("/brand/offers");
      const mapped = await Promise.all(data.map(async (offer) => {
        const kit = await api(`/brand/offers/${offer.id}/creator-kit`);
        return toUiOffer(offer, kit);
      }));
      setOffers(mapped);
      const [applicationGroups, brandRelationships] = await Promise.all([
        Promise.all(mapped.map((offer) => api(`/brand/offers/${offer.id}/applications`))),
        api("/brand/affiliate-relationships")
      ]);
      setApplications(applicationGroups.flat());
      setRelationships(brandRelationships);
      await loadFinance("brand");
    } else if (currentRole === "creator") {
      const [data, creatorApplications, creatorRelationships] = await Promise.all([
        api("/creator/offers"),
        api("/creator/applications"),
        api("/creator/affiliate-relationships")
      ]);
      const mapped = await Promise.all(data.map(async (offer) => {
        try {
          const kit = await api(`/creator/offers/${offer.id}/creator-kit`);
          const uiOffer = toUiOffer(offer, kit);
          const relationship = creatorRelationships.find((item) => item.offerId === offer.id && item.status === "ACTIVE");
          if (relationship) {
            uiOffer.creatorKit.creatorTools = {
              link: relationship.affiliateUrl,
              promoCode: relationship.promoCode,
              status: relationship.status
            };
          }
          return uiOffer;
        } catch (error) {
          return {
            ...toUiOffer(offer),
            creatorKit: null,
            creatorKitError: true,
            creatorKitErrorMessage: error.message || "Не удалось загрузить Creator Kit"
          };
        }
      }));
      setOffers(mapped);
      setApplications(creatorApplications);
      setRelationships(creatorRelationships);
      await loadFinance("creator");
    } else if (currentRole === "admin") {
      setOffers(initialOffers);
      setApplications([]);
      setRelationships([]);
      try {
        await loadFinance("admin");
      } catch {
        setAdminFinance({ commissions: { items: [] }, payouts: { items: [] }, ledger: { items: [] }, overview: {}, statements: [], payments: [], disputes: [] });
        setAdminBrands([]);
        setAdminCreators([]);
        setAdminApplications([]);
        setOperationalReadiness(null);
      }
    } else {
      setOffers([]);
      setApplications([]);
      setRelationships([]);
    }
  };

  const retryCreatorKit = async (offerId) => {
    setOffers((current) => current.map((offer) => (
      offer.id === offerId
        ? { ...offer, creatorKitError: false, creatorKitErrorMessage: "" }
        : offer
    )));
    try {
      const offer = offers.find((item) => item.id === offerId);
      if (!offer) throw new Error("Оффер не найден");
      const kit = await api(`/creator/offers/${offerId}/creator-kit`);
      const nextOffer = toUiOffer(offer, kit);
      const relationship = relationships.find((item) => item.offerId === offerId && item.status === "ACTIVE");
      if (relationship) {
        nextOffer.creatorKit.creatorTools = {
          link: relationship.affiliateUrl,
          promoCode: relationship.promoCode,
          status: relationship.status
        };
      }
      setOffers((current) => current.map((item) => item.id === offerId ? nextOffer : item));
    } catch (error) {
      setOffers((current) => current.map((offer) => (
        offer.id === offerId
          ? {
              ...offer,
              creatorKit: null,
              creatorKitError: true,
              creatorKitErrorMessage: error.message || "Не удалось загрузить Creator Kit"
            }
          : offer
      )));
    }
  };

  const loadPublicOffers = async () => {
    const data = await api("/public/offers");
    setOffers(data.map((offer) => ({ ...toUiOffer(offer), creatorKit: null })));
    setApplications([]);
    setRelationships([]);
  };

  const clearManagerBrandContext = (managerUserId, forgetSelection = false) => {
    setApiActiveBrandId(null);
    setActiveBrandId(null);
    setActiveBrandProfile(null);
    setManagerBrands([]);
    setTeamManagers([]);
    setTeamInvitations([]);
    if (forgetSelection && managerUserId) {
      try {
        window.sessionStorage.removeItem(managerBrandStorageKey(managerUserId));
      } catch {
        // Session storage is optional; in-memory context is still cleared.
      }
    }
  };

  const activateManagerBrand = async (managerUser, brandId, brands = managerBrands) => {
    const selectedBrand = brands.find((brand) => brand.id === brandId);
    if (!managerUser || !selectedBrand) throw new Error("Бренд больше не доступен");

    setApiActiveBrandId(brandId);
    try {
      const brandProfile = await api("/brands/me");
      setActiveBrandId(brandId);
      setActiveBrandProfile(brandProfile);
      try {
        window.sessionStorage.setItem(managerBrandStorageKey(managerUser.id), brandId);
      } catch {
        // The active context remains available for the current page session.
      }
      await loadOffers("manager");
      return selectedBrand;
    } catch (error) {
      setApiActiveBrandId(null);
      setActiveBrandId(null);
      setActiveBrandProfile(null);
      try {
        window.sessionStorage.removeItem(managerBrandStorageKey(managerUser.id));
      } catch {
        // Ignore unavailable session storage while clearing invalid context.
      }
      throw error;
    }
  };

  const initializeManagerBrandContext = async (managerUser) => {
    setApiActiveBrandId(null);
    setActiveBrandId(null);
    setActiveBrandProfile(null);

    const brands = await api("/manager/brands");
    setManagerBrands(brands);

    let storedBrandId = null;
    try {
      storedBrandId = window.sessionStorage.getItem(managerBrandStorageKey(managerUser.id));
    } catch {
      // Continue without persistence when session storage is unavailable.
    }

    const selectedBrandId = brands.length === 1
      ? brands[0].id
      : brands.some((brand) => brand.id === storedBrandId)
        ? storedBrandId
        : null;

    if (!selectedBrandId) {
      await loadOffers("guest");
      return null;
    }

    await activateManagerBrand(managerUser, selectedBrandId, brands);
    return selectedBrandId;
  };

  const selectManagerBrand = async (brandId) => {
    try {
      await activateManagerBrand(user, brandId);
      navigate("brand", { asRole: "manager" });
    } catch (error) {
      notify(error.message);
    }
  };

  const acceptExistingManagerInvitation = async (token) => {
    if (!user || role !== "manager") throw new Error("Войдите в аккаунт менеджера");
    await api(`/manager-invitations/${encodeURIComponent(token)}/accept-existing`, {
      method: "POST"
    });
    try {
      window.sessionStorage.removeItem(managerInvitationStorageKey);
    } catch {
      // Ignore unavailable session storage after successful acceptance.
    }
    await initializeManagerBrandContext(user);
  };

  const inviteManager = async (payload) => {
    try {
      const invitation = await api("/brand/team/invitations", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setTeamInvitations((current) => [invitation, ...current]);
      notify("Приглашение создано");
      return invitation;
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const revokeInvitation = async (invitationId) => {
    try {
      await api(`/brand/team/invitations/${invitationId}`, { method: "DELETE" });
      setTeamInvitations((current) => current.map((item) => item.id === invitationId ? { ...item, status: "REVOKED", revokedAt: new Date().toISOString() } : item));
      notify("Приглашение отозвано");
    } catch (error) {
      notify(error.message);
    }
  };

  const removeManager = async (managerId) => {
    try {
      await api(`/brand/team/managers/${managerId}`, { method: "DELETE" });
      setTeamManagers((current) => current.filter((item) => item.managerId !== managerId));
      notify("Менеджер удалён из команды");
    } catch (error) {
      notify(error.message);
    }
  };

  useEffect(() => {
    let active = true;
    restoreSession().then(async (restoredUser) => {
      if (!active) return;
      if (invitationToken) {
        setUser(restoredUser);
        setRole(roleFromUser(restoredUser));
        setSessionReady(true);
        setPage("manager-invitation");
        return;
      }
      const restoredRole = roleFromUser(restoredUser);
      setUser(restoredUser);
      setRole(restoredRole);
      let restoredBrandId = null;
      if (restoredUser) {
        try {
          if (restoredRole === "manager") {
            restoredBrandId = await initializeManagerBrandContext(restoredUser);
          } else {
            clearManagerBrandContext();
            await loadOffers(restoredRole);
          }
        } catch (error) {
          notify(error.message);
        }
      } else {
        try {
          await loadPublicOffers();
        } catch (error) {
          notify(error.message);
        }
      }
      const requestedHash = window.location.hash.replace("#", "");
      const managerDefault = restoredBrandId ? "brand" : "manager";
      const requested = requestedHash || (restoredRole === "manager" ? managerDefault : "home");
      const initialPage = restoredRole === "manager" && requested === "manager" && restoredBrandId
        ? "brand"
        : pageTitles[requested] && canOpen(requested, restoredRole)
          ? requested
          : pageTitles[requested]
            ? "login"
            : restoredRole === "manager"
              ? managerDefault
              : "home";
      setPage(initialPage);
      if (initialPage !== requested) window.history.replaceState({ page: initialPage }, "", `#${initialPage}`);
      setSessionReady(true);
    });
    return () => { active = false; };
  }, [invitationToken]);

  useEffect(() => {
    const onPop = () => {
      const next = window.location.hash.replace("#", "") || "home";
      setPage(pageTitles[next] && canOpen(next) ? next : "login");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [role]);

  useEffect(() => {
    document.title = `${pageTitles[page] || "Связка"} · Связка`;
  }, [page]);

  const completeRegistration = async (newRole, form) => {
    try {
      const name = newRole === "brand" ? form.company : form.name;
      const result = await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          role: newRole.toUpperCase(),
          name
        })
      });
      clearManagerBrandContext(user?.id, role === "manager");
      setAccessToken(result.accessToken);
      setRole(newRole);
      if (newRole === "brand" && form.website) {
        await api("/brands/me", {
          method: "PATCH",
          body: JSON.stringify({ website: form.website })
        });
      }
      if (newRole === "creator" && form.channel) {
        await api("/creators/me", {
          method: "PATCH",
          body: JSON.stringify({ socialLinks: { primary: form.channel } })
        });
      }
      setUser(await api("/auth/me"));
      await loadOffers(newRole);
      notify("Аккаунт создан и сохранён");
      navigate(
        newRole === "creator" && selectedOfferId ? "offer" : newRole,
        { asRole: newRole, offerId: selectedOfferId || undefined },
      );
    } catch (error) {
      notify(error.message);
    }
  };

  const login = async (form) => {
    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(form)
      });
      if (result.mfaRequired) return result;
      clearManagerBrandContext(user?.id, role === "manager");
      setAccessToken(result.accessToken);
      const nextRole = roleFromUser(result.user);
      setRole(nextRole);
      const nextUser = await api("/auth/me");
      setUser(nextUser);
      const selectedBrandId = nextRole === "manager"
        ? await initializeManagerBrandContext(nextUser)
        : await loadOffers(nextRole).then(() => null);
      notify("Вход выполнен");
      let pendingInvitationToken = null;
      try {
        pendingInvitationToken = window.sessionStorage.getItem(managerInvitationStorageKey);
      } catch {
        // The URL-backed invitation flow can continue without session storage.
      }
      navigate(
        pendingInvitationToken && nextRole === "manager"
          ? "manager-invitation"
          : nextRole === "manager" && selectedBrandId
            ? "brand"
            : nextRole === "creator" && selectedOfferId
              ? "offer"
              : nextRole,
        { asRole: nextRole, offerId: selectedOfferId || undefined },
      );
      return null;
    } catch (error) {
      notify(error.message);
      return null;
    }
  };

  const verifyMfa = async (challengeToken, code) => {
    try {
      const result = await api("/auth/admin/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken, code })
      });
      clearManagerBrandContext(user?.id, role === "manager");
      setAccessToken(result.accessToken);
      const nextRole = roleFromUser(result.user);
      setRole(nextRole);
      setUser(await api("/auth/me"));
      await loadOffers(nextRole);
      notify("Вход подтверждён");
      navigate(nextRole, { asRole: nextRole });
    } catch (error) {
      notify(error.message);
    }
  };

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Локальное завершение сессии выполняется даже при недоступном сервере.
    }
    clearManagerBrandContext(user?.id, role === "manager");
    setAccessToken(null);
    setUser(null);
    setRole("guest");
    setOffers([]);
    setApplications([]);
    setRelationships([]);
    setCreatorFinance({ clicks: { items: [] }, orders: { items: [] }, commissions: { items: [] }, payouts: { items: [] }, summary: {} });
    setCreatorNotifications({ items: [], counts: { unread: 0, actionRequired: 0 } });
    setBrandFinance({ orders: { items: [] }, commissions: { items: [] }, analytics: {}, creatorAnalytics: { items: [] }, overview: {}, statements: [] });
    setAdminFinance({ commissions: { items: [] }, payouts: { items: [] }, ledger: { items: [] }, overview: {}, statements: [], payments: [], disputes: [] });
    setAdminBrands([]);
    setAdminCreators([]);
    setAdminApplications([]);
    setOrderImportPreview(null);
    try {
      await loadPublicOffers();
    } catch {
      // Keep the guest shell usable if the public catalog is temporarily unavailable.
    }
    navigate("home");
  };

  const openOffer = (offer) => navigate("offer", { offerId: offer.id });

  const apply = async (offerId, message) => {
    try {
      const offer = offers.find((item) => item.id === offerId);
      await api(`/creator/offers/${offerId}/applications`, {
        method: "POST",
        body: JSON.stringify({
          ...(message.trim() ? { message: message.trim() } : {}),
          ...(offer?.commercialTermsVersion ? { expectedCommercialTermsVersion: offer.commercialTermsVersion } : {})
        })
      });
      await loadOffers("creator");
      notify("Заявка отправлена бренду");
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  };

  const acceptApplicationTerms = async (application) => {
    try {
      const version = application.applicableCommercialTerms?.version;
      await api(`/creator/applications/${application.id}/accept-terms`, {
        method: "POST",
        body: JSON.stringify({
          expectedCommercialTermsVersion: version,
          expectedApplicationVersion: application.version
        })
      });
      await loadOffers("creator");
      notify("Новые коммерческие условия приняты");
    } catch (error) {
      notify(error.message);
    }
  };

  const withdrawApplication = async (applicationId) => {
    try {
      await api(`/creator/applications/${applicationId}/withdraw`, { method: "POST" });
      await loadOffers("creator");
      notify("Заявка отозвана");
    } catch (error) {
      notify(error.message);
    }
  };

  const cancelApplication = async (applicationId) => {
    try {
      await api(`/creator/applications/${applicationId}/cancel`, { method: "POST" });
      await loadOffers("creator");
      notify("Заявка отменена");
    } catch (error) {
      notify(error.message);
    }
  };

  const updateApplication = async (applicationId, action) => {
    try {
      await api(`/brand/applications/${applicationId}/${action}`, { method: "POST" });
      await loadOffers(role);
      notify(action === "approve" ? "Заявка одобрена, партнёрская связь создана" : "Заявка отклонена");
    } catch (error) {
      notify(error.message);
    }
  };

  const transitionRelationship = async (relationshipId, action) => {
    try {
      await api(`/brand/affiliate-relationships/${relationshipId}/${action}`, { method: "POST" });
      await loadOffers(role);
      notify("Статус партнёрской связи обновлён");
    } catch (error) {
      notify(error.message);
    }
  };

  const changeRelationshipManager = async (relationshipId, managerId) => {
    try {
      await api(`/brand/affiliate-relationships/${relationshipId}/responsibility`, {
        method: "PATCH",
        body: JSON.stringify(managerId ? { managerId } : {})
      });
      await loadOffers(role);
      notify(managerId ? "Ответственный менеджер партнёра обновлён" : "Партнёр оставлен без менеджера");
    } catch (error) {
      notify(error.message);
    }
  };

  const replaceCreatorPromoCode = async (relationshipId, code) => {
    try {
      const relationship = await api(`/brand/affiliate-relationships/${relationshipId}/promo-code`, {
        method: "PATCH",
        body: JSON.stringify({ code })
      });
      await loadOffers("brand");
      notify("Новый промокод сохранён");
      return relationship;
    } catch (error) {
      notify(error.message);
      return null;
    }
  };

  const confirmCreatorPromoCode = async (relationshipId) => {
    try {
      await api(`/brand/affiliate-relationships/${relationshipId}/promo-code/confirm-tilda`, { method: "POST" });
      await loadOffers("brand");
      notify("Промокод отмечен как добавленный в Tilda");
    } catch (error) {
      notify(error.message);
    }
  };

  const copyValue = (value, message) => {
    if (navigator.clipboard) navigator.clipboard.writeText(value).catch(() => {});
    notify(message);
  };

  const uploadOrdersCsv = async (file) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const preview = await api("/brand/order-imports", { method: "POST", body: formData });
      setOrderImportPreview(preview);
      notify(`CSV проверен: ${preview.validRows} валидных строк`);
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const confirmOrdersCsv = async (importId) => {
    try {
      await api(`/brand/order-imports/${importId}/confirm`, { method: "POST" });
      setOrderImportPreview((current) => current ? { ...current, status: "IMPORTED" } : current);
      await loadFinance("brand");
      notify("Заказы импортированы, комиссии рассчитаны");
    } catch (error) {
      notify(error.message);
    }
  };

  const createPayout = async (commissionIds) => {
    try {
      await api("/admin/payouts", { method: "POST", body: JSON.stringify({ commissionIds }) });
      await loadFinance("admin");
      notify("Payout создан");
    } catch (error) {
      notify(error.message);
    }
  };

  const approvePayout = async (payoutId) => {
    try {
      await api(`/admin/payouts/${payoutId}/approve`, { method: "POST" });
      await loadFinance("admin");
      notify("Payout подтверждён");
    } catch (error) {
      notify(error.message);
    }
  };

  const markPayoutPaid = async (payoutId) => {
    try {
      await api(`/admin/payouts/${payoutId}/mark-paid`, { method: "POST" });
      await loadFinance("admin");
      notify("Выплата отмечена как выполненная");
    } catch (error) {
      notify(error.message);
    }
  };

  const cancelPayout = async (payoutId) => {
    try {
      await api(`/admin/payouts/${payoutId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Отменено администратором" })
      });
      await loadFinance("admin");
      notify("Payout отменён, комиссии снова доступны");
    } catch (error) {
      notify(error.message);
    }
  };

  const runReconciliation = async () => {
    try {
      const result = await api("/admin/reconciliation/run", { method: "POST" });
      await loadFinance("admin");
      notify(result.status === "PASSED" ? "Reconciliation пройден" : `Найдены расхождения: ${result.mismatchCount}`);
    } catch (error) {
      notify(error.message);
    }
  };

  const issueStatement = async (form) => {
    try {
      await api("/admin/statements", {
        method: "POST",
        body: JSON.stringify({
          brandId: form.brandId,
          periodStart: `${form.periodStart}T00:00:00.000Z`,
          periodEnd: `${form.periodEnd}T00:00:00.000Z`,
          dueAt: `${form.dueAt}T00:00:00.000Z`,
          currency: form.currency
        })
      });
      await loadFinance("admin");
      notify("Statement выпущен");
    } catch (error) {
      notify(error.message);
    }
  };

  const recordBrandPayment = async (statement) => {
    try {
      const remaining = (
        BigInt(statement.totalDueMinor || 0) -
        BigInt(statement.paidMinor || 0)
      ).toString();
      await api("/admin/brand-payments", {
        method: "POST",
        body: JSON.stringify({
          brandId: statement.brandId,
          currency: statement.currency,
          amountMinor: remaining,
          paidAt: new Date().toISOString(),
          reference: `statement-${statement.id}`,
          allocations: [{ statementId: statement.id, amountMinor: remaining }]
        })
      });
      await loadFinance("admin");
      notify("Оплата Brand зафиксирована");
    } catch (error) {
      notify(error.message);
    }
  };

  const resolveDispute = async (disputeId, resolution) => {
    try {
      await api(`/admin/disputes/${disputeId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution })
      });
      await loadFinance("admin");
      notify("Dispute закрыт с сохранением AuditLog");
    } catch (error) {
      notify(error.message);
    }
  };

  const verifyBrand = async (brandId) => {
    try {
      await api(`/admin/brands/${brandId}/verify`, { method: "POST" });
      await loadFinance("admin");
      notify("Бренд подтверждён для загрузки файлов");
    } catch (error) {
      notify(error.message);
    }
  };

  const changeAdminPassword = async (currentPassword, newPassword) => {
    try {
      await api("/auth/password/change", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      notify("Пароль изменён. Выполните вход заново");
      await logout();
    } catch (error) {
      notify(error.message);
    }
  };

  const beginAdminMfa = async (currentPassword) => {
    try {
      return await api("/auth/admin/mfa/enroll", {
        method: "POST",
        body: JSON.stringify({ currentPassword })
      });
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const confirmAdminMfa = async (code) => {
    try {
      const result = await api("/auth/admin/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      setUser(await api("/auth/me"));
      await loadOffers("admin");
      notify("TOTP подключён");
      return result.recoveryCodes || [];
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const saveOffer = async (offer, shouldPublish = false, existingOfferId = null, options = {}) => {
    try {
      const promotionMap = { yes: "YES", no: "NO", restricted: "LIMITED" };
      const payload = {
        title: offer.title,
        description: offer.description,
        productPriceKopecks: Math.round(offer.price * 100),
        ...(offer.productUrl ? { productUrl: offer.productUrl } : {}),
        totalCommissionPoolBps: Math.round((offer.totalCommission ?? offer.commission) * 100),
        promotionWithoutProduct: promotionMap[offer.creatorKit.promotionWithoutSample],
        category: offer.category,
        productRequirementSales: offer.threshold,
        allowedPromotionFormats: offer.creatorKit.allowedDigitalFormats
      };
      const saved = await api(existingOfferId ? `/brand/offers/${existingOfferId}` : "/brand/offers", {
        method: existingOfferId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...payload
        })
      });
      if (!existingOfferId || offer.creatorKitScenariosLoaded) {
        await api(`/brand/offers/${saved.id}/creator-kit`, {
          method: "PUT",
          body: JSON.stringify(creatorKitPayload(offer.creatorKit))
        });
      }
      if (shouldPublish) await api(`/brand/offers/${saved.id}/publish`, { method: "POST" });
      await loadOffers(role);
      notify(shouldPublish ? "Оффер сохранён и опубликован" : "Черновик сохранён");
      navigate(
        "brand",
        ["creatorKit", "creatorKitScenarios"].includes(options.destination)
          ? {
              brandTab: "creatorKit",
              creatorKitOfferId: saved.id,
              creatorKitFocus: options.destination === "creatorKitScenarios" ? "scenarios" : "assets"
            }
          : {}
      );
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  };

  const saveCreatorKitScenarios = async (offerId, scenarios) => {
    try {
      await api(`/brand/offers/${offerId}/creator-kit`, {
        method: "PUT",
        body: JSON.stringify(creatorKitPayload({ scenarios }))
      });
      await loadOffers(role);
      notify("Сценарии сохранены");
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const transitionOffer = async (offerId, action) => {
    try {
      await api(`/brand/offers/${offerId}/${action}`, { method: "POST" });
      await loadOffers(role);
      notify("Статус оффера обновлён");
    } catch (error) {
      notify(error.message);
    }
  };

  const changeOfferManager = async (offerId, managerId) => {
    try {
      await api(`/brand/offers/${offerId}/responsibility`, {
        method: "PATCH",
        body: JSON.stringify(managerId ? { managerId } : {})
      });
      await loadOffers(role);
      notify(managerId ? "Ответственный менеджер обновлён" : "Оффер оставлен без менеджера");
    } catch (error) {
      notify(error.message);
    }
  };

  const toggleCreatorKitAsset = async (offerId, assetId, active) => {
    try {
      await api(`/brand/offers/${offerId}/creator-kit/assets/${assetId}/${active ? "disable" : "enable"}`, { method: "POST" });
      await loadOffers(role);
      notify(active ? "Материал отключён" : "Материал снова доступен");
    } catch (error) {
      notify(error.message);
    }
  };

  const downloadCreatorKitAsset = async (offerId, assetId, mode) => {
    try {
      const data = await api(`/${mode === "brand" ? "brand" : "creator"}/offers/${offerId}/creator-kit/assets/${assetId}/download`);
      window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(error.message);
    }
  };

  const uploadCreatorKitAsset = async (offerId, form) => {
    try {
      const file = form.file;
      const initialized = await api(`/brand/offers/${offerId}/creator-kit/assets/uploads`, {
        method: "POST",
        body: JSON.stringify({
          title: form.title || file.name,
          assetType: form.assetType,
          accessLevel: form.accessLevel,
          originalFileName: file.name,
          mimeType: file.type,
          byteSize: file.size,
          editable: form.editable,
          textAllowed: form.textAllowed,
          paidAdsAllowed: form.paidAdsAllowed,
          approvalRequired: form.approvalRequired,
          requiresAffiliateApproval: form.requiresAffiliateApproval,
          ...(form.expiresAt ? { expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString() } : {})
        })
      });
      const uploadResponse = await fetch(initialized.uploadUrl, {
        method: "PUT",
        headers: initialized.requiredHeaders,
        body: file
      });
      if (!uploadResponse.ok) throw new Error("Хранилище не приняло файл");
      await api(`/brand/offers/${offerId}/creator-kit/assets/${initialized.asset.id}/complete`, { method: "POST" });
      await loadOffers(role);
      notify("Материал загружен и проверен сервером");
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const loadCreatorKitPreview = async (offerId, access = "DIGITAL", options = {}) => {
    const params = new URLSearchParams({
      accessLevel: access.toUpperCase(),
      source: options.source === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      affiliateApproved: options.affiliateApproved === false ? "false" : "true"
    });
    const kit = await api(`/brand/offers/${offerId}/creator-kit/preview?${params.toString()}`);
    const offer = offers.find((item) => item.id === offerId);
    return mapCreatorKit(kit, offer);
  };

  const brandDashboardUser = role === "manager"
    ? { ...user, profile: activeBrandProfile }
    : user;

  if (!sessionReady) return <div className="app"><main className="auth-main"><div className="auth-panel"><h2>Загрузка сессии…</h2></div></main></div>;

  return (
    <div className="app">
      {!["register", "login", "manager-invitation"].includes(page) && <Header page={page} role={role} navigate={navigate} logout={logout} />}
      {page === "home" && <HomePage offers={offers.filter((offer) => offer.status === "active")} navigate={navigate} openOffer={openOffer} />}
      {page === "manager-invitation" && invitationToken && <ManagerInvitationPage token={invitationToken} user={user} role={role} navigate={navigate} notify={notify} onAcceptExisting={acceptExistingManagerInvitation} />}
      {page === "catalog" && <CatalogPage offers={offers} openOffer={openOffer} navigate={navigate} role={role} />}
      {page === "offer" && selectedOffer && <OfferPage offer={selectedOffer} applicationStatus={(applications.find((item) => item.offerId === selectedOffer.id)?.status || "NONE").toLowerCase()} role={role} apply={apply} navigate={navigate} notify={notify} onToggleAsset={toggleCreatorKitAsset} onDownloadAsset={downloadCreatorKitAsset} onRetryCreatorKit={retryCreatorKit} />}
      {page === "register" && <RegisterPage presetRole={registerRole} complete={completeRegistration} navigate={navigate} />}
      {page === "login" && <LoginPage login={login} verifyMfa={verifyMfa} navigate={navigate} />}
      {page === "creator" && role === "creator" && <CreatorDashboard user={user} applications={applications} relationships={relationships} offers={offers} finance={creatorFinance} notifications={creatorNotifications} cancelApplication={cancelApplication} copyValue={copyValue} navigate={navigate} />}
      {page === "brand" && role === "brand" && <BrandDashboard user={user} role={role} managerBrands={[]} activeBrandId={null} onSelectManagerBrand={() => {}} offers={offers} applications={applications} relationships={relationships} finance={brandFinance} orderImportPreview={orderImportPreview} initialTab={brandDashboardTarget.tab} initialCreatorKitOfferId={brandDashboardTarget.creatorKitOfferId} initialCreatorKitFocus={brandDashboardTarget.creatorKitFocus} updateApplication={updateApplication} transitionRelationship={transitionRelationship} replacePromoCode={replaceCreatorPromoCode} confirmPromoCode={confirmCreatorPromoCode} copyValue={copyValue} onChangeRelationshipManager={changeRelationshipManager} navigate={navigate} notify={notify} onToggleAsset={toggleCreatorKitAsset} onDownloadAsset={downloadCreatorKitAsset} onUploadAsset={uploadCreatorKitAsset} onLoadPreview={loadCreatorKitPreview} onSaveScenarios={saveCreatorKitScenarios} onReload={() => loadOffers("brand")} transitionOffer={transitionOffer} onChangeOfferManager={changeOfferManager} onUploadOrders={uploadOrdersCsv} onConfirmOrders={confirmOrdersCsv} canManageTeam teamManagers={teamManagers} teamInvitations={teamInvitations} onInviteManager={inviteManager} onRevokeInvitation={revokeInvitation} onRemoveManager={removeManager} />}
      {["manager", "brand", "create"].includes(page) && role === "manager" && !activeBrandId && <ManagerBrandSelector brands={managerBrands} activeBrandId={activeBrandId} onSelect={selectManagerBrand} />}
      {page === "brand" && role === "manager" && activeBrandId && <BrandDashboard user={brandDashboardUser} role={role} managerBrands={managerBrands} activeBrandId={activeBrandId} onSelectManagerBrand={selectManagerBrand} offers={offers} applications={applications} relationships={relationships} finance={brandFinance} orderImportPreview={orderImportPreview} initialTab={brandDashboardTarget.tab} initialCreatorKitOfferId={brandDashboardTarget.creatorKitOfferId} initialCreatorKitFocus={brandDashboardTarget.creatorKitFocus} updateApplication={updateApplication} transitionRelationship={transitionRelationship} copyValue={copyValue} onChangeRelationshipManager={changeRelationshipManager} navigate={navigate} notify={notify} onToggleAsset={toggleCreatorKitAsset} onDownloadAsset={downloadCreatorKitAsset} onUploadAsset={uploadCreatorKitAsset} onLoadPreview={loadCreatorKitPreview} onSaveScenarios={saveCreatorKitScenarios} onReload={() => loadOffers("manager")} transitionOffer={transitionOffer} onChangeOfferManager={changeOfferManager} onUploadOrders={uploadOrdersCsv} onConfirmOrders={confirmOrdersCsv} teamManagers={teamManagers} />}
      {page === "create" && ["brand", "manager"].includes(role) && (role !== "manager" || activeBrandId) && <CreateOfferPage publish={saveOffer} navigate={navigate} initialOffer={offers.find((offer) => offer.id === editingOfferId)} brandName={brandDashboardUser?.profile?.brandName} uploadAllowed={brandDashboardUser?.profile?.verificationStatus === "VERIFIED"} managers={teamManagers} onChangeOfferManager={changeOfferManager} />}
      {page === "admin" && role === "admin" && <AdminDashboard user={user} offers={offers} brands={adminBrands} operationalReadiness={operationalReadiness} finance={adminFinance} createPayout={createPayout} approvePayout={approvePayout} markPayoutPaid={markPayoutPaid} cancelPayout={cancelPayout} issueStatement={issueStatement} recordBrandPayment={recordBrandPayment} resolveDispute={resolveDispute} runReconciliation={runReconciliation} verifyBrand={verifyBrand} changeAdminPassword={changeAdminPassword} beginAdminMfa={beginAdminMfa} confirmAdminMfa={confirmAdminMfa} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export default App;
