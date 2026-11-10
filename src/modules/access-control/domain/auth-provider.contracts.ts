/**
 * Control de acceso — Contratos del motor de autenticación autogestionado.
 *
 * Define la abstracción tecnológica para el servicio de autenticación (IdP),
 * permitiendo sustituir o alternar proveedores (Supabase Auth Cloud, GoTrue
 * autohospedado, servicio nativo) sin acoplar la aplicación a implementaciones
 * externas ni introducir dependencias de red.
 *
 * SEPARACIÓN DE CONCEPTOS:
 *   - Autenticación: verificación de credenciales (correo/contraseña), emisión,
 *     renovación y revocación de tokens de acceso/sesión.
 *   - Identidad: datos del sujeto autenticado emitidos por el IdP (ID único, correo).
 *   - Autorización: perfiles, membresías, roles y permisos de negocio de SiteCorp
 *     (definidos en `entities.ts` y resueltos por la base de datos).
 */

/**
 * Identidad base del usuario según el proveedor de autenticación.
 * Representa únicamente al sujeto verificado, sin perfiles ni permisos de negocio.
 */
export interface AuthUserIdentity {
  /** Identificador único inmutable (UUID v4) del usuario. */
  id: string
  /** Correo electrónico principal del usuario autenticado. */
  email: string
  /** Marca temporal ISO de confirmación de correo (si aplica). */
  confirmedAt?: string | null
  /** Marca temporal ISO de creación de la cuenta en el IdP. */
  createdAt?: string
}

/**
 * Sesión de autenticación activa emitida por el proveedor.
 */
export interface AuthSession {
  /** Token de acceso JWT firmado por el proveedor (Bearer token). */
  accessToken: string
  /** Token de refresco opcional para renovar la sesión sin credenciales. */
  refreshToken?: string
  /** Tiempo de expiración del token en segundos desde epoch (UNIX timestamp). */
  expiresAt?: number
  /** Identidad del usuario asociado a la sesión. */
  user: AuthUserIdentity
}

/**
 * Tipos de eventos emitidos al cambiar el estado de la sesión.
 */
export type AuthStateChangeEventType =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY"

/**
 * Notificación de cambio de estado en la suscripción de autenticación.
 */
export interface AuthStateChangeEvent {
  event: AuthStateChangeEventType
  session: AuthSession | null
}

/**
 * Parámetros para iniciar sesión mediante correo y contraseña.
 */
export interface AuthSignInCredentials {
  email: string
  password: string
}

/**
 * Resultado del intento de inicio de sesión.
 */
export interface AuthSignInResult {
  session: AuthSession | null
  error: string | null
}

/**
 * Parámetros para solicitar recuperación de contraseña.
 */
export interface AuthPasswordRecoveryInput {
  email: string
  /** URL de redirección local o endpoint para captura del token. */
  redirectTo?: string
}

/**
 * Resultado de una solicitud de recuperación de contraseña.
 */
export interface AuthPasswordRecoveryResult {
  success: boolean
  error: string | null
}

/**
 * Parámetros para actualizar la contraseña del usuario con sesión activa.
 */
export interface AuthUpdatePasswordInput {
  newPassword: string
}

/**
 * Resultado de la actualización de contraseña.
 */
export interface AuthUpdatePasswordResult {
  success: boolean
  error: string | null
}

/**
 * Contrato principal del servicio de autenticación (puerto de infraestructura).
 *
 * Cualquier proveedor (Supabase Auth Cloud, GoTrue local, servicio nativo Linux)
 * debe implementar esta interfaz para ser consumido por SiteCorp.
 */
export interface IAuthenticationProvider {
  /**
   * Consulta la sesión actualmente almacenada en el cliente o memoria.
   * Devuelve null si no existe sesión activa o expiró.
   */
  getSession(): Promise<AuthSession | null>

  /**
   * Inicia sesión con credenciales básicas de correo y contraseña.
   */
  signInWithPassword(credentials: AuthSignInCredentials): Promise<AuthSignInResult>

  /**
   * Cierra la sesión activa revocando tokens locales y del servidor.
   */
  signOut(): Promise<void>

  /**
   * Renueva el token de acceso utilizando el refresh token de la sesión activa.
   */
  refreshToken(): Promise<AuthSession | null>

  /**
   * Actualiza la contraseña del usuario actualmente autenticado.
   */
  updatePassword(input: AuthUpdatePasswordInput): Promise<AuthUpdatePasswordResult>

  /**
   * Inicia el flujo de recuperación de contraseña para un correo dado.
   */
  requestPasswordRecovery(input: AuthPasswordRecoveryInput): Promise<AuthPasswordRecoveryResult>

  /**
   * Se suscribe a eventos del ciclo de vida de la sesión.
   * Devuelve una función para cancelar la suscripción.
   */
  subscribeToAuthChanges(callback: (event: AuthStateChangeEvent) => void): () => void

  /**
   * Devuelve el ID único del usuario actualmente autenticado, o null si no hay sesión.
   */
  getCurrentUserId(): Promise<string | null>
}
