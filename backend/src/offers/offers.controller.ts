import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { OfferStatus, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { BrandContextGuard } from '../brand-access/brand-context.guard';
import { ActiveBrandId } from '../brand-access/brand-context';
import { UpdateResponsibilityDto } from '../manager/dto/update-responsibility.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OffersService } from './offers.service';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard, BrandContextGuard)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post('brand/offers')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  create(@CurrentUser() user: AuthenticatedUser, @ActiveBrandId() brandId: string, @Body() dto: CreateOfferDto) {
    return this.offers.create(user.id, dto, brandId);
  }

  @Get('brand/offers')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  listOwn(@CurrentUser() user: AuthenticatedUser, @ActiveBrandId() brandId: string) {
    return this.offers.listOwn(user.id, brandId);
  }

  @Get('brand/offers/:id')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  getOwn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.offers.getOwn(user.id, offerId, brandId);
  }

  @Patch('brand/offers/:id')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateOfferDto,
    @ActiveBrandId() brandId: string,
  ) {
    return this.offers.updateOwn(user.id, offerId, dto, brandId);
  }

  @Post('brand/offers/:id/publish')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.offers.transition(user.id, offerId, OfferStatus.PUBLISHED, brandId);
  }

  @Post('brand/offers/:id/pause')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.offers.transition(user.id, offerId, OfferStatus.PAUSED, brandId);
  }

  @Post('brand/offers/:id/archive')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.offers.transition(user.id, offerId, OfferStatus.ARCHIVED, brandId);
  }

  @Patch('brand/offers/:id/responsibility')
  @Roles(UserRole.MANAGER)
  updateResponsibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @ActiveBrandId() brandId: string,
    @Body() dto: UpdateResponsibilityDto,
  ) {
    return this.offers.updateResponsibility(user.id, offerId, brandId, dto.managerId ?? null);
  }

  @Get('creator/offers')
  @Roles(UserRole.CREATOR)
  listPublished() {
    return this.offers.listPublished();
  }

  @Get('creator/offers/:id')
  @Roles(UserRole.CREATOR)
  getPublished(@Param('id', ParseUUIDPipe) offerId: string) {
    return this.offers.getPublished(offerId);
  }
}
