-- =============================================================================
-- SITECORP AUTHENTICATION SUBSYSTEM — POSTGRESQL DDL ROLLBACK (FASE 4G.5)
-- =============================================================================
-- Rollback: 0003_sitecorp_auth_activation_tokens
-- Esquema: sitecorp_auth
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS sitecorp_auth.activation_tokens CASCADE;

DROP INDEX IF EXISTS sitecorp_auth.idx_sitecorp_auth_users_tenant;

ALTER TABLE sitecorp_auth.users
    DROP COLUMN IF EXISTS tenant_id;

COMMIT;
