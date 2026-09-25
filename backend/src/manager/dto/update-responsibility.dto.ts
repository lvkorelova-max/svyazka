import { IsOptional, IsUUID } from 'class-validator';

export class UpdateResponsibilityDto {
  @IsOptional()
  @IsUUID()
  managerId?: string;
}
