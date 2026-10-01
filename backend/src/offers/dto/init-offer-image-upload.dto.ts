import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class InitOfferImageUploadDto {
  @IsString()
  @MaxLength(255)
  originalFileName: string;

  @IsString()
  @MaxLength(120)
  mimeType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26_214_400)
  byteSize: number;
}
