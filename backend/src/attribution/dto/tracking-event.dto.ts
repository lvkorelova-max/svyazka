import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";

export class TrackingEventDto {
  @IsString()
  @Length(12, 80)
  installationKey!: string;

  @IsString()
  @Length(8, 160)
  eventId!: string;

  @IsIn(["CLICK", "SESSION_STARTED", "SESSION_REFRESHED"])
  eventType!: string;

  @IsDateString()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  @Length(8, 96)
  attributionId?: string;

  @IsOptional()
  @IsString()
  @Length(8, 80)
  creatorLinkCode?: string;

  @IsOptional()
  @Matches(/^[A-Z0-9_-]{1,80}$/i)
  promoCode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  consentState?: string;
}
