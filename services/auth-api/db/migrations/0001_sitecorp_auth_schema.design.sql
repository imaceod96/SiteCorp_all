-- =============================================================================
-- SITECORP AUTH API — DISEÑO DEL ESQUEMA DE PERSISTENCIA POSTGRESQL (FASE 4F.1.1)
-- =============================================================================
-- ADVERTENCIA DE SEGURIDAD Y OPERACIÓN:
-- 1. ESTE ARCHIVO ES EXCLUSIVAMENTE DE DISEÑO TÉCNICO (BLUEPRINT).
-- 2. NO DEBE EJECUTARSE EN SUPABASE CLOUD NI EN PRODUCCIÓN.
-- 3. DISEÑADO PARA UN MOTOR POSTGRESQL ESTÁNDAR AUTOGESTIONADO (COMPATIBLE
--    CON INFRAESTRUCTURA ETECSA, SIN EXTENSIONES PROPIETARIAS NI SUPABASE).
-- 4. LOS UUID SE GENERAN EN LA CAPA DE APLICACIÓN (Node.js crypto.randomUUID()),
--    POR LO QUE NO REQUIERE OBLIGATORIAMENTE pgcrypto NI PostgreSQL 13+.
-- =============================================================================

BEGIN;

-- 1. Creación del esquema aislado
CREATE SCHEMA IF NOT EXISTS sitecorp_auth;

-- 2. Tabla de control de migraciones del esquema sitecorp_auth
-- Incluye soporte explícito de estado ('applied', 'failed', 'rolled_back')
-- y coordinación mediante pg_try_advisory_lock en el ejecutor de migraciones.
CREATE TABLE IF NOT EXISTS sitecorp_auth.schema_migrations (
    version         VARCHAR(64) PRIMARY KEY,
    description     VARCHAR(255) NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'applied',
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_by      VARCHAR(128) NOT NULL DEFAULT CURRENT_USER,
    execution_ms    INTEGER NOT NULL CHECK (execution_ms >= 0),

    CONSTRAINT chk_schema_migrations_status CHECK (
        status IN ('applied', 'failed', 'rolled_back')
    ),
    CONSTRAINT chk_schema_migrations_checksum_hex CHECK (
        checksum_sha256 ~ '^[0-9a-f]{64}$'
    )
);

-- =============================================================================
-- 3. TABLA: sitecorp_auth.users
-- =============================================================================
-- Almacena la identidad nuclear de autenticación y el estado del ciclo de vida.
-- El identificador `id` (UUID v4) es estable y compatible 1:1 con `public.profiles(id)`
-- y demás claves foráneas de negocio de SiteCorp.
CREATE TABLE IF NOT EXISTS sitecorp_auth.users (
    id                      UUID PRIMARY KEY,
    email                   VARCHAR(255) NOT NULL,
    email_normalized        VARCHAR(255) NOT NULL,
    status                  VARCHAR(32) NOT NULL DEFAULT 'active',
    must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at              TIMESTAMPTZ NULL,

    -- Restricciones de dominio
    CONSTRAINT chk_users_status CHECK (
        status IN ('active', 'suspended', 'pending_password_change', 'deleted')
    ),
    CONSTRAINT chk_users_email_normalized CHECK (
        email_normalized = lower(btrim(email))
        AND char_length(email_normalized) >= 3
        AND char_length(email_normalized) <= 255
    ),
    CONSTRAINT chk_users_failed_attempts_non_negative CHECK (
        failed_login_attempts >= 0
    ),
    CONSTRAINT chk_users_deleted_consistency CHECK (
        (status = 'deleted' AND deleted_at IS NOT NULL)
        OR (status <> 'deleted' AND deleted_at IS NULL)
    ),
    CONSTRAINT chk_users_pending_password_consistency CHECK (
        status <> 'pending_password_change' OR must_change_password = TRUE
    ),
    CONSTRAINT chk_users_updated_at_order CHECK (
        updated_at >= created_at
    )
);

-- Unicidad estricta sobre el correo normalizado para impedir duplicidad de identidades
-- (incluyendo variantes con mayúsculas o espacios).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sitecorp_auth_users_email_normalized
    ON sitecorp_auth.users (email_normalized);

-- Índice para filtrado rápido de cuentas activas/bloqueadas
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_users_status
    ON sitecorp_auth.users (status)
    WHERE deleted_at IS NULL;

-- =============================================================================
-- 4. TABLA: sitecorp_auth.user_credentials
-- =============================================================================
-- Separación estricta entre la entidad de identidad (`users`) y el material
-- criptográfico (`user_credentials`). Nunca almacena contraseñas en claro.
-- Soporta rotación de algoritmo (Argon2id primario, compatibilidad bcrypt si se
-- migran hashes preexistentes) y control de versiones de credencial.
-- NOTA DE INTEGRIDAD: `ON DELETE RESTRICT` impide la eliminación física accidental
-- de un usuario mientras conserve credenciales; la baja operativa en SiteCorp es
-- siempre lógica (`status = 'deleted'`, `deleted_at = NOW()`).
CREATE TABLE IF NOT EXISTS sitecorp_auth.user_credentials (
    id                  VARCHAR(64) PRIMARY KEY,
    user_id             UUID NOT NULL,
    algorithm           VARCHAR(32) NOT NULL DEFAULT 'argon2id',
    password_hash       TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_credentials_user
        FOREIGN KEY (user_id)
        REFERENCES sitecorp_auth.users (id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_credentials_user_id
        UNIQUE (user_id),

    CONSTRAINT chk_credentials_algorithm CHECK (
        algorithm IN ('argon2id', 'bcrypt')
    ),
    CONSTRAINT chk_credentials_version_positive CHECK (
        version >= 1
    ),
    CONSTRAINT chk_credentials_hash_not_empty CHECK (
        char_length(btrim(password_hash)) >= 20
    ),
    CONSTRAINT chk_credentials_updated_at_order CHECK (
        updated_at >= created_at
    )
);

-- =============================================================================
-- 5. TABLA: sitecorp_auth.sessions
-- =============================================================================
-- Representa una sesión autenticada de un dispositivo/cliente.
-- Su revocación invalida inmediatamente cualquier renovación de tokens asociada.
-- Actúa como raíz de bloqueo (mutex de sesión/familia) durante rotaciones concurrentes.
CREATE TABLE IF NOT EXISTS sitecorp_auth.sessions (
    id                  VARCHAR(64) PRIMARY KEY,
    user_id             UUID NOT NULL,
    ip_address          VARCHAR(64) NULL,
    user_agent          VARCHAR(512) NULL,
    is_revoked          BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at          TIMESTAMPTZ NULL,
    revoke_reason       VARCHAR(64) NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          TIMESTAMPTZ NOT NULL,

    CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id)
        REFERENCES sitecorp_auth.users (id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_sessions_expiration_valid CHECK (
        expires_at > created_at
    ),
    CONSTRAINT chk_sessions_revocation_consistency CHECK (
        (is_revoked = TRUE AND revoked_at IS NOT NULL)
        OR (is_revoked = FALSE AND revoked_at IS NULL AND revoke_reason IS NULL)
    )
);

-- Índice compuesto para revocación masiva y consulta de sesiones activas por usuario
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_sessions_user_active
    ON sitecorp_auth.sessions (user_id, is_revoked, expires_at);

-- Índice para tareas programadas de purga de sesiones expiradas
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_sessions_expires_at
    ON sitecorp_auth.sessions (expires_at);

-- =============================================================================
-- 6. TABLA: sitecorp_auth.refresh_tokens
-- =============================================================================
-- Almacena EXCLUSIVAMENTE el hash SHA-256 (hexadecimal en minúsculas de 64 caracteres)
-- del refresh token opaco. Nunca almacena el token crudo (`rawToken`).
-- Agrupa los tokens en familias (`family_id`) para detección de robo/reuso.
CREATE TABLE IF NOT EXISTS sitecorp_auth.refresh_tokens (
    id                      VARCHAR(64) PRIMARY KEY,
    session_id              VARCHAR(64) NOT NULL,
    token_hash              CHAR(64) NOT NULL,
    family_id               VARCHAR(64) NOT NULL,
    is_revoked              BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at              TIMESTAMPTZ NULL,
    replaced_by_token_id    VARCHAR(64) NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at              TIMESTAMPTZ NOT NULL,

    -- `ON DELETE CASCADE` respecto a `sessions` permite que la tarea de mantenimiento
    -- purgue físicamente sesiones caducadas hace >30 días junto con sus tokens.
    CONSTRAINT fk_refresh_tokens_session
        FOREIGN KEY (session_id)
        REFERENCES sitecorp_auth.sessions (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_refresh_tokens_replaced_by
        FOREIGN KEY (replaced_by_token_id)
        REFERENCES sitecorp_auth.refresh_tokens (id)
        ON DELETE SET NULL,

    CONSTRAINT chk_refresh_tokens_hash_format CHECK (
        token_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT chk_refresh_tokens_not_self_replaced CHECK (
        replaced_by_token_id IS NULL OR replaced_by_token_id <> id
    ),
    CONSTRAINT chk_refresh_tokens_revocation_consistency CHECK (
        (is_revoked = TRUE AND revoked_at IS NOT NULL)
        OR (is_revoked = FALSE AND revoked_at IS NULL AND replaced_by_token_id IS NULL)
    ),
    CONSTRAINT chk_refresh_tokens_expiration_valid CHECK (
        expires_at > created_at
    )
);

-- Búsqueda O(1) por hash durante rotación y logout
CREATE UNIQUE INDEX IF NOT EXISTS uq_sitecorp_auth_refresh_tokens_hash
    ON sitecorp_auth.refresh_tokens (token_hash);

-- Índice crítico para invalidación inmediata de toda una familia ante detección de reuso
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_refresh_tokens_family_id
    ON sitecorp_auth.refresh_tokens (family_id, is_revoked);

-- Índice para revocación en cascada lógica por sesión
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_refresh_tokens_session_id
    ON sitecorp_auth.refresh_tokens (session_id, is_revoked);

-- Índice en la autorreferencia `replaced_by_token_id` para evitar Seq Scan
-- cuando se purgan o actualizan tokens padres/hijos
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_refresh_tokens_replaced_by
    ON sitecorp_auth.refresh_tokens (replaced_by_token_id)
    WHERE replaced_by_token_id IS NOT NULL;

-- =============================================================================
-- 7. TABLA: sitecorp_auth.security_audit_events
-- =============================================================================
-- Registro inmutable (append-only) de eventos de seguridad.
-- `user_id` es anulable y usa ON DELETE SET NULL para preservar la evidencia
-- forense incluso si un registro de usuario de prueba llegara a purgarse.
CREATE TABLE IF NOT EXISTS sitecorp_auth.security_audit_events (
    id                  UUID PRIMARY KEY,
    event_type          VARCHAR(64) NOT NULL,
    user_id             UUID NULL,
    ip_address          VARCHAR(64) NULL,
    user_agent          VARCHAR(512) NULL,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_security_audit_user
        FOREIGN KEY (user_id)
        REFERENCES sitecorp_auth.users (id)
        ON DELETE SET NULL,

    CONSTRAINT chk_security_audit_metadata_object CHECK (
        jsonb_typeof(metadata) = 'object'
    ),
    CONSTRAINT chk_security_audit_event_type CHECK (
        event_type IN (
            'LOGIN_SUCCESS',
            'LOGIN_FAILED',
            'LOGOUT',
            'TOKEN_ROTATED',
            'TOKEN_REUSE_DETECTED',
            'PASSWORD_CHANGED',
            'PASSWORD_RESET_REQUESTED',
            'PASSWORD_RESET_COMPLETED',
            'ACCOUNT_LOCKED',
            'ACCOUNT_UNLOCKED',
            'USER_CREATED',
            'USER_SUSPENDED',
            'USER_ACTIVATED',
            'USER_DELETED'
        )
    )
);

-- Índices para auditoría por usuario y línea temporal
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_audit_user_occurred
    ON sitecorp_auth.security_audit_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_audit_type_occurred
    ON sitecorp_auth.security_audit_events (event_type, occurred_at DESC);

COMMIT;
