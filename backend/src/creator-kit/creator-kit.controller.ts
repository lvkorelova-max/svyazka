import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
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
import { AdminSecurityGuard } from '../common/guards/admin-security.guard';
import { CreatorKitService } from './creator-kit.service';
import { InitCreatorKitUploadDto } from './dto/init-upload.dto';
import {
  PreviewAsCreatorDto,
  ProductAccessDto,
  PublishCreatorKitDto,
  ReorderScenariosDto,
  RestoreCreatorKitDto,
} from './dto/revision.dto';
import {
  CreatorKitScenarioDto,
  UpdateCreatorKitScenarioDto,
  UpsertCreatorKitDto,
} from './dto/upsert-creator-kit.dto';

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
    @Query('source') source?: 'DRAFT' | 'PUBLISHED',
    @Query('affiliateApproved') affiliateApproved?: string,
  ) {
    return this.creatorKit.getBrandPreview(
      user.id,
      offerId,
      accessLevel,
      source === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
      affiliateApproved !== 'false',
    );
  }

  @Post('brand/offers/:offerId/creator-kit/preview-as-creator')
  @Roles(UserRole.BRAND)
  previewAsCreator(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: PreviewAsCreatorDto,
  ) {
    return this.creatorKit.previewAsCreator(user.id, offerId, dto);
  }

  @Post('brand/offers/:offerId/creator-kit/publish')
  @Roles(UserRole.BRAND)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: PublishCreatorKitDto,
  ) {
    return this.creatorKit.publish(user.id, offerId, dto);
  }

  @Get('brand/offers/:offerId/creator-kit/revisions')
  @Roles(UserRole.BRAND)
  revisions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.creatorKit.getRevisions(user.id, offerId);
  }

  @Post('brand/offers/:offerId/creator-kit/revisions/:revisionId/create-draft')
  @Roles(UserRole.BRAND)
  createDraftFromRevision(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
  ) {
    return this.creatorKit.createDraftFromRevision(user.id, offerId, revisionId);
  }

  @Get('brand/offers/:offerId/creator-kit/revisions/:revisionId/restore-preview')
  @Roles(UserRole.BRAND)
  restorePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
  ) {
    return this.creatorKit.restorePreview(user.id, offerId, revisionId);
  }

  @Post('brand/offers/:offerId/creator-kit/revisions/:revisionId/restore')
  @Roles(UserRole.BRAND)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Body() dto: RestoreCreatorKitDto,
  ) {
    return this.creatorKit.restore(user.id, offerId, revisionId, dto);
  }

  @Delete('brand/offers/:offerId/creator-kit/draft')
  @Roles(UserRole.BRAND)
  discardDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.creatorKit.discardDraft(user.id, offerId);
  }

  @Post('brand/offers/:offerId/creator-kit/scenarios')
  @Roles(UserRole.BRAND)
  createScenario(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: CreatorKitScenarioDto,
  ) {
    return this.creatorKit.createScenario(user.id, offerId, dto);
  }

  @Put('brand/offers/:offerId/creator-kit/scenarios/reorder')
  @Roles(UserRole.BRAND)
  reorderScenarios(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: ReorderScenariosDto,
  ) {
    return this.creatorKit.reorderScenarios(user.id, offerId, dto.scenarioIds);
  }

  @Patch('brand/offers/:offerId/creator-kit/scenarios/:scenarioId')
  @Roles(UserRole.BRAND)
  updateScenario(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Body() dto: UpdateCreatorKitScenarioDto,
  ) {
    return this.creatorKit.updateScenario(user.id, offerId, scenarioId, dto);
  }

  @Delete('brand/offers/:offerId/creator-kit/scenarios/:scenarioId')
  @Roles(UserRole.BRAND)
  deleteScenario(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
  ) {
    return this.creatorKit.deleteScenario(user.id, offerId, scenarioId);
  }

  @Get('brand/offers/:offerId/product-access')
  @Roles(UserRole.BRAND)
  listBrandProductAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.creatorKit.listProductAccess(user, offerId);
  }

  @Post('brand/offers/:offerId/product-access/:creatorId/grant')
  @Roles(UserRole.BRAND)
  grantBrandProductAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('creatorId', ParseUUIDPipe) creatorId: string,
    @Body() dto: ProductAccessDto,
  ) {
    return this.creatorKit.grantProductAccess(user, offerId, creatorId, dto);
  }

  @Post('brand/offers/:offerId/product-access/:creatorId/revoke')
  @Roles(UserRole.BRAND)
  revokeBrandProductAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('creatorId', ParseUUIDPipe) creatorId: string,
    @Body() dto: ProductAccessDto,
  ) {
    return this.creatorKit.revokeProductAccess(user, offerId, creatorId, dto);
  }

  @Post('admin/offers/:offerId/product-access/:creatorId/grant')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  grantAdminProductAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('creatorId', ParseUUIDPipe) creatorId: string,
    @Body() dto: ProductAccessDto,
  ) {
    return this.creatorKit.grantProductAccess(user, offerId, creatorId, dto);
  }

  @Post('admin/offers/:offerId/product-access/:creatorId/revoke')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  revokeAdminProductAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Param('creatorId', ParseUUIDPipe) creatorId: string,
    @Body() dto: ProductAccessDto,
  ) {
    return this.creatorKit.revokeProductAccess(user, offerId, creatorId, dto);
  }

  @Post('brand/offers/:offerId/creator-kit/assets/uploads')
  @Roles(UserRole.BRAND)
  @RateLimit({ scope: 'creator-kit-upload', limit: 60, windowSeconds: 3600 })
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
