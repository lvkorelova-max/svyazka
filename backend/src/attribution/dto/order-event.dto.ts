import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { Stage8OrderEventType } from "@prisma/client";

export class OrderLineDto {
  @IsString()
  @Length(1, 160)
  externalProductId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  category?: string;

  @Matches(/^[1-9]\d*$/)
  quantity!: string;

  @Matches(/^\d+$/)
  amountMinor!: string;
}

export class CanonicalOrderDto {
  @IsString()
  @Length(1, 160)
  externalOrderId!: string;

  @IsOptional()
  @IsDateString()
  createdAt?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  amountMinor?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  shippingAmountMinor?: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items?: OrderLineDto[];
}

export class OrderAttributionDto {
  @IsOptional()
  @IsString()
  @Length(8, 96)
  attributionId?: string;

  @IsOptional()
  @IsString()
  @Length(8, 96)
  clickId?: string;

  @IsOptional()
  @IsString()
  @Length(8, 80)
  creatorLinkCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  promoCode?: string;
}

export class IngestOrderEventDto {
  @Matches(/^1\.\d+$/)
  schemaVersion!: string;

  @IsEnum(Stage8OrderEventType)
  type!: Stage8OrderEventType;

  @IsDateString()
  occurredAt!: string;

  @ValidateNested()
  @Type(() => CanonicalOrderDto)
  order!: CanonicalOrderDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderAttributionDto)
  attribution?: OrderAttributionDto;

  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  refundAmountMinor?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
