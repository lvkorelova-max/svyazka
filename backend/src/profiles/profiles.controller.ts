import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';
import { ProfilesService } from './profiles.service';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('brands/me')
  @Roles(UserRole.BRAND)
  getBrand(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getBrand(user.id);
  }

  @Patch('brands/me')
  @Roles(UserRole.BRAND)
  updateBrand(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBrandProfileDto) {
    return this.profiles.updateBrand(user.id, dto);
  }

  @Get('creators/me')
  @Roles(UserRole.CREATOR)
  getCreator(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getCreator(user.id);
  }

  @Patch('creators/me')
  @Roles(UserRole.CREATOR)
  updateCreator(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCreatorProfileDto) {
    return this.profiles.updateCreator(user.id, dto);
  }
}
