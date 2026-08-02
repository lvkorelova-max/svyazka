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
        return config;
      },
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    CreatorKitModule,
    ProfilesModule,
    OffersModule,
    PartnershipsModule,
    FinanceModule,
  ],
})
export class AppModule {}
