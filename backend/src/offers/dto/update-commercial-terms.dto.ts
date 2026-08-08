import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class UpdateCommercialTermsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  totalCommissionPoolBps: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsObject()
  attributionPolicy?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  attributionWindow?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  commissionEligibility?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  confirmationPolicy?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  returnPolicy?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  cancellationPolicy?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  payoutPolicy?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  payoutSchedule?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  settlementModel?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  minimumPayoutMinor?: number;
}
