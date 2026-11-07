-- =============================================================================
-- SITECORP AUTHENTICATION SUBSYSTEM — ROLLBACK MIGRATION (FASE 4G.2 FINAL)
-- =============================================================================
-- Migración: 0002_sitecorp_auth_operator_permissions (ROLLBACK)
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS sitecorp_auth.idx_sitecorp_auth_operator_permissions_user_active;
DROP INDEX IF EXISTS sitecorp_auth.uq_sitecorp_auth_operator_permissions_active;
DROP TABLE IF EXISTS sitecorp_auth.operator_permissions;

COMMIT;
