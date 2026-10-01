import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import { AdminSecurityGuard } from "../common/guards/admin-security.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ActiveBrandId } from "../brand-access/brand-context";
import { BrandContextGuard } from "../brand-access/brand-context.guard";
import { AttributionService } from "./attribution.service";
import { CreateTrackerInstallationDto } from "./dto/create-tracker-installation.dto";
import { CreateTildaIntegrationDto } from "./dto/create-tilda-integration.dto";
import { IngestOrderEventDto } from "./dto/order-event.dto";
import { ResolveAttributionExceptionDto } from "./dto/resolve-attribution-exception.dto";
import { TrackingEventDto } from "./dto/tracking-event.dto";
import { TildaIntegrationService } from "./tilda-integration.service";

type RawRequest = Request & { rawBody?: Buffer };

@Controller("track")
export class TrackerPublicController {
  constructor(private readonly attribution: AttributionService) {}

  @Get("v1.js")
  script(@Res() response: Response) {
    response
      .status(200)
      .type("application/javascript")
      .setHeader(
        "cache-control",
        "public, max-age=300, stale-while-revalidate=3600",
      )
      .send(this.attribution.trackerScript());
  }

  @Post("v1/events")
  @RateLimit({ scope: "stage8-tracker", limit: 240, windowSeconds: 60 })
  collect(@Body() dto: TrackingEventDto, @Headers("origin") origin?: string) {
    return this.attribution.collectTrackingEvent(dto, origin);
  }
}

@Controller("v1/integrations")
export class IntegrationOrderController {
  constructor(
    private readonly attribution: AttributionService,
    private readonly tilda: TildaIntegrationService,
  ) {}

  @Post("order-events")
  @RateLimit({ scope: "stage8-order-events", limit: 600, windowSeconds: 60 })
  ingest(
    @Req() request: RawRequest,
    @Body() dto: IngestOrderEventDto,
    @Headers("svyazka-installation") installationId = "",
    @Headers("svyazka-key-id") keyId = "",
    @Headers("svyazka-event-id") eventId = "",
    @Headers("svyazka-timestamp") timestamp = "",
    @Headers("svyazka-signature") signature = "",
  ) {
    return this.attribution.ingestSignedOrderEvent({
      installationId,
      keyId,
      eventId,
      timestamp,
      signature,
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(request.body)),
      dto,
    });
  }

  @Post("tilda/:id/orders")
  @HttpCode(200)
  @RateLimit({ scope: "stage8-tilda-orders", limit: 240, windowSeconds: 60 })
  receiveTildaOrder(
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("x-svyazka-tilda-key") webhookKey = "",
    @Query("key") urlKey = "",
    @Body() payload: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.tilda
      .receiveWebhook(id, webhookKey || urlKey, payload)
      .then((result) => {
        if (String(payload.test ?? "").toLowerCase() === "test") {
          response.status(200);
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.send("ok");
          return undefined;
        }
        return result;
      });
  }

  @Post("tilda/:id/cloudpayments/refunds")
  @HttpCode(200)
  @RateLimit({
    scope: "stage8-cloudpayments-refunds",
    limit: 240,
    windowSeconds: 60,
  })
  receiveCloudPaymentsRefund(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: RawRequest,
    @Headers("content-hmac") contentHmac = "",
    @Headers("x-content-hmac") decodedContentHmac = "",
    @Body() payload: Record<string, unknown>,
  ) {
    return this.tilda.receiveCloudPaymentsRefund(id, {
      contentHmac,
      decodedContentHmac,
      rawBody:
        request.rawBody ??
        Buffer.from(
          new URLSearchParams(
            Object.entries(payload).map(([key, value]) => [
              key,
              String(value ?? ""),
            ]),
          ).toString(),
        ),
      payload,
    });
  }
}

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
export class AttributionDashboardController {
  constructor(
    private readonly attribution: AttributionService,
    private readonly tilda: TildaIntegrationService,
  ) {}

  @Post("brand/tilda-integration")
  @Roles(UserRole.BRAND)
  createTildaIntegration(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTildaIntegrationDto,
  ) {
    return this.tilda.createOrReplace(user.id, dto);
  }

  @Get("brand/tilda-integration")
  @Roles(UserRole.BRAND)
  getTildaIntegration(@CurrentUser() user: AuthenticatedUser) {
    return this.tilda.getForBrand(user.id);
  }

  @Post("brand/tilda-integration/check")
  @Roles(UserRole.BRAND)
  checkTildaIntegration(@CurrentUser() user: AuthenticatedUser) {
    return this.tilda.checkConnection(user.id);
  }

  @Post("brand/tracker-installations")
  @Roles(UserRole.BRAND)
  createInstallation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTrackerInstallationDto,
  ) {
    return this.attribution.createInstallation(user.id, dto);
  }

  @Get("brand/tracker-installations")
  @Roles(UserRole.BRAND)
  listInstallations(@CurrentUser() user: AuthenticatedUser) {
    return this.attribution.listInstallations(user.id);
  }

  @Post("brand/tracker-installations/:id/activate")
  @Roles(UserRole.BRAND)
  activateInstallation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.attribution.activateInstallation(user.id, id);
  }

  @Post("brand/tracker-installations/:id/rotate-secret")
  @Roles(UserRole.BRAND)
  rotateInstallationSecret(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.attribution.rotateInstallationSecret(user.id, id);
  }

  @Get("brand/sales/overview")
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  @UseGuards(BrandContextGuard)
  brandSalesOverview(
    @CurrentUser() user: AuthenticatedUser,
    @ActiveBrandId() activeBrandId?: string,
  ) {
    return this.attribution.brandSalesOverview(user.id, activeBrandId);
  }

  @Get("brand/attribution-exceptions")
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  @UseGuards(BrandContextGuard)
  listBrandExceptions(
    @CurrentUser() user: AuthenticatedUser,
    @ActiveBrandId() activeBrandId?: string,
  ) {
    return this.attribution.listBrandExceptions(user.id, activeBrandId);
  }

  @Post("brand/attribution-exceptions/:id/resolve")
  @Roles(UserRole.BRAND)
  resolveBrandException(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveAttributionExceptionDto,
  ) {
    return this.attribution.resolveException(
      { id: user.id, role: UserRole.BRAND },
      id,
      dto,
    );
  }

  @Get("creator/performance/overview")
  @Roles(UserRole.CREATOR)
  creatorPerformanceOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.attribution.creatorPerformanceOverview(user.id);
  }

  @Get("brand/orders/:id/timeline")
  @Roles(UserRole.BRAND, UserRole.MANAGER)
  @UseGuards(BrandContextGuard)
  brandOrderTimeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @ActiveBrandId() activeBrandId?: string,
  ) {
    return this.attribution.orderTimeline(
      { id: user.id, role: user.role },
      id,
      activeBrandId,
    );
  }

  @Get("creator/orders/:id/timeline")
  @Roles(UserRole.CREATOR)
  creatorOrderTimeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.attribution.orderTimeline(
      { id: user.id, role: UserRole.CREATOR },
      id,
    );
  }

  @Get("admin/attribution/exceptions")
  @Roles(UserRole.ADMIN)
  listAdminExceptions() {
    return this.attribution.listAdminExceptions();
  }

  @Get("admin/attribution/readiness")
  @Roles(UserRole.ADMIN)
  adminOperationalStatus() {
    return this.attribution.adminOperationalStatus();
  }

  @Post("admin/attribution/exceptions/:id/resolve")
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  resolveAdminException(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveAttributionExceptionDto,
  ) {
    return this.attribution.resolveException(
      { id: user.id, role: UserRole.ADMIN },
      id,
      dto,
    );
  }
}
