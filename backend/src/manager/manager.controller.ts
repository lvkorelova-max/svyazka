import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { AdminSecurityGuard } from '../common/guards/admin-security.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateManagerProfileDto } from './dto/update-manager-profile.dto';
import { ManagerService } from './manager.service';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
export class ManagerController {
  constructor(private readonly managers: ManagerService) {}

  @Get('manager/profile')
  @Roles(UserRole.MANAGER)
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.managers.getProfile(user.id);
  }

  @Patch('manager/profile')
  @Roles(UserRole.MANAGER)
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateManagerProfileDto,
  ) {
    return this.managers.updateProfile(user.id, dto);
  }

  @Get('manager/brands')
  @Roles(UserRole.MANAGER)
  listBrands(@CurrentUser() user: AuthenticatedUser) {
    return this.managers.listBrands(user.id);
  }

  @Get('brand/team/managers')
  @Roles(UserRole.BRAND)
  listOwnBrandManagers(@CurrentUser() brand: AuthenticatedUser) {
    return this.managers.listOwnBrandManagers(brand.id);
  }

  @Post('brand/team/managers/:managerId')
  @Roles(UserRole.BRAND)
  assignOwnBrandManager(
    @CurrentUser() brand: AuthenticatedUser,
    @Param('managerId', ParseUUIDPipe) managerId: string,
  ) {
    return this.managers.assignOwnBrandManager(brand.id, managerId);
  }

  @Delete('brand/team/managers/:managerId')
  @Roles(UserRole.BRAND)
  removeOwnBrandManager(
    @CurrentUser() brand: AuthenticatedUser,
    @Param('managerId', ParseUUIDPipe) managerId: string,
  ) {
    return this.managers.removeOwnBrandManager(brand.id, managerId);
  }

  @Get('admin/managers/eligible')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  listEligible(@CurrentUser() admin: AuthenticatedUser) {
    return this.managers.listEligibleManagers(admin.id);
  }

  @Get('admin/brands/:brandId/managers')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  listBrandManagers(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('brandId', ParseUUIDPipe) brandId: string,
  ) {
    return this.managers.listBrandManagers(admin.id, brandId);
  }

  @Post('admin/brands/:brandId/managers/:managerId')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  assign(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Param('managerId', ParseUUIDPipe) managerId: string,
  ) {
    return this.managers.assignManager(admin.id, brandId, managerId);
  }

  @Delete('admin/brands/:brandId/managers/:managerId')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  remove(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Param('managerId', ParseUUIDPipe) managerId: string,
  ) {
    return this.managers.removeManager(admin.id, brandId, managerId);
  }
}
