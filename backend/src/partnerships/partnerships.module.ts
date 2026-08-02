import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartnershipsController, RedirectController } from './partnerships.controller';
import { PartnershipsService } from './partnerships.service';

@Module({
  imports: [AuthModule],
  controllers: [PartnershipsController, RedirectController],
  providers: [PartnershipsService],
  exports: [PartnershipsService],
})
export class PartnershipsModule {}
