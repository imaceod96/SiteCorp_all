-- ============================================================================
-- SiteCorp · FASE 2/3 — 90. REVERSIÓN Y RECUPERACIÓN
--   [revisado: ORDEN corregido y eliminado el DROP del diseño anterior]
--
-- PRINCIPIO BÁSICO
--   Esta migración NO BORRA Y NO MODIFICA NI UNA FILA de datos de negocio, y NO
--   usa DROP FUNCTION / DROP TABLE / DROP POLICY en ningún paso: solo renombra y
--   sustituye cuerpos. Por tanto:
--     · No hay pérdida de datos que revertir.
--     · La recuperación es de nomenclatura y de código.
--     · Los UUID, las membresías, los roles y los permisos efectivos permanecen,
--       porque nunca se recrean objetos con pérdida de identidad.
--
-- ORDEN CORREGIDO (importante)
--   El diseño anterior reinstalaba los cuerpos ANTES de deshacer los renombrados.
--   Eso fallaría en las 9 funciones escritas en LANGUAGE sql: PostgreSQL valida su
--   cuerpo al crearlas y todavía no existirían las tablas `tenants`/`tenant_*`.
--   El orden correcto es: PRIMERO la nomenclatura, DESPUÉS los cuerpos.
--
-- QUÉ SE REVIERTE DE FORMA AUTOMÁTICA
--   1. TODOS los renombrados, en orden inverso, dirigidos por phase2_migration.rename_log.
--   2. Los CUERPOS originales, desde phase2_migration.function_definition_snapshot
--      (capturado en el fichero 01 con pg_get_functiondef()).
--
-- QUÉ **NO** SE PROMETE REVERTIR AUTOMÁTICAMENTE
--   · Si `phase2_migration` se ha perdido o está incompleta, la reversión automática
--     queda INHABILITADA: la única vía segura es PITR o la copia de seguridad previa.
--   · Los códigos de permiso almacenados NO se tocan en esta fase (decisión nº 4), así
--     que no requieren reversión.
--   · La reescritura de un cuerpo que hubiera introducido un cambio funcional distinto
--     del renombrado no se detecta por sí sola: por eso la reversión reinstala las
--     definiciones ORIGINALES completas, no una transformación inversa.
--
-- REQUISITOS PREVIOS
--   · Copia de seguridad verificada o PITR disponible dentro de la ventana.
--   · `phase2_migration.function_definition_snapshot`, `function_acl_snapshot` y
--     `rename_log` válidas (pobladas por el fichero 01).
--   · Ventana de mantenimiento: nadie usando la aplicación.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PASO 1 — Deshacer TODOS los renombrados en orden inverso (data-driven)
--   Resuelve cada fila de rename_log contra el catálogo actual; omite con aviso lo
--   que ya esté en el estado antiguo y registra los fallos sin abortar el resto.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r          record;
  p_old      text[];
  p_new      text[];
  v_bare_old text;
  v_ok       integer := 0;
  v_fail     integer := 0;
BEGIN
  FOR r IN SELECT * FROM phase2_migration.rename_log ORDER BY id DESC LOOP
    BEGIN
      IF r.object_kind = 'TABLE' THEN
        p_old := string_to_array(r.object_old, '.');
        p_new := string_to_array(r.object_new, '.');
        IF to_regclass(r.object_new) IS NOT NULL AND to_regclass(r.object_old) IS NULL THEN
          EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', p_new[1], p_new[2], p_old[2]);
        END IF;

      ELSIF r.object_kind = 'COLUMN' THEN
        p_old := string_to_array(r.object_old, '.');
        p_new := string_to_array(r.object_new, '.');
        IF to_regclass(p_new[1] || '.' || p_new[2]) IS NOT NULL THEN
          EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN %I TO %I',
                         p_new[1], p_new[2], p_new[3], p_old[3]);
        END IF;

      ELSIF r.object_kind = 'CONSTRAINT' THEN
        p_old := string_to_array(r.object_old, '.');
        p_new := string_to_array(r.object_new, '.');
        IF to_regclass(p_new[1] || '.' || p_new[2]) IS NOT NULL THEN
          EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
                         p_new[1], p_new[2], p_new[3], p_old[3]);
        END IF;

      ELSIF r.object_kind = 'INDEX' THEN
        p_old := string_to_array(r.object_old, '.');
        p_new := string_to_array(r.object_new, '.');
        IF to_regclass(r.object_new) IS NOT NULL THEN
          EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', p_new[1], p_new[2], p_old[2]);
        END IF;

      ELSIF r.object_kind = 'POLICY' THEN
        p_old := string_to_array(r.object_old, '.');
        p_new := string_to_array(r.object_new, '.');
        IF to_regclass(p_new[1] || '.' || p_new[2]) IS NOT NULL THEN
          EXECUTE format('ALTER POLICY %I ON %I.%I RENAME TO %I',
                         p_new[3], p_new[1], p_new[2], p_old[3]);
        END IF;

      ELSIF r.object_kind = 'TRIGGER' THEN
        p_old := string_to_array(r.object_old, '.');
        p_new := string_to_array(r.object_new, '.');
        IF to_regclass(p_new[1] || '.' || p_new[2]) IS NOT NULL THEN
          EXECUTE format('ALTER TRIGGER %I ON %I.%I RENAME TO %I',
                         p_new[3], p_new[1], p_new[2], p_old[3]);
        END IF;

      ELSIF r.object_kind = 'FUNCTION' THEN
        -- object_old / object_new = 'public.nombre(argumentos)'
        v_bare_old := split_part(
                        substring(r.object_old from position('.' in r.object_old) + 1),
                        '(', 1);
        IF to_regprocedure(r.object_new) IS NOT NULL THEN
          EXECUTE format('ALTER FUNCTION %s RENAME TO %I', r.object_new, v_bare_old);
        END IF;
      END IF;

      v_ok := v_ok + 1;

    EXCEPTION WHEN others THEN
      v_fail := v_fail + 1;
      RAISE WARNING 'NO revertido % % → %: %',
        r.object_kind, r.object_new, r.object_old, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Renombrados revertidos: % · fallidos: %', v_ok, v_fail;
END $$;

-- ---------------------------------------------------------------------------
-- PASO 2 — Reinstalar los CUERPOS originales (ya con la nomenclatura antigua).
--   CREATE OR REPLACE sobre la MISMA firma: no hay DROP, así que el OID, el
--   propietario y la ACL de cada función se conservan intactos.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r      record;
  v_ok   integer := 0;
  v_fail integer := 0;
BEGIN
  FOR r IN
    SELECT function_name, identity_arguments, definition
    FROM phase2_migration.function_definition_snapshot
    ORDER BY function_name, identity_arguments
  LOOP
    IF to_regprocedure('public.' || r.function_name || '(' || r.identity_arguments || ')') IS NULL THEN
      v_fail := v_fail + 1;
      RAISE WARNING 'No existe public.%(%) para reinstalar su cuerpo.',
        r.function_name, r.identity_arguments;
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE r.definition;
      v_ok := v_ok + 1;
    EXCEPTION WHEN others THEN
      v_fail := v_fail + 1;
      RAISE WARNING 'NO restaurada %(%): %', r.function_name, r.identity_arguments, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Cuerpos restaurados: % · no restaurados: %', v_ok, v_fail;
END $$;

-- ---------------------------------------------------------------------------
-- PASO 3 — VERIFICACIÓN DE LA REVERSIÓN
-- ---------------------------------------------------------------------------

-- 3.1 Nomenclatura definitiva residual. ESPERADO: 0 filas (salvo
--     `workers_tenant_code_unique`, que nunca se renombró).
SELECT c.relname AS objeto_nuevo_residual
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'company_client%'
ORDER BY 1;

-- 3.2 Ninguna tabla afectada debe quedar sin RLS. ESPERADO: 0 filas.
SELECT c.relname AS tabla_sin_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                AND a.attnum > 0 AND NOT a.attisdropped)
ORDER BY 1;

-- 3.3 Recuentos de filas: deben COINCIDIR con los capturados como 'before'.
--     La migración no elimina filas en ningún paso.
SELECT b.table_name, b.row_count AS filas_antes,
       a.row_count AS filas_despues,
       (b.row_count = a.row_count) AS coincide
FROM phase2_migration.table_row_counts b
LEFT JOIN phase2_migration.table_row_counts a
  ON a.table_name = b.table_name AND a.phase = 'after'
WHERE b.phase = 'before'
ORDER BY 1;

-- 3.4 ACL y propietario por OID tras la reversión. ESPERADO: 0 filas.
SELECT s.function_name, s.acl_text AS acl_antes, p.proacl::text AS acl_ahora
FROM phase2_migration.function_definition_snapshot s
LEFT JOIN pg_proc p ON p.oid = s.function_oid
WHERE p.oid IS NULL
   OR p.proacl IS DISTINCT FROM s.acl_text::aclitem[]
   OR pg_get_userbyid(p.proowner) IS DISTINCT FROM s.owner_name
ORDER BY 1;

-- 3.5 Funciones de public: recuento final (debe coincidir con el de la instantánea).
SELECT (SELECT count(*) FROM phase2_migration.function_definition_snapshot) AS antes,
       (SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public') AS despues;

COMMIT;

-- ============================================================================
-- LIMPIEZA (solo DESPUÉS de cerrar la Fase 3 y con autorización expresa)
--   DROP SCHEMA phase2_migration CASCADE;
--   → Al eliminarlo se pierde la capacidad de reversión automática y la evidencia
--     de auditoría. Conservarlo hasta que la Fase 3 esté validada.
-- ============================================================================
