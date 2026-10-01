import { IsString, Length, Matches } from 'class-validator';

export class ReplacePromoCodeDto {
  @IsString()
  @Length(4, 40)
  @Matches(/^[\p{L}\p{N}\s]+$/u)
  code: string;
}
