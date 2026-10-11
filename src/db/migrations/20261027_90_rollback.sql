-- ============================================================================
-- SiteCorp · FASE 2/3 — 90. REVERSIÓN Y RECUPERACIÓN
--
-- PRINCIPIO BÁSICO
--   La migración de esta fase NO BORRA Y NO MODIFICA NI UNA FILA de datos de negocio:
--   solo cambia NOMBRES (tablas, columnas, restricciones, índices, políticas,
--   triggers) y reescribe CUERPOS de función. Por tanto:
--     · No hay pérdida de datos que revertir.
--     · La recuperación es una cuestión de nomenclatura y de código, no de datos.
--
-- QUÉ SE REVIERTE DE FORMA AUTOMÁTICA (preparado y verificado en diseño)
--   1. TODOS los renombrados, en orden inverso, dirigidos por
--      `phase2_migration.rename_log` (lo escriben los ficheros 02, 03, 04, 05, 06 y 08).
--   2. Los CUERPOS de función, desde `phase2_migration.function_definition_snapshot`
--      (capturado en el fichero 01), que guarda `pg_get_functiondef()` de cada función.
--
-- QUÉ **NO** SE PROMETE REVERTIR AUTOMÁTICAMENTE
--   · Si `phase2_migration` se ha perdido o está incompleta (por ejemplo, si se
--     limpió el esquema antes de cerrar la fase), la reversión automática queda
--     INHABILITADA: la única recuperación segura es Point-in-Time Recovery / la copia
--     de seguridad previa. NO se debe asumir que la reversión “siempre funciona”.
--   · Las funciones recreadas con DROP + CREATE (fichero 08, PARTE B) exigen
--     DROP previo para recuperar su FIRMA anterior (PostgreSQL no permite cambiar el
--     nombre de un parámetro con CREATE OR REPLACE). Está previsto abajo.
--   · Las claves de permiso almacenadas (datos) NO se han tocado, así que no hay nada
--     que revertir en ese punto... salvo que en la ventana se haya decidido el cambio
--     de códigos ('tenants.delete', 'tenant_roles.manage'), que es un paso tipo D y
--     debe tener su propio guion de reversión.
--
-- REQUISITOS PREVIOS A CUALQUIER EJECUCIÓN
--   · Copia de seguridad lógica/verificada del proyecto Supabase (o confirmación de
--     PITR disponible dentro de la ventana).
--   · `phase2_migration.function_definition_snapshot`,
--     `phase2_migration.function_acl_snapshot` y `phase2_migration.rename_log` válidas.
--   · Confirmación de que NADIE está usando la aplicación (ventana de mantenimiento).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PASO 1 — Funciones con FIRMA cambiada: DROP de la firma NUEVA
--   (necesario para poder reinstalar la firma antigua desde la instantánea)
--   Ejecutar SOLO si se completó la PARTE B del fichero 08.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.delete_company_client(uuid, text)',
    'public.company_client_deletion_summary(uuid)',
    'public.can_use_company_client_permission(uuid, text)',
    'public.can_list_company_client_memberships(uuid)',
    'public.can_invite_to_company_client(uuid)',
    'public.save_company_client_role(uuid, uuid, text, text, boolean, uuid[])',
    'public.save_company_client_role(uuid, uuid, uuid, text, text, boolean, uuid[])',
    'public.create_worker_medical_certificate(uuid, uuid, uuid, date, date, integer, uuid, uuid)',
    'public.list_entity_user_access(uuid)'
  ]
  LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      BEGIN
        EXECUTE format('DROP FUNCTION %s', sig);
        RAISE NOTICE 'Eliminada firma nueva %', sig;
      EXCEPTION WHEN dependent_objects_still_exist THEN
        RAISE WARNING
          'No se pudo eliminar % porque hay objetos dependientes: revisar a mano.', sig;
      END;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- PASO 2 — Reinstalar los CUERPOS anteriores desde la instantánea
--   Resiliente: cada fallo se informa y NO aborta la reversión completa.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r        record;
  v_ok     integer := 0;
  v_fail   integer := 0;
BEGIN
  FOR r IN
    SELECT function_name, identity_arguments, definition
    FROM phase2_migration.function_definition_snapshot
    ORDER BY function_name, identity_arguments
  LOOP
    BEGIN
      EXECUTE r.definition;
      v_ok := v_ok + 1;
    EXCEPTION WHEN others THEN
      v_fail := v_fail + 1;
      RAISE WARNING 'NO restaurada %(%): %',
        r.function_name, r.identity_arguments, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Cuerpos restaurados: % · no restaurados: %', v_ok, v_fail;
END $$;

-- ---------------------------------------------------------------------------
-- PASO 3 — Deshacer TODOS los renombrados en orden inverso (data-driven)
--   Resuelve cada fila de rename_log contra el catálogo actual; si un objeto ya no
--   existe o ya tiene el nombre antiguo, lo omite con aviso.
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
  FOR r IN
    SELECT * FROM phase2_migration.rename_log ORDER BY id DESC
  LOOP
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
        IF to_regclass('public.' || p_new[2]) IS NOT NULL THEN
          EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN %I TO %I',
                         p_new[1], p_new[2], p_new[3], p_old[3]);
        END IF;

      ELSIF r.object_kind = 'CONSTRAINT' THEN
        p_old := string_to_array(r.object_old, '.');
        p_new := string_to_array(r.object_new, '.');
        IF to_regclass('public.' || p_new[2]) IS NOT NULL THEN
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
        IF to_regclass('public.' || p_new[2]) IS NOT NULL THEN
          EXECUTE format('ALTER POLICY %I ON %I.%I RENAME TO %I',
                         p_new[3], p_new[1], p_new[2], p_old[3]);
        END IF;

      ELSIF r.object_kind = 'TRIGGER' THEN
        p_old := string_to_array(r.object_old, '.');
        p_new := string_to_array(r.object_new, '.');
        IF to_regclass('public.' || p_new[2]) IS NOT NULL THEN
          EXECUTE format('ALTER TRIGGER %I ON %I.%I RENAME TO %I',
                         p_new[3], p_new[1], p_new[2], p_old[3]);
        END IF;

      ELSIF r.object_kind = 'FUNCTION' THEN
        -- object_old = 'public.nombre_antiguo(args)' ; object_new = 'public.nombre_nuevo(args)'
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
-- PASO 4 — Restaurar la ACL previa de las funciones afectadas
--   (tras reinstalar cuerpos/firmas, la ACL vuelve al valor por defecto).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m      record;
  g      record;
  v_sig  text;
  v_rows integer;
BEGIN
  FOR m IN
    SELECT DISTINCT function_name, identity_arguments
    FROM phase2_migration.function_acl_snapshot
  LOOP
    v_sig := 'public.' || m.function_name || '(' || m.identity_arguments || ')';

    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE NOTICE 'ACL pendiente: % no existe todavía', v_sig;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);

    SELECT count(*) INTO v_rows
    FROM phase2_migration.function_acl_snapshot s
    WHERE s.function_name = m.function_name
      AND s.identity_arguments = m.identity_arguments;

    IF v_rows = 0 THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', v_sig);
    ELSE
      FOR g IN
        SELECT grantee, privilege_type
        FROM phase2_migration.function_acl_snapshot s
        WHERE s.function_name = m.function_name
          AND s.identity_arguments = m.identity_arguments
      LOOP
        IF g.grantee = 'PUBLIC' THEN
          EXECUTE format('GRANT %s ON FUNCTION %s TO PUBLIC', g.privilege_type, v_sig);
        ELSE
          EXECUTE format('GRANT %s ON FUNCTION %s TO %I', g.privilege_type, v_sig, g.grantee);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- PASO 5 — VERIFICACIÓN DE LA REVERSIÓN
-- ---------------------------------------------------------------------------
-- 5.1 ESPERADO: 0 filas (no debe quedar ningún objeto con nombre CompanyClient si
--     el objetivo es volver al estado anterior).
SELECT c.relname AS objeto_con_nombre_nuevo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'company_client%'
ORDER BY 1;

-- 5.2 ESPERADO: los recuentos de filas deben COINCIDIR con los capturados como
--     'before' en phase2_migration.table_row_counts (la migración no borra filas).
SELECT b.table_name,
       b.row_count AS filas_antes,
       a.row_count AS filas_despues,
       (b.row_count = a.row_count) AS coincide
FROM phase2_migration.table_row_counts b
LEFT JOIN phase2_migration.table_row_counts a
  ON a.table_name = b.table_name AND a.phase = 'after'
WHERE b.phase = 'before'
ORDER BY 1;

-- 5.3 ESPERADO: 0 filas.
SELECT p.proname AS funcion_con_nombre_nuevo
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname ~ 'company_client'
ORDER BY 1;

COMMIT;

-- ============================================================================
-- LIMPIEZA (solo DESPUÉS de cerrar satisfactoriamente la Fase 3 y con autorización)
--   DROP SCHEMA phase2_migration CASCADE;
--   → Al eliminarlo se pierde la capacidad de reversión automática. Conservarlo
--     hasta que la Fase 3 esté validada.
-- ============================================================================
