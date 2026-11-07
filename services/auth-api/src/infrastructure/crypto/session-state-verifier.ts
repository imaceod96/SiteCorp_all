import {
  AuthSession,
  AuthUser,
  SessionInvalidError,
  TokenInvalidError,
} from "../../domain";
import {
  AccessTokenPayload,
  ISessionRepository,
  IUserRepository,
} from "../../interfaces";
import { isValidSessionId } from "./jose-token.service";

export interface VerifiedSessionState {
  readonly user: AuthUser;
  readonly session: AuthSession;
  readonly claims: AccessTokenPayload;
}

/**
 * Mecanismo canónico de comprobación de estado de sesión para operaciones protegidas.
 *
 * ARQUITECTURA DE REVOCACIÓN DE SESIONES (FASE 4G.1.1):
 * 1. `JoseTokenService.verifyAccessToken(jwt)` realiza la verificación criptográfica
 *    asimétrica stateless (`Ed25519`), garantizando autenticidad, integridad, vigencia (`exp`)
 *    y formato del identificador de sesión vinculado (`sid`).
 * 2. Sin embargo, dado que un JWT es autocontenido, cuando una sesión se revoca en PostgreSQL
 *    mediante:
 *    - `LogoutUseCase` (cierre de sesión individual o global),
 *    - `ChangePasswordUseCase` (incremento de versión de credencial y revocación de sesiones),
 *    - `AdminUpdateStatusUseCase` (suspensión o baja lógica `deleted`), o
 *    - `RefreshSessionUseCase` (detección de reuso de refresh token `TOKEN_REUSE_DETECTED`),
 *    el JWT emitido con anterioridad NO queda invalidado sólo por su firma antes de `exp`.
 * 3. Por ello, todo endpoint protegido que requiera revocación inmediata (o el futuro
 *    guard de autenticación HTTP) DEBE invocar `verifyAccessTokenSessionState()` tras
 *    verificar la firma del JWT. Esta función:
 *    - Exige que el JWT contenga un `sid` válido (`sess_<uuid>`).
 *    - Consulta la sesión en `ISessionRepository` y verifica `session.isValid(now)`
 *      (`!session.isRevoked` y `now < session.expiresAt`).
 *    - Comprueba la correspondencia inequívoca `session.userId === claims.sub`.
 *    - Consulta el usuario en `IUserRepository`, verifica que no esté eliminado (`deleted`),
 *      suspendido (`UserSuspendedError`) ni bloqueado (`AccountLockedError`).
 *    - Verifica la coherencia del rol restringido (`pending_password_change`) frente al
 *      estado actual de `user.mustChangePassword`.
 */
export async function verifyAccessTokenSessionState(
  claims: AccessTokenPayload,
  sessionRepo: ISessionRepository,
  userRepo: IUserRepository,
  now: Date = new Date()
): Promise<VerifiedSessionState> {
  if (!claims || typeof claims !== "object") {
    throw new TokenInvalidError("Los claims del token son obligatorios.");
  }

  if (!isValidSessionId(claims.sid)) {
    throw new SessionInvalidError(
      "El token de acceso no contiene un identificador de sesión ('sid') válido."
    );
  }

  const session = await sessionRepo.findSessionById(claims.sid);
  if (!session || !session.isValid(now)) {
    throw new SessionInvalidError(
      "La sesión vinculada al token no existe, ha sido revocada o ha expirado."
    );
  }

  if (session.userId !== claims.sub) {
    throw new TokenInvalidError(
      "Inconsistencia crítica: el 'sub' del token no coincide con el propietario de la sesión ('sid')."
    );
  }

  const user = await userRepo.findById(claims.sub);
  if (!user || user.status === "deleted" || user.deletedAt !== null) {
    throw new SessionInvalidError(
      "La cuenta de usuario asociada a la sesión no existe o ha sido dada de baja."
    );
  }

  user.ensureCanAuthenticate(now);

  const requiresPasswordChange =
    user.mustChangePassword || user.status === "pending_password_change";

  if (
    requiresPasswordChange &&
    (claims.role !== "pending_password_change" ||
      claims.scope !== "auth:change_password")
  ) {
    throw new SessionInvalidError(
      "El usuario tiene un cambio obligatorio de contraseña pendiente; el token con rol completo ya no es válido."
    );
  }

  return Object.freeze({
    user,
    session,
    claims,
  });
}
