import {
  CreatorKitAccessLevel,
  CreatorKitClaimType,
  CreatorKitFactType,
  CreatorKitScenarioChannel,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreatorKitScenarioDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  id?: string;

  @IsEnum(CreatorKitScenarioChannel)
  channel: CreatorKitScenarioChannel;

  @IsString()
  @Length(3, 200)
  title: string;

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  mainIdea?: string;

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  idea?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  hook?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  structure?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cta?: string;

  @IsEnum(CreatorKitAccessLevel)
  accessLevel: CreatorKitAccessLevel;

  @IsOptional()
  @IsBoolean()
  requiresAffiliateApproval?: boolean;

  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder: number;
}

export class UpdateCreatorKitScenarioDto extends PartialType(CreatorKitScenarioDto) {}

export class CreatorKitFactDto {
  @IsEnum(CreatorKitFactType)
  type: CreatorKitFactType;

  @IsString()
  @Length(1, 10000)
  value: string;

  @IsOptional()
  @IsEnum(CreatorKitAccessLevel)
  accessLevel?: CreatorKitAccessLevel;

  @IsOptional()
  @IsBoolean()
  requiresAffiliateApproval?: boolean;

  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder: number;
}

export class CreatorKitClaimDto {
  @IsEnum(CreatorKitClaimType)
  type: CreatorKitClaimType;

  @IsString()
  @Length(1, 2000)
  value: string;

  @IsOptional()
  @IsEnum(CreatorKitAccessLevel)
  accessLevel?: CreatorKitAccessLevel;

  @IsOptional()
  @IsBoolean()
  requiresAffiliateApproval?: boolean;

  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder: number;
}

export class CreatorKitRuleDto {
  @IsString()
  @Length(1, 2000)
  value: string;

  @IsOptional()
  @IsEnum(CreatorKitAccessLevel)
  accessLevel?: CreatorKitAccessLevel;

  @IsOptional()
  @IsBoolean()
  requiresAffiliateApproval?: boolean;

  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder: number;
}

export class PublicationRequirementsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  mandatoryMentions: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  advertisingLabel?: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  hashtags: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandMention?: string;

  @IsBoolean()
  approvalRequired: boolean;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  allowedPlatforms: string[];

  @IsOptional()
  @IsEnum(CreatorKitAccessLevel)
  accessLevel?: CreatorKitAccessLevel;

  @IsOptional()
  @IsBoolean()
  requiresAffiliateApproval?: boolean;
}

export class CreatorKitBrandContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  history?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  values: string[];

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  positioning?: string;

  @IsOptional()
  @IsEnum(CreatorKitAccessLevel)
  accessLevel?: CreatorKitAccessLevel;

  @IsOptional()
  @IsBoolean()
  requiresAffiliateApproval?: boolean;
}

export class CreatorKitProductContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  benefits: string[];

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  usageInstructions?: string;

  @IsOptional()
  @IsEnum(CreatorKitAccessLevel)
  accessLevel?: CreatorKitAccessLevel;

  @IsOptional()
  @IsBoolean()
  requiresAffiliateApproval?: boolean;
}

export class UpsertCreatorKitDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatorKitBrandContentDto)
  brandContent?: CreatorKitBrandContentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatorKitProductContentDto)
  productContent?: CreatorKitProductContentDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreatorKitScenarioDto)
  scenarios?: CreatorKitScenarioDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreatorKitFactDto)
  facts?: CreatorKitFactDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreatorKitClaimDto)
  claims?: CreatorKitClaimDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreatorKitRuleDto)
  rules?: CreatorKitRuleDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PublicationRequirementsDto)
  publicationRequirements?: PublicationRequirementsDto;
}
