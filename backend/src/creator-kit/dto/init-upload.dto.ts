import { CreatorKitAccessLevel, CreatorKitAssetType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InitCreatorKitUploadDto {
  @IsString()
  @Length(2, 200)
  title: string;

  @IsEnum(CreatorKitAssetType)
  assetType: CreatorKitAssetType;

  @IsEnum(CreatorKitAccessLevel)
  accessLevel: CreatorKitAccessLevel;

  @IsString()
  @Length(1, 255)
  originalFileName: string;

  @IsString()
  @MaxLength(120)
  mimeType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(524_288_000)
  byteSize: number;

  @IsBoolean()
  editable: boolean;

  @IsBoolean()
  textAllowed: boolean;

  @IsBoolean()
  paidAdsAllowed: boolean;

  @IsBoolean()
  approvalRequired: boolean;

  @IsOptional()
  @IsBoolean()
  requiresAffiliateApproval?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
