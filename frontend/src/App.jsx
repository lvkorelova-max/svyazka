import React, { useEffect, useMemo, useState } from "react";
import { api, restoreSession, setAccessToken } from "./api/client";

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
    channel: scenarioChannelLabels[scenario.channel] || scenario.channel,
    idea: scenario.idea
  }));
  const productScenarios = scenarios.filter((scenario) => scenario.accessLevel === "PRODUCT");

  return {
    promotionWithoutSample: policy === "YES" ? "yes" : policy === "NO" ? "no" : "restricted",
    allowedDigitalFormats: kit?.offerPolicy?.allowedPromotionFormats || offer?.allowedPromotionFormats || [],
    productAccessFormats: productScenarios.map((scenario) => scenario.title),
    completeness: kit?.completeness?.percent || 0,
    completenessMissing: kit?.completeness?.missing || [],
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
      originalFileName: asset.originalFileName
    })),
    scenarios,
    facts,
    allowedClaims: (kit?.claims || []).filter((claim) => claim.type === "ALLOWED").map((claim) => claim.value),
    forbiddenClaims: (kit?.claims || []).filter((claim) => claim.type === "FORBIDDEN").map((claim) => claim.value),
    noSampleRules: (kit?.rules || []).map((rule) => rule.value),
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
  create: "Создание оффера",
  admin: "Админ-панель"
};

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
          {role === "brand" && <button className={`nav-button ${page === "brand" ? "active" : ""}`} onClick={() => go("brand")}>Кабинет бренда</button>}
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
              <button className="button secondary small" onClick={() => go(role)}>Кабинет</button>
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
          <button className="button secondary" onClick={() => go(role === "guest" ? "register" : role)}>Кабинет</button>
          {role === "guest"
            ? <button className="button" onClick={() => go("login")}>Войти</button>
            : <button className="button ghost" onClick={logout}>Выйти</button>}
        </div>
      )}
    </header>
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
            <span className="term-label">Комиссия</span>
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

function CatalogPage({ offers, openOffer, navigate }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Все категории");
  const [commission, setCommission] = useState("Любая комиссия");
  const categories = ["Все категории", ...new Set(offers.map((offer) => offer.category))];
  const filtered = offers.filter((offer) => {
    const matchesQuery = `${offer.title} ${offer.brand}`.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = category === "Все категории" || offer.category === category;
    const matchesCommission =
      commission === "Любая комиссия" ||
      (commission === "От 15%" && offer.commission >= 15) ||
      (commission === "До 14%" && offer.commission <= 14);
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
            <button className="button secondary" onClick={() => navigate("register", { role: "creator" })}>Стать креатором</button>
          </div>
        </div>
        <div className="catalog-toolbar">
          <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по товару или бренду" />
          <select className="select-field" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="select-field" value={commission} onChange={(event) => setCommission(event.target.value)}>
            <option>Любая комиссия</option>
            <option>От 15%</option>
            <option>До 14%</option>
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

function CreatorKit({ offer, mode = "creator", hasProductAccess = false, notify, onToggleAsset, onDownloadAsset }) {
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
            <small>{hasProductAccess ? "Образец подтверждён" : `После получения образца`}</small>
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
                    <span className="asset-preview">{asset.type.slice(0, 2).toUpperCase()}</span>
                  </label>
                ) : (
                  <span className="asset-preview">{asset.type.slice(0, 2).toUpperCase()}</span>
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
                <p>{hasProductAccess ? "Получение образца подтверждено. Можно создавать форматы с реальным использованием продукта." : "Откроется после подтверждённого получения физического образца."}</p>
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

function OfferPage({ offer, applicationStatus, role, apply, navigate, notify, onToggleAsset, onDownloadAsset }) {
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [applicationMessage, setApplicationMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!offer) return null;
  const reward = Math.round(offer.price * offer.commission / 100);
  const action = () => {
    if (role !== "creator") {
      navigate("register", { role: "creator" });
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
              <span className="commission">Комиссия {offer.commission}% · {money(reward)}</span>
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
              <div className="detail-row"><span>Creator Kit</span><strong>Digital Access · {offer.creatorKit.assets.filter((asset) => asset.active).length} материалов</strong></div>
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
        <CreatorKit
          offer={offer}
          mode="creator"
          hasProductAccess={false}
          notify={notify}
          onToggleAsset={onToggleAsset}
          onDownloadAsset={onDownloadAsset}
        />
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

function LoginPage({ login, navigate }) {
  const [form, setForm] = useState({ email: "", password: "" });
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
          <h2>Вход</h2>
          <p>Введите email и пароль тестового аккаунта.</p>
          <div className="form-grid">
            <div className="form-group full">
              <label className="form-label">Email</label>
              <input className="field" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div className="form-group full">
              <label className="form-label">Пароль</label>
              <input className="field" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </div>
          </div>
          <div className="form-actions">
            <button className="button ghost" onClick={() => navigate("home")}>← Назад</button>
            <button className="button" onClick={() => login(form)}>Войти</button>
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
  CANCELLED: "Отменена"
};

const relationshipStatusLabels = {
  ACTIVE: "Активна",
  PAUSED: "Приостановлена",
  REVOKED: "Отозвана"
};

function CreatorDashboard({ user, applications, relationships, offers, finance, cancelApplication, copyValue, navigate }) {
  const [tab, setTab] = useState("offers");
  const activeRelationships = relationships.filter((item) => item.status === "ACTIVE");
  const displayName = user?.profile?.displayName || user?.name || "креатор";

  return (
    <DashboardLayout
      roleLabel="Кабинет креатора"
      items={[
        { id: "offers", label: "Мои офферы" },
        { id: "applications", label: "Заявки" },
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
        <strong>Заявки, партнёрские ссылки, клики, продажи и комиссии загружаются с сервера.</strong>
      </div>
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
                    <p>{offer.brand} · комиссия {offer.commission}%</p>
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
                {applications.map((application) => (
                  <tr key={application.id}>
                    <td><span className="table-title">{application.offer.title}</span>{application.message && <span className="table-subtitle">{application.message}</span>}</td>
                    <td>{application.offer.brand.brandName}</td>
                    <td>{new Date(application.createdAt).toLocaleDateString("ru-RU")}</td>
                    <td><Status type={application.status === "APPROVED" ? "success" : application.status === "REJECTED" ? "danger" : "pending"}>{applicationStatusLabels[application.status]}</Status></td>
                    <td>{application.status === "PENDING" && <button className="button secondary small" onClick={() => cancelApplication(application.id)}>Отменить</button>}</td>
                  </tr>
                ))}
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

function SalesTrackingLive({ notify, preview, onUpload, onConfirm }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

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
          <span className="eyebrow">Рабочий способ этапа 4</span>
          <h2>Ручной импорт заказов через CSV</h2>
          <p>Сначала сервер проверяет строки и показывает предпросмотр. Рабочие заказы создаются только после подтверждения брендом.</p>
        </div>
        <Status type={preview?.status === "IMPORTED" ? "success" : preview ? "pending" : ""}>
          {preview?.status === "IMPORTED" ? "Импортировано" : preview ? "Готово к проверке" : "Файл не загружен"}
        </Status>
      </section>

      <section className="tracking-section">
        <div className="tracking-section-head">
          <div><span className="tracking-number">01</span><h2>Импорт и предпросмотр</h2><p>Поддерживаются статусы pending, paid, cancelled, returned и partially_returned.</p></div>
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
            <div><span className="tracking-number">02</span><h2>Предпросмотр заказов</h2><p>Валидные строки: {preview.validRows}; ошибки и конфликты: {preview.invalidRows}; дубли: {preview.duplicateRows}.</p></div>
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
                    <td>{moneyKopecks(row.previewCreatorCommissionKopecks)}</td>
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
        <strong>JavaScript tracker, Server-to-server API и CMS-интеграции пока не подключены. На этапе 4 рабочим способом передачи заказов является CSV.</strong>
      </div>
    </div>
  );
}

function BrandCreatorKitManager({ offers, notify, onToggleAsset, onDownloadAsset, onUploadAsset, onLoadPreview }) {
  const brandOffers = offers;
  const [selectedOfferId, setSelectedOfferId] = useState(brandOffers[0] ? brandOffers[0].id : null);
  const [preview, setPreview] = useState(false);
  const [previewAccess, setPreviewAccess] = useState("digital");
  const [previewKit, setPreviewKit] = useState(null);
  const [uploading, setUploading] = useState(false);
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
  const displayedOffer = selectedOffer ? { ...selectedOffer, creatorKit: kit } : null;

  const updateUpload = (key, value) => setUploadForm((current) => ({ ...current, [key]: value }));

  const loadPreview = async (access = previewAccess) => {
    if (!selectedOffer) return;
    try {
      const nextKit = await onLoadPreview(selectedOffer.id, access);
      setPreviewKit(nextKit);
    } catch (error) {
      notify(error.message);
    }
  };

  useEffect(() => {
    if (preview && selectedOffer) loadPreview(previewAccess);
  }, [preview, previewAccess, selectedOffer?.id]);

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

  if (!selectedOffer) return <div className="empty-state">Создайте оффер, чтобы заполнить Creator Kit.</div>;

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
          <div><span>Заполненность Creator Kit</span><strong>Готов к публикации</strong><small>Добавьте срок действия для одного файла</small></div>
        </div>
        <div className="stat-card"><span className="stat-label">Скачивания материалов</span><span className="stat-value">—</span><span className="stat-note">не собираются на этапе MVP</span></div>
        <div className="stat-card"><span className="stat-label">Креаторы использовали</span><span className="stat-value">—</span><span className="stat-note">аналитика будет добавлена позднее</span></div>
        <div className="stat-card"><span className="stat-label">Активные материалы</span><span className="stat-value">{kit.assets.filter((asset) => asset.active).length}</span><span className="stat-note">из {kit.assets.length} загруженных</span></div>
      </div>

      {!preview && (
        <form className="creator-kit-upload panel" onSubmit={submitUpload}>
          <div className="panel-header"><div><h2>Добавить материал</h2><p>Файл загружается напрямую в приватное хранилище и подтверждается сервером.</p></div></div>
          <div className="panel-body form-grid">
            <div className="form-group full">
              <label className="form-label">Файл</label>
              <input className="field" type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.pdf" onChange={(event) => {
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
          <div className="form-actions"><button className="button" type="submit" disabled={uploading}>{uploading ? "Загрузка…" : "Загрузить материал"}</button></div>
        </form>
      )}

      {preview && (
        <div className="preview-notice">
          <div>
            <strong>Предпросмотр глазами креатора</strong>
            <span>{previewAccess === "digital" ? "До получения физического образца" : "После подтверждённого получения образца"}</span>
          </div>
          <div className="access-preview-switch">
            <button className={previewAccess === "digital" ? "active" : ""} onClick={() => setPreviewAccess("digital")}>Digital Access</button>
            <button className={previewAccess === "product" ? "active" : ""} onClick={() => setPreviewAccess("product")}>Product Access</button>
          </div>
        </div>
      )}

      <CreatorKit
        offer={displayedOffer}
        mode={preview ? "creator" : "brand"}
        hasProductAccess={preview && previewAccess === "product"}
        notify={notify}
        onToggleAsset={onToggleAsset}
        onDownloadAsset={onDownloadAsset}
      />
    </div>
  );
}

function BrandDashboard({ offers, applications, relationships, finance, orderImportPreview, updateApplication, transitionRelationship, navigate, notify, onToggleAsset, onDownloadAsset, onUploadAsset, onLoadPreview, transitionOffer, onUploadOrders, onConfirmOrders }) {
  const [tab, setTab] = useState("offers");

  return (
    <DashboardLayout
      roleLabel="Кабинет бренда"
      items={[
        { id: "offers", label: "Офферы" },
        { id: "applications", label: "Заявки" },
        { id: "partners", label: "Партнёры" },
        { id: "sales", label: "Продажи" },
        { id: "creatorKit", label: "Creator Kit" },
        { id: "tracking", label: "Отслеживание продаж" }
      ]}
      active={tab}
      setActive={setTab}
    >
      {tab === "tracking" ? (
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
              <h1>Бренд LUNEA</h1>
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
          <div className="panel-header"><h2>Офферы</h2></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Оффер</th><th>Статус</th><th>Creator Kit</th><th>Комиссия</th><th>Заявки</th><th>Продажи</th><th></th></tr></thead>
              <tbody>
                {offers.map((offer) => (
                  <tr key={offer.id}>
                    <td><span className="table-title">{offer.title}</span><span className="table-subtitle">{money(offer.price)}</span></td>
                    <td><Status type={offer.status === "active" ? "success" : "pending"}>{offer.statusLabel}</Status></td>
                    <td><strong>{offer.creatorKit.completeness}%</strong><span className="table-subtitle"> заполнено</span></td>
                    <td>{offer.commission}%</td><td>{applications.filter((item) => item.offerId === offer.id).length}</td><td>—</td>
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
        </div>
      )}

      {tab === "applications" && (
        <div className="panel">
          <div className="panel-header"><h2>Заявки креаторов</h2><Status type="success">Подключено</Status></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Креатор</th><th>Оффер</th><th>Сообщение</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id}>
                    <td><span className="table-title">{application.creator.displayName}</span><span className="table-subtitle">{application.creator.description || "Описание профиля не заполнено"}</span></td>
                    <td>{application.offer.title}</td>
                    <td>{application.message || "Без сообщения"}</td>
                    <td><Status type={application.status === "APPROVED" ? "success" : application.status === "REJECTED" ? "danger" : "pending"}>{applicationStatusLabels[application.status]}</Status></td>
                    <td>
                      {application.status === "PENDING" && (
                        <div className="row-actions">
                          <button className="button secondary small" onClick={() => updateApplication(application.id, "reject")}>Отклонить</button>
                          <button className="button small" onClick={() => updateApplication(application.id, "approve")}>Одобрить</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!applications.length && <div className="empty-state">Заявок на ваши офферы пока нет.</div>}
        </div>
      )}

      {tab === "partners" && (
        <div className="panel">
          <div className="panel-header"><h2>Партнёры бренда</h2></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Креатор</th><th>Оффер</th><th>Промокод</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {relationships.map((relationship) => (
                  <tr key={relationship.id}>
                    <td><span className="table-title">{relationship.creator.displayName}</span><span className="table-subtitle">{relationship.creator.description || "Описание профиля не заполнено"}</span></td>
                    <td>{relationship.offer.title}</td>
                    <td><strong>{relationship.promoCode}</strong></td>
                    <td><Status type={relationship.status === "ACTIVE" ? "success" : relationship.status === "REVOKED" ? "danger" : "pending"}>{relationshipStatusLabels[relationship.status]}</Status></td>
                    <td>
                      <div className="row-actions">
                        {relationship.status === "ACTIVE" && <button className="button secondary small" onClick={() => transitionRelationship(relationship.id, "pause")}>Приостановить</button>}
                        {relationship.status === "PAUSED" && <button className="button small" onClick={() => transitionRelationship(relationship.id, "activate")}>Активировать</button>}
                        {relationship.status !== "REVOKED" && <button className="button ghost small" onClick={() => transitionRelationship(relationship.id, "revoke")}>Отозвать</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!relationships.length && <div className="empty-state">Одобренных партнёров пока нет.</div>}
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

      {tab === "tracking" && <SalesTrackingLive notify={notify} preview={orderImportPreview} onUpload={onUploadOrders} onConfirm={onConfirmOrders} />}
      {tab === "creatorKit" && <BrandCreatorKitManager offers={offers} notify={notify} onToggleAsset={onToggleAsset} onDownloadAsset={onDownloadAsset} onUploadAsset={onUploadAsset} onLoadPreview={onLoadPreview} />}
    </DashboardLayout>
  );
}

function CreateOfferPage({ publish, navigate, initialOffer }) {
  const [form, setForm] = useState({
    title: initialOffer?.title || "Набор для ночного ухода Renewal",
    category: initialOffer?.category || "Красота и уход",
    description: initialOffer?.description || "Ночной уход для восстановления и увлажнения кожи.",
    productUrl: initialOffer?.productUrl || "https://example.test/products/renewal",
    price: initialOffer?.price ?? 7200,
    commission: initialOffer?.commission ?? 17,
    threshold: initialOffer?.threshold ?? 5,
    terms: "Нативная интеграция в контент об уходе и образе жизни.",
    promotionWithoutSample: initialOffer?.creatorKit?.promotionWithoutSample || "restricted",
    allowedDigitalFormats: initialOffer?.creatorKit?.allowedDigitalFormats || [...digitalFormats],
    allowedClaims: "Подходит для ежедневного ухода; бренд указывает в составе…",
    forbiddenClaims: "Я протестировала и рекомендую; гарантированно решает проблему",
    publicationRequirements: "Указать название и цену, добавить маркировку рекламы, упомянуть @lunea."
  });

  const update = (key, value) => setForm({ ...form, [key]: value });
  const toggleFormat = (format) => {
    update(
      "allowedDigitalFormats",
      form.allowedDigitalFormats.includes(format)
        ? form.allowedDigitalFormats.filter((item) => item !== format)
        : [...form.allowedDigitalFormats, format]
    );
  };
  const previewBase = {
    ...form,
    id: 99,
    brand: "LUNEA",
    image: productImages.cosmetics,
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
      allowedClaims: form.allowedClaims.split(";").map((item) => item.trim()).filter(Boolean),
      forbiddenClaims: form.forbiddenClaims.split(";").map((item) => item.trim()).filter(Boolean)
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
            <section className="form-section">
              <h2>Товар</h2>
              <p>Основная информация, которую увидит креатор.</p>
              <div className="form-grid">
                <div className="form-group full"><label className="form-label">Название</label><input className="field" value={form.title} onChange={(e) => update("title", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Категория</label><select className="select-field" value={form.category} onChange={(e) => update("category", e.target.value)}><option>Красота и уход</option><option>Одежда и обувь</option><option>Дом и интерьер</option><option>Аксессуары</option></select></div>
                <div className="form-group"><label className="form-label">Цена, ₽</label><input className="field" type="number" value={form.price} onChange={(e) => update("price", Number(e.target.value))} /></div>
                <div className="form-group full"><label className="form-label">Ссылка на товар</label><input className="field" type="url" value={form.productUrl} onChange={(e) => update("productUrl", e.target.value)} placeholder="https://brand.ru/products/product" /></div>
                <div className="form-group full"><label className="form-label">Описание</label><textarea className="textarea" value={form.description} onChange={(e) => update("description", e.target.value)} /></div>
                <div className="form-group full"><label className="form-label">Изображения</label><div className="upload-box">Демонстрационная область загрузки<br />Изображение уже добавлено в предпросмотр</div></div>
              </div>
            </section>
            <section className="form-section">
              <h2>Партнёрские условия</h2>
              <p>Комиссия начисляется после подтверждения продажи.</p>
              <div className="form-grid">
                <div className="form-group"><label className="form-label">Комиссия, %</label><input className="field" type="number" value={form.commission} onChange={(e) => update("commission", Number(e.target.value))} /></div>
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
                    ["no", "Нет, продукт обязателен", "Материалы откроются только после подтверждённого получения образца."],
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
                  <h3>Библиотека визуальных материалов</h3>
                  <p>Для каждого файла права использования настраиваются отдельно.</p>
                </div>
                <div className="material-type-grid">
                  {["Фото", "Вертикальные видео", "Горизонтальные видео", "PNG без фона", "Логотипы", "Lifestyle-контент", "Видео текстуры", "Видео использования", "Рекламные баннеры"].map((type, index) => (
                    <span className={index < 6 ? "filled" : ""} key={type}>{type}<small>{index < 6 ? "Добавлено" : "Не добавлено"}</small></span>
                  ))}
                </div>
                <div className="upload-box">Добавить материал и настроить: формат, редактирование, текст, платную рекламу, согласование и срок действия</div>
              </div>

              <div className="creator-kit-form-block">
                <div><h3>Сценарии и банк фактов</h3><p>Сценарии показываются как идеи, которые креатор адаптирует под свой стиль.</p></div>
                <div className="format-chips">
                  {["Reels", "Stories", "Telegram", "Threads", "Пост", "Короткий обзор", "Подборка"].map((item) => <span key={item}>{item}</span>)}
                </div>
                <div className="form-grid compact-form-grid">
                  <div className="form-group"><label className="form-label">Факты о продукте</label><textarea className="textarea" value="Описание, преимущества, состав, применение, цена, объём, производство, аудитория и ограничения" readOnly /></div>
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
              {(!initialOffer || initialOffer.apiStatus === "DRAFT") && <button className="button secondary" onClick={() => publish(previewOffer, false, initialOffer?.id)}>Сохранить черновик</button>}
              <button className="button" onClick={() => publish(previewOffer, !initialOffer || initialOffer.apiStatus === "DRAFT", initialOffer?.id)}>
                {initialOffer && initialOffer.apiStatus !== "DRAFT" ? "Сохранить изменения" : "Опубликовать оффер"}
              </button>
            </div>
          </div>
          <aside className="preview-sticky">
            <div className="preview-label">Предпросмотр карточки</div>
            <OfferCard offer={previewOffer} onOpen={() => {}} />
            <div className="panel" style={{ marginTop: 14 }}>
              <div className="panel-body">
                <span className="term-label">Комиссия с одной продажи</span>
                <strong style={{ fontSize: 22 }}>{money(Math.round(form.price * form.commission / 100))}</strong>
              </div>
            </div>
            <div className="panel" style={{ marginTop: 14 }}>
              <div className="panel-body">
                <span className="term-label">Creator Kit</span>
                <strong style={{ display: "block", marginTop: 5 }}>Digital Access · {form.allowedDigitalFormats.length} форматов</strong>
                <span className="stat-note">Product Access откроется после получения образца</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function AdminDashboard({ offers, finance, createPayout, approvePayout, markPayoutPaid }) {
  const [tab, setTab] = useState("offers");
  const brands = ["LUNEA", "FORMA", "SEVER", "KONTUR", "MIRA", "Точка дома"];
  return (
    <DashboardLayout
      roleLabel="Администрирование"
      items={[
        { id: "offers", label: "Офферы" },
        { id: "brands", label: "Бренды" },
        { id: "creators", label: "Креаторы" },
        { id: "applications", label: "Заявки" },
        { id: "payouts", label: "Выплаты" },
        { id: "ledger", label: "Ledger" }
      ]}
      active={tab}
      setActive={setTab}
    >
      <div className="dashboard-header">
        <div><h1>Админ-панель</h1><p>Обзор тестовых данных и статусов платформы.</p></div>
      </div>
      <div className="creator-warning compact-warning">
        <span className="warning-mark">!</span>
        <strong>Выплаты и финансовый ledger подключены к серверу. Офферы, бренды, креаторы и заявки в этой панели остаются демонстрационными.</strong>
      </div>
      <div className="creator-warning compact-warning">
        <span className="warning-mark">!</span>
        <strong>Файловый pipeline MVP не включает антивирусную проверку. Использовать только в закрытом пилоте с проверенными брендами. Перед публичным запуском подключить quarantine, ClamAV и worker</strong>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><span className="stat-label">Бренды</span><span className="stat-value">6</span><span className="stat-note">в демонстрационных данных</span></div>
        <div className="stat-card"><span className="stat-label">Креаторы</span><span className="stat-value">148</span><span className="stat-note">тестовые профили</span></div>
        <div className="stat-card"><span className="stat-label">Офферы</span><span className="stat-value">{offers.length}</span><span className="stat-note">{offers.filter((item) => item.status === "review").length} на проверке</span></div>
        <div className="stat-card"><span className="stat-label">Активные заявки</span><span className="stat-value">37</span><span className="stat-note">на рассмотрении</span></div>
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
          <div className="panel-header"><h2>Бренды</h2></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Бренд</th><th>Офферы</th><th>Статус</th></tr></thead><tbody>{brands.map((brand) => <tr key={brand}><td><strong>{brand}</strong></td><td>{offers.filter((item) => item.brand === brand).length}</td><td><Status type="success">Активен</Status></td></tr>)}</tbody></table></div>
        </div>
      )}

      {tab === "creators" && (
        <div className="panel">
          <div className="panel-header"><h2>Креаторы</h2></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Креатор</th><th>Тематика</th><th>Активные офферы</th><th>Статус</th></tr></thead><tbody><tr><td><strong>Анна Лебедева</strong></td><td>Красота и уход</td><td>2</td><td><Status type="success">Активен</Status></td></tr><tr><td><strong>Мария Фролова</strong></td><td>Образ жизни</td><td>3</td><td><Status type="success">Активен</Status></td></tr><tr><td><strong>Елена Петрова</strong></td><td>Мода</td><td>1</td><td><Status type="success">Активен</Status></td></tr></tbody></table></div>
        </div>
      )}

      {tab === "applications" && (
        <div className="panel">
          <div className="panel-header"><h2>Заявки</h2><Status type="pending">37 активных</Status></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Креатор</th><th>Бренд</th><th>Оффер</th><th>Статус</th></tr></thead><tbody><tr><td>Анна Лебедева</td><td>LUNEA</td><td>{offers[0].title}</td><td><Status type="success">Одобрена</Status></td></tr><tr><td>Мария Фролова</td><td>SEVER</td><td>{offers[2].title}</td><td><Status type="pending">На рассмотрении</Status></td></tr><tr><td>Елена Петрова</td><td>FORMA</td><td>{offers[1].title}</td><td><Status type="pending">На рассмотрении</Status></td></tr></tbody></table></div>
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
                  <td><div className="row-actions">{payout.status === "DRAFT" && <button className="button secondary small" onClick={() => approvePayout(payout.id)}>Подтвердить</button>}{payout.status === "APPROVED" && <button className="button small" onClick={() => markPayoutPaid(payout.id)}>Отметить выплаченным</button>}</div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {(finance.commissions?.items || []).filter((item) => item.hasPostPayoutDebt).map((commission) => <div className="creator-warning compact-warning" key={commission.id}><span className="warning-mark">!</span><strong>Возврат после выплаты: {commission.creator.displayName}, задолженность {moneyKopecks(commission.debtAmountKopecks)}</strong></div>)}
        </div>
      )}
      {tab === "ledger" && (
        <div className="panel">
          <div className="panel-header"><h2>Журнал ledger entries</h2><Status type="success">Неизменяемая история</Status></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Креатор</th><th>Заказ</th><th>Тип</th><th>Сумма</th></tr></thead><tbody>{(finance.ledger?.items || []).map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString("ru-RU")}</td><td>{entry.creator.displayName}</td><td>{entry.order.externalOrderId}</td><td>{entry.type}</td><td>{moneyKopecks(entry.amountKopecks)}</td></tr>)}</tbody></table></div>
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
  const base = {
    id: offer.id,
    brand: offer.brand?.brandName || "Бренд",
    title: offer.title,
    category: offer.category || "Товары",
    price: offer.productPriceKopecks / 100,
    commission: offer.creatorCommissionBps / 100,
    threshold: offer.productRequirementSales || 0,
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
    allowedPromotionFormats: offer.allowedPromotionFormats || []
  };
  const creatorKit = creatorKitResponse
    ? mapCreatorKit(creatorKitResponse, offer)
    : mapCreatorKit({ offerPolicy: { promotionWithoutProduct: offer.promotionWithoutProduct, allowedPromotionFormats: offer.allowedPromotionFormats } }, offer);
  return { ...base, creatorKit };
}

const scenarioChannelValues = Object.fromEntries(Object.entries(scenarioChannelLabels).map(([key, value]) => [value, key]));
const factTypeValues = Object.fromEntries(Object.entries(factTypeLabels).map(([key, value]) => [value, key]));

function creatorKitPayload(kit) {
  const requirements = kit.publicationRequirements || {};
  return {
    scenarios: (kit.scenarios || []).map((scenario, index) => ({
      channel: scenarioChannelValues[scenario.channel] || scenario.channel,
      title: scenario.title,
      idea: scenario.idea,
      accessLevel: scenario.accessLevel || "DIGITAL",
      requiresAffiliateApproval: scenario.requiresAffiliateApproval || false,
      sortOrder: index
    })),
    facts: Object.entries(kit.facts || {}).filter(([, value]) => value).map(([label, value], index) => ({
      type: factTypeValues[label] || label,
      value: String(value),
      sortOrder: index
    })),
    claims: [
      ...(kit.allowedClaims || []).map((value, index) => ({ type: "ALLOWED", value, sortOrder: index })),
      ...(kit.forbiddenClaims || []).map((value, index) => ({ type: "FORBIDDEN", value, sortOrder: index }))
    ],
    rules: (kit.noSampleRules || []).map((value, index) => ({ value, sortOrder: index })),
    publicationRequirements: {
      mandatoryMentions: requirements["Обязательные упоминания"] ? [requirements["Обязательные упоминания"]] : [],
      advertisingLabel: requirements["Маркировка рекламы"] || undefined,
      hashtags: requirements["Хэштеги"] ? requirements["Хэштеги"].split(/\s+/).filter(Boolean) : [],
      brandMention: requirements["Упоминание бренда"] || undefined,
      approvalRequired: requirements["Согласование"]?.toLowerCase().includes("нужно") || requirements["Согласование"] === "Требуется",
      allowedPlatforms: requirements["Разрешённые площадки"] ? requirements["Разрешённые площадки"].split(",").map((item) => item.trim()).filter(Boolean) : []
    }
  };
}

function App() {
  const [page, setPage] = useState("home");
  const [role, setRole] = useState("guest");
  const [user, setUser] = useState(null);
  const [offers, setOffers] = useState([]);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [editingOfferId, setEditingOfferId] = useState(null);
  const [registerRole, setRegisterRole] = useState("");
  const [applications, setApplications] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [creatorFinance, setCreatorFinance] = useState({ clicks: { items: [] }, orders: { items: [] }, commissions: { items: [] }, summary: {} });
  const [brandFinance, setBrandFinance] = useState({ orders: { items: [] }, commissions: { items: [] }, analytics: {}, creatorAnalytics: { items: [] } });
  const [adminFinance, setAdminFinance] = useState({ commissions: { items: [] }, payouts: { items: [] }, ledger: { items: [] } });
  const [orderImportPreview, setOrderImportPreview] = useState(null);
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
    if (["brand", "create"].includes(target)) return currentRole === "brand";
    if (target === "creator") return currentRole === "creator";
    if (target === "admin") return currentRole === "admin";
    return true;
  };

  const loadFinance = async (currentRole) => {
    if (currentRole === "brand") {
      const [ordersData, commissionsData, analyticsData, creatorAnalyticsData] = await Promise.all([
        api("/brand/orders?pageSize=100"),
        api("/brand/commissions?pageSize=100"),
        api("/brand/analytics"),
        api("/brand/analytics/creators?pageSize=100")
      ]);
      setBrandFinance({ orders: ordersData, commissions: commissionsData, analytics: analyticsData, creatorAnalytics: creatorAnalyticsData });
    } else if (currentRole === "creator") {
      const [clicksData, ordersData, commissionsData, summaryData] = await Promise.all([
        api("/creator/clicks?pageSize=100"),
        api("/creator/orders?pageSize=100"),
        api("/creator/commissions?pageSize=100"),
        api("/creator/earnings-summary")
      ]);
      setCreatorFinance({ clicks: clicksData, orders: ordersData, commissions: commissionsData, summary: summaryData });
    } else if (currentRole === "admin") {
      const [commissionsData, payoutsData, ledgerData] = await Promise.all([
        api("/admin/commissions?pageSize=100"),
        api("/admin/payouts?pageSize=100"),
        api("/admin/ledger-entries?pageSize=100")
      ]);
      setAdminFinance({ commissions: commissionsData, payouts: payoutsData, ledger: ledgerData });
    }
  };

  const navigate = (target, options = {}) => {
    if (options.role) setRegisterRole(options.role);
    if (options.offerId) setSelectedOfferId(options.offerId);
    if (target === "create") setEditingOfferId(options.editOfferId || null);
    const safeTarget = canOpen(target, options.asRole || role) ? target : "login";
    setPage(safeTarget);
    window.history.pushState({ page: safeTarget }, "", `#${safeTarget}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (options.anchor) {
      window.setTimeout(() => {
        const element = document.getElementById(options.anchor);
        if (element) window.scrollTo({ top: Math.max(0, element.offsetTop - 72), behavior: "smooth" });
      }, 60);
    }
  };

  const loadOffers = async (currentRole = role) => {
    if (currentRole === "brand") {
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
        } catch {
          return toUiOffer(offer);
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
      await loadFinance("admin");
    } else {
      setOffers([]);
      setApplications([]);
      setRelationships([]);
    }
  };

  useEffect(() => {
    let active = true;
    restoreSession().then(async (restoredUser) => {
      if (!active) return;
      const restoredRole = roleFromUser(restoredUser);
      setUser(restoredUser);
      setRole(restoredRole);
      if (restoredUser) {
        try {
          await loadOffers(restoredRole);
        } catch (error) {
          notify(error.message);
        }
      }
      const requested = window.location.hash.replace("#", "") || "home";
      const initialPage = pageTitles[requested] && canOpen(requested, restoredRole) ? requested : (pageTitles[requested] ? "login" : "home");
      setPage(initialPage);
      if (initialPage !== requested) window.history.replaceState({ page: initialPage }, "", `#${initialPage}`);
      setSessionReady(true);
    });
    return () => { active = false; };
  }, []);

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
      navigate(newRole, { asRole: newRole });
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
      setAccessToken(result.accessToken);
      const nextRole = roleFromUser(result.user);
      setRole(nextRole);
      setUser(await api("/auth/me"));
      await loadOffers(nextRole);
      notify("Вход выполнен");
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
    setAccessToken(null);
    setUser(null);
    setRole("guest");
    setOffers([]);
    setApplications([]);
    setRelationships([]);
    setCreatorFinance({ clicks: { items: [] }, orders: { items: [] }, commissions: { items: [] }, summary: {} });
    setBrandFinance({ orders: { items: [] }, commissions: { items: [] }, analytics: {}, creatorAnalytics: { items: [] } });
    setAdminFinance({ commissions: { items: [] }, payouts: { items: [] }, ledger: { items: [] } });
    setOrderImportPreview(null);
    navigate("home");
  };

  const openOffer = (offer) => navigate("offer", { offerId: offer.id });

  const apply = async (offerId, message) => {
    try {
      await api(`/creator/offers/${offerId}/applications`, {
        method: "POST",
        body: JSON.stringify({ ...(message.trim() ? { message: message.trim() } : {}) })
      });
      await loadOffers("creator");
      notify("Заявка отправлена бренду");
      return true;
    } catch (error) {
      notify(error.message);
      return false;
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
      await loadOffers("brand");
      notify(action === "approve" ? "Заявка одобрена, партнёрская связь создана" : "Заявка отклонена");
    } catch (error) {
      notify(error.message);
    }
  };

  const transitionRelationship = async (relationshipId, action) => {
    try {
      await api(`/brand/affiliate-relationships/${relationshipId}/${action}`, { method: "POST" });
      await loadOffers("brand");
      notify("Статус партнёрской связи обновлён");
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

  const saveOffer = async (offer, shouldPublish = false, existingOfferId = null) => {
    try {
      const promotionMap = { yes: "YES", no: "NO", restricted: "LIMITED" };
      const payload = {
        title: offer.title,
        description: offer.description,
        productPriceKopecks: Math.round(offer.price * 100),
        ...(offer.productUrl ? { productUrl: offer.productUrl } : {}),
        creatorCommissionBps: Math.round(offer.commission * 100),
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
      await api(`/brand/offers/${saved.id}/creator-kit`, {
        method: "PUT",
        body: JSON.stringify(creatorKitPayload(offer.creatorKit))
      });
      if (shouldPublish) await api(`/brand/offers/${saved.id}/publish`, { method: "POST" });
      await loadOffers("brand");
      notify(shouldPublish ? "Оффер сохранён и опубликован" : "Черновик сохранён");
      navigate("brand");
    } catch (error) {
      notify(error.message);
    }
  };

  const transitionOffer = async (offerId, action) => {
    try {
      await api(`/brand/offers/${offerId}/${action}`, { method: "POST" });
      await loadOffers("brand");
      notify("Статус оффера обновлён");
    } catch (error) {
      notify(error.message);
    }
  };

  const toggleCreatorKitAsset = async (offerId, assetId, active) => {
    try {
      await api(`/brand/offers/${offerId}/creator-kit/assets/${assetId}/${active ? "disable" : "enable"}`, { method: "POST" });
      await loadOffers("brand");
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
      await loadOffers("brand");
      notify("Материал загружен и проверен сервером");
    } catch (error) {
      notify(error.message);
      throw error;
    }
  };

  const loadCreatorKitPreview = async (offerId, access) => {
    const kit = await api(`/brand/offers/${offerId}/creator-kit/preview?accessLevel=${access.toUpperCase()}`);
    const offer = offers.find((item) => item.id === offerId);
    return mapCreatorKit(kit, offer);
  };

  if (!sessionReady) return <div className="app"><main className="auth-main"><div className="auth-panel"><h2>Загрузка сессии…</h2></div></main></div>;

  return (
    <div className="app">
      {!["register", "login"].includes(page) && <Header page={page} role={role} navigate={navigate} logout={logout} />}
      {page === "home" && <HomePage offers={offers.filter((offer) => offer.status === "active")} navigate={navigate} openOffer={openOffer} />}
      {page === "catalog" && <CatalogPage offers={offers} openOffer={openOffer} navigate={navigate} />}
      {page === "offer" && selectedOffer && <OfferPage offer={selectedOffer} applicationStatus={(applications.find((item) => item.offerId === selectedOffer.id)?.status || "NONE").toLowerCase()} role={role} apply={apply} navigate={navigate} notify={notify} onToggleAsset={toggleCreatorKitAsset} onDownloadAsset={downloadCreatorKitAsset} />}
      {page === "register" && <RegisterPage presetRole={registerRole} complete={completeRegistration} navigate={navigate} />}
      {page === "login" && <LoginPage login={login} navigate={navigate} />}
      {page === "creator" && role === "creator" && <CreatorDashboard user={user} applications={applications} relationships={relationships} offers={offers} finance={creatorFinance} cancelApplication={cancelApplication} copyValue={copyValue} navigate={navigate} />}
      {page === "brand" && role === "brand" && <BrandDashboard offers={offers} applications={applications} relationships={relationships} finance={brandFinance} orderImportPreview={orderImportPreview} updateApplication={updateApplication} transitionRelationship={transitionRelationship} navigate={navigate} notify={notify} onToggleAsset={toggleCreatorKitAsset} onDownloadAsset={downloadCreatorKitAsset} onUploadAsset={uploadCreatorKitAsset} onLoadPreview={loadCreatorKitPreview} transitionOffer={transitionOffer} onUploadOrders={uploadOrdersCsv} onConfirmOrders={confirmOrdersCsv} />}
      {page === "create" && role === "brand" && <CreateOfferPage publish={saveOffer} navigate={navigate} initialOffer={offers.find((offer) => offer.id === editingOfferId)} />}
      {page === "admin" && role === "admin" && <AdminDashboard offers={offers} finance={adminFinance} createPayout={createPayout} approvePayout={approvePayout} markPayoutPaid={markPayoutPaid} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export default App;
