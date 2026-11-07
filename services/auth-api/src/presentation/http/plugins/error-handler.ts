import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AccountLockedError,
  ActivationTokenAlreadyUsedError,
  DomainError,
  DuplicateEmailError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidEmailError,
  InvalidUserIdError,
  SessionInvalidError,
  TokenExpiredError,
  TokenInvalidError,
  TokenReuseDetectedError,
  UnauthorizedError,
  UserDeletedError,
  UserNotFoundError,
  UserSuspendedError,
  WeakPasswordError,
} from "../../../domain";
import {
  ConcurrentCredentialModificationError,
  SamePasswordError,
} from "../../../application/use-cases/change-password.use-case";
import { CsrfValidationError } from "./csrf-token.service";
import { Argon2ConcurrencySaturationError } from "../concurrency/argon2-concurrency-gate";
import { RateLimitExceededError } from "../concurrency/rate-limiter";
import { PasswordChangeRequiredError } from "./auth-guard";

export class UnsupportedMediaTypeHttpError extends DomainError {
  public readonly code = "UNSUPPORTED_MEDIA_TYPE";
  constructor(
    message: string = "El encabezado 'Content-Type' debe ser 'application/json'."
  ) {
    super(message);
  }
}

export class PayloadTooLargeHttpError extends DomainError {
  public readonly code = "PAYLOAD_TOO_LARGE";
  constructor(
    message: string = "El tamaño del cuerpo de la solicitud excede el límite permitido."
  ) {
    super(message);
  }
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly details: Record<string, unknown> | null;
  };
}

interface MappedHttpError {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown> | null;
  readonly headers?: Record<string, string>;
}

const SENSITIVE_FIELD_NAMES = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "initialpassword",
  "temporarypassword",
  "refreshtoken",
  "rawrefreshtoken",
  "token",
  "accesstoken",
  "authorization",
  "cookie",
  "csrfsecret",
  "hmacsecret",
]);

function sanitizeValidationMessage(err: FastifyError): {
  message: string;
  details: Record<string, unknown> | null;
} {
  if (!Array.isArray(err.validation) || err.validation.length === 0) {
    return {
      message: "Los datos de entrada de la solicitud no tienen un formato válido.",
      details: null,
    };
  }

  const sanitizedIssues = err.validation.map((issue) => {
    const rawPath =
      typeof issue.instancePath === "string" ? issue.instancePath : "";
    const missingProp =
      issue.params && typeof issue.params.missingProperty === "string"
        ? issue.params.missingProperty
        : undefined;
    const additionalProp =
      issue.params && typeof issue.params.additionalProperty === "string"
        ? issue.params.additionalProperty
        : undefined;

    const fieldName = (
      missingProp ??
      additionalProp ??
      rawPath.replace(/^\//, "")
    ).toLowerCase();

    const safeField = SENSITIVE_FIELD_NAMES.has(fieldName)
      ? fieldName
      : missingProp ?? additionalProp ?? (rawPath || "body");

    return {
      field: safeField,
      keyword: issue.keyword ?? "validation",
    };
  });

  return {
    message: "Error de validación en los parámetros de la solicitud.",
    details: { issues: sanitizedIssues },
  };
}

export function mapErrorToHttpResponse(error: unknown): MappedHttpError {
  // 1. Rate Limit Exceeded -> 429
  if (error instanceof RateLimitExceededError) {
    return {
      statusCode: 429,
      code: error.code,
      message: error.message,
      details: {
        retryAfterSeconds: error.retryAfterSeconds,
      },
      headers: {
        "Retry-After": String(error.retryAfterSeconds),
        "X-RateLimit-Limit": String(error.limit),
        "X-RateLimit-Remaining": String(error.remaining),
        ...(error.resetAtEpochSeconds > 0
          ? { "X-RateLimit-Reset": String(error.resetAtEpochSeconds) }
          : {}),
      },
    };
  }

  // 2. Argon2 Concurrency Gate Saturated -> 503
  if (error instanceof Argon2ConcurrencySaturationError) {
    return {
      statusCode: 503,
      code: error.code,
      message: error.message,
      details: null,
      headers: {
        "Retry-After": String(error.retryAfterSeconds),
      },
    };
  }

  // 3. CSRF Validation Error -> 403
  if (error instanceof CsrfValidationError) {
    return {
      statusCode: 403,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  // 4. Password Change Required -> 403
  if (error instanceof PasswordChangeRequiredError) {
    return {
      statusCode: 403,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  // 5. Unsupported Media Type -> 415
  if (error instanceof UnsupportedMediaTypeHttpError) {
    return {
      statusCode: 415,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  // 6. Payload Too Large -> 413
  if (error instanceof PayloadTooLargeHttpError) {
    return {
      statusCode: 413,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  // 7. Errores de Dominio y Aplicación
  if (error instanceof WeakPasswordError) {
    return {
      statusCode: 400,
      code: error.code,
      message: "La contraseña no cumple las políticas de seguridad requeridas.",
      details: { reasons: error.reasons },
    };
  }

  if (
    error instanceof SamePasswordError ||
    error instanceof InvalidEmailError ||
    error instanceof InvalidUserIdError ||
    error instanceof ActivationTokenAlreadyUsedError
  ) {
    return {
      statusCode: 400,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  if (
    error instanceof InvalidCredentialsError ||
    error instanceof UnauthorizedError ||
    error instanceof TokenInvalidError ||
    error instanceof TokenExpiredError ||
    error instanceof TokenReuseDetectedError ||
    error instanceof SessionInvalidError
  ) {
    return {
      statusCode: 401,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  if (
    error instanceof UserSuspendedError ||
    error instanceof UserDeletedError ||
    error instanceof ForbiddenError
  ) {
    return {
      statusCode: 403,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  if (error instanceof UserNotFoundError) {
    return {
      statusCode: 404,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  if (
    error instanceof DuplicateEmailError ||
    error instanceof ConcurrentCredentialModificationError
  ) {
    return {
      statusCode: 409,
      code: error.code,
      message: error.message,
      details: null,
    };
  }

  if (error instanceof AccountLockedError) {
    return {
      statusCode: 423,
      code: error.code,
      message: error.message,
      details: {
        lockedUntil: error.lockedUntil.toISOString(),
      },
    };
  }

  // 8. Errores nativos de Fastify (bodyLimit, JSON inválido, Content-Type, validación Ajv)
  if (typeof error === "object" && error !== null && "code" in error) {
    const fastifyErr = error as FastifyError;

    if (fastifyErr.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return {
        statusCode: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: "El tamaño del cuerpo de la solicitud excede el límite permitido.",
        details: null,
      };
    }

    if (
      fastifyErr.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
      fastifyErr.statusCode === 415
    ) {
      return {
        statusCode: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "El encabezado 'Content-Type' debe ser 'application/json'.",
        details: null,
      };
    }

    if (
      fastifyErr.code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH" ||
      fastifyErr.code === "FST_ERR_CTP_INVALID_TYPE" ||
      fastifyErr.code === "FST_ERR_CTP_EMPTY_JSON_BODY" ||
      (typeof fastifyErr.code === "string" &&
        fastifyErr.code.startsWith("FST_ERR_CTP_")) ||
      error instanceof SyntaxError
    ) {
      return {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "El cuerpo JSON de la solicitud es inválido o está malformado.",
        details: null,
      };
    }

    if (fastifyErr.validation) {
      const sanitized = sanitizeValidationMessage(fastifyErr);
      return {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: sanitized.message,
        details: sanitized.details,
      };
    }
  }

  // 9. Cualquier otro error interno o de PostgreSQL -> 500 sin exponer detalles técnicos ni SQL
  return {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Ha ocurrido un error interno al procesar la solicitud.",
    details: null,
  };
}

/**
 * Registra los manejadores centralizados `setErrorHandler` y `setNotFoundHandler`
 * en la instancia de Fastify, garantizando sobres de error uniformes, correlación
 * por `requestId` y cero filtraciones de stack traces, consultas SQL o secretos.
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const envelope: ErrorEnvelope = {
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "El recurso o endpoint solicitado no existe.",
        requestId: req.id,
        details: null,
      },
    };
    void reply.code(404).type("application/json; charset=utf-8").send(envelope);
  });

  app.setErrorHandler(
    (error: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
      const mapped = mapErrorToHttpResponse(error);

      if (mapped.statusCode >= 500) {
        req.log.error(
          {
            requestId: req.id,
            errName: error?.name ?? "UnknownError",
            errCode:
              typeof error === "object" && error !== null && "code" in error
                ? String((error as { code?: unknown }).code)
                : undefined,
          },
          "Unhandled internal error in auth-api request"
        );
      } else {
        req.log.warn(
          {
            requestId: req.id,
            statusCode: mapped.statusCode,
            errorCode: mapped.code,
          },
          "Request rejected with controlled HTTP error"
        );
      }

      if (mapped.headers) {
        for (const [headerName, headerValue] of Object.entries(mapped.headers)) {
          reply.header(headerName, headerValue);
        }
      }

      const envelope: ErrorEnvelope = {
        error: {
          code: mapped.code,
          message: mapped.message,
          requestId: req.id,
          details: mapped.details,
        },
      };

      void reply
        .code(mapped.statusCode)
        .type("application/json; charset=utf-8")
        .send(envelope);
    }
  );
}
