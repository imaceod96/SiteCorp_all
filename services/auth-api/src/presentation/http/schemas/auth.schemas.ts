/**
 * Esquemas JSON estrictos (Ajv / Fastify v5) para los endpoints de autenticación
 * de la Fase 4G.2B.2.
 *
 * Reglas de seguridad:
 * - `additionalProperties: false` en todos los cuerpos y parámetros de consulta.
 * - Sin coerción de tipos (`coerceTypes: false` en el servidor).
 * - Límites estrictos de longitud (`email` <= 254, `password` <= 128).
 */

export interface LoginRequestBody {
  readonly email: string;
  readonly password: string;
}

export type RefreshRequestBody = Record<string, never>;

export interface LogoutRequestBody {
  readonly allDevices?: boolean;
}

export interface ChangePasswordRequestBody {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export const emptyQuerySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {},
} as const);

export const loginBodySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["email", "password"],
  properties: {
    email: {
      type: "string",
      minLength: 3,
      maxLength: 254,
    },
    password: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
  },
} as const);

export const refreshBodySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {},
} as const);

export const logoutBodySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    allDevices: {
      type: "boolean",
    },
  },
} as const);

export const changePasswordBodySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["currentPassword", "newPassword"],
  properties: {
    currentPassword: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    newPassword: {
      type: "string",
      minLength: 12,
      maxLength: 128,
    },
  },
} as const);
