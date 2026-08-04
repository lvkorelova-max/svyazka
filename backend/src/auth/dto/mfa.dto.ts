import { IsString, Length } from 'class-validator';

export class BeginMfaEnrollmentDto {
  @IsString()
  @Length(12, 128)
  currentPassword!: string;
}

export class ConfirmMfaEnrollmentDto {
  @IsString()
  @Length(6, 8)
  code!: string;
}

export class VerifyMfaLoginDto {
  @IsString()
  @Length(20, 4000)
  challengeToken!: string;

  @IsString()
  @Length(6, 32)
  code!: string;
}
