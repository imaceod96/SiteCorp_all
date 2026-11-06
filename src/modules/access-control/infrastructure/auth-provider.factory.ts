import type { IAuthenticationProvider } from "../domain/auth-provider.contracts"
import {
  SupabaseAuthAdapter,
  type SupabaseAuthClientLike,
} from "./supabase-auth.adapter"

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
 * Configuración reservada para el futuro proveedor de autenticación autogestionado.
 * Arquitectónicamente definida para admitir endpoint o servicio nativo,
 * pero no implementada en esta fase.
 */
export interface SelfHostedProviderConfig {
  type: "self_hosted"
  baseUrl?: string
}

/**
 * Unión discriminada de todas las configuraciones posibles de proveedores de autenticación.
 */
export type AuthProviderConfig = SupabaseProviderConfig | SelfHostedProviderConfig

/**
 * Factoría desacoplada para la resolución de instancias de IAuthenticationProvider.
 *
 * REGLAS DE ARQUITECTURA:
 * 1. Selección explícita: el proveedor se resuelve exclusivamente mediante la configuración
 *    recibida por parámetro. No consulta variables de entorno globales ni deduce opciones en segundo plano.
 * 2. Cero fallback silencioso: si se especifica un tipo no soportado o inválido, la factoría
 *    lanza un error explícito inmediatamente.
 * 3. Aislamiento total: la factoría es una función pura / clase estática sin estado global ni
 *    efectos secundarios al ser importada.
 * 4. Desconexión del flujo activo: no está conectada a AuthProvider.tsx ni a la UI de SiteCorp.
 */
export class AuthProviderFactory {
  /**
   * Crea y devuelve una instancia de IAuthenticationProvider según la configuración especificada.
   *
   * @param config Configuración tipada del proveedor.
   * @throws Error si la configuración es inválida, el proveedor no existe o aún no está implementado.
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
        throw new Error(
          "El proveedor de autenticación 'self_hosted' aún no está disponible ni implementado en esta versión de SiteCorp."
        )

      default: {
        const unknownType = (config as { type: string }).type
        throw new Error(
          `Proveedor de autenticación no reconocido: '${unknownType}'. Los proveedores válidos son 'supabase' o 'self_hosted'.`
        )
      }
    }
  }
}

/**
 * Función auxiliar para crear proveedores sin instanciar la clase factoría directamente.
 */
export function createAuthenticationProvider(config: AuthProviderConfig): IAuthenticationProvider {
  return AuthProviderFactory.create(config)
}
