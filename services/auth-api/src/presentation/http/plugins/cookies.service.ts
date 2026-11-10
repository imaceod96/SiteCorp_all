import type { FastifyReply } from "fastify";
import type { SerializeOptions } from "@fastify/cookie";
import {
  AuthCookieConfig,
  HttpConfigurationError,
} from "../../../infrastructure/config/http-config";
import { DomainError } from "../../../domain";

export class CookieExpirationError extends DomainError {
  public readonly code = "COOKIE_EXPIRATION_ERROR";
  constructor(message: string) {
    super(message);
  }
}

export interface CalculateCookieMaxAgeInput {
  readonly refreshTokenExpiresAt: Date;
  readonly sessionExpiresAt?: Date;
  readonly now?: Date;
}

export interface IssuedCookieMetadata {
  readonly name: string;
  readonly path: string;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "strict" | "lax";
  readonly maxAge: number;
  readonly expires: Date;
}

/**
 * Servicio reutilizable para emisión, validación de atributos y limpieza
 * determinista de las cookies `sitecorp_rt` y `__Host-sitecorp_csrf` (o `sitecorp_csrf` en HTTP local).
 *
 * Cumple rigurosamente RFC 6265bis:
 * - `sitecorp_rt`: `HttpOnly=true`, `Path=/api/v1/auth`, `Secure` según config, `SameSite=Strict/Lax`, sin `Domain`.
 * - `__Host-sitecorp_csrf`: `HttpOnly=false`, `Secure=true` (obligatorio para `__Host-`), `Path=/`, `SameSite=Strict/Lax`, sin `Domain`.
 * - Al borrar cookies (`Max-Age=0`), conserva exactamente el mismo `Path`, `Secure`, `HttpOnly` y `SameSite`.
 */
export class AuthCookieService {
  private readonly config: AuthCookieConfig;

  constructor(config: AuthCookieConfig) {
    AuthCookieService.assertValidCookieConfig(config);
    this.config = config;
  }

  public static assertValidCookieConfig(config: AuthCookieConfig): void {
    if (!config || typeof config !== "object") {
      throw new HttpConfigurationError("La configuración de cookies es obligatoria.");
    }

    if (config.refreshCookieName !== "sitecorp_rt") {
      throw new HttpConfigurationError(
        "El nombre de la cookie de refresh debe ser exactamente 'sitecorp_rt'."
      );
    }

    if (config.refreshCookiePath !== "/api/v1/auth") {
      throw new HttpConfigurationError(
        "El Path de la cookie 'sitecorp_rt' debe ser exactamente '/api/v1/auth'."
      );
    }

    if (config.csrfCookiePath !== "/") {
      throw new HttpConfigurationError(
        "El Path de la cookie CSRF debe ser exactamente '/'."
      );
    }

    if (config.csrfCookieName.startsWith("__Host-")) {
      if (config.secure !== true) {
        throw new HttpConfigurationError(
          "Toda cookie con prefijo '__Host-' exige obligatoriamente 'secure: true' según RFC 6265bis."
        );
      }
      if (config.csrfCookiePath !== "/") {
        throw new HttpConfigurationError(
          "Toda cookie con prefijo '__Host-' exige obligatoriamente 'Path=/' según RFC 6265bis."
        );
      }
    }

    if (config.secure && config.csrfCookieName !== "__Host-sitecorp_csrf") {
      throw new HttpConfigurationError(
        "Cuando 'secure: true' está activo, la cookie CSRF debe utilizar el prefijo '__Host-sitecorp_csrf'."
      );
    }
  }

  private get normalizedSameSite(): "strict" | "lax" {
    return this.config.sameSite === "Strict" ? "strict" : "lax";
  }

  /**
   * Calcula el `Max-Age` restante en segundos sin exceder `refreshTokenExpiresAt`,
   * `sessionExpiresAt` (si se proporciona) ni `config.maxRefreshTtlSeconds`.
   */
  public calculateRemainingMaxAgeSeconds(
    input: CalculateCookieMaxAgeInput
  ): { maxAgeSeconds: number; expiresAt: Date } {
    const now = input.now ?? new Date();
    const nowMs = now.getTime();

    if (
      !(input.refreshTokenExpiresAt instanceof Date) ||
      Number.isNaN(input.refreshTokenExpiresAt.getTime())
    ) {
      throw new CookieExpirationError(
        "La fecha 'refreshTokenExpiresAt' es inválida."
      );
    }

    let effectiveDeadlineMs = input.refreshTokenExpiresAt.getTime();

    if (input.sessionExpiresAt !== undefined) {
      if (
        !(input.sessionExpiresAt instanceof Date) ||
        Number.isNaN(input.sessionExpiresAt.getTime())
      ) {
        throw new CookieExpirationError(
          "La fecha 'sessionExpiresAt' es inválida."
        );
      }
      effectiveDeadlineMs = Math.min(
        effectiveDeadlineMs,
        input.sessionExpiresAt.getTime()
      );
    }

    const remainingSeconds = Math.floor((effectiveDeadlineMs - nowMs) / 1000);
    if (remainingSeconds <= 0) {
      throw new CookieExpirationError(
        "No se puede emitir una cookie para un token o sesión cuya fecha de expiración ya ha vencido."
      );
    }

    const boundedSeconds = Math.min(
      remainingSeconds,
      this.config.maxRefreshTtlSeconds
    );

    const expiresAt = new Date(nowMs + boundedSeconds * 1000);
    return { maxAgeSeconds: boundedSeconds, expiresAt };
  }

  /**
   * Construye las opciones de serialización para la cookie `sitecorp_rt`.
   * Garantiza ausencia total de atributo `Domain` (Host-Only).
   */
  public buildRefreshCookieOptions(
    input: CalculateCookieMaxAgeInput
  ): SerializeOptions & { maxAge: number; expires: Date } {
    const { maxAgeSeconds, expiresAt } =
      this.calculateRemainingMaxAgeSeconds(input);

    return {
      path: this.config.refreshCookiePath,
      httpOnly: true,
      secure: this.config.secure,
      sameSite: this.normalizedSameSite,
      maxAge: maxAgeSeconds,
      expires: expiresAt,
    };
  }

  /**
   * Construye las opciones de serialización para la cookie `__Host-sitecorp_csrf` (o `sitecorp_csrf`).
   * Garantiza `Path=/`, `HttpOnly=false` y ausencia total de atributo `Domain` (Host-Only).
   */
  public buildCsrfCookieOptions(
    input: CalculateCookieMaxAgeInput
  ): SerializeOptions & { maxAge: number; expires: Date } {
    const { maxAgeSeconds, expiresAt } =
      this.calculateRemainingMaxAgeSeconds(input);

    return {
      path: this.config.csrfCookiePath,
      httpOnly: false,
      secure: this.config.secure,
      sameSite: this.normalizedSameSite,
      maxAge: maxAgeSeconds,
      expires: expiresAt,
    };
  }

  /**
   * Emite la cookie `sitecorp_rt` en la respuesta Fastify.
   */
  public setRefreshTokenCookie(
    reply: FastifyReply,
    rawRefreshToken: string,
    expirationInput: CalculateCookieMaxAgeInput
  ): IssuedCookieMetadata {
    if (typeof rawRefreshToken !== "string" || rawRefreshToken.trim() === "") {
      throw new CookieExpirationError(
        "El valor del refresh token para la cookie no puede estar vacío."
      );
    }
    const opts = this.buildRefreshCookieOptions(expirationInput);
    reply.setCookie(this.config.refreshCookieName, rawRefreshToken, opts);

    return Object.freeze({
      name: this.config.refreshCookieName,
      path: this.config.refreshCookiePath,
      httpOnly: true,
      secure: this.config.secure,
      sameSite: this.normalizedSameSite,
      maxAge: opts.maxAge,
      expires: opts.expires,
    });
  }

  /**
   * Emite la cookie `__Host-sitecorp_csrf` (o `sitecorp_csrf` en test/dev sin TLS) en la respuesta Fastify.
   */
  public setCsrfCookie(
    reply: FastifyReply,
    csrfToken: string,
    expirationInput: CalculateCookieMaxAgeInput
  ): IssuedCookieMetadata {
    if (typeof csrfToken !== "string" || csrfToken.trim() === "") {
      throw new CookieExpirationError(
        "El valor del token CSRF para la cookie no puede estar vacío."
      );
    }
    const opts = this.buildCsrfCookieOptions(expirationInput);
    reply.setCookie(this.config.csrfCookieName, csrfToken, opts);

    return Object.freeze({
      name: this.config.csrfCookieName,
      path: this.config.csrfCookiePath,
      httpOnly: false,
      secure: this.config.secure,
      sameSite: this.normalizedSameSite,
      maxAge: opts.maxAge,
      expires: opts.expires,
    });
  }

  /**
   * Limpia tanto `sitecorp_rt` como `__Host-sitecorp_csrf` conservando exactamente
   * el mismo `Path`, `HttpOnly`, `Secure`, `SameSite` y ausencia de `Domain`
   * utilizados al crearlas (`Max-Age=0`, `Expires=Thu, 01 Jan 1970 00:00:00 GMT`).
   */
  public clearAuthCookies(reply: FastifyReply): void {
    const epochZero = new Date(0);

    reply.setCookie(this.config.refreshCookieName, "", {
      path: this.config.refreshCookiePath,
      httpOnly: true,
      secure: this.config.secure,
      sameSite: this.normalizedSameSite,
      maxAge: 0,
      expires: epochZero,
    });

    reply.setCookie(this.config.csrfCookieName, "", {
      path: this.config.csrfCookiePath,
      httpOnly: false,
      secure: this.config.secure,
      sameSite: this.normalizedSameSite,
      maxAge: 0,
      expires: epochZero,
    });
  }

  public get refreshCookieName(): string {
    return this.config.refreshCookieName;
  }

  public get csrfCookieName(): string {
    return this.config.csrfCookieName;
  }
}
