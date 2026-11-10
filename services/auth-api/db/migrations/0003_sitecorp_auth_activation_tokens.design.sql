-- =============================================================================
-- SITECORP AUTHENTICATION SUBSYSTEM — POSTGRESQL DDL MIGRATION (FASE 4G.5)
-- =============================================================================
-- Migración: 0003_sitecorp_auth_activation_tokens
-- Esquema: sitecorp_auth
-- Descripción:
--   1. Añade soporte nativo de multiempresa / multiinquilino (`tenant_id`) a `sitecorp_auth.users`.
--   2. Implementa la tabla autoritativa de tokens de un solo uso para activación
--      de usuarios importados y restablecimiento de contraseña (`sitecorp_auth.activation_tokens`).
--   3. Almacena exclusivamente el hash SHA-256 del token (nunca el token en claro).
--   4. Garantiza caducidad, consumo atómico único y auditoría de IP/UserAgent del consumidor.
-- =============================================================================

BEGIN;

-- 1. Añadir columna tenant_id a sitecorp_auth.users si no existe
ALTER TABLE sitecorp_auth.users
    ADD COLUMN IF NOT EXISTS tenant_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_users_tenant
    ON sitecorp_auth.users (tenant_id)
    WHERE tenant_id IS NOT NULL;

-- 2. Crear tabla de tokens de activación y recuperación de contraseña de un solo uso
CREATE TABLE IF NOT EXISTS sitecorp_auth.activation_tokens (
    id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    token_type VARCHAR(32) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    consumed_ip VARCHAR(45) NULL,
    consumed_user_agent TEXT NULL,

    CONSTRAINT chk_activation_token_type CHECK (
        token_type IN ('activation', 'password_reset')
    ),
    CONSTRAINT chk_activation_token_consumption_consistency CHECK (
        (used_at IS NULL AND consumed_ip IS NULL AND consumed_user_agent IS NULL)
        OR (used_at IS NOT NULL)
    )
);

-- Índice único sobre el hash SHA-256 para búsqueda inmediata y anti-colisión
CREATE UNIQUE INDEX IF NOT EXISTS uq_sitecorp_auth_activation_tokens_hash
    ON sitecorp_auth.activation_tokens (token_hash);

-- Índice parcial para revocación/consulta de tokens pendientes por usuario
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_activation_tokens_pending_user
    ON sitecorp_auth.activation_tokens (user_id, token_type)
    WHERE used_at IS NULL;

COMMIT;
