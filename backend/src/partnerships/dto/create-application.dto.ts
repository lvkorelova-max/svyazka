import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
