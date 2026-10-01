import { IsString, IsUUID, Length } from "class-validator";

export class ResolveAttributionExceptionDto {
  @IsUUID()
  affiliateCommercialAgreementId!: string;

  @IsString()
  @Length(5, 1000)
  reason!: string;
}
