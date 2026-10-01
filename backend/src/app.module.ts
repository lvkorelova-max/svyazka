import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CreatorKitModule } from './creator-kit/creator-kit.module';
import { OffersModule } from './offers/offers.module';
import { FinanceModule } from './finance/finance.module';
import { PartnershipsModule } from './partnerships/partnerships.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfilesModule } from './profiles/profiles.module';
import { StorageModule } from './storage/storage.module';
import { AuditModule } from './audit/audit.module';
import { SecurityModule } from './common/security.module';
import { HealthModule } from './health/health.module';
import { BrandAccessModule } from './brand-access/brand-access.module';
import { ManagerModule } from './manager/manager.module';
import { ManagerInvitationModule } from './manager-invitation/manager-invitation.module';
import { AttributionModule } from './attribution/attribution.module';
import { CommercialTermsModule } from './commercial-terms/commercial-terms.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => {
        const required = [
          'DATABASE_URL',
          'JWT_ACCESS_SECRET',
          'FRONTEND_ORIGIN',
          'CLICK_IP_HASH_SALT',
        ];
        for (const key of required) {
          if (!config[key]) throw new Error(`Missing required environment variable: ${key}`);
        }
        if (String(config.JWT_ACCESS_SECRET).length < 32) {
          throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters');
        }
        if (String(config.CLICK_IP_HASH_SALT).length < 32) {
          throw new Error('CLICK_IP_HASH_SALT must contain at least 32 characters');
        }
        if (String(config.NODE_ENV) === 'production') {
          for (const key of ['MFA_ENCRYPTION_KEY', 'MFA_RECOVERY_CODE_SALT']) {
            if (!config[key] || String(config[key]).length < 32) {
              throw new Error(`${key} must contain at least 32 characters in production`);
            }
          }
          if (String(config.ADMIN_MFA_REQUIRED) !== 'true') {
            throw new Error('ADMIN_MFA_REQUIRED must be true in production');
          }
          const stage8Enabled = [
            'STAGE8_TRACKER_ENABLED',
            'STAGE8_TILDA_ENABLED',
            'STAGE8_ORDER_INGESTION_ENABLED',
            'STAGE8_ATTRIBUTION_SHADOW_ENABLED',
            'STAGE8_AUTO_ATTRIBUTION_ENABLED',
            'STAGE8_FINANCE_HANDOFF_ENABLED',
          ].some((key) => String(config[key]) === 'true');
          if (
            stage8Enabled &&
            (!config.STAGE8_WEBHOOK_SECRET_ENCRYPTION_KEY ||
              String(config.STAGE8_WEBHOOK_SECRET_ENCRYPTION_KEY).length < 32)
          ) {
            throw new Error(
              'STAGE8_WEBHOOK_SECRET_ENCRYPTION_KEY must contain at least 32 characters when Stage 8 is enabled',
            );
          }
        }
        return config;
      },
    }),
    PrismaModule,
    AuditModule,
    SecurityModule,
    StorageModule,
    HealthModule,
    CommercialTermsModule,
    NotificationsModule,
    BrandAccessModule,
    AuthModule,
    ManagerModule,
    ManagerInvitationModule,
    CreatorKitModule,
    ProfilesModule,
    OffersModule,
    PartnershipsModule,
    FinanceModule,
    AttributionModule,
  ],
})
export class AppModule {}
