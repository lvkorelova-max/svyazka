import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class IssueBrandStatementDto {
  @IsUUID()
  brandId: string;

  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  @IsDateString()
  dueAt: string;

  @IsString()
  @Length(3, 3)
  currency: string;
}

export class BrandPaymentAllocationDto {
  @IsUUID()
  statementId: string;

  @IsString()
  @Length(1, 40)
  amountMinor: string;
}

export class RecordBrandPaymentDto {
  @IsUUID()
  brandId: string;

  @IsString()
  @Length(3, 3)
  currency: string;

  @IsString()
  @Length(1, 40)
  amountMinor: string;

  @IsDateString()
  paidAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BrandPaymentAllocationDto)
  allocations: BrandPaymentAllocationDto[];
}

export class OpenFinancialDisputeDto {
  @IsUUID()
  orderId: string;

  @IsString()
  @Length(5, 1000)
  reason: string;
}

export class ResolveFinancialDisputeDto {
  @IsString()
  @Length(5, 1000)
  resolution: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  adjustmentMinor?: number;
}
