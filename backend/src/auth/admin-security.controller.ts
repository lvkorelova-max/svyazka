import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { AdminSecurityGuard } from '../common/guards/admin-security.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { BlockUserDto } from './dto/password.dto';
import { HealthService } from '../health/health.service';

@Controller('admin')
@UseGuards(AccessTokenGuard, RolesGuard, AdminSecurityGuard)
@Roles(UserRole.ADMIN)
export class AdminSecurityController {
  constructor(
    private readonly auth: AuthService,
    private readonly health: HealthService,
  ) {}

  @Post('users/:id/block')
  @RateLimit({ scope: 'admin-user-block', limit: 30, windowSeconds: 3600 })
  blockUser(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: BlockUserDto,
  ) {
    return this.auth.blockUser(admin.id, userId, dto.reason);
  }

  @Get('brands')
  listBrands() {
    return this.auth.listBrands();
  }

  @Get('creators')
  listCreators() {
    return this.auth.listCreators();
  }

  @Get('applications')
  listApplications() {
    return this.auth.listApplications();
  }

  @Post('brands/:id/verify')
  @RateLimit({ scope: 'admin-brand-verify', limit: 60, windowSeconds: 3600 })
  verifyBrand(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) brandId: string,
  ) {
    return this.auth.verifyBrand(admin.id, brandId);
  }

  @Get('operations/readiness')
  readiness() {
    return this.health.readiness();
  }
}
