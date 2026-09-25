import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandAccessModule } from '../brand-access/brand-access.module';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';

@Module({
  imports: [AuthModule, BrandAccessModule],
  controllers: [ManagerController],
  providers: [ManagerService],
  exports: [ManagerService],
})
export class ManagerModule {}
