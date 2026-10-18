import { rpcIsPlatformFounder } from "../infrastructure/platform-founder.repository"

/**
 * Control de acceso — Consulta del fundador (aplicación).
 *
 * Indica si la SESIÓN actual es la cuenta fundadora de SiteCorp. Es la única pregunta que
 * necesita la interfaz para decidir si muestra los controles del rol SuperAdmin; la
 * autorización real la aplica la base (disparador de `platform_user_roles`).
 */
export async function loadIsPlatformFounder(): Promise<boolean> {
  return rpcIsPlatformFounder()
}
