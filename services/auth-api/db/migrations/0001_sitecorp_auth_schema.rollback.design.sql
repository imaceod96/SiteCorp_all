-- =============================================================================
-- SITECORP AUTH API — SCRIPT DE ROLLBACK DEL ESQUEMA (FASE 4F.1.1)
-- =============================================================================
-- ADVERTENCIA CRÍTICA DE SEGURIDAD:
-- 1. Este archivo es EXCLUSIVAMENTE un blueprint de diseño técnico.
-- 2. Por seguridad operativa (Safe-by-Default), la transacción finaliza en
--    `ROLLBACK;` y exige una salvaguarda explícita de entorno (`sitecorp.allow_destructive_rollback = 'true'`)
--    para impedir que una ejecución accidental destruya datos en un entorno real.
-- 3. NUNCA utiliza `DROP ... CASCADE` para evitar eliminar objetos externos
--    de otros esquemas que pudieran haber creado dependencias accidentales.
-- =============================================================================

BEGIN;

DO $$
BEGIN
    IF current_setting('sitecorp.allow_destructive_rollback', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'ABORTADO POR SEGURIDAD: El script de rollback de diseño tiene activada la protección contra ejecución accidental. En un entorno efímero de pruebas, establezca SET LOCAL sitecorp.allow_destructive_rollback = ''true''; antes de ejecutar.';
    END IF;
END $$;

-- Eliminación en orden estrictamente inverso de dependencias referenciales (sin CASCADE)
DROP TABLE IF EXISTS sitecorp_auth.security_audit_events RESTRICT;
DROP TABLE IF EXISTS sitecorp_auth.refresh_tokens RESTRICT;
DROP TABLE IF EXISTS sitecorp_auth.sessions RESTRICT;
DROP TABLE IF EXISTS sitecorp_auth.user_credentials RESTRICT;
DROP TABLE IF EXISTS sitecorp_auth.users RESTRICT;
DROP TABLE IF EXISTS sitecorp_auth.schema_migrations RESTRICT;

DROP SCHEMA IF EXISTS sitecorp_auth RESTRICT;

-- Por defecto este blueprint revierte cualquier cambio si se ejecuta directamente:
ROLLBACK;
