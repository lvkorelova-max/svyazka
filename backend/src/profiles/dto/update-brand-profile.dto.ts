import { IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class UpdateBrandProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  brandName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  legalName?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  logoUrl?: string;
}
