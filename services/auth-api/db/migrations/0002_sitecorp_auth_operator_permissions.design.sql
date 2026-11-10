-- =============================================================================
-- SITECORP AUTHENTICATION SUBSYSTEM — POSTGRESQL DDL MIGRATION (FASE 4G.2 FINAL)
-- =============================================================================
-- Migración: 0002_sitecorp_auth_operator_permissions
-- Esquema: sitecorp_auth
-- Descripción:
--   Fuente autoritativa, persistente y auditable en tiempo real para permisos
--   administrativos de operadores (`sitecorp_auth.operator_permissions`).
--   Permite resolución en vivo por cada petición administrativa (`IOperatorPrincipalResolver`)
--   y revocación inmediata de privilegios sin esperar a que expire el JWT (15m).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sitecorp_auth.operator_permissions (
    id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE RESTRICT,
    permission VARCHAR(64) NOT NULL,
    granted_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    grant_reason VARCHAR(255) NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ NULL,
    revoked_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,

    CONSTRAINT chk_operator_permission_code CHECK (
        permission IN ('users.manage', 'security.manage', 'security.admin')
    ),
    CONSTRAINT chk_operator_permissions_no_self_grant CHECK (
        granted_by IS NULL OR granted_by <> user_id
    ),
    CONSTRAINT chk_operator_permissions_revocation_consistency CHECK (
        (is_revoked = TRUE AND revoked_at IS NOT NULL)
        OR (is_revoked = FALSE AND revoked_at IS NULL AND revoked_by IS NULL)
    )
);

-- Un usuario sólo puede tener un registro activo (no revocado) por cada permiso
CREATE UNIQUE INDEX IF NOT EXISTS uq_sitecorp_auth_operator_permissions_active
    ON sitecorp_auth.operator_permissions (user_id, permission)
    WHERE is_revoked = FALSE;

-- Índice para resolución en vivo de permisos activos de un operador en cada petición /admin/*
CREATE INDEX IF NOT EXISTS idx_sitecorp_auth_operator_permissions_user_active
    ON sitecorp_auth.operator_permissions (user_id)
    WHERE is_revoked = FALSE;

COMMIT;
