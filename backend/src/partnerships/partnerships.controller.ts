import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { BrandContextGuard } from '../brand-access/brand-context.guard';
import { ActiveBrandId } from '../brand-access/brand-context';
import { UpdateResponsibilityDto } from '../manager/dto/update-responsibility.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import {
  AcceptApplicationTermsDto,
  ApproveApplicationDto,
} from './dto/application-terms.dto';
import { ListRelationshipsQueryDto } from './dto/list-relationships-query.dto';
import { ReplacePromoCodeDto } from './dto/replace-promo-code.dto';
import { PartnershipsService } from './partnerships.service';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard, BrandContextGuard)
export class PartnershipsController {
  constructor(private readonly partnerships: PartnershipsService) {}

  @Post('creator/offers/:offerId/applications')
  @Roles(UserRole.CREATOR)
  createApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: CreateApplicationDto,
  ) {
    return this.partnerships.createApplication(user.id, offerId, dto);
  }

  @Get('creator/applications')
  @Roles(UserRole.CREATOR)
  listCreatorApplications(@CurrentUser() user: AuthenticatedUser) {
    return this.partnerships.listCreatorApplications(user.id);
  }

  @Get('creator/applications/:id')
  @Roles(UserRole.CREATOR)
  getCreatorApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
  ) {
    return this.partnerships.getCreatorApplication(user.id, applicationId);
  }

  @Post('creator/applications/:id/cancel')
  @Roles(UserRole.CREATOR)
  cancelApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
  ) {
    return this.partnerships.cancelApplication(user.id, applicationId);
  }

  @Get('creator/applications/:id/terms')
  @Roles(UserRole.CREATOR)
  getApplicationTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
  ) {
    return this.partnerships.getApplicationTerms(user.id, applicationId);
  }

  @Post('creator/applications/:id/accept-terms')
  @Roles(UserRole.CREATOR)
  acceptApplicationTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
    @Body() dto: AcceptApplicationTermsDto,
  ) {
    return this.partnerships.acceptApplicationTerms(user.id, applicationId, dto);
  }

  @Post('creator/applications/:id/withdraw')
  @Roles(UserRole.CREATOR)
  withdrawApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
  ) {
    return this.partnerships.withdrawApplication(user.id, applicationId);
  }

  @Get('creator/affiliate-relationships')
  @Roles(UserRole.CREATOR)
  listCreatorRelationships(@CurrentUser() user: AuthenticatedUser) {
    return this.partnerships.listCreatorRelationships(user.id);
  }

  @Get('creator/affiliate-relationships/:id')
  @Roles(UserRole.CREATOR)
  getCreatorRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
  ) {
    return this.partnerships.getCreatorRelationship(user.id, relationshipId);
  }

  @Get('brand/offers/:offerId/applications')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  listOfferApplications(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.partnerships.listBrandApplications(user.id, offerId, brandId);
  }

  @Get('brand/applications/:id')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  getBrandApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.partnerships.getBrandApplication(user.id, applicationId, brandId);
  }

  @Post('brand/applications/:id/approve')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  approveApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
    @ActiveBrandId() brandId: string,
    @Body() dto: ApproveApplicationDto,
  ) {
    return this.partnerships.approveApplication(user.id, applicationId, brandId, dto);
  }

  @Post('brand/applications/:id/reject')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  rejectApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.partnerships.rejectApplication(user.id, applicationId, brandId);
  }

  @Get('brand/affiliate-relationships')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  listBrandRelationships(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRelationshipsQueryDto,
    @ActiveBrandId() brandId: string,
  ) {
    return this.partnerships.listBrandRelationships(user.id, query.offerId, brandId);
  }

  @Post('brand/affiliate-relationships/:id/pause')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  pauseRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.partnerships.transitionRelationship(user.id, relationshipId, 'PAUSED', brandId);
  }

  @Post('brand/affiliate-relationships/:id/activate')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  activateRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.partnerships.transitionRelationship(user.id, relationshipId, 'ACTIVE', brandId);
  }

  @Post('brand/affiliate-relationships/:id/revoke')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  revokeRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.partnerships.transitionRelationship(user.id, relationshipId, 'REVOKED', brandId);
  }

  @Patch('brand/affiliate-relationships/:id/responsibility')
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  updateResponsibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
    @ActiveBrandId() brandId: string,
    @Body() dto: UpdateResponsibilityDto,
  ) {
    return this.partnerships.updateResponsibility(
      user.id,
      relationshipId,
      brandId,
      dto.managerId ?? null,
    );
  }

  @Patch('brand/affiliate-relationships/:id/promo-code')
  @Roles(UserRole.BRAND)
  replacePromoCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
    @ActiveBrandId() brandId: string,
    @Body() dto: ReplacePromoCodeDto,
  ) {
    return this.partnerships.replacePromoCode(user.id, relationshipId, dto, brandId);
  }

  @Post('brand/affiliate-relationships/:id/promo-code/confirm-tilda')
  @Roles(UserRole.BRAND)
  confirmPromoCodeProvisioned(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
    @ActiveBrandId() brandId: string,
  ) {
    return this.partnerships.confirmPromoCodeProvisioned(user.id, relationshipId, brandId);
  }
}

@Controller('go')
export class RedirectController {
  constructor(private readonly partnerships: PartnershipsService) {}

  @Get(':affiliateCode')
  @RateLimit({ scope: 'affiliate-redirect', limit: 120, windowSeconds: 60 })
  async redirect(
    @Param('affiliateCode') affiliateCode: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const destination = await this.partnerships.resolveRedirect(affiliateCode, {
      ip: request.ip,
      referrer: request.get('referer'),
      userAgent: request.get('user-agent'),
    });
    return response.redirect(302, destination);
  }
}
