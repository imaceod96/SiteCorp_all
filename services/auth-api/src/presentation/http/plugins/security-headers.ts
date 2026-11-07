import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthHttpConfig } from "../../../infrastructure/config/http-config";
import { verifyRequestOrigin } from "./csrf-token.service";
import { UnsupportedMediaTypeHttpError } from "./error-handler";

const SAFE_REQUEST_ID_REGEX = /^[A-Za-z0-9_.-]{8,128}$/;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Extrae o genera de forma segura el identificador de correlación `X-Request-Id`
 * para cada petición HTTP, impidiendo inyección de cabeceras (CRLF) o IDs excesivamente largos.
 */
export function resolveSafeRequestId(req: FastifyRequest): string {
  const incoming = req.headers["x-request-id"];
  const raw = Array.isArray(incoming) ? incoming[0] : incoming;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (SAFE_REQUEST_ID_REGEX.test(trimmed)) {
      return trimmed;
    }
  }
  return randomUUID();
}

/**
 * Registra los hooks transversales de seguridad HTTP:
 * 1. Correlación de `X-Request-Id` y cabeceras `Cache-Control: no-store` / `Pragma: no-cache`.
 * 2. Validación de `Origin` / `Referer` contra `allowedOrigins` en métodos mutadores.
 * 3. Validación estricta de `Content-Type: application/json` en peticiones mutadoras con cuerpo.
 */
export function registerSecurityHooks(
  app: FastifyInstance,
  httpConfig: AuthHttpConfig
): void {
  app.addHook(
    "onRequest",
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // Asegurar que la respuesta siempre incluya X-Request-Id y políticas anti-caché
      reply.header("X-Request-Id", req.id);
      reply.header(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, private"
      );
      reply.header("Pragma", "no-cache");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("X-Frame-Options", "DENY");
      reply.header("Referrer-Policy", "no-referrer");

      const method = req.method.toUpperCase();

      // Validar Origin / Referer en cualquier operación mutadora (POST, PUT, PATCH, DELETE)
      if (MUTATING_METHODS.has(method)) {
        const cookieHeader = req.headers.cookie ?? "";
        const hasRefreshCookie = cookieHeader.includes(
          `${httpConfig.cookies.refreshCookieName}=`
        );

        verifyRequestOrigin({
          originHeader: req.headers.origin,
          refererHeader: req.headers.referer,
          allowedOrigins: httpConfig.allowedOrigins,
          // Si la petición transporta la cookie de sesión sitecorp_rt, Origin/Referer es obligatorio
          requireOriginHeader: hasRefreshCookie,
        });
      }
    }
  );

  app.addHook(
    "preParsing",
    async (req: FastifyRequest, _reply: FastifyReply, payload) => {
      const method = req.method.toUpperCase();
      if (!MUTATING_METHODS.has(method)) {
        return payload;
      }

      const contentLengthHeader = req.headers["content-length"];
      const transferEncodingHeader = req.headers["transfer-encoding"];
      const hasBody =
        (typeof contentLengthHeader === "string" &&
          contentLengthHeader !== "0" &&
          contentLengthHeader.trim() !== "") ||
        typeof transferEncodingHeader === "string";

      const rawContentType = req.headers["content-type"];
      if (hasBody || rawContentType !== undefined) {
        if (typeof rawContentType !== "string") {
          throw new UnsupportedMediaTypeHttpError();
        }
        const mediaType = rawContentType.split(";")[0]?.trim().toLowerCase();
        if (mediaType !== "application/json") {
          throw new UnsupportedMediaTypeHttpError();
        }
      }

      return payload;
    }
  );
}
