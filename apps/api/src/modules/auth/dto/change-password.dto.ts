import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

import {
  PASSWORD_LOWERCASE_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_NUMBER_PATTERN,
  PASSWORD_SYMBOL_PATTERN,
  PASSWORD_UPPERCASE_PATTERN,
} from '../../../common/security/password';

function MatchesProperty(property: string, validationOptions?: ValidationOptions) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'matchesProperty',
      target: target.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, arguments_: ValidationArguments): boolean {
          const [relatedProperty] = arguments_.constraints as [string];
          const relatedValue = (arguments_.object as Record<string, unknown>)[relatedProperty];
          return typeof value === 'string' && value === relatedValue;
        },
      },
    });
  };
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Current password is required.' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_LOWERCASE_PATTERN, { message: 'Password must include a lowercase letter.' })
  @Matches(PASSWORD_UPPERCASE_PATTERN, { message: 'Password must include an uppercase letter.' })
  @Matches(PASSWORD_NUMBER_PATTERN, { message: 'Password must include a number.' })
  @Matches(PASSWORD_SYMBOL_PATTERN, { message: 'Password must include a symbol.' })
  newPassword!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  @MatchesProperty('newPassword', { message: 'Password confirmation must match.' })
  confirmPassword!: string;
}
