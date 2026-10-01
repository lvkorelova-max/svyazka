import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum CommissionScopeDto {
  WHOLE_STORE = 'WHOLE_STORE',
  SELECTED_PRODUCTS = 'SELECTED_PRODUCTS',
}

export class CommissionEligibilityDto {
  @IsEnum(CommissionScopeDto)
  scope: CommissionScopeDto;

  @ValidateIf(
    (value: CommissionEligibilityDto) =>
      value.scope === CommissionScopeDto.SELECTED_PRODUCTS,
  )
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  externalProductIds?: string[];
}

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
  @ValidateNested()
  @Type(() => CommissionEligibilityDto)
  commissionEligibility?: CommissionEligibilityDto;

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
