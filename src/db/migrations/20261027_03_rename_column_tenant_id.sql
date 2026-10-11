-- ============================================================================
-- SiteCorp · FASE 2/3 — 03. RENOMBRADO DE LA COLUMNA `tenant_id` → `company_client_id`
--
-- CAMBIO DE TIPO A en la base de datos, C respecto a la aplicación.
-- NO EJECUTAR sin la ventana coordinada: la Data API expone el nombre de la columna,
-- así que cualquier `select("tenant_id")` o `eq("tenant_id", …)` deja de funcionar.
--
-- POR QUÉ ES SEGURO EN LA BASE DE DATOS
--   · RENAME COLUMN conserva el OID de la tabla, el attnum de la columna, TODAS las
--     filas, las FK, los índices, los triggers y las POLÍTICAS RLS.
--   · Las políticas e índices se guardan como árboles de nodos con attnum/OID, no por
--     nombre → NO hay que recrear ninguna política ni ningún índice por este cambio.
--   · La FK `…_tenant_id_fkey` sigue apuntando a la misma tabla (ahora
--     `company_clients`) y se conserva NOT NULL / ON DELETE CASCADE.
--
-- POR QUÉ NO ES SUFICIENTE POR SÍ SOLO
--   · Los cuerpos de función son TEXTO: PostgreSQL no detecta la dependencia y no
--     avisa. La función deja de compilarse en tiempo de ejecución → fichero 08.
--
-- TABLAS AFECTADAS (26, verificado por introspección el 2026-10-27):
--   academic_category_payments, candidates, contract_addendums,
--   document_generation_events, employment_contract_addendum_changes,
--   employment_contracts, employment_types, governing_documents, municipalities,
--   organization_entities, organization_representative_assignments,
--   organization_representative_positions, political_affiliations, prenomina_periods,
--   provinces, rehire_statuses, salary_scales, tenant_invitations, tenant_memberships,
--   tenant_roles, worker_medical_certificates, worker_payroll_movements,
--   worker_resolutions, worker_vacation_movements, worker_vacations, workers.
--   (Tras el fichero 02, las tres tablas `tenant_*` de esa lista ya se llaman
--    `company_client_*`; el descubrimiento es dinámico por catálogo, sin listas fijas.)
--
-- Idempotente: si la columna ya está renombrada, no hace nada.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')          -- tabla normal y tabla particionada
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I RENAME COLUMN tenant_id TO company_client_id',
      r.schema_name, r.table_name
    );

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new)
    VALUES ('COLUMN',
            r.schema_name || '.' || r.table_name || '.tenant_id',
            r.schema_name || '.' || r.table_name || '.company_client_id');

    RAISE NOTICE 'RENOMBRADA columna %.%.tenant_id → company_client_id',
      r.schema_name, r.table_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- ESPERADO: 0 filas.
SELECT n.nspname AS esquema, c.relname AS tabla_con_columna_legacy
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND a.attname = 'tenant_id'
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY 2;

-- ESPERADO: 26 filas (recuento de columnas renombradas en este fichero).
SELECT count(*) AS tablas_con_company_client_id
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND a.attname = 'company_client_id'
  AND a.attnum > 0
  AND NOT a.attisdropped;

-- INTEGRIDAD: la FK debe seguir existiendo y apuntando a company_clients(id).
-- ESPERADO: el MISMO número de filas que había antes del renombrado. Se compara
-- contra la instantánea (fichero 01 §2.4) en lugar de contra un número escrito a mano,
-- porque NO todas las tablas con tenant_id tienen FK a tenants:
--   hallazgo verificado → `candidates`, `document_generation_events`,
--   `employment_contracts`, `governing_documents`, `municipalities`, `provinces`,
--   `worker_payroll_movements` y `worker_resolutions` tienen tenant_id SIN FK.
--   Esa integridad parcial NO se modifica en esta fase (añadir FK sería un cambio de
--   esquema no solicitado que podría fallar sobre datos existentes).
SELECT count(*) AS fk_hacia_company_clients_ahora
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.connamespace = 'public'::regnamespace
  AND c.confrelid = to_regclass('public.company_clients');

SELECT count(*) AS fk_legacy_registradas_en_instantanea
FROM phase2_migration.object_name_snapshot s
WHERE s.object_kind = 'CONSTRAINT'
  AND s.definition ILIKE '%REFERENCES tenants(%';

-- Detalle de las FK (verificar que ninguna quedó huérfana).
SELECT c.conname AS restriccion_fk,
       c.conrelid::regclass::text AS tabla_hija,
       c.confrelid::regclass::text AS tabla_padre,
       c.confdeltype AS on_delete
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.connamespace = 'public'::regnamespace
  AND c.confrelid = to_regclass('public.company_clients')
ORDER BY 2;

COMMIT;

-- ============================================================================
-- REVERSIÓN: fase2_migration.rename_log (object_kind='COLUMN') más la inversión de
-- los renombrados de tabla (fichero 90).
-- ============================================================================
