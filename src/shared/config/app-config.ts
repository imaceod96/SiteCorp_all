/**
 * SiteCorp · Configuración Global Centralizada (Agnóstica de Proveedor)
 *
 * Jerarquía de resolución de parámetros (12-Factor App / Key Vault Ready):
 *   1. Variables de entorno neutrales inyectadas en servidor / contenedor / Key Vault (`VITE_API_*`, `VITE_SECURITY_*`).
 *   2. Variables de entorno heredadas de transición (`VITE_SUPABASE_*`) por compatibilidad.
 *   3. Configuración global inicial del proyecto (`DEFAULT_GLOBAL_CONFIG`).
 *
 * Incluye validación de formato (URL HTTP/HTTPS válida y tokens sin saltos de línea) para que
 * un valor malformado en variables de entorno nunca deje la aplicación en blanco.
 */

export interface GlobalAppConfig {
  /** Conexión al gateway HTTP / PostgREST / API de datos (agnóstico de Supabase). */
  api: {
    baseUrl: string
    publicKey: string
  }
  /** Configuración de esquema físico de base de datos. */
  database: {
    schemaTarget: "auto" | "legacy" | "company_client"
  }
  /** Configuración de sesiones propias en PostgreSQL (`public.user_sessions`). */
  auth: {
    sessionStorageKey: string
    sessionHeaderName: string
    avatarsBucket: string
  }
  /** Políticas de seguridad y contraseñas (sincronizadas con PostgreSQL `pgcrypto`). */
  security: {
    passwordMinLength: number
    initialPasswordLength: number
    maxFailedLoginAttempts: number
    lockoutMinutes: number
    sessionDurationHours: number
  }
}

/**
 * 1. Valores iniciales por defecto del proyecto (Fallback local cuando no hay variables de entorno).
 *    Cuando despliegues en tu propio servidor o conectes un Key Vault, las variables de entorno
 *    válidas tendrán prioridad automática sin modificar este archivo.
 */
const DEFAULT_GLOBAL_CONFIG: GlobalAppConfig = {
  api: {
    baseUrl: "https://xvswjkpoeccgpiewptur.supabase.co",
    publicKey: "sb_publishable_4ZKRypToE3sUnlo_oAGdRA_KhkLmieP",
  },
  database: {
    schemaTarget: "auto",
  },
  auth: {
    sessionStorageKey: "sitecorp_custom_session_token",
    sessionHeaderName: "x-sitecorp-session",
    avatarsBucket: "avatars",
  },
  security: {
    passwordMinLength: 12,
    initialPasswordLength: 24,
    maxFailedLoginAttempts: 5,
    lockoutMinutes: 15,
    sessionDurationHours: 8,
  },
}

/** Lee una variable de entorno de `import.meta.env` o `process.env` de forma segura. */
function readEnvString(...keys: string[]): string | undefined {
  for (const key of keys) {
    const metaVal =
      typeof import.meta !== "undefined" && import.meta.env
        ? (import.meta.env as Record<string, string | undefined>)[key]
        : undefined
    if (typeof metaVal === "string" && metaVal.trim().length > 0) {
      return metaVal.trim()
    }

    const procVal =
      typeof process !== "undefined" && process.env ? process.env[key] : undefined
    if (typeof procVal === "string" && procVal.trim().length > 0) {
      return procVal.trim()
    }
  }
  return undefined
}

/** Verifica que una cadena sea una URL HTTP/HTTPS válida de una sola línea. */
function isValidHttpUrl(value: string): boolean {
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

/** Lee una URL válida desde variables de entorno; si está malformada, usa el fallback seguro. */
function readEnvHttpUrl(fallback: string, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = readEnvString(key)
    if (candidate && isValidHttpUrl(candidate)) {
      return candidate
    }
  }
  return fallback
}

/** Lee un token/identificador de una sola línea sin espacios; si está malformado, usa el fallback. */
function readEnvSingleToken(fallback: string, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = readEnvString(key)
    if (candidate && !/\s/.test(candidate) && candidate.length < 512) {
      return candidate
    }
  }
  return fallback
}

/** Lee un número positivo desde variables de entorno o devuelve el valor por defecto. */
function readEnvPositiveInt(fallback: number, ...keys: string[]): number {
  const raw = readEnvString(...keys)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Resuelve el objetivo de esquema físico desde variables de entorno o configuración global. */
function resolveSchemaTargetSetting(
  fallback: "auto" | "legacy" | "company_client"
): "auto" | "legacy" | "company_client" {
  const raw = readEnvString("VITE_DB_SCHEMA_TARGET", "VITE_SCHEMA_TARGET")?.toLowerCase()
  if (raw === "legacy" || raw === "company_client" || raw === "auto") {
    return raw
  }
  return fallback
}

/**
 * Configuración global activa de SiteCorp.
 * Prioridad: Key Vault / Variables de Entorno válidas (`VITE_API_*`) -> Compatibilidad -> `DEFAULT_GLOBAL_CONFIG`.
 */
export const appConfig: Readonly<GlobalAppConfig> = Object.freeze({
  api: {
    baseUrl: readEnvHttpUrl(
      DEFAULT_GLOBAL_CONFIG.api.baseUrl,
      "VITE_API_BASE_URL",
      "VITE_POSTGREST_URL",
      "VITE_SUPABASE_URL"
    ),
    publicKey: readEnvSingleToken(
      DEFAULT_GLOBAL_CONFIG.api.publicKey,
      "VITE_API_PUBLIC_KEY",
      "VITE_POSTGREST_PUBLIC_KEY",
      "VITE_SUPABASE_ANON_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY"
    ),
  },
  database: {
    schemaTarget: resolveSchemaTargetSetting(DEFAULT_GLOBAL_CONFIG.database.schemaTarget),
  },
  auth: {
    sessionStorageKey: readEnvSingleToken(
      DEFAULT_GLOBAL_CONFIG.auth.sessionStorageKey,
      "VITE_AUTH_SESSION_STORAGE_KEY"
    ),
    sessionHeaderName: readEnvSingleToken(
      DEFAULT_GLOBAL_CONFIG.auth.sessionHeaderName,
      "VITE_AUTH_SESSION_HEADER_NAME"
    ),
    avatarsBucket: readEnvSingleToken(
      DEFAULT_GLOBAL_CONFIG.auth.avatarsBucket,
      "VITE_STORAGE_AVATARS_BUCKET"
    ),
  },
  security: {
    passwordMinLength: readEnvPositiveInt(
      DEFAULT_GLOBAL_CONFIG.security.passwordMinLength,
      "VITE_SECURITY_PASSWORD_MIN_LENGTH"
    ),
    initialPasswordLength: readEnvPositiveInt(
      DEFAULT_GLOBAL_CONFIG.security.initialPasswordLength,
      "VITE_SECURITY_INITIAL_PASSWORD_LENGTH"
    ),
    maxFailedLoginAttempts: readEnvPositiveInt(
      DEFAULT_GLOBAL_CONFIG.security.maxFailedLoginAttempts,
      "VITE_SECURITY_MAX_LOGIN_ATTEMPTS"
    ),
    lockoutMinutes: readEnvPositiveInt(
      DEFAULT_GLOBAL_CONFIG.security.lockoutMinutes,
      "VITE_SECURITY_LOCKOUT_MINUTES"
    ),
    sessionDurationHours: readEnvPositiveInt(
      DEFAULT_GLOBAL_CONFIG.security.sessionDurationHours,
      "VITE_SECURITY_SESSION_HOURS"
    ),
  },
})
