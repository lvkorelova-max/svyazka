import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { OfferStatus, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateOfferDto } from './dto/create-offer.dto';
import { InitOfferImageUploadDto } from './dto/init-offer-image-upload.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { UpdateCommercialTermsDto } from './dto/update-commercial-terms.dto';
import { OffersService } from './offers.service';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post('brand/offers')
  @Roles(UserRole.BRAND)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOfferDto) {
    return this.offers.create(user.id, dto);
  }

  @Get('brand/offers')
  @Roles(UserRole.BRAND)
  listOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.listOwn(user.id);
  }

  @Get('brand/offers/:id')
  @Roles(UserRole.BRAND)
  getOwn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.getOwn(user.id, offerId);
  }

  @Patch('brand/offers/:id')
  @Roles(UserRole.BRAND)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offers.updateOwn(user.id, offerId, dto);
  }

  @Post('brand/offers/:id/commercial-terms')
  @Roles(UserRole.BRAND)
  updateCommercialTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateCommercialTermsDto,
  ) {
    return this.offers.updateCommercialTerms(user.id, offerId, dto);
  }

  @Post('brand/offers/:id/image/uploads')
  @Roles(UserRole.BRAND)
  @RateLimit({ scope: 'offer-image-upload', limit: 30, windowSeconds: 3600 })
  initImageUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @Body() dto: InitOfferImageUploadDto,
  ) {
    return this.offers.initImageUpload(user.id, offerId, dto);
  }

  @Post('brand/offers/:id/image/uploads/:uploadId/complete')
  @Roles(UserRole.BRAND)
  completeImageUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ) {
    return this.offers.completeImageUpload(user.id, offerId, uploadId);
  }

  @Post('brand/offers/:id/publish')
  @Roles(UserRole.BRAND)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.transition(user.id, offerId, OfferStatus.PUBLISHED);
  }

  @Post('brand/offers/:id/pause')
  @Roles(UserRole.BRAND)
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.transition(user.id, offerId, OfferStatus.PAUSED);
  }

  @Post('brand/offers/:id/archive')
  @Roles(UserRole.BRAND)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.transition(user.id, offerId, OfferStatus.ARCHIVED);
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
