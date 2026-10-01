import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandAccessModule } from '../brand-access/brand-access.module';
import { AttributionModule } from '../attribution/attribution.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [AuthModule, BrandAccessModule, AttributionModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
