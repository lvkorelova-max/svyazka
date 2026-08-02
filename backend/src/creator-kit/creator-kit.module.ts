import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreatorKitController } from './creator-kit.controller';
import { CreatorKitService } from './creator-kit.service';

@Module({
  imports: [AuthModule],
  controllers: [CreatorKitController],
  providers: [CreatorKitService],
})
export class CreatorKitModule {}
