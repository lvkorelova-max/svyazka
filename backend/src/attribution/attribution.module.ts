import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BrandAccessModule } from "../brand-access/brand-access.module";
import { FinanceCoreModule } from "../finance/finance-core.module";
import {
  AttributionDashboardController,
  IntegrationOrderController,
  TrackerPublicController,
} from "./attribution.controller";
import { AttributionService } from "./attribution.service";
import { CloudPaymentsClient } from "./cloudpayments-client.service";
import { IntegrationSecretService } from "./integration-secret.service";
import { Stage8FlagsService } from "./stage8-flags.service";
import { Stage8WorkerService } from "./stage8-worker.service";
import { TildaIntegrationService } from "./tilda-integration.service";

@Module({
  imports: [AuthModule, BrandAccessModule, FinanceCoreModule],
  controllers: [
    TrackerPublicController,
    IntegrationOrderController,
    AttributionDashboardController,
  ],
  providers: [
    AttributionService,
    CloudPaymentsClient,
    IntegrationSecretService,
    Stage8FlagsService,
    Stage8WorkerService,
    TildaIntegrationService,
  ],
  exports: [AttributionService, Stage8FlagsService],
})
export class AttributionModule {}
