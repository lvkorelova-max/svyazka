import { PromotionWithoutProduct } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOfferDto {
  @IsString()
  @Length(3, 200)
  title: string;

  @IsString()
  @Length(10, 10000)
  description: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  productUrl?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  productPriceKopecks: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  creatorCommissionBps: number;

  @IsEnum(PromotionWithoutProduct)
  promotionWithoutProduct: PromotionWithoutProduct;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  imageUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  productRequirementSales?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  allowedPromotionFormats?: string[];
}
