-- ============================================================================
-- SiteCorp · FASE 2/3 — 11. APLICACIÓN DE LOS CUERPOS DE FUNCIÓN (RPC)
--
-- ⚠️  ESTE ES EL FICHERO QUE MODIFICA OBJETOS DE LA APLICACIÓN.
--     Su ejecución forma parte de la ventana coordinada (backend + aplicación).
--     NO EJECUTAR sin: (a) previsualización del fichero 08 revisada y sin bloqueadas,
--     (b) entorno aislado validado, (c) copia de seguridad verificada.
--
-- QUÉ HACE, en UNA sola transacción
--   1. Comprueba que la previsualización (fichero 08) es válida y está al día.
--   2. Renombra las funciones que cambian de nombre con ALTER FUNCTION … RENAME
--      (conserva OID, propietario, ACL, dependencias de triggers y llamadas por OID).
--   3. Aplica cada definición nueva con CREATE OR REPLACE FUNCTION, tomada VERBATIM de
--      la previsualización: no hay texto escrito a mano y NO se toca ninguna firma
--      (mismos parámetros, mismos tipos, mismas columnas de salida, mismo LANGUAGE,
--      mismo SECURITY DEFINER, mismo SET search_path).
--   4. Verifica el resultado: semáforo de nomenclatura, recuento de funciones,
--      ACL/propietario por OID y barrido de políticas/triggers.
--
-- QUÉ NO HACE
--   · No usa DROP FUNCTION en ningún caso (por eso ninguna función puede perder su ACL).
--     Es la razón de que el fichero 12 sea una COMPROBACIÓN y no una restauración.
--   · No modifica datos, no genera UUID, no elimina filas, no desactiva RLS.
--
-- Si algo falla, TODA la transacción se deshace: no existe estado intermedio.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. GUARDIAS PREVIAS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bloqueadas   integer;
  v_preview      integer;
  v_catalogo     integer;
  v_desalineadas integer;
BEGIN
  IF to_regclass('phase2_migration.function_rewrite_preview') IS NULL THEN
    RAISE EXCEPTION
      'Falta la previsualización. Ejecuta antes el fichero 20261027_08_functions_preview.sql';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE blocked)
    INTO v_preview, v_bloqueadas
  FROM phase2_migration.function_rewrite_preview;

  IF v_bloqueadas > 0 THEN
    RAISE EXCEPTION
      'HAY % FUNCIONES BLOQUEADAS en la previsualización. Revisa el apartado 3.2 del fichero 08 antes de aplicar.',
      v_bloqueadas;
  END IF;

  -- La previsualización debe cubrir EXACTAMENTE el conjunto afectado del catálogo
  -- (si se ha cambiado algo desde que se construyó, está obsoleta).
  SELECT count(*)
    INTO v_catalogo
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND (p.prosrc ~ '(tenants|tenant_id|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id)'
         OR p.prosrc ~ '\m(create_workspace|delete_workspace|workspace_deletion_summary|workspace_deletion_target)\M');

  IF v_preview <> v_catalogo THEN
    RAISE EXCEPTION
      'Previsualización OBSOLETA: % filas previstas frente a % funciones afectadas en el catálogo. Reconstruye el fichero 08.',
      v_preview, v_catalogo;
  END IF;

  SELECT count(*)
    INTO v_desalineadas
  FROM phase2_migration.function_rewrite_preview pr
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = pr.function_oid
      AND pg_get_function_identity_arguments(p.oid) = pr.identity_arguments
  );

  IF v_desalineadas > 0 THEN
    RAISE EXCEPTION
      'Previsualización OBSOLETA: % funciones ya no existen o cambiaron de firma.', v_desalineadas;
  END IF;

  RAISE NOTICE 'Guardias superadas: % funciones previstas, 0 bloqueadas.', v_preview;
END $$;

-- ---------------------------------------------------------------------------
-- 1. RENOMBRADO DE FUNCIONES (ALTER FUNCTION … RENAME TO)
--    Conserva OID, propietario y ACL; los triggers y las políticas que las referencian
--    por OID siguen funcionando y pasan a mostrar el nombre nuevo.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT pr.function_name, pr.target_name, pr.identity_arguments
    FROM phase2_migration.function_rewrite_preview pr
    WHERE pr.target_name <> pr.function_name
    ORDER BY 1, 3
  LOOP
    IF to_regprocedure('public.' || r.function_name || '(' || r.identity_arguments || ')') IS NULL THEN
      RAISE NOTICE 'OMITIDA renombrado de public.%(%) (ya renombrada)', r.function_name, r.identity_arguments;
      CONTINUE;
    END IF;

    IF to_regprocedure('public.' || r.target_name || '(' || r.identity_arguments || ')') IS NOT NULL THEN
      RAISE EXCEPTION 'CONFLICTO: ya existe public.%(%)', r.target_name, r.identity_arguments;
    END IF;

    EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I',
                   r.function_name, r.identity_arguments, r.target_name);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new)
    VALUES ('FUNCTION',
            'public.' || r.function_name || '(' || r.identity_arguments || ')',
            'public.' || r.target_name   || '(' || r.identity_arguments || ')');

    RAISE NOTICE 'RENOMBRADA función public.%(%) → public.%',
      r.function_name, r.identity_arguments, r.target_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. APLICACIÓN DE LAS DEFINICIONES NUEVAS (CREATE OR REPLACE, sin DROP)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r      record;
  v_ok   integer := 0;
  v_err  integer := 0;
BEGIN
  FOR r IN
    SELECT function_name, target_name, identity_arguments, new_definition
    FROM phase2_migration.function_rewrite_preview
    ORDER BY target_name, identity_arguments
  LOOP
    BEGIN
      EXECUTE r.new_definition;
      v_ok := v_ok + 1;
    EXCEPTION WHEN others THEN
      v_err := v_err + 1;
      RAISE EXCEPTION 'Fallo aplicando public.%(%): %',
        r.target_name, r.identity_arguments, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Definiciones aplicadas correctamente: %', v_ok;
END $$;

-- ---------------------------------------------------------------------------
-- 3. VERIFICACIÓN POSTERIOR (obligatoria, dentro de la misma transacción)
-- ---------------------------------------------------------------------------

-- 3.1 SEMÁFORO: ninguna función de public debe conservar nomenclatura legacy en su
--     código. ESPERADO: 0 filas.
SELECT p.proname AS funcion_con_legacy,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       phase2_migration.legacy_in_code(p.prosrc) AS tokens_detectados
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND phase2_migration.legacy_in_code(p.prosrc) <> ''
ORDER BY 1;

-- 3.2 Recuento de funciones de public: debe ser IDÉNTICO al de la instantánea
--     (ninguna función creada ni eliminada). ESPERADO: 1 fila con diferencia 0.
SELECT (SELECT count(*) FROM phase2_migration.function_definition_snapshot) AS antes,
       (SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public') AS despues;

-- 3.3 BARRIDO: ningún objeto debe seguir mostrando nomenclatura legacy.
--     ESPERADO: 0 en todas las filas.
SELECT 'triggerdef' AS tipo, count(*) AS n
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal AND pg_get_triggerdef(t.oid) ~ 'tenant'
UNION ALL
SELECT 'policy_expr', count(*)
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
       || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'tenant'
UNION ALL
SELECT 'indexdef_pendiente_justificado', count(*)
FROM pg_index i
JOIN pg_class ci ON ci.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = ci.relnamespace
WHERE n.nspname = 'public' AND pg_get_indexdef(i.indexrelid) ~ '\mtenant'
ORDER BY 1;
-- NOTA: la fila `indexdef_pendiente_justificado` puede devolver 1: es
-- `workers_tenant_code_unique`, excluido a propósito (decisión nº 5).

COMMIT;

-- ============================================================================
-- DESPUÉS DE ESTE FICHERO
--   · Nada más por ejecutar: los ficheros 05, 06, 07 y este ya dejan la base de datos
--     en la nomenclatura definitiva (salvo el índice justificado del apartado 3.3).
-- ============================================================================
