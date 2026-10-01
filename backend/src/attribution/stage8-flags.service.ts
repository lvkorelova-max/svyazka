import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class Stage8FlagsService {
  constructor(private readonly config: ConfigService) {}

  trackerEnabled() {
    return this.enabled("STAGE8_TRACKER_ENABLED");
  }

  tildaEnabled() {
    return this.enabled("STAGE8_TILDA_ENABLED");
  }

  ingestionEnabled() {
    return this.enabled("STAGE8_ORDER_INGESTION_ENABLED");
  }

  shadowEnabled() {
    return this.enabled("STAGE8_ATTRIBUTION_SHADOW_ENABLED");
  }

  autoAttributionEnabled() {
    return this.enabled("STAGE8_AUTO_ATTRIBUTION_ENABLED");
  }

  financeHandoffEnabled() {
    return this.enabled("STAGE8_FINANCE_HANDOFF_ENABLED");
  }

  private enabled(key: string) {
    return this.config.get<string>(key) === "true";
  }
}
