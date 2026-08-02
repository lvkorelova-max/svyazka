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
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreatorKitService } from './creator-kit.service';
import { InitCreatorKitUploadDto } from './dto/init-upload.dto';
import { UpsertCreatorKitDto } from './dto/upsert-creator-kit.dto';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
export class CreatorKitController {
  constructor(private readonly creatorKit: CreatorKitService) {}

  @Get('brand/offers/:offerId/creator-kit')
  @Roles(UserRole.BRAND)
  getBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.creatorKit.getBrandKit(user.id, offerId);
  }

  @Put('brand/offers/:offerId/creator-kit')
  @Roles(UserRole.BRAND)
  updateBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpsertCreatorKitDto,
  ) {
    return this.creatorKit.updateBrandKit(user.id, offerId, dto);
  }

  @Get('brand/offers/:offerId/creator-kit/preview')
  @Roles(UserRole.BRAND)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Query('accessLevel', new ParseEnumPipe(CreatorKitAccessLevel))
    accessLevel: CreatorKitAccessLevel,
  ) {
    return this.creatorKit.getBrandPreview(user.id, offerId, accessLevel);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/uploads')
  @Roles(UserRole.BRAND)
  initUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: InitCreatorKitUploadDto,
  ) {
    return this.creatorKit.initUpload(user.id, offerId, dto);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/:assetId/complete')
  @Roles(UserRole.BRAND)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.creatorKit.completeUpload(user.id, offerId, assetId);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/:assetId/disable')
  @Roles(UserRole.BRAND)
  disable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.creatorKit.disableAsset(user.id, offerId, assetId);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/:assetId/enable')
  @Roles(UserRole.BRAND)
  enable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.creatorKit.enableAsset(user.id, offerId, assetId);
  }

  @Get('brand/offers/:offerId/creator-kit/assets/:assetId/download')
  @Roles(UserRole.BRAND)
  brandDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.creatorKit.brandDownload(user.id, offerId, assetId);
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
