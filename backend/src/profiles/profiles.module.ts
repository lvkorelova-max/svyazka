import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandAccessModule } from '../brand-access/brand-access.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [AuthModule, BrandAccessModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
