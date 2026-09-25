import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ManagerInvitationController } from './manager-invitation.controller';
import { ManagerInvitationService } from './manager-invitation.service';

@Module({
  imports: [AuthModule],
  controllers: [ManagerInvitationController],
  providers: [ManagerInvitationService],
})
export class ManagerInvitationModule {}
