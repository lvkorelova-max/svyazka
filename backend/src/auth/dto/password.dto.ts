import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @Length(40, 200)
  token!: string;

  @IsString()
  @Length(12, 128)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(12, 128)
  currentPassword!: string;

  @IsString()
  @Length(12, 128)
  newPassword!: string;
}

export class BlockUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
