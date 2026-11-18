import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AttributionService } from "./attribution.service";
import { Stage8FlagsService } from "./stage8-flags.service";
import { TildaIntegrationService } from "./tilda-integration.service";

@Injectable()
export class Stage8WorkerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private retentionDueAt = 0;
  private retentionRunning = false;
  private readonly logger = new Logger(Stage8WorkerService.name);

  constructor(
    private readonly attribution: AttributionService,
    private readonly flags: Stage8FlagsService,
    private readonly tilda: TildaIntegrationService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.scheduleRetention();
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

  private scheduleRetention() {
    const mode = this.flags.retentionMode();
    if (mode === "off" || this.retentionRunning || Date.now() < this.retentionDueAt) return;
    this.retentionRunning = true;
    this.run("retention", async () => {
      try {
        const result = await this.attribution.runRetention(mode);
        this.logger.log({ task: "retention", ...result });
        this.retentionDueAt = Date.now() + 24 * 60 * 60 * 1000;
      } catch (error) {
        this.retentionDueAt = Date.now() + 60 * 60 * 1000;
        throw error;
      } finally {
        this.retentionRunning = false;
      }
    });
  }

  private run(task: string, action: () => Promise<unknown>) {
    void action().catch((error: unknown) => {
      this.logger.error({ task, error: error instanceof Error ? error.constructor.name : "ERROR" });
    });
  }
}
