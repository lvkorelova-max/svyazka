import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandAccessModule } from '../brand-access/brand-access.module';
import { OffersController, PublicOffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [AuthModule, BrandAccessModule],
  controllers: [OffersController, PublicOffersController],
  providers: [OffersService],
})
export class OffersModule {}
