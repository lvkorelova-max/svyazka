import {
  AffiliateRelationshipStatus,
  AttributionSource,
  BrandVerificationStatus,
  CommissionStatus,
  CreatorKitAccessLevel,
  CreatorKitClaimType,
  CreatorKitFactType,
  CreatorKitRevisionStatus,
  CreatorKitScenarioChannel,
  LedgerEntryType,
  OfferApplicationStatus,
  OfferStatus,
  OrderImportAction,
  OrderImportRowStatus,
  OrderImportStatus,
  OrderStatus,
  PrismaClient,
  PromotionWithoutProduct,
  UserRole,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function upsertUser(email: string, password: string, role: UserRole) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { email },
    update: { passwordHash, role, status: 'ACTIVE' },
    create: { email, passwordHash, role },
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed запрещён в production. Используйте безопасный bootstrap администратора.');
  }
  const brandUser = await upsertUser(
    'brand@example.test',
    process.env.SEED_BRAND_PASSWORD ?? 'BrandTest123!',
    UserRole.BRAND,
  );
  const creatorUser = await upsertUser(
    'creator@example.test',
    process.env.SEED_CREATOR_PASSWORD ?? 'CreatorTest123!',
    UserRole.CREATOR,
  );
  const adminUser = await upsertUser(
    'admin@example.test',
    process.env.SEED_ADMIN_PASSWORD ?? 'AdminTest123!',
    UserRole.ADMIN,
  );

  const brand = await prisma.brandProfile.upsert({
    where: { userId: brandUser.id },
    update: {
      brandName: 'Лаборатория Бережно',
      verificationStatus: BrandVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verifiedByUserId: adminUser.id,
    },
    create: {
      userId: brandUser.id,
      brandName: 'Лаборатория Бережно',
      description: 'Тестовый российский бренд ухода за кожей.',
      website: 'https://example.test',
      verificationStatus: BrandVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verifiedByUserId: adminUser.id,
    },
  });

  const creator = await prisma.creatorProfile.upsert({
    where: { userId: creatorUser.id },
    update: { displayName: 'Анна Тестова' },
    create: {
      userId: creatorUser.id,
      displayName: 'Анна Тестова',
      description: 'Тестовый профиль креатора.',
      socialLinks: { telegram: 'https://t.me/example_test' },
    },
  });

  const offers = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      title: 'Увлажняющая сыворотка «Баланс»',
      description: 'Сыворотка с ниацинамидом и гиалуроновой кислотой.',
      productUrl: 'https://example.test/products/balance-serum',
      productPriceKopecks: 249000,
      creatorCommissionBps: 1500,
      platformCommissionBps: 500,
      promotionWithoutProduct: PromotionWithoutProduct.LIMITED,
      status: OfferStatus.PUBLISHED,
      category: 'Красота и уход',
      productRequirementSales: 5,
      allowedPromotionFormats: ['wishlist', 'подборка товаров', 'обзор характеристик'],
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      title: 'Восстанавливающий крем «Контур»',
      description: 'Питательный крем для ежедневного ухода.',
      productPriceKopecks: 189000,
      creatorCommissionBps: 1250,
      platformCommissionBps: 500,
      promotionWithoutProduct: PromotionWithoutProduct.NO,
      status: OfferStatus.DRAFT,
      category: 'Красота и уход',
      productRequirementSales: 3,
      allowedPromotionFormats: [],
    },
  ];

  for (const offer of offers) {
    await prisma.offer.upsert({
      where: { id: offer.id },
      update: { ...offer, brandId: brand.id },
      create: { ...offer, brandId: brand.id },
    });
  }

  const kit = await prisma.creatorKit.upsert({
    where: { offerId: offers[0].id },
    update: {},
    create: { offerId: offers[0].id },
  });

  const revision = await prisma.creatorKitRevision.upsert({
    where: {
      creatorKitId_revisionNumber: {
        creatorKitId: kit.id,
        revisionNumber: 1,
      },
    },
    update: {
      status: CreatorKitRevisionStatus.PUBLISHED,
      createdByUserId: brandUser.id,
      publishedByUserId: brandUser.id,
      publishedAt: new Date('2026-07-30T00:00:00.000Z'),
    },
    create: {
      id: '90000000-0000-4000-8000-000000000001',
      creatorKitId: kit.id,
      revisionNumber: 1,
      status: CreatorKitRevisionStatus.PUBLISHED,
      createdByUserId: brandUser.id,
      publishedByUserId: brandUser.id,
      publishedAt: new Date('2026-07-30T00:00:00.000Z'),
      changeSummary: 'Создан тестовый Creator Kit',
      changeSet: {
        schemaVersion: 1,
        sections: [{ section: 'CREATOR_KIT', changeType: 'CREATED' }],
      },
    },
  });

  await prisma.creatorKit.update({
    where: { id: kit.id },
    data: { activeRevisionId: revision.id, draftRevisionId: null },
  });

  await prisma.$transaction(async (tx) => {
    await tx.creatorKitScenario.deleteMany({ where: { revisionId: revision.id } });
    await tx.creatorKitFact.deleteMany({ where: { revisionId: revision.id } });
    await tx.creatorKitClaim.deleteMany({ where: { revisionId: revision.id } });
    await tx.creatorKitRule.deleteMany({ where: { revisionId: revision.id } });

    await tx.creatorKitBrandContent.upsert({
      where: { revisionId: revision.id },
      update: {
        description: 'Российский бренд понятного ежедневного ухода.',
        history: 'Бренд создан вокруг прозрачных составов и простых ритуалов ухода.',
        values: ['Прозрачность', 'Забота', 'Проверяемые формулировки'],
        positioning: 'Современный ежедневный уход без завышенных обещаний.',
      },
      create: {
        revisionId: revision.id,
        description: 'Российский бренд понятного ежедневного ухода.',
        history: 'Бренд создан вокруг прозрачных составов и простых ритуалов ухода.',
        values: ['Прозрачность', 'Забота', 'Проверяемые формулировки'],
        positioning: 'Современный ежедневный уход без завышенных обещаний.',
      },
    });

    await tx.creatorKitProductContent.upsert({
      where: { revisionId: revision.id },
      update: {
        description: offers[0].description,
        benefits: ['Поддерживает увлажнение', 'Подходит для ежедневного ухода'],
        usageInstructions: 'Наносить на очищенную кожу согласно инструкции бренда.',
      },
      create: {
        revisionId: revision.id,
        description: offers[0].description,
        benefits: ['Поддерживает увлажнение', 'Подходит для ежедневного ухода'],
        usageInstructions: 'Наносить на очищенную кожу согласно инструкции бренда.',
      },
    });

    await tx.creatorKitScenario.createMany({
      data: [
        {
          revisionId: revision.id,
          channel: CreatorKitScenarioChannel.REELS,
          title: 'Три проверяемых факта о сыворотке',
          hook: 'Что важно знать об увлажняющей сыворотке?',
          mainIdea: 'Используйте официальные кадры и расскажите о составе без заявления о личном опыте.',
          structure: 'Хук, три факта, официальный кадр продукта, вывод.',
          cta: 'Перейдите по ссылке и изучите карточку продукта.',
          accessLevel: CreatorKitAccessLevel.DIGITAL,
          sortOrder: 1,
        },
        {
          revisionId: revision.id,
          channel: CreatorKitScenarioChannel.SHORT_REVIEW,
          title: 'Личный обзор после получения образца',
          hook: 'Показываю текстуру сыворотки после личного знакомства.',
          mainIdea: 'Покажите текстуру и опишите собственные впечатления только после получения продукта.',
          structure: 'Хук, нанесение, личные наблюдения, ограничения, вывод.',
          cta: 'Используйте персональный промокод.',
          accessLevel: CreatorKitAccessLevel.PRODUCT,
          sortOrder: 2,
        },
      ],
    });

    const facts = [
      [CreatorKitFactType.DESCRIPTION, 'Увлажняющая сыворотка для ежедневного ухода.'],
      [CreatorKitFactType.BENEFITS, 'Поддерживает увлажнение и комфорт кожи.'],
      [CreatorKitFactType.INGREDIENTS, 'Ниацинамид и гиалуроновая кислота.'],
      [CreatorKitFactType.USAGE, 'Наносить на очищенную кожу согласно инструкции бренда.'],
      [CreatorKitFactType.PRICE, '2 490 ₽'],
      [CreatorKitFactType.VOLUME, '30 мл'],
      [CreatorKitFactType.COUNTRY, 'Россия'],
      [CreatorKitFactType.TARGET_AUDIENCE, 'Покупатели, выбирающие понятный ежедневный уход.'],
      [CreatorKitFactType.FEATURES, 'Можно продвигать с официальными материалами Digital Access.'],
      [CreatorKitFactType.LIMITATIONS, 'Возможна индивидуальная реакция на компоненты.'],
    ] as const;
    await tx.creatorKitFact.createMany({
      data: facts.map(([type, value], index) => ({
        revisionId: revision.id,
        type,
        value,
        accessLevel: CreatorKitAccessLevel.DIGITAL,
        requiresAffiliateApproval: false,
        sortOrder: index + 1,
      })),
    });

    await tx.creatorKitClaim.createMany({
      data: [
        {
          revisionId: revision.id,
          type: CreatorKitClaimType.ALLOWED,
          value: 'Бренд указывает в составе ниацинамид и гиалуроновую кислоту.',
          accessLevel: CreatorKitAccessLevel.DIGITAL,
          requiresAffiliateApproval: false,
          sortOrder: 1,
        },
        {
          revisionId: revision.id,
          type: CreatorKitClaimType.FORBIDDEN,
          value: 'Я протестировала продукт и точно рекомендую — до получения образца.',
          accessLevel: CreatorKitAccessLevel.DIGITAL,
          requiresAffiliateApproval: false,
          sortOrder: 2,
        },
      ],
    });

    await tx.creatorKitRule.createMany({
      data: [
        {
          revisionId: revision.id,
          value: 'Использовать только официальные материалы бренда.',
          accessLevel: CreatorKitAccessLevel.DIGITAL,
          requiresAffiliateApproval: false,
          sortOrder: 1,
        },
        {
          revisionId: revision.id,
          value: 'Не утверждать, что продукт был лично протестирован.',
          accessLevel: CreatorKitAccessLevel.DIGITAL,
          requiresAffiliateApproval: false,
          sortOrder: 2,
        },
      ],
    });

    await tx.publicationRequirements.upsert({
      where: { revisionId: revision.id },
      update: {
        mandatoryMentions: ['Название продукта', 'Актуальная цена'],
        advertisingLabel: 'Маркировка рекламы обязательна для рекламной публикации.',
        hashtags: ['#реклама', '#бережно'],
        brandMention: '@berezhno',
        approvalRequired: false,
        allowedPlatforms: ['VK', 'Telegram', 'Threads', 'короткие видео'],
      },
      create: {
        revisionId: revision.id,
        mandatoryMentions: ['Название продукта', 'Актуальная цена'],
        advertisingLabel: 'Маркировка рекламы обязательна для рекламной публикации.',
        hashtags: ['#реклама', '#бережно'],
        brandMention: '@berezhno',
        approvalRequired: false,
        allowedPlatforms: ['VK', 'Telegram', 'Threads', 'короткие видео'],
        accessLevel: CreatorKitAccessLevel.DIGITAL,
        requiresAffiliateApproval: false,
      },
    });
  });

  const application = await prisma.offerApplication.upsert({
    where: { id: '20000000-0000-4000-8000-000000000001' },
    update: {
      offerId: offers[0].id,
      creatorId: creator.id,
      message: 'Тестовая заявка для проверки партнёрского сценария.',
      status: OfferApplicationStatus.APPROVED,
      reviewedAt: new Date('2026-07-30T00:00:00.000Z'),
      reviewedByUserId: brandUser.id,
    },
    create: {
      id: '20000000-0000-4000-8000-000000000001',
      offerId: offers[0].id,
      creatorId: creator.id,
      message: 'Тестовая заявка для проверки партнёрского сценария.',
      status: OfferApplicationStatus.APPROVED,
      reviewedAt: new Date('2026-07-30T00:00:00.000Z'),
      reviewedByUserId: brandUser.id,
    },
  });

  const relationship = await prisma.affiliateRelationship.upsert({
    where: { applicationId: application.id },
    update: {
      offerId: offers[0].id,
      creatorId: creator.id,
      affiliateCode: 'm3Jr8sQv5Xp2Nc7Bk4Wd9Hy6',
      promoCode: 'SVYAZKA2',
      destinationUrl: 'https://example.test/products/balance-serum',
      status: AffiliateRelationshipStatus.ACTIVE,
      activatedAt: new Date('2026-07-30T00:00:00.000Z'),
      pausedAt: null,
      revokedAt: null,
    },
    create: {
      id: '30000000-0000-4000-8000-000000000001',
      offerId: offers[0].id,
      creatorId: creator.id,
      applicationId: application.id,
      affiliateCode: 'm3Jr8sQv5Xp2Nc7Bk4Wd9Hy6',
      promoCode: 'SVYAZKA2',
      destinationUrl: 'https://example.test/products/balance-serum',
      status: AffiliateRelationshipStatus.ACTIVE,
      activatedAt: new Date('2026-07-30T00:00:00.000Z'),
    },
  });

  const click = await prisma.click.upsert({
    where: { id: '40000000-0000-4000-8000-000000000001' },
    update: {
      affiliateRelationshipId: relationship.id,
      affiliateCode: relationship.affiliateCode,
      offerId: offers[0].id,
      creatorId: creator.id,
    },
    create: {
      id: '40000000-0000-4000-8000-000000000001',
      affiliateRelationshipId: relationship.id,
      affiliateCode: relationship.affiliateCode,
      offerId: offers[0].id,
      creatorId: creator.id,
      clickedAt: new Date('2026-07-31T08:00:00.000Z'),
      landingUrl: relationship.destinationUrl,
      referrer: 'https://t.me/example_test',
      userAgent: 'Seed browser',
      ipHash: 'd7b63d5df47191f0b7bf5b4d9189e183d75386a3106b0285be870b7374b72872',
      deduplicationKey:
        '8e8126fd55c3c5eb73793a9c4d34bf31b26b807e5c48beab6ac82ec9cfd152de',
    },
  });

  const orderImport = await prisma.orderImport.upsert({
    where: { id: '50000000-0000-4000-8000-000000000001' },
    update: {
      brandId: brand.id,
      status: OrderImportStatus.IMPORTED,
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      duplicateRows: 0,
      completedAt: new Date('2026-07-31T09:01:00.000Z'),
    },
    create: {
      id: '50000000-0000-4000-8000-000000000001',
      brandId: brand.id,
      originalFileName: 'seed-orders.csv',
      status: OrderImportStatus.IMPORTED,
      totalRows: 1,
      validRows: 1,
      completedAt: new Date('2026-07-31T09:01:00.000Z'),
    },
  });

  const order = await prisma.order.upsert({
    where: {
      brandId_externalOrderId: {
        brandId: brand.id,
        externalOrderId: 'SEED-ORDER-1001',
      },
    },
    update: {
      orderImportId: orderImport.id,
      status: OrderStatus.PAID,
      returnedAmountKopecks: 0,
    },
    create: {
      id: '60000000-0000-4000-8000-000000000001',
      brandId: brand.id,
      offerId: offers[0].id,
      orderImportId: orderImport.id,
      affiliateRelationshipId: relationship.id,
      externalOrderId: 'SEED-ORDER-1001',
      orderDate: new Date('2026-07-31T08:30:00.000Z'),
      amountKopecks: 249000,
      currency: 'RUB',
      status: OrderStatus.PAID,
      attributionSource: AttributionSource.CLICK_ID,
      affiliateCode: relationship.affiliateCode,
      promoCode: relationship.promoCode,
      clickId: click.id,
      creatorCommissionBps: 1500,
      platformCommissionBps: 500,
      importedAt: new Date('2026-07-31T09:00:00.000Z'),
    },
  });

  await prisma.orderImportRow.upsert({
    where: {
      orderImportId_rowNumber: { orderImportId: orderImport.id, rowNumber: 2 },
    },
    update: {
      status: OrderImportRowStatus.VALID,
      action: OrderImportAction.CREATE,
      existingOrderId: order.id,
    },
    create: {
      orderImportId: orderImport.id,
      rowNumber: 2,
      status: OrderImportRowStatus.VALID,
      action: OrderImportAction.CREATE,
      externalOrderId: order.externalOrderId,
      orderDate: order.orderDate,
      amountKopecks: order.amountKopecks,
      returnedAmountKopecks: 0,
      currency: order.currency,
      orderStatus: order.status,
      affiliateCode: relationship.affiliateCode,
      promoCode: relationship.promoCode,
      clickId: click.id,
      offerId: order.offerId,
      attributedRelationshipId: relationship.id,
      attributionSource: AttributionSource.CLICK_ID,
      existingOrderId: order.id,
      creatorCommissionBpsSnapshot: order.creatorCommissionBps,
      platformCommissionBpsSnapshot: order.platformCommissionBps,
      previewCreatorAmountKopecks: 37350,
      previewPlatformAmountKopecks: 12450,
      rawData: {
        external_order_id: order.externalOrderId,
        order_date: order.orderDate.toISOString(),
        amount_kopecks: String(order.amountKopecks),
        currency: order.currency,
        status: 'paid',
        click_id: click.id,
      },
    },
  });

  const commission = await prisma.commission.upsert({
    where: { orderId: order.id },
    update: {
      creatorAmountKopecks: 37350,
      platformAmountKopecks: 12450,
      status: CommissionStatus.AVAILABLE,
      holdUntil: new Date('2026-07-31T09:00:00.000Z'),
    },
    create: {
      id: '70000000-0000-4000-8000-000000000001',
      orderId: order.id,
      affiliateRelationshipId: relationship.id,
      creatorId: creator.id,
      offerId: offers[0].id,
      creatorAmountKopecks: 37350,
      platformAmountKopecks: 12450,
      status: CommissionStatus.AVAILABLE,
      holdUntil: new Date('2026-07-31T09:00:00.000Z'),
    },
  });

  await prisma.ledgerEntry.upsert({
    where: { eventKey: `order:${order.id}:accrual` },
    update: {
      amountKopecks: 37350,
      metadata: { platformAmountKopecks: 12450, source: 'seed' },
    },
    create: {
      id: '80000000-0000-4000-8000-000000000001',
      commissionId: commission.id,
      creatorId: creator.id,
      orderId: order.id,
      type: LedgerEntryType.ACCRUAL,
      amountKopecks: 37350,
      eventKey: `order:${order.id}:accrual`,
      metadata: { platformAmountKopecks: 12450, source: 'seed' },
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
