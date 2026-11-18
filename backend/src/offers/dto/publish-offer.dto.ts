import { IsBoolean, IsOptional, Matches } from 'class-validator';

export class PublishOfferDto {
  @IsOptional()
  @IsBoolean()
  accepted?: boolean;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  reviewHash?: string;
}
