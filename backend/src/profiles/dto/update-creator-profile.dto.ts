import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class SocialLinksDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  primary?: string;
}

export class UpdateCreatorProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;
}
