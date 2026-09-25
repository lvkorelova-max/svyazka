import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandAccessModule } from '../brand-access/brand-access.module';
import { PartnershipsController, RedirectController } from './partnerships.controller';
import { PartnershipsService } from './partnerships.service';

@Module({
  imports: [AuthModule, BrandAccessModule],
  controllers: [PartnershipsController, RedirectController],
  providers: [PartnershipsService],
  exports: [PartnershipsService],
})
export class PartnershipsModule {}
