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

export class CreatorKitScenarioDto {
  @IsEnum(CreatorKitScenarioChannel)
  channel: CreatorKitScenarioChannel;

  @IsString()
  @Length(3, 200)
  title: string;

  @IsString()
  @Length(10, 5000)
  idea: string;

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

export class CreatorKitFactDto {
  @IsEnum(CreatorKitFactType)
  type: CreatorKitFactType;

  @IsString()
  @Length(1, 10000)
  value: string;

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

  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder: number;
}

export class CreatorKitRuleDto {
  @IsString()
  @Length(1, 2000)
  value: string;

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
}

export class UpsertCreatorKitDto {
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

export class PublishCreatorKitDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  publisherNote?: string;
}
