const { useEffect, useMemo, useState } = React;

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
    creatorTools: {
      link: `https://sviazka.ru/a/anna-${offer.id || "new"}x9`,
      promoCode: "ANNA18",
      commission: `${offer.commission}%`,
      buyerDiscount: "7%",
      cookieDays: "30 дней",
      offerEnds: "31 декабря 2026"
    },
    analytics: {
      totalDownloads: 286,
      creatorsUsed: 37,
      last30Days: 94
    }
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

function Header({ page, role, navigate, setRole }) {
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
          <select
            className="role-switcher"
            aria-label="Демонстрационная роль"
            value={role}
            onChange={(event) => {
              const nextRole = event.target.value;
              setRole(nextRole);
              navigate(nextRole === "guest" ? "home" : nextRole);
            }}
          >
            <option value="guest">Гость</option>
            <option value="creator">Креатор</option>
            <option value="brand">Бренд</option>
            <option value="admin">Администратор</option>
          </select>
          {role === "guest" ? (
            <button className="button small" onClick={() => go("register")}>Регистрация</button>
          ) : (
            <button className="button secondary small" onClick={() => go(role)}>Кабинет</button>
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
          <select
            className="role-switcher"
            aria-label="Демонстрационная роль"
            value={role}
            onChange={(event) => {
              const nextRole = event.target.value;
              setRole(nextRole);
              go(nextRole === "guest" ? "home" : nextRole);
            }}
          >
            <option value="guest">Гость</option>
            <option value="creator">Креатор</option>
            <option value="brand">Бренд</option>
            <option value="admin">Администратор</option>
          </select>
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

function CreatorKit({ offer, mode = "creator", hasProductAccess = false, notify, onToggleAsset }) {
  const kit = offer.creatorKit || buildCreatorKit(offer);
  const [selectedAssets, setSelectedAssets] = useState(kit.assets.filter((asset) => asset.active).slice(0, 2).map((asset) => asset.id));
  const [kitTab, setKitTab] = useState("assets");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftScenario, setDraftScenario] = useState(kit.scenarios[0].title);

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
                <button className="button secondary small" onClick={() => notify("Все активные материалы подготовлены к демонстрационному скачиванию")}>Скачать все материалы</button>
                <button className="button small" disabled={!selectedAssets.length} onClick={() => notify(`Выбрано материалов для скачивания: ${selectedAssets.length}`)}>Скачать выбранные материалы</button>
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
                  {mode === "brand" && <span>{asset.downloads} скачиваний</span>}
                </div>
                {mode === "brand" && (
                  <button className={`asset-toggle ${asset.active ? "on" : ""}`} onClick={() => onToggleAsset(offer.id, asset.id)}>
                    {asset.active ? "Активен" : "Отключён"}
                  </button>
                )}
              </div>
            ))}
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
          <div className="kit-section-heading"><div><h3>Персональные инструменты креатора</h3><p>Данные привязаны к текущему офферу и демонстрационному профилю.</p></div></div>
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
            {[
              ["Комиссия", kit.creatorTools.commission],
              ["Скидка покупателю", kit.creatorTools.buyerDiscount],
              ["Срок cookie", kit.creatorTools.cookieDays],
              ["Оффер действует до", kit.creatorTools.offerEnds]
            ].map(([label, value]) => <div className="tool-card compact" key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          {mode === "creator" && (
            <div className="publication-action">
              <div><h3>Создать публикацию</h3><p>Выберите идею и подготовьте собственный черновик. AI-генерация в прототипе не используется.</p></div>
              <button className="button" onClick={() => setDraftOpen(true)}>Создать публикацию</button>
            </div>
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

function OfferPage({ offer, applicationStatus, role, apply, navigate, notify, onToggleAsset }) {
  if (!offer) return null;
  const reward = Math.round(offer.price * offer.commission / 100);
  const action = () => {
    if (role !== "creator") {
      navigate("register", { role: "creator" });
      return;
    }
    if (applicationStatus === "none") apply(offer.id);
    else navigate("creator");
  };

  const buttonLabel =
    role !== "creator" ? "Подать заявку" :
    applicationStatus === "none" ? "Подать заявку" :
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
            <button className="button wide" onClick={action}>{buttonLabel}</button>
          </div>
        </div>
        <CreatorKit
          offer={offer}
          mode="creator"
          hasProductAccess={false}
          notify={notify}
          onToggleAsset={onToggleAsset}
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
        <div className="auth-note">Прототип не создаёт аккаунт и не сохраняет введённые данные.</div>
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
              <p>Заполните основные данные для демонстрационного перехода.</p>
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
                  </>
                )}
              </div>
              <div className="form-actions">
                <button className="button ghost" onClick={() => setStep(1)}>← Назад</button>
                <button className="button" onClick={() => complete(selectedRole)}>Продолжить</button>
              </div>
            </>
          )}
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

function CreatorDashboard({ applications, offers, productRequests, requestProduct, copyLink, navigate }) {
  const [tab, setTab] = useState("offers");
  const activeItems = [
    { offer: offers[0], sales: 3, state: "active" },
    { offer: offers[3], sales: 3, state: productRequests.includes(offers[3].id) ? "requested" : "eligible" }
  ];

  return (
    <DashboardLayout
      roleLabel="Кабинет креатора"
      items={[
        { id: "offers", label: "Мои офферы" },
        { id: "applications", label: "Заявки" },
        { id: "rewards", label: "Вознаграждения" }
      ]}
      active={tab}
      setActive={setTab}
    >
      <div className="dashboard-header">
        <div>
          <h1>Здравствуйте, Анна</h1>
          <p>Ваши партнёрские офферы и результаты за текущий период.</p>
        </div>
        <button className="button" onClick={() => navigate("catalog")}>Найти оффер</button>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><span className="stat-label">Подтверждённые продажи</span><span className="stat-value">6</span><span className="stat-note">по активным офферам</span></div>
        <div className="stat-card"><span className="stat-label">Вознаграждение</span><span className="stat-value">7 947 ₽</span><span className="stat-note">начислено</span></div>
        <div className="stat-card"><span className="stat-label">Активные офферы</span><span className="stat-value">2</span><span className="stat-note">с партнёрской ссылкой</span></div>
        <div className="stat-card"><span className="stat-label">Заявки</span><span className="stat-value">{Object.values(applications).filter((value) => value === "pending").length + 1}</span><span className="stat-note">на рассмотрении</span></div>
      </div>

      {tab === "offers" && (
        <div className="panel">
          <div className="panel-header"><h2>Активные офферы</h2><Status type="success">2 активных</Status></div>
          <div className="panel-body">
            {activeItems.map(({ offer, sales, state }) => {
              const complete = sales >= offer.threshold;
              return (
                <div className="creator-offer" key={offer.id}>
                  <div className="creator-offer-image"><img src={offer.image} alt="" /></div>
                  <div>
                    <h3>{offer.title}</h3>
                    <p>{offer.brand} · комиссия {offer.commission}%</p>
                    <div className="link-box">
                      <span className="link-value">sviazka.ru/a/anna-{offer.id}x9</span>
                      <button className="icon-button" style={{ width: 32, height: 32 }} aria-label="Копировать ссылку" onClick={() => copyLink(offer)}>⧉</button>
                    </div>
                  </div>
                  <div>
                    <div className="progress-info"><span>До получения товара</span><strong>{sales} из {offer.threshold}</strong></div>
                    <div className="progress-track"><span style={{ width: `${Math.min(100, sales / offer.threshold * 100)}%` }}></span></div>
                    <p style={{ marginTop: 9 }}>
                      {complete ? <Status type="success">Условие выполнено</Status> : <Status>Осталось продаж: {offer.threshold - sales}</Status>}
                    </p>
                  </div>
                  <div className="creator-offer-actions">
                    <button className="button secondary small" onClick={() => navigate("offer", { offerId: offer.id })}>Creator Kit</button>
                    {state === "requested" ? (
                      <Status type="success">Товар запрошен</Status>
                    ) : complete ? (
                      <button className="button small" onClick={() => requestProduct(offer.id)}>Запросить товар</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "applications" && (
        <div className="panel">
          <div className="panel-header"><h2>Мои заявки</h2></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Оффер</th><th>Бренд</th><th>Дата</th><th>Статус</th></tr></thead>
              <tbody>
                {Object.entries(applications).map(([offerId, status]) => {
                  const offer = offers.find((item) => item.id === Number(offerId));
                  if (!offer) return null;
                  return <tr key={offerId}><td><span className="table-title">{offer.title}</span></td><td>{offer.brand}</td><td>25 июля 2026</td><td><Status type={status === "approved" ? "success" : "pending"}>{status === "approved" ? "Одобрена" : "На рассмотрении"}</Status></td></tr>;
                })}
                <tr><td><span className="table-title">Набор декоративной косметики Base</span></td><td>MIRA</td><td>22 июля 2026</td><td><Status type="pending">На рассмотрении</Status></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "rewards" && (
        <div className="panel">
          <div className="panel-header"><h2>Вознаграждения</h2><Status type="success">7 947 ₽ начислено</Status></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Оффер</th><th>Продажи</th><th>Комиссия</th><th>Начислено</th></tr></thead>
              <tbody>
                <tr><td><span className="table-title">{offers[0].title}</span><span className="table-subtitle">{offers[0].brand}</span></td><td>3</td><td>{offers[0].commission}%</td><td><strong>{money(Math.round(offers[0].price * offers[0].commission / 100 * 3))}</strong></td></tr>
                <tr><td><span className="table-title">{offers[3].title}</span><span className="table-subtitle">{offers[3].brand}</span></td><td>3</td><td>{offers[3].commission}%</td><td><strong>{money(Math.round(offers[3].price * offers[3].commission / 100 * 3))}</strong></td></tr>
              </tbody>
            </table>
          </div>
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
    const csv = "order_id,partner_id,amount,currency,status,created_at\\nORD-1001,anna-1x9,6490,RUB,confirmed,2026-07-27T10:00:00+07:00\\n";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "sviazka-orders-template.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Шаблон CSV скачан");
  };

  const previewOrders = [
    { id: "ORD-1042", partner: "anna-1x9", amount: 6490, status: "Подтверждён" },
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

function BrandCreatorKitManager({ offers, notify, onToggleAsset }) {
  const brandOffers = offers.filter((offer) => offer.brand === "LUNEA");
  const [selectedOfferId, setSelectedOfferId] = useState(brandOffers[0] ? brandOffers[0].id : null);
  const [preview, setPreview] = useState(false);
  const [previewAccess, setPreviewAccess] = useState("digital");
  const selectedOffer = brandOffers.find((offer) => offer.id === selectedOfferId) || brandOffers[0];

  if (!selectedOffer) return <div className="empty-state">Создайте оффер, чтобы заполнить Creator Kit.</div>;
  const kit = selectedOffer.creatorKit || buildCreatorKit(selectedOffer);

  return (
    <div className="brand-kit-manager">
      <div className="brand-kit-toolbar">
        <div className="form-group">
          <label className="form-label">Оффер</label>
          <select className="select-field" value={selectedOffer.id} onChange={(event) => setSelectedOfferId(Number(event.target.value))}>
            {brandOffers.map((offer) => <option value={offer.id} key={offer.id}>{offer.title}</option>)}
          </select>
        </div>
        <button className={`button ${preview ? "secondary" : ""}`} onClick={() => setPreview(!preview)}>
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
        <div className="stat-card"><span className="stat-label">Скачивания материалов</span><span className="stat-value">{kit.analytics.totalDownloads}</span><span className="stat-note">{kit.analytics.last30Days} за последние 30 дней</span></div>
        <div className="stat-card"><span className="stat-label">Креаторы использовали</span><span className="stat-value">{kit.analytics.creatorsUsed}</span><span className="stat-note">уникальных профилей</span></div>
        <div className="stat-card"><span className="stat-label">Активные материалы</span><span className="stat-value">{kit.assets.filter((asset) => asset.active).length}</span><span className="stat-note">из {kit.assets.length} загруженных</span></div>
      </div>

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
        offer={selectedOffer}
        mode={preview ? "creator" : "brand"}
        hasProductAccess={preview && previewAccess === "product"}
        notify={notify}
        onToggleAsset={onToggleAsset}
      />
    </div>
  );
}

function BrandDashboard({ offers, applications, updateApplication, navigate, notify, onToggleAsset }) {
  const [tab, setTab] = useState("offers");
  const applicationRows = [
    { id: "a1", creator: "Анна Лебедева", channel: "VK · красота и уход", offer: offers[0], status: applications[1] || "approved" },
    { id: "a2", creator: "Мария Фролова", channel: "Telegram · образ жизни", offer: offers[0], status: applications.a2 || "pending" },
    { id: "a3", creator: "Елена Петрова", channel: "VK · мода", offer: offers[1], status: applications.a3 || "pending" }
  ];

  return (
    <DashboardLayout
      roleLabel="Кабинет бренда"
      items={[
        { id: "offers", label: "Офферы" },
        { id: "applications", label: "Заявки" },
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
            <div className="stat-card"><span className="stat-label">Активные офферы</span><span className="stat-value">{offers.filter((item) => item.brand === "LUNEA").length}</span><span className="stat-note">доступны в каталоге</span></div>
            <div className="stat-card"><span className="stat-label">Заявки креаторов</span><span className="stat-value">24</span><span className="stat-note">3 требуют решения</span></div>
            <div className="stat-card"><span className="stat-label">Подтверждённые продажи</span><span className="stat-value">83</span><span className="stat-note">за текущий период</span></div>
            <div className="stat-card"><span className="stat-label">Комиссии</span><span className="stat-value">96 822 ₽</span><span className="stat-note">начислено креаторам</span></div>
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
                {offers.filter((offer) => offer.brand === "LUNEA").map((offer) => (
                  <tr key={offer.id}>
                    <td><span className="table-title">{offer.title}</span><span className="table-subtitle">{money(offer.price)}</span></td>
                    <td><Status type={offer.status === "active" ? "success" : "pending"}>{offer.status === "active" ? "Активен" : "На проверке"}</Status></td>
                    <td><strong>{offer.creatorKit.completeness}%</strong><span className="table-subtitle"> заполнено</span></td>
                    <td>{offer.commission}%</td><td>{offer.applications}</td><td>{offer.sales}</td>
                    <td><button className="button secondary small" onClick={() => navigate("offer", { offerId: offer.id })}>Открыть</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "applications" && (
        <div className="panel">
          <div className="panel-header"><h2>Заявки креаторов</h2><Status type="pending">3 новых</Status></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Креатор</th><th>Оффер</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {applicationRows.map((row) => (
                  <tr key={row.id}>
                    <td><span className="table-title">{row.creator}</span><span className="table-subtitle">{row.channel}</span></td>
                    <td>{row.offer.title}</td>
                    <td><Status type={row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "pending"}>{row.status === "approved" ? "Одобрена" : row.status === "rejected" ? "Отклонена" : "На рассмотрении"}</Status></td>
                    <td>
                      {row.status === "pending" && (
                        <div className="row-actions">
                          <button className="button secondary small" onClick={() => updateApplication(row.id, "rejected")}>Отклонить</button>
                          <button className="button small" onClick={() => updateApplication(row.id, "approved")}>Одобрить</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "sales" && (
        <div className="panel">
          <div className="panel-header"><h2>Подтверждённые продажи</h2></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Дата</th><th>Оффер</th><th>Креатор</th><th>Сумма</th><th>Комиссия</th><th>Статус</th></tr></thead>
              <tbody>
                <tr><td>24.07.2026</td><td>{offers[0].title}</td><td>Анна Лебедева</td><td>{money(offers[0].price)}</td><td>{money(Math.round(offers[0].price * offers[0].commission / 100))}</td><td><Status type="success">Подтверждена</Status></td></tr>
                <tr><td>23.07.2026</td><td>{offers[0].title}</td><td>Мария Фролова</td><td>{money(offers[0].price)}</td><td>{money(Math.round(offers[0].price * offers[0].commission / 100))}</td><td><Status type="success">Подтверждена</Status></td></tr>
                <tr><td>22.07.2026</td><td>{offers[0].title}</td><td>Анна Лебедева</td><td>{money(offers[0].price)}</td><td>{money(Math.round(offers[0].price * offers[0].commission / 100))}</td><td><Status type="success">Подтверждена</Status></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "tracking" && <SalesTracking notify={notify} />}
      {tab === "creatorKit" && <BrandCreatorKitManager offers={offers} notify={notify} onToggleAsset={onToggleAsset} />}
    </DashboardLayout>
  );
}

function CreateOfferPage({ publish, navigate }) {
  const [form, setForm] = useState({
    title: "Набор для ночного ухода Renewal",
    category: "Красота и уход",
    description: "Ночной уход для восстановления и увлажнения кожи.",
    price: 7200,
    commission: 17,
    threshold: 5,
    terms: "Нативная интеграция в контент об уходе и образе жизни.",
    promotionWithoutSample: "restricted",
    allowedDigitalFormats: [...digitalFormats],
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
              <button className="button secondary" onClick={() => navigate("brand")}>Сохранить</button>
              <button className="button" onClick={() => publish(previewOffer)}>Опубликовать оффер</button>
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

function AdminDashboard({ offers, updateOfferStatus }) {
  const [tab, setTab] = useState("offers");
  const brands = ["LUNEA", "FORMA", "SEVER", "KONTUR", "MIRA", "Точка дома"];
  return (
    <DashboardLayout
      roleLabel="Администрирование"
      items={[
        { id: "offers", label: "Офферы" },
        { id: "brands", label: "Бренды" },
        { id: "creators", label: "Креаторы" },
        { id: "applications", label: "Заявки" }
      ]}
      active={tab}
      setActive={setTab}
    >
      <div className="dashboard-header">
        <div><h1>Админ-панель</h1><p>Обзор тестовых данных и статусов платформы.</p></div>
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
                        {offer.status !== "rejected" && <button className="button secondary small" onClick={() => updateOfferStatus(offer.id, "rejected")}>Отклонить</button>}
                        {offer.status !== "active" && <button className="button small" onClick={() => updateOfferStatus(offer.id, "active")}>Активировать</button>}
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
    </DashboardLayout>
  );
}

function App() {
  const [page, setPage] = useState("home");
  const [role, setRole] = useState("guest");
  const [offers, setOffers] = useState(initialOffers);
  const [selectedOfferId, setSelectedOfferId] = useState(1);
  const [registerRole, setRegisterRole] = useState("");
  const [applications, setApplications] = useState({ 1: "approved" });
  const [productRequests, setProductRequests] = useState([]);
  const [toast, setToast] = useState("");

  const selectedOffer = useMemo(() => offers.find((offer) => offer.id === selectedOfferId) || offers[0], [offers, selectedOfferId]);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  };

  const navigate = (target, options = {}) => {
    if (options.role) setRegisterRole(options.role);
    if (options.offerId) setSelectedOfferId(options.offerId);
    setPage(target);
    window.history.pushState({ page: target }, "", `#${target}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (options.anchor) {
      window.setTimeout(() => {
        const element = document.getElementById(options.anchor);
        if (element) {
          window.scrollTo({ top: Math.max(0, element.offsetTop - 72), behavior: "smooth" });
        }
      }, 60);
    }
  };

  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "");
    if (pageTitles[fromHash]) setPage(fromHash);
    const onPop = () => {
      const next = window.location.hash.replace("#", "");
      setPage(pageTitles[next] ? next : "home");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = `${pageTitles[page]} · Связка`;
    if (page === "creator" && role === "guest") setRole("creator");
    if ((page === "brand" || page === "create") && role === "guest") setRole("brand");
    if (page === "admin" && role === "guest") setRole("admin");
  }, [page]);

  const openOffer = (offer) => {
    setSelectedOfferId(offer.id);
    navigate("offer", { offerId: offer.id });
  };

  const completeRegistration = (newRole) => {
    setRole(newRole);
    notify(newRole === "creator" ? "Демонстрационный профиль креатора создан" : "Демонстрационный профиль бренда создан");
    navigate(newRole);
  };

  const apply = (offerId) => {
    setApplications({ ...applications, [offerId]: "pending" });
    notify("Заявка отправлена бренду");
  };

  const updateApplication = (offerId, status) => {
    setApplications({ ...applications, [offerId]: status });
    notify(status === "approved" ? "Заявка одобрена" : "Заявка отклонена");
  };

  const requestProduct = (offerId) => {
    setProductRequests([...productRequests, offerId]);
    notify("Запрос товара отправлен бренду");
  };

  const publishOffer = (offer) => {
    const nextId = Math.max(...offers.map((item) => item.id)) + 1;
    const nextBase = { ...offer, id: nextId };
    const nextOffer = {
      ...nextBase,
      creatorKit: {
        ...buildCreatorKit(nextBase),
        promotionWithoutSample: offer.creatorKit.promotionWithoutSample,
        allowedDigitalFormats: offer.creatorKit.allowedDigitalFormats,
        allowedClaims: offer.creatorKit.allowedClaims,
        forbiddenClaims: offer.creatorKit.forbiddenClaims
      }
    };
    setOffers([nextOffer, ...offers]);
    notify("Оффер опубликован и отправлен на проверку");
    navigate("brand");
  };

  const updateOfferStatus = (offerId, status) => {
    setOffers(offers.map((offer) => offer.id === offerId ? { ...offer, status } : offer));
    notify(status === "active" ? "Оффер активирован" : "Оффер отклонён");
  };

  const toggleCreatorKitAsset = (offerId, assetId) => {
    setOffers(offers.map((offer) => {
      if (offer.id !== offerId) return offer;
      const kit = offer.creatorKit || buildCreatorKit(offer);
      return {
        ...offer,
        creatorKit: {
          ...kit,
          assets: kit.assets.map((asset) => asset.id === assetId ? { ...asset, active: !asset.active } : asset)
        }
      };
    }));
    notify("Статус материала обновлён");
  };

  return (
    <div className="app">
      {page !== "register" && <Header page={page} role={role} navigate={navigate} setRole={setRole} />}
      {page === "home" && <HomePage offers={offers.filter((offer) => offer.status === "active")} navigate={navigate} openOffer={openOffer} />}
      {page === "catalog" && <CatalogPage offers={offers} openOffer={openOffer} navigate={navigate} />}
      {page === "offer" && <OfferPage offer={selectedOffer} applicationStatus={applications[selectedOffer.id] || "none"} role={role} apply={apply} navigate={navigate} notify={notify} onToggleAsset={toggleCreatorKitAsset} />}
      {page === "register" && <RegisterPage presetRole={registerRole} complete={completeRegistration} navigate={navigate} />}
      {page === "creator" && <CreatorDashboard applications={applications} offers={offers} productRequests={productRequests} requestProduct={requestProduct} copyLink={(offer) => notify(`Ссылка для «${offer.title}» скопирована`)} navigate={navigate} />}
      {page === "brand" && <BrandDashboard offers={offers} applications={applications} updateApplication={updateApplication} navigate={navigate} notify={notify} onToggleAsset={toggleCreatorKitAsset} />}
      {page === "create" && <CreateOfferPage publish={publishOffer} navigate={navigate} />}
      {page === "admin" && <AdminDashboard offers={offers} updateOfferStatus={updateOfferStatus} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
