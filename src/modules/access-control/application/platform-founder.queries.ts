import {
  rpcIsPlatformFounder,
  selectPlatformFounderId,
} from "../infrastructure/platform-founder.repository"

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

/**
 * UUID de la cuenta fundadora, si ya está designada.
 *
 * Permite que la pantalla de usuarios cierre la fila del fundador (eliminar y desactivar) para
 * CUALQUIER SuperAdmin, no sólo para la propia cuenta fundadora. `null` significa «no
 * identificada» (migración sin aplicar o sin permiso de lectura) y no cambia el comportamiento
 * previo: el servidor sigue siendo quien autoriza.
 */
export async function loadPlatformFounderId(): Promise<string | null> {
  return selectPlatformFounderId()
}
