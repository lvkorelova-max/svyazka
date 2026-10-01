import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedCommercialTermsVersion?: number;
}
