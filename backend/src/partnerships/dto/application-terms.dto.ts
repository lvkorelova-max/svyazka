import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class AcceptApplicationTermsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedCommercialTermsVersion: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedApplicationVersion?: number;
}

export class ApproveApplicationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedAcceptedTermsVersion?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedApplicationVersion?: number;
}
