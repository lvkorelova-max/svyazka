import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AttributionService } from "./attribution.service";
import { Stage8FlagsService } from "./stage8-flags.service";
import { TildaIntegrationService } from "./tilda-integration.service";

@Injectable()
export class Stage8WorkerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly attribution: AttributionService,
    private readonly flags: Stage8FlagsService,
    private readonly tilda: TildaIntegrationService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      if (!this.flags.ingestionEnabled()) return;
      void this.attribution.processRetryableOrderEvents();
      void this.attribution.processPendingOutbox();
      void this.attribution.escalateDueExceptions();
      void this.tilda.processPendingPayments();
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
