import { compare, hash } from 'bcryptjs';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_LOWERCASE_PATTERN = /[a-z]/;
export const PASSWORD_UPPERCASE_PATTERN = /[A-Z]/;
export const PASSWORD_NUMBER_PATTERN = /\d/;
export const PASSWORD_SYMBOL_PATTERN = /[^A-Za-z0-9]/;

const passwordHashCost = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, passwordHashCost);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}
