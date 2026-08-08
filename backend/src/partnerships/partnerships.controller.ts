import {
  Body,
  Controller,
  Get,
  Param,
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
import { CreateApplicationDto } from './dto/create-application.dto';
import {
  AcceptApplicationTermsDto,
  ApproveApplicationDto,
} from './dto/application-terms.dto';
import { ListRelationshipsQueryDto } from './dto/list-relationships-query.dto';
import { PartnershipsService } from './partnerships.service';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
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
    return this.partnerships.acceptApplicationTerms(
      user.id,
      applicationId,
      dto,
    );
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
  @Roles(UserRole.BRAND)
  listOfferApplications(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.partnerships.listBrandApplications(user.id, offerId);
  }

  @Get('brand/applications/:id')
  @Roles(UserRole.BRAND)
  getBrandApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
  ) {
    return this.partnerships.getBrandApplication(user.id, applicationId);
  }

  @Post('brand/applications/:id/approve')
  @Roles(UserRole.BRAND)
  approveApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
    @Body() dto: ApproveApplicationDto,
  ) {
    return this.partnerships.approveApplication(user.id, applicationId, dto);
  }

  @Post('brand/applications/:id/reject')
  @Roles(UserRole.BRAND)
  rejectApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) applicationId: string,
  ) {
    return this.partnerships.rejectApplication(user.id, applicationId);
  }

  @Get('brand/affiliate-relationships')
  @Roles(UserRole.BRAND)
  listBrandRelationships(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRelationshipsQueryDto,
  ) {
    return this.partnerships.listBrandRelationships(user.id, query.offerId);
  }

  @Post('brand/affiliate-relationships/:id/pause')
  @Roles(UserRole.BRAND)
  pauseRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
  ) {
    return this.partnerships.transitionRelationship(user.id, relationshipId, 'PAUSED');
  }

  @Post('brand/affiliate-relationships/:id/activate')
  @Roles(UserRole.BRAND)
  activateRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
  ) {
    return this.partnerships.transitionRelationship(user.id, relationshipId, 'ACTIVE');
  }

  @Post('brand/affiliate-relationships/:id/revoke')
  @Roles(UserRole.BRAND)
  revokeRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) relationshipId: string,
  ) {
    return this.partnerships.transitionRelationship(user.id, relationshipId, 'REVOKED');
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
