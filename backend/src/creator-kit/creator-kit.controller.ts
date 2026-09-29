import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CreatorKitAccessLevel, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { BrandContextGuard } from '../brand-access/brand-context.guard';
import { ActiveBrandId } from '../brand-access/brand-context';
import { CreatorKitService } from './creator-kit.service';
import { InitCreatorKitUploadDto } from './dto/init-upload.dto';
import { PublishCreatorKitDto, UpsertCreatorKitDto } from './dto/upsert-creator-kit.dto';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard, BrandContextGuard)
export class CreatorKitController {
  constructor(private readonly creatorKit: CreatorKitService) {}

  @Get('brand/offers/:offerId/creator-kit')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  getBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.getBrandKit(user.id, offerId, brandId);
  }

  @Put('brand/offers/:offerId/creator-kit')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  updateBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpsertCreatorKitDto,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.updateBrandKit(user.id, offerId, dto, brandId);
  }

  @Post('brand/offers/:offerId/creator-kit/publish')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: PublishCreatorKitDto,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.publish(user.id, offerId, dto, brandId);
  }

  @Get('brand/offers/:offerId/creator-kit/preview')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Query('accessLevel', new ParseEnumPipe(CreatorKitAccessLevel))
    accessLevel: CreatorKitAccessLevel,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.getBrandPreview(user.id, offerId, accessLevel, brandId);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/uploads')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  @RateLimit({ scope: 'creator-kit-upload', limit: 60, windowSeconds: 3600 })
  initUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: InitCreatorKitUploadDto,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.initUpload(user.id, offerId, dto, brandId);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/:assetId/complete')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.completeUpload(user.id, offerId, assetId, brandId);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/:assetId/disable')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  disable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.disableAsset(user.id, offerId, assetId, brandId);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/:assetId/enable')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  enable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.enableAsset(user.id, offerId, assetId, brandId);
  }

  @Get('brand/offers/:offerId/creator-kit/assets/:assetId/download')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  brandDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.creatorKit.brandDownload(user.id, offerId, assetId, brandId);
  }

  @Get('creator/offers/:offerId/creator-kit')
  @Roles(UserRole.CREATOR)
  getCreator(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.creatorKit.getCreatorKit(user.id, offerId);
  }

  @Get('creator/offers/:offerId/creator-kit/assets/:assetId/download')
  @Roles(UserRole.CREATOR)
  creatorDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.creatorKit.creatorDownload(user.id, offerId, assetId);
  }
}
