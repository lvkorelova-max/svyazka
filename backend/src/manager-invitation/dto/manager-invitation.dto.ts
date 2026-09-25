import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateManagerInvitationDto {
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsString()
  @Length(2, 160)
  displayName: string;
}

export class AcceptNewManagerInvitationDto {
  @IsString()
  @Length(10, 128)
  @Matches(/[a-zа-яё]/i, { message: 'Пароль должен содержать букву' })
  @Matches(/\d/, { message: 'Пароль должен содержать цифру' })
  password: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  displayName?: string;
}
