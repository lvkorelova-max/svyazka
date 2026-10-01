import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BrandAccessModule } from '../brand-access/brand-access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialOrderPort } from './financial-order.port';
import { FinanceService } from './finance.service';

@Module({
  imports: [PrismaModule, AuditModule, BrandAccessModule],
  providers: [FinanceService, FinancialOrderPort],
  exports: [FinanceService, FinancialOrderPort],
})
export class FinanceCoreModule {}
