import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import {
  PASSWORD_LOWERCASE_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_NUMBER_PATTERN,
  PASSWORD_SYMBOL_PATTERN,
  PASSWORD_UPPERCASE_PATTERN,
} from '../../../common/security/password';

export class VerifyAccountActivationDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class ActivateAccountDto extends VerifyAccountActivationDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_LOWERCASE_PATTERN, { message: 'Password must include a lowercase letter.' })
  @Matches(PASSWORD_UPPERCASE_PATTERN, { message: 'Password must include an uppercase letter.' })
  @Matches(PASSWORD_NUMBER_PATTERN, { message: 'Password must include a number.' })
  @Matches(PASSWORD_SYMBOL_PATTERN, { message: 'Password must include a symbol.' })
  password!: string;
}

export class ResendAccountInvitationDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}
