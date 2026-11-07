import {
  AuthSession,
  RefreshToken,
  UserId,
  createUserId,
} from "../../domain";
import {
  AtomicRotateResult,
  IDatabaseClient,
  IDatabaseExecutor,
  ISessionRepository,
  ITransactionManager,
} from "../../interfaces";

interface SessionRow {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  is_revoked: boolean;
  revoked_at: Date | string | null;
  revoke_reason: string | null;
  created_at: Date | string;
  last_activity_at: Date | string;
  expires_at: Date | string;
  [column: string]: unknown;
}

interface RefreshTokenRow {
  id: string;
  session_id: string;
  token_hash: string;
  family_id: string;
  is_revoked: boolean;
  revoked_at: Date | string | null;
  replaced_by_token_id: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  [column: string]: unknown;
}

interface UserLockCheckRow {
  id: string;
  status: string;
  deleted_at: Date | string | null;
  locked_until: Date | string | null;
  [column: string]: unknown;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

/**
 * Repositorio PostgreSQL de Sesiones y Refresh Tokens (`sitecorp_auth.sessions`, `sitecorp_auth.refresh_tokens`).
 *
 * Cumple rigurosamente con la arquitectura de seguridad transaccional de la Fase 4F.1.1:
 * 1. Jerarquía canónica de bloqueos:
 *    Nivel 1 (`users`) -> Nivel 3 (`sessions` ORDER BY id ASC) -> Nivel 4 (`refresh_tokens` ORDER BY id ASC).
 * 2. Revalidación obligatoria de usuario, sesión, familia y token DESPUÉS de adquirir los bloqueos.
 * 3. Persistencia irreversible ante detección de reuso (`ALREADY_REVOKED`):
 *    Ejecuta su propia transacción confirmada (`COMMIT`) antes de devolver el resultado de fallo
 *    al caso de uso, de forma que la excepción posterior `TokenReuseDetectedError` jamás revierta
 *    la revocación de la familia ni de la sesión.
 */
export class PostgresSessionRepository implements ISessionRepository {
  constructor(
    private readonly db: IDatabaseClient,
    private readonly txManager?: ITransactionManager
  ) {}

  private mapSessionRow(row: SessionRow): AuthSession {
    return AuthSession.reconstitute({
      id: row.id,
      userId: createUserId(row.user_id),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      isRevoked: Boolean(row.is_revoked),
      createdAt: toDate(row.created_at),
      lastActivityAt: toDate(row.last_activity_at),
      expiresAt: toDate(row.expires_at),
    });
  }

  private mapTokenRow(row: RefreshTokenRow): RefreshToken {
    return RefreshToken.reconstitute({
      id: row.id,
      sessionId: row.session_id,
      tokenHash: row.token_hash.trim(),
      familyId: row.family_id,
      isRevoked: Boolean(row.is_revoked),
      replacedByTokenId: row.replaced_by_token_id,
      createdAt: toDate(row.created_at),
      expiresAt: toDate(row.expires_at),
    });
  }

  private async runWithExecutor<T>(
    fn: (executor: IDatabaseExecutor) => Promise<T>
  ): Promise<T> {
    if (this.db.isInTransaction()) {
      return fn(this.db.getActiveExecutor());
    }
    if (this.txManager) {
      return this.txManager.runInTransaction((tx) => fn(tx.executor));
    }
    return fn(this.db.getActiveExecutor());
  }

  async createSession(session: AuthSession): Promise<void> {
    const nowIso = session.createdAt.toISOString();
    await this.db.getActiveExecutor().query(
      `INSERT INTO sitecorp_auth.sessions (
         id, user_id, ip_address, user_agent, is_revoked, revoked_at, revoke_reason,
         created_at, last_activity_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        session.id,
        session.userId,
        session.ipAddress,
        session.userAgent,
        session.isRevoked,
        session.isRevoked ? nowIso : null,
        session.isRevoked ? "MANUAL_REVOKE" : null,
        session.createdAt,
        session.lastActivityAt,
        session.expiresAt,
      ]
    );
  }

  async findSessionById(id: string): Promise<AuthSession | null> {
    const result = await this.db.getActiveExecutor().query<SessionRow>(
      `SELECT
         id, user_id, ip_address, user_agent, is_revoked, revoked_at, revoke_reason,
         created_at, last_activity_at, expires_at
       FROM sitecorp_auth.sessions
       WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? this.mapSessionRow(row) : null;
  }

  async updateSession(session: AuthSession): Promise<void> {
    const result = await this.db.getActiveExecutor().query(
      `UPDATE sitecorp_auth.sessions
       SET
         ip_address = $2,
         user_agent = $3,
         is_revoked = $4,
         revoked_at = CASE
           WHEN $4 = TRUE AND revoked_at IS NULL THEN CURRENT_TIMESTAMP
           WHEN $4 = FALSE THEN NULL
           ELSE revoked_at
         END,
         revoke_reason = CASE
           WHEN $4 = TRUE AND revoke_reason IS NULL THEN 'SESSION_UPDATED'
           WHEN $4 = FALSE THEN NULL
           ELSE revoke_reason
         END,
         last_activity_at = $5,
         expires_at = $6
       WHERE id = $1`,
      [
        session.id,
        session.ipAddress,
        session.userAgent,
        session.isRevoked,
        session.lastActivityAt,
        session.expiresAt,
      ]
    );

    if (result.rowCount === 0) {
      throw new Error(`Sesión '${session.id}' no encontrada para actualizar.`);
    }
  }

  async revokeSession(id: string): Promise<void> {
    await this.runWithExecutor(async (executor) => {
      // Bloquear sesión primero (Nivel 3) y luego sus tokens en orden determinista (Nivel 4)
      const sessionCheck = await executor.query<{ id: string }>(
        `SELECT id FROM sitecorp_auth.sessions WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (sessionCheck.rows.length === 0) {
        return;
      }

      await executor.query(
        `SELECT id FROM sitecorp_auth.refresh_tokens WHERE session_id = $1 ORDER BY id ASC FOR UPDATE`,
        [id]
      );

      const nowIso = new Date().toISOString();
      await executor.query(
        `UPDATE sitecorp_auth.sessions
         SET is_revoked = TRUE,
             revoked_at = COALESCE(revoked_at, $2::timestamptz),
             revoke_reason = COALESCE(revoke_reason, 'SESSION_REVOKED')
         WHERE id = $1 AND is_revoked = FALSE`,
        [id, nowIso]
      );

      await executor.query(
        `UPDATE sitecorp_auth.refresh_tokens
         SET is_revoked = TRUE,
             revoked_at = COALESCE(revoked_at, $2::timestamptz)
         WHERE session_id = $1 AND is_revoked = FALSE`,
        [id, nowIso]
      );
    });
  }

  async revokeAllUserSessions(userId: UserId): Promise<void> {
    await this.runWithExecutor(async (executor) => {
      // Nivel 1: Bloquear fila de usuario si aún no está bloqueada en la transacción
      await executor.query(
        `SELECT id FROM sitecorp_auth.users WHERE id = $1 FOR UPDATE`,
        [userId]
      );

      // Nivel 3: Bloquear todas las sesiones del usuario en ORDER BY id ASC
      const sessionsRes = await executor.query<{ id: string }>(
        `SELECT id
         FROM sitecorp_auth.sessions
         WHERE user_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [userId]
      );

      if (sessionsRes.rows.length === 0) {
        return;
      }

      // Nivel 4: Bloquear todos los refresh tokens de esas sesiones en ORDER BY id ASC
      await executor.query(
        `SELECT rt.id
         FROM sitecorp_auth.refresh_tokens rt
         INNER JOIN sitecorp_auth.sessions s ON s.id = rt.session_id
         WHERE s.user_id = $1
         ORDER BY rt.id ASC
         FOR UPDATE OF rt`,
        [userId]
      );

      const nowIso = new Date().toISOString();
      await executor.query(
        `UPDATE sitecorp_auth.sessions
         SET is_revoked = TRUE,
             revoked_at = COALESCE(revoked_at, $2::timestamptz),
             revoke_reason = COALESCE(revoke_reason, 'ALL_USER_SESSIONS_REVOKED')
         WHERE user_id = $1 AND is_revoked = FALSE`,
        [userId, nowIso]
      );

      await executor.query(
        `UPDATE sitecorp_auth.refresh_tokens
         SET is_revoked = TRUE,
             revoked_at = COALESCE(revoked_at, $2::timestamptz)
         WHERE session_id IN (
           SELECT id FROM sitecorp_auth.sessions WHERE user_id = $1
         ) AND is_revoked = FALSE`,
        [userId, nowIso]
      );
    });
  }

  async createRefreshToken(token: RefreshToken): Promise<void> {
    const nowIso = token.createdAt.toISOString();
    await this.db.getActiveExecutor().query(
      `INSERT INTO sitecorp_auth.refresh_tokens (
         id, session_id, token_hash, family_id, is_revoked, revoked_at,
         replaced_by_token_id, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        token.id,
        token.sessionId,
        token.tokenHash,
        token.familyId,
        token.isRevoked,
        token.isRevoked ? nowIso : null,
        token.replacedByTokenId,
        token.createdAt,
        token.expiresAt,
      ]
    );
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    const result = await this.db.getActiveExecutor().query<RefreshTokenRow>(
      `SELECT
         id, session_id, token_hash, family_id, is_revoked, revoked_at,
         replaced_by_token_id, created_at, expires_at
       FROM sitecorp_auth.refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );
    const row = result.rows[0];
    return row ? this.mapTokenRow(row) : null;
  }

  async rotateRefreshToken(oldTokenId: string, newToken: RefreshToken): Promise<void> {
    await this.runWithExecutor(async (executor) => {
      const nowIso = newToken.createdAt.toISOString();
      await executor.query(
        `INSERT INTO sitecorp_auth.refresh_tokens (
           id, session_id, token_hash, family_id, is_revoked, revoked_at,
           replaced_by_token_id, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, FALSE, NULL, NULL, $5, $6)`,
        [
          newToken.id,
          newToken.sessionId,
          newToken.tokenHash,
          newToken.familyId,
          newToken.createdAt,
          newToken.expiresAt,
        ]
      );

      await executor.query(
        `UPDATE sitecorp_auth.refresh_tokens
         SET is_revoked = TRUE,
             revoked_at = COALESCE(revoked_at, $3::timestamptz),
             replaced_by_token_id = $2
         WHERE id = $1`,
        [oldTokenId, newToken.id, nowIso]
      );
    });
  }

  /**
   * Rotación Atómica con Orden Canónico de Bloqueos y Revalidación Post-Bloqueo.
   *
   * IMPORTANTE: Si se invoca fuera de una transacción, gestiona su propia transacción ACID
   * mediante `txManager.runInTransaction` y hace `COMMIT` tanto en la rama de éxito como en
   * la rama de revocación defensiva por reuso (`ALREADY_REVOKED`). Así, cuando el caso de uso
   * lanza `TokenReuseDetectedError`, la revocación de la familia ya está confirmada en PostgreSQL.
   */
  async rotateRefreshTokenAtomic(
    expectedOldTokenHash: string,
    newRawTokenHash: string,
    newTokenId: string,
    now: Date = new Date()
  ): Promise<AtomicRotateResult> {
    const executeLockedRotation = async (
      executor: IDatabaseExecutor
    ): Promise<AtomicRotateResult> => {
      const nowIso = now.toISOString();

      // Paso 0 (DENTRO de la misma transacción y mismo PoolClient):
      // Localizar metadatos estructurales del token objetivo para bloquear en orden canónico.
      const lookupRes = await executor.query<{
        token_id: string;
        session_id: string;
        family_id: string;
        user_id: string;
      }>(
        `SELECT
           rt.id AS token_id,
           rt.session_id,
           rt.family_id,
           s.user_id
         FROM sitecorp_auth.refresh_tokens rt
         INNER JOIN sitecorp_auth.sessions s ON s.id = rt.session_id
         WHERE rt.token_hash = $1`,
        [expectedOldTokenHash]
      );

      const targetMeta = lookupRes.rows[0];
      if (!targetMeta) {
        return { success: false, reason: "NOT_FOUND" };
      }

      // Paso 1: Adquirir bloqueos en Orden Canónico Estricto:
      // Nivel 1: sitecorp_auth.users
      const userLockRes = await executor.query<UserLockCheckRow>(
        `SELECT id, status, deleted_at, locked_until
         FROM sitecorp_auth.users
         WHERE id = $1
         FOR UPDATE`,
        [targetMeta.user_id]
      );

      // Nivel 3: sitecorp_auth.sessions
      const sessionLockRes = await executor.query<SessionRow>(
        `SELECT
           id, user_id, ip_address, user_agent, is_revoked, revoked_at, revoke_reason,
           created_at, last_activity_at, expires_at
         FROM sitecorp_auth.sessions
         WHERE id = $1
         FOR UPDATE`,
        [targetMeta.session_id]
      );

      // Nivel 4: sitecorp_auth.refresh_tokens de toda la familia en ORDER BY id ASC
      const familyTokensRes = await executor.query<RefreshTokenRow>(
        `SELECT
           id, session_id, token_hash, family_id, is_revoked, revoked_at,
           replaced_by_token_id, created_at, expires_at
         FROM sitecorp_auth.refresh_tokens
         WHERE family_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [targetMeta.family_id]
      );

      // Paso 2: Revalidación post-bloqueo de token, familia, sesión y usuario
      const oldTokenRow = familyTokensRes.rows.find(
        (r) => r.token_hash.trim() === expectedOldTokenHash
      );
      if (!oldTokenRow) {
        return { success: false, reason: "NOT_FOUND" };
      }

      const sessionRow = sessionLockRes.rows[0];
      const userRow = userLockRes.rows[0];

      // 2.A: ¿El token ya estaba revocado? -> Detección de Reuso (Robo de Token)
      if (oldTokenRow.is_revoked) {
        await executor.query(
          `UPDATE sitecorp_auth.refresh_tokens
           SET is_revoked = TRUE,
               revoked_at = COALESCE(revoked_at, $2::timestamptz)
           WHERE family_id = $1 AND is_revoked = FALSE`,
          [oldTokenRow.family_id, nowIso]
        );

        if (sessionRow) {
          await executor.query(
            `UPDATE sitecorp_auth.sessions
             SET is_revoked = TRUE,
                 revoked_at = COALESCE(revoked_at, $2::timestamptz),
                 revoke_reason = COALESCE(revoke_reason, 'TOKEN_REUSE_DETECTED')
             WHERE id = $1 AND is_revoked = FALSE`,
            [sessionRow.id, nowIso]
          );
          sessionRow.is_revoked = true;
          sessionRow.revoked_at = nowIso;
          sessionRow.revoke_reason = "TOKEN_REUSE_DETECTED";
        }

        // Retornamos un valor normal sin lanzar excepción para que runInTransaction haga COMMIT
        // y la revocación de toda la familia quede persistida irreversiblemente en PostgreSQL.
        return {
          success: false,
          reason: "ALREADY_REVOKED",
          familyId: oldTokenRow.family_id,
          session: sessionRow ? this.mapSessionRow(sessionRow) : null,
        };
      }

      // 2.B: ¿El token ha expirado? -> Marcar como revocado por expiración y rechazar
      const tokenExpiresAt = toDate(oldTokenRow.expires_at);
      if (tokenExpiresAt.getTime() <= now.getTime()) {
        await executor.query(
          `UPDATE sitecorp_auth.refresh_tokens
           SET is_revoked = TRUE,
               revoked_at = COALESCE(revoked_at, $2::timestamptz)
           WHERE id = $1 AND is_revoked = FALSE`,
          [oldTokenRow.id, nowIso]
        );
        return {
          success: false,
          reason: "EXPIRED",
          familyId: oldTokenRow.family_id,
        };
      }

      // 2.C: ¿La sesión existe, no está revocada y no ha expirado?
      if (!sessionRow || sessionRow.is_revoked) {
        await executor.query(
          `UPDATE sitecorp_auth.refresh_tokens
           SET is_revoked = TRUE,
               revoked_at = COALESCE(revoked_at, $2::timestamptz)
           WHERE family_id = $1 AND is_revoked = FALSE`,
          [oldTokenRow.family_id, nowIso]
        );
        return { success: false, reason: "SESSION_REVOKED" };
      }
      const sessionExpiresAt = toDate(sessionRow.expires_at);
      if (sessionExpiresAt.getTime() <= now.getTime()) {
        await executor.query(
          `UPDATE sitecorp_auth.sessions
           SET is_revoked = TRUE,
               revoked_at = COALESCE(revoked_at, $2::timestamptz),
               revoke_reason = COALESCE(revoke_reason, 'SESSION_EXPIRED')
           WHERE id = $1 AND is_revoked = FALSE`,
          [sessionRow.id, nowIso]
        );
        await executor.query(
          `UPDATE sitecorp_auth.refresh_tokens
           SET is_revoked = TRUE,
               revoked_at = COALESCE(revoked_at, $2::timestamptz)
           WHERE session_id = $1 AND is_revoked = FALSE`,
          [sessionRow.id, nowIso]
        );
        return { success: false, reason: "SESSION_EXPIRED" };
      }

      // 2.D: ¿El usuario sigue activo y no fue suspendido, eliminado ni bloqueado en paralelo?
      const isUserLocked =
        userRow?.locked_until !== null &&
        userRow?.locked_until !== undefined &&
        toDate(userRow.locked_until).getTime() > now.getTime();

      if (
        !userRow ||
        userRow.status === "suspended" ||
        userRow.status === "deleted" ||
        userRow.deleted_at !== null ||
        isUserLocked
      ) {
        await executor.query(
          `UPDATE sitecorp_auth.sessions
           SET is_revoked = TRUE,
               revoked_at = COALESCE(revoked_at, $2::timestamptz),
               revoke_reason = COALESCE(revoke_reason, 'USER_CANNOT_AUTHENTICATE')
           WHERE id = $1 AND is_revoked = FALSE`,
          [sessionRow.id, nowIso]
        );
        await executor.query(
          `UPDATE sitecorp_auth.refresh_tokens
           SET is_revoked = TRUE,
               revoked_at = COALESCE(revoked_at, $2::timestamptz)
           WHERE family_id = $1 AND is_revoked = FALSE`,
          [oldTokenRow.family_id, nowIso]
        );
        return { success: false, reason: "SESSION_REVOKED" };
      }

      // Paso 3: Rotación atómica exitosa
      const newToken = RefreshToken.create(
        newTokenId,
        oldTokenRow.session_id,
        newRawTokenHash,
        oldTokenRow.family_id,
        { now }
      );

      // 3.1 Insertar primero el nuevo token hijo (para satisfacer fk_refresh_tokens_replaced_by)
      await executor.query(
        `INSERT INTO sitecorp_auth.refresh_tokens (
           id, session_id, token_hash, family_id, is_revoked, revoked_at,
           replaced_by_token_id, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, FALSE, NULL, NULL, $5, $6)`,
        [
          newToken.id,
          newToken.sessionId,
          newToken.tokenHash,
          newToken.familyId,
          newToken.createdAt,
          newToken.expiresAt,
        ]
      );

      // 3.2 Marcar el token anterior como revocado y apuntar al nuevo token hijo
      //     Invariante estricta en WHERE: exige que el token padre siga sin revocar y sin hijo previo.
      const updateParentRes = await executor.query(
        `UPDATE sitecorp_auth.refresh_tokens
         SET is_revoked = TRUE,
             revoked_at = $3::timestamptz,
             replaced_by_token_id = $2
         WHERE id = $1
           AND is_revoked = FALSE
           AND replaced_by_token_id IS NULL`,
        [oldTokenRow.id, newToken.id, nowIso]
      );

      if (updateParentRes.rowCount !== 1) {
        throw new Error(
          `Invariante de concurrencia violada: el refresh token padre '${oldTokenRow.id}' ya fue consumido.`
        );
      }

      // 3.3 Actualizar marca de última actividad de la sesión
      await executor.query(
        `UPDATE sitecorp_auth.sessions
         SET last_activity_at = GREATEST(created_at, $2::timestamptz)
         WHERE id = $1`,
        [sessionRow.id, nowIso]
      );

      oldTokenRow.is_revoked = true;
      oldTokenRow.revoked_at = nowIso;
      oldTokenRow.replaced_by_token_id = newToken.id;
      sessionRow.last_activity_at = nowIso;

      return {
        success: true,
        session: this.mapSessionRow(sessionRow),
        oldToken: this.mapTokenRow(oldTokenRow),
        newToken,
      };
    };

    return this.runWithExecutor(executeLockedRotation);
  }

  async revokeTokenFamily(familyId: string): Promise<void> {
    await this.runWithExecutor(async (executor) => {
      await executor.query(
        `SELECT id
         FROM sitecorp_auth.refresh_tokens
         WHERE family_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [familyId]
      );

      const nowIso = new Date().toISOString();
      await executor.query(
        `UPDATE sitecorp_auth.refresh_tokens
         SET is_revoked = TRUE,
             revoked_at = COALESCE(revoked_at, $2::timestamptz)
         WHERE family_id = $1 AND is_revoked = FALSE`,
        [familyId, nowIso]
      );
    });
  }
}
