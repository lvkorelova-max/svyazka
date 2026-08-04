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
        }
        return config;
      },
    }),
    PrismaModule,
    AuditModule,
    SecurityModule,
    StorageModule,
    HealthModule,
    AuthModule,
    CreatorKitModule,
    ProfilesModule,
    OffersModule,
    PartnershipsModule,
    FinanceModule,
  ],
})
export class AppModule {}
