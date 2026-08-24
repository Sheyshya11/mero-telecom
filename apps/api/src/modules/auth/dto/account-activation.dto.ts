import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class VerifyAccountActivationDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class ActivateAccountDto extends VerifyAccountActivationDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter.' })
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter.' })
  @Matches(/\d/, { message: 'Password must include a number.' })
  @Matches(/[^A-Za-z0-9]/, { message: 'Password must include a symbol.' })
  password!: string;
}

export class ResendAccountInvitationDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}
