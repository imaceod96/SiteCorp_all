/**
 * Esquemas JSON estrictos (AJV / Fastify) para los endpoints administrativos
 * de la Fase 4G.2 FINAL:
 * - POST  /api/v1/auth/admin/users
 * - PATCH /api/v1/auth/admin/users/:id/status
 *
 * Propiedades de seguridad:
 * - `additionalProperties: false` en todos los esquemas para impedir
 *   inyección de campos no autorizados (`role`, `permissions`, `isPlatformAdmin`, `id`, `status`, etc.).
 */

export interface AdminCreateUserRequestBody {
  readonly email: string;
  readonly initialPassword: string;
  readonly mustChangePassword?: boolean;
}

export interface AdminUpdateStatusRequestParams {
  readonly id: string;
}

export interface AdminUpdateStatusRequestBody {
  readonly status: "active" | "suspended" | "deleted";
}

export const adminCreateUserBodySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["email", "initialPassword"],
  properties: {
    email: {
      type: "string",
      minLength: 3,
      maxLength: 254,
    },
    initialPassword: {
      type: "string",
      minLength: 12,
      maxLength: 128,
    },
    mustChangePassword: {
      type: "boolean",
    },
  },
});

export const adminUpdateStatusParamsSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      minLength: 36,
      maxLength: 36,
    },
  },
});

export const adminUpdateStatusBodySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: {
      type: "string",
      enum: ["active", "suspended", "deleted"],
    },
  },
});

export interface AdminGenerateActivationTokenRequestParams {
  readonly id: string;
}

export interface AdminGenerateActivationTokenRequestBody {
  readonly tokenType?: "activation" | "password_reset";
  readonly expiresInHours?: number;
}

export const adminGenerateActivationTokenParamsSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      minLength: 36,
      maxLength: 36,
    },
  },
});

export const adminGenerateActivationTokenBodySchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    tokenType: {
      type: "string",
      enum: ["activation", "password_reset"],
    },
    expiresInHours: {
      type: "integer",
      minimum: 1,
      maximum: 168,
    },
  },
});

