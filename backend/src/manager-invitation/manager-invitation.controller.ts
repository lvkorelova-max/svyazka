import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  AcceptNewManagerInvitationDto,
  CreateManagerInvitationDto,
} from './dto/manager-invitation.dto';
import { ManagerInvitationService } from './manager-invitation.service';

@Controller()
export class ManagerInvitationController {
  constructor(private readonly invitations: ManagerInvitationService) {}

  @Post('brand/team/invitations')
  @Roles(UserRole.BRAND)
  @UseGuards(AccessTokenGuard, RolesGuard)
  create(
    @CurrentUser() brand: AuthenticatedUser,
    @Body() dto: CreateManagerInvitationDto,
  ) {
    return this.invitations.create(brand.id, dto);
  }

  @Get('brand/team/invitations')
  @Roles(UserRole.BRAND)
  @UseGuards(AccessTokenGuard, RolesGuard)
  list(@CurrentUser() brand: AuthenticatedUser) {
    return this.invitations.list(brand.id);
  }

  @Delete('brand/team/invitations/:id')
  @Roles(UserRole.BRAND)
  @UseGuards(AccessTokenGuard, RolesGuard)
  revoke(
    @CurrentUser() brand: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.revoke(brand.id, invitationId);
  }

  @Get('manager-invitations/:token')
  @RateLimit({ scope: 'manager-invitation-inspect', limit: 60, windowSeconds: 900 })
  inspect(@Param('token') token: string) {
    return this.invitations.inspect(token);
  }

  @Post('manager-invitations/:token/accept')
  @RateLimit({ scope: 'manager-invitation-accept-new', limit: 20, windowSeconds: 900 })
  acceptNew(
    @Param('token') token: string,
    @Body() dto: AcceptNewManagerInvitationDto,
  ) {
    return this.invitations.acceptNew(token, dto);
  }

  @Post('manager-invitations/:token/accept-existing')
  @Roles(UserRole.MANAGER)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @RateLimit({ scope: 'manager-invitation-accept-existing', limit: 20, windowSeconds: 900 })
  acceptExisting(
    @CurrentUser() manager: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    return this.invitations.acceptExisting(manager.id, token);
  }
}
