import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandAccessModule } from '../brand-access/brand-access.module';
import { CreatorKitController } from './creator-kit.controller';
import { CreatorKitService } from './creator-kit.service';

@Module({
  imports: [AuthModule, BrandAccessModule],
  controllers: [CreatorKitController],
  providers: [CreatorKitService],
})
export class CreatorKitModule {}
