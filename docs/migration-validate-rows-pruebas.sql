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
--   8. Formato del campo `messages` (contrato JSON del frontend)    → array de cadenas
--   9. Cobertura de los 15 mensajes literales del validador         → sin 22P02 ni 55000
--  10. Independencia entre filas de un mismo lote                   → por fila
--
-- Requiere
--   · 20261103_01_migration_validate_rows_record_fix.sql  (RECORD tipado).
--   · 20261103_02_migration_validate_rows_messages_array_fix.sql  (mensajes con
--     array_append). Sin la segunda, las pruebas 0, 4, 5, 6, 8, 9 y 10 fallan con
--     SQLSTATE 22P02 «malformed array literal» al anexar el primer mensaje:
--     `text[] || '<literal>'` resuelve a array_cat(text[], text[]), no a
--     array_append(text[], text).
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

-- Tipos de contrato activos, para las pruebas de contrato migrado (prueba 9).
-- Pueden ser NULL si el catálogo está vacío: en ese caso la prueba omite los
-- mensajes que dependen de ellos.
CREATE TEMP TABLE t_ct ON COMMIT DROP AS
SELECT
  (SELECT t.id FROM public.employment_contract_types t
    WHERE t.is_active = true
    ORDER BY t.code LIMIT 1) AS any_type_id,
  (SELECT t.id FROM public.employment_contract_types t
    WHERE t.is_active = true AND upper(t.code) = 'DETERMINADO'
    LIMIT 1) AS determinado_type_id;

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
-- PRUEBA 8 · Formato del campo `messages` (contrato JSON del frontend)
--   Cada fila debe ser { index: number, status: VALID|WARNING|ERROR,
--   messages: string[], position_id: uuid|null, position_label: string|null }.
--   `messages` debe ser un ARRAY JSON de cadenas: ni una cadena, ni un array con
--   elementos no-cadena, ni un literal de array serializado («{…}»). Es lo que
--   consume MigrationPreviewRow (src/modules/people/domain/entities.ts) y lo que
--   el frontend recorre con spread en src/modules/people/domain/worker-migration.rules.ts.
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
  e jsonb;
  v_code text;
  v_estado_esperado text;
BEGIN
  SELECT free_position_code INTO v_code FROM t_ctx;
  v_estado_esperado := CASE WHEN v_code IS NULL THEN 'ERROR' ELSE 'VALID' END;

  SELECT public.migration_validate_rows(
           (SELECT entity_id FROM t_ctx),
           jsonb_build_array(
             jsonb_build_object(
               'first_name', 'PRUEBA',
               'first_surname', 'FORMATO-OK',
               'identification', pg_temp.ci(10),
               'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
               'position_code', coalesce(v_code, 'PST-SIN-PUESTOS')
             ),
             jsonb_build_object(
               'first_name', '',
               'first_surname', '',
               'identification', 'abc',
               'employment_start_date', 'no-es-fecha',
               'initial_vacation_balance', '-5'
             )
           )
         ) INTO r;

  IF jsonb_typeof(r) <> 'array' THEN
    RAISE EXCEPTION 'T8: la respuesta debe ser un array JSON. Recibido: %', r;
  END IF;
  IF jsonb_array_length(r) <> 2 THEN
    RAISE EXCEPTION 'T8: la respuesta debe tener 2 filas. Recibido: %', r;
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(r) LOOP
    IF NOT (e ? 'index' AND e ? 'status' AND e ? 'messages'
            AND e ? 'position_id' AND e ? 'position_label') THEN
      RAISE EXCEPTION 'T8: faltan claves del contrato en la fila: %', e;
    END IF;
    IF jsonb_typeof(e -> 'index') <> 'number' OR jsonb_typeof(e -> 'status') <> 'string' THEN
      RAISE EXCEPTION 'T8: index debe ser número y status cadena: %', e;
    END IF;
    IF (e ->> 'status') NOT IN ('VALID', 'WARNING', 'ERROR') THEN
      RAISE EXCEPTION 'T8: estado no previsto por el frontend: %', e ->> 'status';
    END IF;
    IF jsonb_typeof(e -> 'messages') <> 'array' THEN
      RAISE EXCEPTION 'T8: messages debe ser un array JSON; recibido % (%): %',
        jsonb_typeof(e -> 'messages'), e ->> 'messages', e;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(e -> 'messages') m
      WHERE jsonb_typeof(m) <> 'string'
    ) THEN
      RAISE EXCEPTION 'T8: todos los elementos de messages deben ser cadenas: %', e -> 'messages';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(e -> 'messages') m
      WHERE btrim(m) = '' OR m LIKE '{%'
    ) THEN
      RAISE EXCEPTION 'T8: mensaje vacío o con forma de literal de array: %', e -> 'messages';
    END IF;
    IF (e ->> 'position_id') IS NOT NULL
       AND (e ->> 'position_id')
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'T8: position_id debe ser un UUID o null: %', e ->> 'position_id';
    END IF;
    IF (e ->> 'position_label') IS NOT NULL
       AND jsonb_typeof(e -> 'position_label') <> 'string' THEN
      RAISE EXCEPTION 'T8: position_label debe ser cadena o null: %', e;
    END IF;
  END LOOP;

  -- Fila 0: sin mensajes si el puesto se resolvió; en caso contrario, exactamente
  -- el mensaje de puesto no encontrado (nunca una excepción ni un array inválido).
  IF (r -> 0 ->> 'status') IS DISTINCT FROM v_estado_esperado THEN
    RAISE EXCEPTION 'T8 fila 0: estado % (esperado %): %', r -> 0 ->> 'status', v_estado_esperado, r -> 0;
  END IF;
  IF v_code IS NOT NULL AND jsonb_array_length(r -> 0 -> 'messages') <> 0 THEN
    RAISE EXCEPTION 'T8: la fila válida no debe acumular mensajes: %', r -> 0;
  END IF;
  IF v_code IS NULL AND jsonb_array_length(r -> 0 -> 'messages') <> 1 THEN
    RAISE EXCEPTION 'T8: se esperaba un único mensaje de puesto no encontrado: %', r -> 0;
  END IF;

  -- Fila 1: varios mensajes acumulados en el mismo array JSON.
  IF jsonb_array_length(r -> 1 -> 'messages') < 5 THEN
    RAISE EXCEPTION 'T8 fila 1: se esperaban al menos 5 mensajes: %', r -> 1;
  END IF;

  RAISE NOTICE 'PRUEBA 8 OK: messages es array JSON de % cadenas (fila válida) y % (fila con varios avisos)',
    jsonb_array_length(r -> 0 -> 'messages'), jsonb_array_length(r -> 1 -> 'messages');
END $$;

-- ===========================================================================
-- PRUEBA 9 · Cobertura de los 15 mensajes literales → ningún 22P02 ni 55000
--   Un solo lote que dispara TODOS los avisos que se acumulaban con
--   `v_messages || '<literal>'`. Antes de 20261103_02 esta llamada abortaba con
--   SQLSTATE 22P02 «malformed array literal» en la primera de esas líneas que se
--   alcanzara (con la plantilla oficial: el aviso de pendiente de vinculación).
--   Ahora debe devolver resultado por fila, sin excepción SQL, y cada texto debe
--   aparecer como cadena dentro del array `messages`.
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
  v_code text;
  v_any uuid;
  v_det uuid;
  v_payload jsonb;
  v_observados text[];
  v_faltantes text[];
  v_esperados text[] := ARRAY[
    'El nombre es obligatorio',
    'El primer apellido es obligatorio',
    'El carné de identidad es obligatorio',
    'El número de identificación debe contener exactamente 11 dígitos',
    'Fecha de incorporación inválida o vacía',
    'La fecha de incorporación no puede ser futura',
    'Se importará como pendiente de vinculación a plantilla',
    'El saldo inicial de vacaciones debe estar entre 0 y 24 días',
    'Saldo inicial de vacaciones inválido',
    'Sin fecha de corte: se usará la fecha de incorporación',
    'El contrato migrado requiere que el trabajador se vincule a un puesto'
  ]::text[];
BEGIN
  SELECT free_position_code INTO v_code FROM t_ctx;
  SELECT any_type_id, determinado_type_id INTO v_any, v_det FROM t_ct;

  IF v_code IS NOT NULL THEN
    v_esperados := v_esperados || 'Tipo de contrato no encontrado o inactivo';
  END IF;
  IF v_code IS NOT NULL AND v_any IS NOT NULL THEN
    v_esperados := v_esperados || 'El contrato migrado requiere fecha de inicio';
    v_esperados := v_esperados || 'La fecha de fin del contrato debe ser posterior a su inicio';
  END IF;
  IF v_code IS NOT NULL AND v_det IS NOT NULL THEN
    v_esperados := v_esperados || 'El contrato por tiempo determinado requiere fecha de fin';
  END IF;

  SELECT jsonb_agg(row_obj ORDER BY ord) INTO v_payload
  FROM (
    VALUES
      -- (1) nombre obligatorio
      (1, jsonb_build_object('first_name', '', 'first_surname', 'COBERTURA-01',
            'identification', pg_temp.ci(20),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'))),
      -- (2) primer apellido obligatorio
      (2, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', '',
            'identification', pg_temp.ci(21),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'))),
      -- (3) carné de identidad obligatorio
      (3, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-03',
            'identification', '   ',
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'))),
      -- (4) regla de 11 dígitos
      (4, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-04',
            'identification', 'abc',
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'))),
      -- (5) fecha de incorporación inválida
      (5, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-05',
            'identification', pg_temp.ci(22),
            'employment_start_date', 'no-es-fecha')),
      -- (6) fecha de incorporación futura
      (6, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-06',
            'identification', pg_temp.ci(23),
            'employment_start_date', to_char(current_date + 1, 'YYYY-MM-DD'))),
      -- (7) sin puesto → aviso de pendiente de vinculación (plantilla oficial)
      (7, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-07',
            'identification', pg_temp.ci(24),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'))),
      -- (8) saldo inicial fuera de rango
      (8, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-08',
            'identification', pg_temp.ci(25),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
            'initial_vacation_balance', '-5')),
      -- (9) saldo inicial no numérico
      (9, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-09',
            'identification', pg_temp.ci(26),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
            'initial_vacation_balance', 'abc')),
      -- (10) sin fecha de corte (saldo válido)
      (10, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-10',
            'identification', pg_temp.ci(27),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
            'initial_vacation_balance', '5')),
      -- (11) contrato migrado sin puesto vinculado
      (11, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-11',
            'identification', pg_temp.ci(28),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
            'contract', jsonb_build_object(
              'start_date', to_char(current_date - 300, 'YYYY-MM-DD')))),
      -- (12) tipo de contrato inexistente (requiere puesto)
      (12, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-12',
            'identification', pg_temp.ci(29),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
            'position_code', v_code,
            'contract', jsonb_build_object(
              'contract_type_id', gen_random_uuid()::text,
              'start_date', to_char(current_date - 300, 'YYYY-MM-DD')))),
      -- (13) contrato sin fecha de inicio
      (13, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-13',
            'identification', pg_temp.ci(30),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
            'position_code', v_code,
            'contract', jsonb_build_object('contract_type_id', v_any::text))),
      -- (14) contrato por tiempo determinado sin fecha de fin
      (14, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-14',
            'identification', pg_temp.ci(31),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
            'position_code', v_code,
            'contract', jsonb_build_object(
              'contract_type_id', v_det::text,
              'start_date', to_char(current_date - 300, 'YYYY-MM-DD')))),
      -- (15) fecha de fin anterior o igual al inicio
      (15, jsonb_build_object('first_name', 'PRUEBA', 'first_surname', 'COBERTURA-15',
            'identification', pg_temp.ci(32),
            'employment_start_date', to_char(current_date - 400, 'YYYY-MM-DD'),
            'position_code', v_code,
            'contract', jsonb_build_object(
              'contract_type_id', v_any::text,
              'start_date', to_char(current_date - 300, 'YYYY-MM-DD'),
              'end_date', to_char(current_date - 300, 'YYYY-MM-DD'))))
  ) AS t(ord, row_obj)
  WHERE (ord NOT IN (12, 13, 14, 15) OR v_code IS NOT NULL)
    AND (ord <> 13 OR v_any IS NOT NULL)
    AND (ord <> 14 OR v_det IS NOT NULL)
    AND (ord <> 15 OR v_any IS NOT NULL);

  BEGIN
    SELECT public.migration_validate_rows((SELECT entity_id FROM t_ctx), v_payload) INTO r;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'T9: la validación lanzó un error SQL % (%) — se esperaba respuesta por fila',
      SQLSTATE, SQLERRM;
  END;

  IF jsonb_typeof(r) <> 'array' THEN
    RAISE EXCEPTION 'T9: la respuesta debe ser un array JSON: %', r;
  END IF;
  IF jsonb_array_length(r) < 10 THEN
    RAISE EXCEPTION 'T9: respuesta inesperada (% filas): %', jsonb_array_length(r), r;
  END IF;

  SELECT array_agg(DISTINCT m ORDER BY m) INTO v_observados
  FROM jsonb_array_elements(r) e, jsonb_array_elements_text(e -> 'messages') m;

  SELECT array_agg(x.m ORDER BY x.m) INTO v_faltantes
  FROM unnest(v_esperados) AS x(m)
  WHERE NOT (coalesce(v_observados, ARRAY[]::text[]) @> ARRAY[x.m]);

  IF v_faltantes IS NOT NULL THEN
    RAISE EXCEPTION 'T9: faltan % de los mensajes esperados: %',
      array_length(v_faltantes, 1), v_faltantes;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(v_observados, ARRAY[]::text[])) o
    WHERE btrim(o) = '' OR o LIKE '{%'
  ) THEN
    RAISE EXCEPTION 'T9: algún mensaje no tiene forma de cadena simple: %', v_observados;
  END IF;

  -- La fila sin puesto debe seguir siendo WARNING no bloqueante, sin puesto asignado.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(r) e
    WHERE (e -> 'messages') @> to_jsonb(ARRAY['Se importará como pendiente de vinculación a plantilla'])
      AND (e ->> 'status') = 'WARNING'
      AND (e ->> 'position_id') IS NULL
      AND (e ->> 'position_label') IS NULL
  ) THEN
    RAISE EXCEPTION 'T9: la fila sin puesto no quedó como WARNING con position_id null: %', r;
  END IF;

  IF v_code IS NOT NULL AND v_any IS NOT NULL AND v_det IS NOT NULL
     AND array_length(v_esperados, 1) <> 15 THEN
    RAISE EXCEPTION 'T9: cobertura incompleta de mensajes (% de 15)', array_length(v_esperados, 1);
  END IF;

  RAISE NOTICE 'PRUEBA 9 OK: % mensajes literales cubiertos sin error SQL (observados: %)',
    array_length(v_esperados, 1), array_length(v_observados, 1);
END $$;

-- ===========================================================================
-- PRUEBA 10 · Independencia entre filas de un mismo lote
--  25 filas: 5 con puesto válido (VALID) · 5 con identificación repetida dentro
--  del archivo (WARNING) · 10 sin puesto (WARNING) · 5 con puesto inexistente
--  (ERROR). Comprueba que la posición resuelta y los mensajes NO se filtran de
--  una fila a la siguiente (regresión del reinicio por fila de v_position).
-- ===========================================================================
DO $$
DECLARE
  r jsonb;
  v_code text;
  v_pos uuid;
  v_cap integer;
  v_payload jsonb;
  v_problemas text;
BEGIN
  SELECT free_position_code, free_position_id, free_capacity
    INTO v_code, v_pos, v_cap
  FROM t_ctx;

  IF v_code IS NULL THEN
    RAISE NOTICE 'PRUEBA 10 SALTADA: la entidad no tiene puestos activos con vacante libre';
    RETURN;
  END IF;
  IF coalesce(v_cap, 0) < 10 THEN
    RAISE NOTICE 'PRUEBA 10 SALTADA: se necesitan 10 vacantes libres para las filas con puesto (disponible %)', v_cap;
    RETURN;
  END IF;

  SELECT jsonb_agg(row_obj ORDER BY ord) INTO v_payload
  FROM (
    SELECT n AS ord,
           jsonb_build_object(
             'first_name', 'PRUEBA', 'first_surname', 'INDEP-VALIDA-' || n,
             'identification', pg_temp.ci(50 + n),
             'employment_start_date', to_char(current_date - 200, 'YYYY-MM-DD'),
             'position_code', v_code) AS row_obj
    FROM generate_series(1, 5) AS n
    UNION ALL
    SELECT 5 + n,
           jsonb_build_object(
             'first_name', 'PRUEBA', 'first_surname', 'INDEP-REPETIDA-' || n,
             'identification', pg_temp.ci(51),
             'employment_start_date', to_char(current_date - 200, 'YYYY-MM-DD'),
             'position_code', v_code)
    FROM generate_series(1, 5) AS n
    UNION ALL
    SELECT 10 + n,
           jsonb_build_object(
             'first_name', 'PRUEBA', 'first_surname', 'INDEP-PENDIENTE-' || n,
             'identification', pg_temp.ci(60 + n),
             'employment_start_date', to_char(current_date - 200, 'YYYY-MM-DD'))
    FROM generate_series(1, 10) AS n
    UNION ALL
    SELECT 20 + n,
           jsonb_build_object(
             'first_name', 'PRUEBA', 'first_surname', 'INDEP-FANTASMA-' || n,
             'identification', pg_temp.ci(70 + n),
             'employment_start_date', to_char(current_date - 200, 'YYYY-MM-DD'),
             'position_code', v_code || '-NO-EXISTE-' || n)
    FROM generate_series(1, 5) AS n
  ) AS t;

  BEGIN
    SELECT public.migration_validate_rows((SELECT entity_id FROM t_ctx), v_payload) INTO r;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'T10: la validación lanzó un error SQL % (%)', SQLSTATE, SQLERRM;
  END;

  IF jsonb_typeof(r) <> 'array' THEN
    RAISE EXCEPTION 'T10: la respuesta debe ser un array JSON: %', r;
  END IF;
  IF jsonb_array_length(r) <> 25 THEN
    RAISE EXCEPTION 'T10: se esperaban 25 filas, recibidas %', jsonb_array_length(r);
  END IF;

  SELECT string_agg(v.msg, ' · ') INTO v_problemas
  FROM (
    SELECT 'T10a fila ' || (e ->> 'index') || ' con puesto válido debería ser VALID pero es '
             || (e ->> 'status') AS msg
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 0 AND 4 AND (e ->> 'status') <> 'VALID'
    UNION ALL
    SELECT 'T10b fila ' || (e ->> 'index') || ' con identificación repetida debería ser WARNING pero es '
             || (e ->> 'status')
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 5 AND 9 AND (e ->> 'status') <> 'WARNING'
    UNION ALL
    SELECT 'T10c fila ' || (e ->> 'index') || ' sin puesto debería ser WARNING pero es '
             || (e ->> 'status')
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 10 AND 19 AND (e ->> 'status') <> 'WARNING'
    UNION ALL
    SELECT 'T10d fila ' || (e ->> 'index') || ' con puesto inexistente debería ser ERROR pero es '
             || (e ->> 'status')
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 20 AND 24 AND (e ->> 'status') <> 'ERROR'
    UNION ALL
    SELECT 'T10e fila ' || (e ->> 'index') || ' no debería exponer position_id (posición filtrada)'
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 10 AND 24 AND (e ->> 'position_id') IS NOT NULL
    UNION ALL
    SELECT 'T10f fila ' || (e ->> 'index') || ' debería exponer el puesto resuelto'
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 0 AND 9
      AND (e ->> 'position_id')::uuid IS DISTINCT FROM v_pos
    UNION ALL
    SELECT 'T10g fila ' || (e ->> 'index') || ' no debería heredar «Puesto no encontrado»'
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 0 AND 9
      AND (e -> 'messages') @> to_jsonb(ARRAY['Puesto no encontrado (' || v_code || ')'])
    UNION ALL
    SELECT 'T10h fila ' || (e ->> 'index') || ' sin puesto debería llevar el aviso de vinculación'
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 10 AND 19
      AND NOT ((e -> 'messages') @> to_jsonb(ARRAY['Se importará como pendiente de vinculación a plantilla']))
    UNION ALL
    SELECT 'T10i fila ' || (e ->> 'index') || ' con puesto inexistente debería llevar el mensaje de no encontrado'
    FROM jsonb_array_elements(r) e
    WHERE (e ->> 'index')::int BETWEEN 20 AND 24
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(e -> 'messages') m
        WHERE m LIKE 'Puesto no encontrado (%'
      )
  ) AS v;

  IF v_problemas IS NOT NULL THEN
    RAISE EXCEPTION 'T10: %', v_problemas;
  END IF;

  RAISE NOTICE 'PRUEBA 10 OK: 25 filas independientes (5 VALID · 5 WARNING repetida · 10 WARNING sin puesto · 5 ERROR)';
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
