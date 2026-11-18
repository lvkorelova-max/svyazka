import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export type RegistrationRole = 'BRAND' | 'CREATOR';

export class RegisterDto {
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsString()
  @Length(10, 128)
  @Matches(/[a-zа-яё]/i, { message: 'Пароль должен содержать букву' })
  @Matches(/\d/, { message: 'Пароль должен содержать цифру' })
  password: string;

  @IsIn(['BRAND', 'CREATOR'])
  role: RegistrationRole;

  @IsString()
  @Length(2, 160)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/)
  legalRevision?: string;

  @IsOptional()
  @IsBoolean()
  userAgreementAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  creatorTermsAccepted?: boolean;
}
