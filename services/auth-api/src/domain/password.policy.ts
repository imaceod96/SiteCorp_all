import { WeakPasswordError } from "./types";

export interface PasswordValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

const COMMON_FORBIDDEN_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "adminsitecorp1",
  "sitecorp2026!",
  "qwerty123456",
  "contraseña123",
]);

export class PasswordPolicy {
  public static readonly MIN_LENGTH = 12;
  public static readonly MAX_LENGTH = 128;

  public static validate(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (!password || password.length < this.MIN_LENGTH) {
      errors.push(`Debe tener al menos ${this.MIN_LENGTH} caracteres`);
    }

    if (password.length > this.MAX_LENGTH) {
      errors.push(`No debe exceder los ${this.MAX_LENGTH} caracteres`);
    }

    if (!/[A-Z]/.test(password)) {
      errors.push("Debe contener al menos una letra mayúscula");
    }

    if (!/[a-z]/.test(password)) {
      errors.push("Debe contener al menos una letra minúscula");
    }

    if (!/[0-9]/.test(password)) {
      errors.push("Debe contener al menos un número");
    }

    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      errors.push("Debe contener al menos un carácter especial");
    }

    if (COMMON_FORBIDDEN_PASSWORDS.has(password.toLowerCase())) {
      errors.push("La contraseña es demasiado predecible o vulnerable");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  public static assertValid(password: string): void {
    const result = this.validate(password);
    if (!result.isValid) {
      throw new WeakPasswordError(result.errors);
    }
  }
}
