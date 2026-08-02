import { IsOptional, IsUUID } from 'class-validator';

export class ListRelationshipsQueryDto {
  @IsOptional()
  @IsUUID()
  offerId?: string;
}
