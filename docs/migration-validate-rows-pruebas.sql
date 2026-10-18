-- ============================================================================
-- SiteCorp · Pruebas de solo lectura para public.migration_validate_rows(uuid, jsonb)
--
-- Qué verifica
--   0. REGRESIÓN del error 55000: fila SIN puesto (caso de la plantilla oficial).
--   1. Trabajador con puesto válido y vacante disponible           → VALID
--   2. Trabajador con puesto inexistente (código y UUID)            → ERROR por fila
--   3. Trabajador con puesto sin vacantes                           → ERROR por fila
--   4. Datos obligatorios incompletos                               → ERROR por fila
--   5. Varias filas válidas e inválidas en el mismo archivo         → por fila
--   6. Validación repetida del mismo archivo                        → idéntica
--   7. Ausencia de escrituras durante la validación                 → comprobada
--
-- Garantías del script
--   · Se ejecuta dentro de BEGIN … ROLLBACK: no confirma nada.
--   · No inserta, actualiza ni borra datos reales (solo objetos temporales).
--   · La prueba 7 compara, por tabla, recuento de filas y última versión de fila
--     (xmin) antes y después de todas las llamadas: si la función escribiera,
--     aparecerían filas nuevas o nuevas versiones.
--
-- Cómo ejecutarlo (psql, como propietario de la BD o usuario técnico)
--   \set entity_id 'UUID de una entidad con puestos activos'
--   \set user_id   'UUID de un usuario con workers.manage en esa entidad'
--   \i docs/migration-validate-rows-pruebas.sql
--
--   auth.uid() se simula con `request.jwt.claims` (local a la transacción), de
--   modo que se respeta can_access_entity(..., 'workers.manage').
--   Ejecutar en horario de baja actividad: la prueba 7 compara versiones de fila
--   y una escritura concurrente ajena produciría un falso negativo.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Contexto de sesión simulado (se revierte al final)
-- ---------------------------------------------------------------------------
SELECT
  set_config(
    'request.jwt.claims',
    json_build_object('sub', :'user_id', 'role', 'authenticated')::text,
    true
  ),
  set_config('request.jwt.claim.sub', :'user_id', true);

-- ---------------------------------------------------------------------------
-- Fixtures: un puesto activo con vacante LIBRE y una reserva de CI no usados
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_ctx ON COMMIT DROP AS
SELECT
  :'entity_id'::uuid AS entity_id,
  fp.free_position_id,
  fp.free_position_code,
  fp.free_position_name,
  fp.free_capacity
FROM (SELECT 1) AS one
LEFT JOIN LATERAL (
  SELECT
    p.id AS free_position_id,
    p.code AS free_position_code,
    p.name AS free_position_name,
    p.authorized_quantity - coalesce((
      SELECT count(*)
      FROM public.worker_position_assignments a
      JOIN public.workers w ON w.id = a.worker_id
      WHERE a.position_id = p.id
        AND a.is_current = true
        AND a.end_date IS NULL
        AND w.employment_status = 'active'
    ), 0) AS free_capacity
  FROM public.organization_positions p
  WHERE p.organization_entity_id = :'entity_id'::uuid
    AND p.is_active = true
  ORDER BY (p.authorized_quantity - coalesce((
      SELECT count(*)
      FROM public.worker_position_assignments a
      JOIN public.workers w ON w.id = a.worker_id
      WHERE a.position_id = p.id
        AND a.is_current = true
        AND a.end_date IS NULL
        AND w.employment_status = 'active'
    ), 0)) DESC, p.code
  LIMIT 1
) AS fp ON true;

-- Si el puesto elegido no tiene vacante, se anula para que las pruebas 1 y 3 se salten.
UPDATE t_ctx SET free_position_id = NULL, free_position_code = NULL,
                 free_position_name = NULL, free_capacity = NULL
WHERE coalesce(free_capacity, 0) <= 0;

CREATE TEMP TABLE t_ci ON COMMIT DROP AS
SELECT s.ci, row_number() OVER (ORDER BY s.ci) AS rn
FROM (
  SELECT lpad((93000000000::bigint + n)::text, 11, '0') AS ci
  FROM generate_series(1, 500) AS n
) AS s
WHERE NOT EXISTS (SELECT 1 FROM public.workers w    WHERE w.identification = s.ci)
  AND NOT EXISTS (SELECT 1 FROM public.candidates c WHERE c.identification = s.ci);

CREATE FUNCTION pg_temp.ci(p_n integer) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT ci FROM t_ci WHERE rn = p_n
$$;

-- ---------------------------------------------------------------------------
-- Instantánea «antes» para la prueba 7
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_snap_before ON COMMIT DROP AS
SELECT * FROM (
  SELECT 'workers' AS table_name,
         count(*)::bigint AS row_count,
         coalesce(max(xmin::text::bigint), 0) AS last_xmin
  FROM public.workers
  UNION ALL
  SELECT 'worker_position_assignments', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.worker_position_assignments
  UNION ALL
  SELECT 'employment_contracts', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.employment_contracts
  UNION ALL
  SELECT 'organization_positions', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.organization_positions
  UNION ALL
  SELECT 'worker_vacation_movements', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.worker_vacation_movements
  UNION ALL
  SELECT 'worker_salary_history', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.worker_salary_history
  UNION ALL
  SELECT 'candidates', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.candidates
) AS s;

-- ===========================================================================
-- PRUEBA 0 · Regresión: fila sin puesto (plantilla oficial, sin «Código Puesto»)
--   Antes de la corrección esta llamada abortaba con
--   «record "v_position" is not assigned yet» (SQLSTATE 55000).
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
BEGIN
  SELECT public.migration_validate_rows(
           (SELECT entity_id FROM t_ctx),
           jsonb_build_array(jsonb_build_object(
             'first_name', 'PRUEBA',
             'first_surname', 'SIN-PUESTO',
             'identification', pg_temp.ci(1),
             'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD')
           ))
         ) INTO r;

  IF jsonb_array_length(r) <> 1 THEN
    RAISE EXCEPTION 'T0: se esperaba 1 fila de resultado, recibidas %', jsonb_array_length(r);
  END IF;
  IF (r->0->>'status') <> 'WARNING' THEN
    RAISE EXCEPTION 'T0: estado % (esperado WARNING). Mensajes: %', r->0->>'status', r->0->'messages';
  END IF;
  IF NOT ((r->0->'messages') @> to_jsonb(ARRAY['Se importará como pendiente de vinculación a plantilla'])) THEN
    RAISE EXCEPTION 'T0: falta el aviso de pendiente de vinculación. Mensajes: %', r->0->'messages';
  END IF;
  IF (r->0->>'position_id') IS NOT NULL THEN
    RAISE EXCEPTION 'T0: position_id debe ser NULL, recibido %', r->0->>'position_id';
  END IF;
  IF (r->0->>'position_label') IS NOT NULL THEN
    RAISE EXCEPTION 'T0: position_label debe ser NULL, recibido %', r->0->>'position_label';
  END IF;

  RAISE NOTICE 'PRUEBA 0 OK (regresión 55000): %', r->0;
END $$;

-- ===========================================================================
-- PRUEBA 1 · Puesto válido con vacante disponible → VALID
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
  v_pos uuid;
  v_code text;
  v_name text;
BEGIN
  SELECT free_position_id, free_position_code, free_position_name
    INTO v_pos, v_code, v_name
  FROM t_ctx;

  IF v_pos IS NULL THEN
    RAISE NOTICE 'PRUEBA 1 SALTADA: la entidad no tiene puestos activos con vacante libre';
    RETURN;
  END IF;

  SELECT public.migration_validate_rows(
           (SELECT entity_id FROM t_ctx),
           jsonb_build_array(jsonb_build_object(
             'first_name', 'PRUEBA',
             'first_surname', 'PUESTO-OK',
             'identification', pg_temp.ci(2),
             'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
             'position_code', v_code
           ))
         ) INTO r;

  IF (r->0->>'status') <> 'VALID' THEN
    RAISE EXCEPTION 'T1: estado % (esperado VALID). Mensajes: %', r->0->>'status', r->0->'messages';
  END IF;
  IF (r->0->>'position_id')::uuid IS DISTINCT FROM v_pos THEN
    RAISE EXCEPTION 'T1: position_id % (esperado %)', r->0->>'position_id', v_pos;
  END IF;
  IF (r->0->>'position_label') IS DISTINCT FROM (v_name || ' (' || v_code || ')') THEN
    RAISE EXCEPTION 'T1: position_label % (esperado "%")',
      r->0->>'position_label', v_name || ' (' || v_code || ')';
  END IF;

  RAISE NOTICE 'PRUEBA 1 OK: %', r->0;
END $$;

-- ===========================================================================
-- PRUEBA 2 · Puesto inexistente (por código y por identificador) → ERROR
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
  v_code text;
  v_missing_code text;
BEGIN
  SELECT coalesce(free_position_code, 'PST') INTO v_code FROM t_ctx;
  v_missing_code := v_code || '-NO-EXISTE-' || substr(pg_temp.ci(3), 9, 3);

  SELECT public.migration_validate_rows(
           (SELECT entity_id FROM t_ctx),
           jsonb_build_array(
             jsonb_build_object(
               'first_name', 'PRUEBA',
               'first_surname', 'PUESTO-NO-EXISTE',
               'identification', pg_temp.ci(3),
               'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
               'position_code', v_missing_code
             ),
             jsonb_build_object(
               'first_name', 'PRUEBA',
               'first_surname', 'PUESTO-NO-EXISTE-UUID',
               'identification', pg_temp.ci(4),
               'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
               'position_id', gen_random_uuid()::text
             )
           )
         ) INTO r;

  IF jsonb_array_length(r) <> 2 THEN
    RAISE EXCEPTION 'T2: se esperaban 2 filas, recibidas %', jsonb_array_length(r);
  END IF;

  IF (r->0->>'status') <> 'ERROR' THEN
    RAISE EXCEPTION 'T2a: se esperaba ERROR, recibido %', r->0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(r->0->'messages') m
    WHERE m = 'Puesto no encontrado (' || v_missing_code || ')'
  ) THEN
    RAISE EXCEPTION 'T2a: falta «Puesto no encontrado (%s)». Recibido: %', v_missing_code, r->0;
  END IF;

  IF (r->1->>'status') <> 'ERROR' THEN
    RAISE EXCEPTION 'T2b: se esperaba ERROR, recibido %', r->1;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(r->1->'messages') m
    WHERE m LIKE 'Puesto no encontrado (%'
  ) THEN
    RAISE EXCEPTION 'T2b: falta «Puesto no encontrado». Recibido: %', r->1;
  END IF;

  IF (r->0->>'position_id') IS NOT NULL OR (r->1->>'position_id') IS NOT NULL THEN
    RAISE EXCEPTION 'T2: position_id debe ser NULL en ambas filas: %', r;
  END IF;

  RAISE NOTICE 'PRUEBA 2 OK: %', r;
END $$;

-- ===========================================================================
-- PRUEBA 3 · Puesto sin vacantes → ERROR solo en la fila que supera la capacidad
--   Se envía el mismo puesto (vacante libre + 1) veces con CI distintos: las
--   primeras «vacante libre» filas deben ser VALID y la última ERROR por capacidad.
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
  v_cap integer;
  v_code text;
  v_rows jsonb;
BEGIN
  SELECT free_capacity, free_position_code INTO v_cap, v_code FROM t_ctx;

  IF v_code IS NULL THEN
    RAISE NOTICE 'PRUEBA 3 SALTADA: la entidad no tiene puestos activos con vacante libre';
    RETURN;
  END IF;
  IF coalesce(v_cap, 0) > 20 THEN
    RAISE NOTICE 'PRUEBA 3 SALTADA: la vacante libre es %; el script genera como máximo 21 filas', v_cap;
    RETURN;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'first_name', 'PRUEBA',
           'first_surname', 'CAPACIDAD-' || n,
           'identification', pg_temp.ci(100 + n),
           'employment_start_date', to_char(current_date - 300, 'YYYY-MM-DD'),
           'position_code', v_code
         ) ORDER BY n)
    INTO v_rows
  FROM generate_series(1, v_cap + 1) AS n;

  SELECT public.migration_validate_rows((SELECT entity_id FROM t_ctx), v_rows) INTO r;

  IF jsonb_array_length(r) <> v_cap + 1 THEN
    RAISE EXCEPTION 'T3: se esperaban % filas, recibidas %', v_cap + 1, jsonb_array_length(r);
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(r) e
    WHERE (e->>'index')::int < v_cap AND e->>'status' <> 'VALID'
  ) THEN
    RAISE EXCEPTION 'T3: las % primeras filas debían ser VALID. Resultado: %', v_cap, r;
  END IF;

  IF (r -> v_cap ->> 'status') <> 'ERROR' THEN
    RAISE EXCEPTION 'T3: la fila % debía ser ERROR por capacidad. Resultado: %', v_cap, r -> v_cap;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(r -> v_cap -> 'messages') m
    WHERE m LIKE 'Puesto sin capacidad disponible:%'
  ) THEN
    RAISE EXCEPTION 'T3: falta «Puesto sin capacidad disponible». Recibido: %', r -> v_cap;
  END IF;

  RAISE NOTICE 'PRUEBA 3 OK (vacante libre %): %', v_cap, r -> v_cap;
END $$;

-- ===========================================================================
-- PRUEBA 4 · Datos obligatorios incompletos → ERROR por fila, sin excepción
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
BEGIN
  SELECT public.migration_validate_rows(
           (SELECT entity_id FROM t_ctx),
           jsonb_build_array(jsonb_build_object(
             'first_name', '',
             'first_surname', '',
             'identification', 'abc',
             'employment_start_date', 'no-es-fecha',
             'initial_vacation_balance', '-5'
           ))
         ) INTO r;

  IF (r->0->>'status') <> 'ERROR' THEN
    RAISE EXCEPTION 'T4: se esperaba ERROR, recibido %', r->0;
  END IF;

  IF NOT ((r->0->'messages') @> to_jsonb(ARRAY['El nombre es obligatorio'])) THEN
    RAISE EXCEPTION 'T4: falta «El nombre es obligatorio»: %', r->0->'messages';
  END IF;
  IF NOT ((r->0->'messages') @> to_jsonb(ARRAY['El primer apellido es obligatorio'])) THEN
    RAISE EXCEPTION 'T4: falta «El primer apellido es obligatorio»: %', r->0->'messages';
  END IF;
  IF NOT ((r->0->'messages') @> to_jsonb(ARRAY['El número de identificación debe contener exactamente 11 dígitos'])) THEN
    RAISE EXCEPTION 'T4: falta la regla de 11 dígitos: %', r->0->'messages';
  END IF;
  IF NOT ((r->0->'messages') @> to_jsonb(ARRAY['Fecha de incorporación inválida o vacía'])) THEN
    RAISE EXCEPTION 'T4: falta «Fecha de incorporación inválida o vacía»: %', r->0->'messages';
  END IF;
  IF NOT ((r->0->'messages') @> to_jsonb(ARRAY['El saldo inicial de vacaciones debe estar entre 0 y 24 días'])) THEN
    RAISE EXCEPTION 'T4: falta la regla del saldo de vacaciones: %', r->0->'messages';
  END IF;
  IF jsonb_array_length(r->0->'messages') < 5 THEN
    RAISE EXCEPTION 'T4: se esperaban al menos 5 mensajes: %', r->0->'messages';
  END IF;

  RAISE NOTICE 'PRUEBA 4 OK (mensajes por fila): %', r->0->'messages';
END $$;

-- ===========================================================================
-- PRUEBA 5 · Mezcla de filas válidas e inválidas en el mismo archivo
--   0 VALID (puesto) · 1 ERROR (puesto) · 2 ERROR (obligatorios) · 3 WARNING (sin puesto)
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
  v_code text;
  v_valid_status text;
  v_indexes integer[];
BEGIN
  SELECT free_position_code INTO v_code FROM t_ctx;

  SELECT public.migration_validate_rows(
           (SELECT entity_id FROM t_ctx),
           jsonb_build_array(
             jsonb_build_object(
               'first_name', 'PRUEBA',
               'first_surname', 'MEZCLA-OK',
               'identification', pg_temp.ci(5),
               'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
               'position_code', coalesce(v_code, 'PST-SIN-PUESTO')
             ),
             jsonb_build_object(
               'first_name', 'PRUEBA',
               'first_surname', 'MEZCLA-PUESTO',
               'identification', pg_temp.ci(6),
               'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
               'position_code', coalesce(v_code, 'PST') || '-INEXISTENTE'
             ),
             jsonb_build_object(
               'first_name', 'PRUEBA',
               'identification', '123',
               'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD')
             ),
             jsonb_build_object(
               'first_name', 'PRUEBA',
               'first_surname', 'MEZCLA-SIN-PUESTO',
               'identification', pg_temp.ci(7),
               'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD')
             )
           )
         ) INTO r;

  IF jsonb_array_length(r) <> 4 THEN
    RAISE EXCEPTION 'T5: se esperaban 4 filas, recibidas %', jsonb_array_length(r);
  END IF;

  v_valid_status := CASE WHEN v_code IS NULL THEN 'ERROR' ELSE 'VALID' END;

  IF (r->0->>'status') IS DISTINCT FROM v_valid_status THEN
    RAISE EXCEPTION 'T5 fila 0: estado % (esperado %): %', r->0->>'status', v_valid_status, r->0;
  END IF;
  IF (r->1->>'status') <> 'ERROR' THEN
    RAISE EXCEPTION 'T5 fila 1: estado % (esperado ERROR): %', r->1->>'status', r->1;
  END IF;
  IF (r->2->>'status') <> 'ERROR' THEN
    RAISE EXCEPTION 'T5 fila 2: estado % (esperado ERROR): %', r->2->>'status', r->2;
  END IF;
  IF (r->3->>'status') <> 'WARNING' THEN
    RAISE EXCEPTION 'T5 fila 3: estado % (esperado WARNING): %', r->3->>'status', r->3;
  END IF;

  SELECT array_agg((e->>'index')::int ORDER BY ord)
    INTO v_indexes
  FROM jsonb_array_elements(r) WITH ORDINALITY AS t(e, ord);

  IF v_indexes <> ARRAY[0, 1, 2, 3] THEN
    RAISE EXCEPTION 'T5: índices inesperados: %', v_indexes;
  END IF;

  RAISE NOTICE 'PRUEBA 5 OK: %', (
    SELECT jsonb_agg(jsonb_build_object('index', e->>'index', 'status', e->>'status'))
    FROM jsonb_array_elements(r) e
  );
END $$;

-- ===========================================================================
-- PRUEBA 6 · Validación repetida del mismo archivo → resultado idéntico
-- ===========================================================================
DO $$
DECLARE
  v_payload jsonb;
  r1 jsonb;
  r2 jsonb;
  v_code text;
BEGIN
  SELECT free_position_code INTO v_code FROM t_ctx;

  v_payload := jsonb_build_array(
    jsonb_build_object(
      'first_name', 'PRUEBA',
      'first_surname', 'REPETIDA-OK',
      'identification', pg_temp.ci(8),
      'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
      'position_code', coalesce(v_code, 'PST-SIN-PUESTO')
    ),
    jsonb_build_object(
      'first_name', 'PRUEBA',
      'first_surname', 'REPETIDA-SIN-PUESTO',
      'identification', pg_temp.ci(9),
      'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD')
    ),
    jsonb_build_object(
      'first_name', 'PRUEBA',
      'first_surname', 'REPETIDA-DUPLICADA',
      'identification', pg_temp.ci(8),
      'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD')
    )
  );

  SELECT public.migration_validate_rows((SELECT entity_id FROM t_ctx), v_payload) INTO r1;
  SELECT public.migration_validate_rows((SELECT entity_id FROM t_ctx), v_payload) INTO r2;

  IF r1 IS DISTINCT FROM r2 THEN
    RAISE EXCEPTION 'T6: la validación no es idempotente. Primera: % · Segunda: %', r1, r2;
  END IF;

  -- La tercera fila repite CI dentro del archivo → WARNING no bloqueante
  IF (r1->2->>'status') <> 'WARNING' THEN
    RAISE EXCEPTION 'T6: la identificación repetida debía ser WARNING, recibido %', r1->2;
  END IF;

  RAISE NOTICE 'PRUEBA 6 OK (respuesta idéntica en dos llamadas): %', r1;
END $$;

-- ===========================================================================
-- PRUEBA 7 · Ausencia de escrituras durante la validación
--   7a) instantánea de tablas antes/después (recuento y última versión de fila)
--   7b) firma pública, SECURITY DEFINER y ACL para `authenticated`
-- ===========================================================================
CREATE TEMP TABLE t_snap_after ON COMMIT DROP AS
SELECT * FROM (
  SELECT 'workers' AS table_name,
         count(*)::bigint AS row_count,
         coalesce(max(xmin::text::bigint), 0) AS last_xmin
  FROM public.workers
  UNION ALL
  SELECT 'worker_position_assignments', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.worker_position_assignments
  UNION ALL
  SELECT 'employment_contracts', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.employment_contracts
  UNION ALL
  SELECT 'organization_positions', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.organization_positions
  UNION ALL
  SELECT 'worker_vacation_movements', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.worker_vacation_movements
  UNION ALL
  SELECT 'worker_salary_history', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.worker_salary_history
  UNION ALL
  SELECT 'candidates', count(*)::bigint, coalesce(max(xmin::text::bigint), 0)
  FROM public.candidates
) AS s;

DO $$
DECLARE
  v_changed text;
BEGIN
  SELECT string_agg(DISTINCT d.table_name, ', ')
    INTO v_changed
  FROM (
    (SELECT table_name, row_count, last_xmin FROM t_snap_before
     EXCEPT
     SELECT table_name, row_count, last_xmin FROM t_snap_after)
    UNION ALL
    (SELECT table_name, row_count, last_xmin FROM t_snap_after
     EXCEPT
     SELECT table_name, row_count, last_xmin FROM t_snap_before)
  ) AS d;

  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'T7a: la validación modificó datos en: %', v_changed;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'migration_validate_rows'
      AND pg_get_function_identity_arguments(p.oid) = 'p_entity_id uuid, p_rows jsonb'
      AND p.prorettype = 'jsonb'::regtype
      AND p.prosecdef = true
  ) THEN
    RAISE EXCEPTION 'T7b: firma pública, tipo de retorno o SECURITY DEFINER alterados';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.migration_validate_rows(uuid, jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'T7b: falta EXECUTE para el rol authenticated';
  END IF;

  RAISE NOTICE 'PRUEBA 7 OK: sin escrituras; firma (uuid, jsonb) → jsonb y ACL intactas';
END $$;

-- ---------------------------------------------------------------------------
-- Cierre: se descarta todo (ningún cambio persistente)
-- ---------------------------------------------------------------------------
ROLLBACK;
