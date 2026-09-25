import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateManagerProfileDto {
  @IsString()
  @Length(2, 160)
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  jobTitle?: string;
}
