import type { IAuthenticationProvider } from "../domain/auth-provider.contracts"
import {
  SupabaseAuthAdapter,
  type SupabaseAuthClientLike,
} from "./supabase-auth.adapter"
import {
  SelfHostedAuthAdapter,
  type SelfHostedAuthAdapterOptions,
  type StorageLike,
} from "./self-hosted-auth.adapter"

/**
 * Identificadores de los tipos de proveedores de autenticación admitidos en la arquitectura.
 */
export type AuthProviderType = "supabase" | "self_hosted"

/**
 * Configuración para el proveedor de autenticación basado en Supabase Auth.
 */
export interface SupabaseProviderConfig {
  type: "supabase"
  /**
   * Cliente inyectable para pruebas o entornos desacoplados.
   * Si no se provee, delega en la instancia por defecto del adaptador.
   */
  client?: SupabaseAuthClientLike
}

/**
 * Configuración para el proveedor de autenticación propio autogestionado (Fastify/Node.js).
 */
export interface SelfHostedProviderConfig extends SelfHostedAuthAdapterOptions {
  type: "self_hosted"
}

/**
 * Unión discriminada de todas las configuraciones posibles de proveedores de autenticación.
 */
export type AuthProviderConfig = SupabaseProviderConfig | SelfHostedProviderConfig

/**
 * Factoría desacoplada para la resolución de instancias de IAuthenticationProvider.
 *
 * REGLAS DE ARQUITECTURA:
 * 1. Selección explícita: el proveedor se resuelve mediante la configuración recibida.
 * 2. Cero fallback silencioso: si se especifica un tipo no soportado o inválido, la factoría
 *    lanza un error explícito inmediatamente.
 * 3. Aislamiento total: la factoría es una función pura / clase estática sin efectos secundarios.
 * 4. Supabase por defecto: si no se especifica explícitamente 'self_hosted', la aplicación
 *    conserva Supabase como proveedor primario e inalterado.
 */
export class AuthProviderFactory {
  /**
   * Crea y devuelve una instancia de IAuthenticationProvider según la configuración especificada.
   *
   * @param config Configuración tipada del proveedor.
   * @throws Error si la configuración es inválida o el proveedor no existe.
   */
  static create(config: AuthProviderConfig): IAuthenticationProvider {
    if (!config || typeof config !== "object" || !("type" in config)) {
      throw new Error(
        "Configuración de proveedor de autenticación no válida: se requiere un objeto con la propiedad 'type'."
      )
    }

    switch (config.type) {
      case "supabase":
        return new SupabaseAuthAdapter(config.client)

      case "self_hosted":
        return new SelfHostedAuthAdapter(config)

      default: {
        const unknownType = (config as { type: string }).type
        throw new Error(
          `Proveedor de autenticación no reconocido: '${unknownType}'. Los proveedores válidos son 'supabase' o 'self_hosted'.`
        )
      }
    }
  }

  /**
   * Obtiene la configuración predeterminada del sistema.
   * Mantiene 'supabase' como proveedor predeterminado a menos que se configure explícitamente 'self_hosted'.
   */
  static getDefaultConfig(): AuthProviderConfig {
    const configuredProvider =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_AUTH_PROVIDER
        ? String(import.meta.env.VITE_AUTH_PROVIDER).trim().toLowerCase()
        : "supabase"

    if (configuredProvider === "self_hosted") {
      return {
        type: "self_hosted",
        baseUrl:
          typeof import.meta !== "undefined" && import.meta.env?.VITE_AUTH_API_URL
            ? String(import.meta.env.VITE_AUTH_API_URL).trim()
            : undefined,
      }
    }

    return { type: "supabase" }
  }
}

/**
 * Función auxiliar para crear proveedores sin instanciar la clase factoría directamente.
 */
export function createAuthenticationProvider(config: AuthProviderConfig): IAuthenticationProvider {
  return AuthProviderFactory.create(config)
}

/**
 * Factoría que resuelve el proveedor predeterminado configurado en el sistema (por defecto: Supabase).
 */
export function createDefaultAuthenticationProvider(): IAuthenticationProvider {
  return AuthProviderFactory.create(AuthProviderFactory.getDefaultConfig())
}

export type { StorageLike }
