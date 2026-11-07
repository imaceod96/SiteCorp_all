/**
 * Tipos de Dominio Puros y Value Objects para SiteCorp Auth API
 *
 * Sin dependencias externas. Lógica de negocio y reglas de identidad puras.
 */

declare const UserIdBrand: unique symbol;
export type UserId = string & { readonly [UserIdBrand]: typeof UserIdBrand };

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUserId(value: unknown): value is UserId {
  return typeof value === "string" && UUID_V4_REGEX.test(value.trim());
}

export function createUserId(value: string): UserId {
  const trimmed = value.trim();
  if (!UUID_V4_REGEX.test(trimmed)) {
    throw new InvalidUserIdError(`El identificador '${value}' no es un UUID v4 válido.`);
  }
  return trimmed.toLowerCase() as UserId;
}

declare const EmailBrand: unique symbol;
export type Email = string & { readonly [EmailBrand]: typeof EmailBrand };

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(value: unknown): value is Email {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.length >= 3 &&
    trimmed.length <= 255 &&
    EMAIL_REGEX.test(trimmed)
  );
}

export function createEmail(value: string): Email {
  const trimmed = value.trim().toLowerCase();
  if (!isValidEmail(trimmed)) {
    throw new InvalidEmailError(`El formato del correo '${value}' no es válido.`);
  }
  return trimmed as Email;
}

export type AuthUserStatus =
  | "active"
  | "suspended"
  | "pending_password_change"
  | "deleted";

export type SecurityEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "TOKEN_ROTATED"
  | "TOKEN_REUSE_DETECTED"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_UNLOCKED"
  | "USER_CREATED"
  | "USER_SUSPENDED"
  | "USER_ACTIVATED"
  | "USER_DELETED";

export abstract class DomainError extends Error {
  public abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidUserIdError extends DomainError {
  public readonly code = "INVALID_USER_ID";
}

export class InvalidEmailError extends DomainError {
  public readonly code = "INVALID_EMAIL";
}

export class UserSuspendedError extends DomainError {
  public readonly code = "USER_SUSPENDED";
}

export class UserDeletedError extends DomainError {
  public readonly code = "USER_DELETED";
}

export class AccountLockedError extends DomainError {
  public readonly code = "ACCOUNT_LOCKED";
  constructor(public readonly lockedUntil: Date) {
    super(`La cuenta se encuentra bloqueada temporalmente hasta ${lockedUntil.toISOString()}`);
  }
}

export class WeakPasswordError extends DomainError {
  public readonly code = "WEAK_PASSWORD";
  constructor(public readonly reasons: readonly string[]) {
    super(`La contraseña no cumple las políticas de seguridad: ${reasons.join(", ")}`);
  }
}

export class InvalidCredentialsError extends DomainError {
  public readonly code = "INVALID_CREDENTIALS";
  constructor(message: string = "Credenciales de autenticación incorrectas.") {
    super(message);
  }
}

export class DuplicateEmailError extends DomainError {
  public readonly code = "DUPLICATE_EMAIL";
  constructor(email: string) {
    super(`El correo electrónico '${email}' ya se encuentra registrado.`);
  }
}

export class UnauthorizedError extends DomainError {
  public readonly code = "UNAUTHORIZED";
  constructor(message: string = "No se ha proporcionado una identidad autenticada válida.") {
    super(message);
  }
}

export class ForbiddenError extends DomainError {
  public readonly code = "FORBIDDEN";
  constructor(message: string = "El operador no cuenta con los permisos necesarios para realizar esta acción.") {
    super(message);
  }
}

export class TokenReuseDetectedError extends DomainError {
  public readonly code = "TOKEN_REUSE_DETECTED";
  constructor(public readonly familyId: string) {
    super("Alerta de seguridad: se ha detectado el reuso de un token revocado. Sesión terminada.");
  }
}

export class TokenExpiredError extends DomainError {
  public readonly code = "TOKEN_EXPIRED";
  constructor(message: string = "El token de autenticación ha expirado.") {
    super(message);
  }
}

export class TokenInvalidError extends DomainError {
  public readonly code = "TOKEN_INVALID";
  constructor(message: string = "El token de autenticación es inválido o no existe.") {
    super(message);
  }
}

export class SessionInvalidError extends DomainError {
  public readonly code = "SESSION_INVALID";
  constructor(message: string = "La sesión es inválida, ha sido revocada o ha caducado.") {
    super(message);
  }
}

export class UserNotFoundError extends DomainError {
  public readonly code = "USER_NOT_FOUND";
  constructor(userId?: string) {
    super(
      userId
        ? `El usuario con identificador '${userId}' no existe.`
        : "El usuario solicitado no existe."
    );
  }
}

export class ActivationTokenAlreadyUsedError extends DomainError {
  public readonly code = "TOKEN_ALREADY_USED";
  constructor(message: string = "El enlace o token de activación ya ha sido utilizado previamente.") {
    super(message);
  }
}

