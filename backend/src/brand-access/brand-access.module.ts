import { Module } from '@nestjs/common';
import { BrandContextGuard } from './brand-context.guard';

@Module({
  providers: [BrandContextGuard],
  exports: [BrandContextGuard],
})
export class BrandAccessModule {}
