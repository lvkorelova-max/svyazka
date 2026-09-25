import { Module } from '@nestjs/common';
import { BrandContextGuard } from './brand-context.guard';
import { BrandAccessService } from './brand-access.service';

@Module({
  providers: [BrandAccessService, BrandContextGuard],
  exports: [BrandAccessService, BrandContextGuard],
})
export class BrandAccessModule {}
