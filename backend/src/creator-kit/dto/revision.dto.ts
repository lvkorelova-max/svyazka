import { CreatorKitAccessLevel } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class PublishCreatorKitDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  publisherNote?: string;
}

export class RestoreCreatorKitDto {
  @IsUUID()
  expectedActiveRevisionId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  publisherNote?: string;
}

export class PreviewAsCreatorDto {
  @IsIn(['DRAFT', 'PUBLISHED'])
  source: 'DRAFT' | 'PUBLISHED';

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsIn(['ACTUAL', 'GRANTED', 'NOT_GRANTED'])
  productAccess: 'ACTUAL' | 'GRANTED' | 'NOT_GRANTED';

  @IsIn(['ACTUAL', 'ACTIVE', 'INACTIVE'])
  affiliateApproval: 'ACTUAL' | 'ACTIVE' | 'INACTIVE';
}

export class ProductAccessDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReorderScenariosDto {
  @IsUUID('4', { each: true })
  scenarioIds: string[];
}

export class CreatorKitPreviewQueryDto {
  @IsEnum(CreatorKitAccessLevel)
  accessLevel: CreatorKitAccessLevel;

  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED'])
  source?: 'DRAFT' | 'PUBLISHED';

  @IsOptional()
  @IsBoolean()
  affiliateApproved?: boolean;
}
