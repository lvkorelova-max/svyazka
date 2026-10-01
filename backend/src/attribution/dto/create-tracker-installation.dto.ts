import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  IsUrl,
  Length,
  Matches,
} from "class-validator";

export class CreateTrackerInstallationDto {
  @IsString()
  @Length(2, 160)
  name!: string;

  @IsString()
  @Matches(
    /^(?=.{1,255}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
  )
  primaryDomain!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl(
    { protocols: ["https"], require_protocol: true, require_tld: false },
    { each: true },
  )
  allowedOrigins!: string[];

  @IsIn(["REQUIRED", "ASSUMED_BY_BRAND", "SESSION_ONLY"])
  consentMode!: string;
}
