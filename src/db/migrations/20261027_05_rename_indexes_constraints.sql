-- ============================================================================
-- SiteCorp · FASE 2/3 — 05. RENOMBRADO DE RESTRICCIONES E ÍNDICES
--
-- OBJETIVO: que la nomenclatura interna del esquema sea coherente con la definitiva
-- (si no, PostgreSQL generaría a partir de ahora nombres nuevos como
-- `company_client_id_fkey` conviviendo con `tenant_id_fkey`).
--
-- POR QUÉ ES SEGURO (tipo A)
--   · Restricciones, índices y sus expresiones se almacenan por OID/attnum: el
--     renombrado NO altera su definición, ni su validez, ni su ACL, ni sus datos.
--   · Ninguna política RLS ni ningún trigger dependen del NOMBRE del índice.
--
-- EXCEPCIÓN CRÍTICA — NO renombrar a ciegas
--   Los siguientes índices se comparan POR NOMBRE dentro de PL/pgSQL
--   (SQLERRM LIKE '%…%'). Renombrarlos sin parchear las funciones haría que la
--   detección de colisiones se convirtiera en un error fatal para el usuario:
--     · workers_tenant_code_unique  → usado en create_worker_with_position()
--                                    y migration_create_worker()
--   → Queda EXCLUIDO aquí (lista `v_denylist`) y NO se renombra en esta fase
--     (decisión aprobada nº 5). Justificación y evidencia al final del fichero.
--   · `workers_tenant_ci_active_unique` se menciona en create_worker_with_position()
--     pero NO EXISTE en el esquema real (el índice real es `workers_tenant_ci_unique`
--     y su predicado excluye el origen 'MIGRATION'). Es una rama muerta: se documenta
--     como observación, no se "arregla" en esta fase (no es alcance de la migración).
--
-- Renombrado determinista mediante phase2_migration.rewrite_name() y registrado en
-- rename_log para poder revertirlo automáticamente.
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Restricciones (PK, UNIQUE, FK, CHECK) cuyo nombre contiene 'tenant'
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN
    SELECT n.nspname   AS schema_name,
           cl.relname  AS table_name,
           c.conname   AS con_name
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND c.contype IN ('p', 'u', 'f', 'c')
      AND c.conname ~ 'tenant'
    ORDER BY 2, 3
  LOOP
    v_new := phase2_migration.rewrite_name(r.con_name);

    IF v_new = r.con_name THEN
      RAISE NOTICE 'OMITIDA restricción % (sin cambio de nombre)', r.con_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
                   r.schema_name, r.table_name, r.con_name, v_new);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new, details)
    VALUES ('CONSTRAINT',
            r.schema_name || '.' || r.table_name || '.' || r.con_name,
            r.schema_name || '.' || r.table_name || '.' || v_new,
            jsonb_build_object('table', r.table_name));

    RAISE NOTICE 'RENOMBRADA restricción % → % (tabla %)',
      r.con_name, v_new, r.table_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Índices independientes (los que NO son soporte de una restricción)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_new text;
  -- Índices comparados por nombre dentro de PL/pgSQL: NO renombrar aquí.
  v_denylist text[] := ARRAY['workers_tenant_code_unique'];
BEGIN
  FOR r IN
    SELECT ni.nspname AS schema_name,
           i.relname  AS index_name,
           i.relname  AS old_name
    FROM pg_class i
    JOIN pg_namespace ni ON ni.oid = i.relnamespace
    WHERE ni.nspname = 'public'
      AND i.relkind = 'i'
      AND i.relname ~ 'tenant'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid)
    ORDER BY 2
  LOOP
    IF r.index_name = ANY (v_denylist) THEN
      RAISE NOTICE
        'EXCLUIDO índice % : su nombre se compara en PL/pgSQL; NO se renombra (decisión nº 5).',
        r.index_name;
      CONTINUE;
    END IF;

    v_new := phase2_migration.rewrite_name(r.index_name);

    IF v_new = r.index_name THEN
      RAISE NOTICE 'OMITIDO índice % (sin cambio de nombre)', r.index_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', r.schema_name, r.old_name, v_new);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new)
    VALUES ('INDEX',
            r.schema_name || '.' || r.index_name,
            r.schema_name || '.' || v_new);

    RAISE NOTICE 'RENOMBRADO índice % → %', r.index_name, v_new;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- 3.1 ESPERADO: exactamente 1 fila → el índice excluido a propósito (decisión nº 5),
--     que se queda con su nombre legacy de forma deliberada y documentada.
SELECT c.relname AS indice_legacy_pendiente
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'i'
  AND c.relname ~ 'tenant'
ORDER BY 1;

-- 3.2 ESPERADO: 0 filas.
SELECT c.conname AS restriccion_legacy
FROM pg_constraint c
WHERE c.connamespace = 'public'::regnamespace
  AND c.conname ~ 'tenant'
ORDER BY 1;

-- 3.3 Recuento de lo renombrado en este fichero.
SELECT object_kind, count(*)
FROM phase2_migration.rename_log
WHERE object_kind IN ('CONSTRAINT', 'INDEX')
GROUP BY object_kind;

COMMIT;

-- ============================================================================
-- DECISIÓN FINAL SOBRE `workers_tenant_code_unique` (basada en evidencia del
-- catálogo real, no en una suposición):
--   · Se comprobó que los ÚNICOS índices cuyo nombre aparece dentro de un cuerpo de
--     función son `wpa_current_per_worker_unique` (no contiene 'tenant': no se toca)
--     y `workers_tenant_code_unique` (create_worker_with_position y
--     migration_create_worker lo comparan con SQLERRM LIKE).
--   · Ninguna restricción se menciona por nombre en ningún cuerpo y no existe ningún
--     `ON CONFLICT ON CONSTRAINT` en el esquema.
--   → Conforme a la decisión aprobada nº 5 (renombrar solo cuando sea seguro y no
--     existan dependencias por nombre), este índice NO se renombra y, por tanto, NO
--     hay que parchear ninguna función: el literal `%workers_tenant_code_unique%`
--     conserva su validez.
--   → La incoherencia de nombre que queda es deliberada, está documentada y NO afecta
--     a ningún comportamiento. Si en el futuro se quisiera renombrar, habría que
--     hacerlo en la MISMA transacción que el parche de las dos funciones.
--
--   Observación (no se corrige en esta fase): create_worker_with_position() también
--   compara '%workers_tenant_ci_active_unique%', índice que NO existe en el esquema
--   (el real es `workers_tenant_ci_unique`). Es una rama muerta.
-- ============================================================================
