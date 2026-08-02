import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePayoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  commissionIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;
}
