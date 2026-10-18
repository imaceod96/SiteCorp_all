-- ============================================================================
-- SiteCorp · Carga inicial de trabajadores
-- Corrección: 22P02 «malformed array literal» en la construcción de mensajes de
--             public.migration_validate_rows(uuid, jsonb)
--
-- ----------------------------------------------------------------------------
-- CAUSA EXACTA (verificada sobre la definición desplegada)
--
--   `v_messages` está declarada como `text[]`. Los avisos se acumulaban con el
--   operador de concatenación y un literal de cadena:
--
--       v_messages := v_messages || 'Se importará como pendiente de vinculación a plantilla';
--
--   El problema NO es la asignación en sí, sino QUÉ OPERADOR elige PostgreSQL.
--   Con un operando izquierdo de tipo `text[]` y un literal de tipo `unknown`,
--   la resolución de operadores asume que el desconocido es del mismo tipo que
--   el conocido (`text[]`) y por tanto selecciona:
--
--       array_cat(anyarray, anyarray)   -> text[]  ||  text[]   ✗
--
--   en lugar de:
--
--       array_append(anyarray, anyelement) -> text[] || text     ✓
--
--   Consecuencia: el literal se interpreta como *literal de array* y el motor
--   aborta con
--       SQLSTATE 22P02 · malformed array literal: "Se importará como…"
--       DETAIL: Array value must start with "{" or dimension information.
--   La sentencia señalada por PostgreSQL es exactamente la asignación anterior
--   (línea 199 de la definición desplegada); la comprobación se reprodujo en
--   las pruebas de regresión (ver docs/migration-validate-rows-pruebas.sql,
--   pruebas 0, 4, 5 y 6).
--
--   Alcance real del defecto: 15 sentencias del patrón `v_messages || '<literal>'`.
--   Las 7 que usan `format(...)` NO están afectadas, porque `format()` devuelve
--   `text` (tipo conocido) y la resolución de operadores elige `array_append`
--   correctamente — de ahí que «Puesto no encontrado», «Referencia de puesto
--   ambigua», «Puesto sin capacidad disponible» y los avisos de identificación
--   repetida funcionaran bien mientras el resto fallaba.
--
--   Efecto funcional: al quedar corregido el 55000 previo (migración
--   20261103_01), la ruta «fila sin puesto» alcanza por primera vez la línea
--   del aviso de pendiente de vinculación y es ahí donde revienta: la plantilla
--   oficial de carga inicial (sin «Código Puesto») seguía devolviendo HTTP 500,
--   ahora con SQLSTATE 22P02. Igualmente, cualquier fila con un mensaje de
--   validación de campo abortaba el lote completo en vez de devolver el
--   detalle por fila.
--
-- ----------------------------------------------------------------------------
-- CORRECCIÓN (mínima, solo tratamiento de mensajes)
--   Las 15 asignaciones pasan a la forma explícita e inequívoca:
--
--       v_messages := array_append(v_messages, '<literal>');
--
--   Se usa `array_append` (y no `|| ARRAY['<literal>']`) para que la intención
--   quede explícita en el código y no dependa de la resolución de operadores.
--   NO se añade COALESCE: `v_messages` se reinicia con `ARRAY[]::text[]` al
--   comienzo de CADA fila, antes de cualquier anexo, por lo que nunca se llama
--   a `array_append` con un array NULL.
--
--   Las 7 anexiones con `format(...)` se dejan intactas (ya resuelven a
--   `array_append`) para que el cambio se limite estrictamente
--   a lo que está roto: el diff contra 20261103_01 son exactamente 15 líneas.
--
-- ----------------------------------------------------------------------------
-- LO QUE NO CAMBIA
--   · Firma pública: (p_entity_id uuid, p_rows jsonb) RETURNS jsonb.
--   · Contrato JSON de respuesta, por fila:
--       { index: number, status: "VALID"|"WARNING"|"ERROR",
--         messages: string[], position_id: uuid|null, position_label: text|null }
--     `messages` sigue construyéndose con `to_jsonb(v_messages)`, que produce
--     un array JSON de cadenas (nunca una cadena ni un array con huecos).
--     Coincide con `MigrationPreviewRow` (src/modules/people/domain/entities.ts)
--     y con el consumo directo de la RPC en
--     src/modules/people/infrastructure/worker-migration.repository.ts.
--   · Regla de identificación de exactamente 11 dígitos.
--   · Duplicados (en el archivo, en trabajadores o en candidatos) como avisos
--     WARNING no bloqueantes.
--   · Trabajador sin puesto → WARNING «Se importará como pendiente de
--     vinculación a plantilla».
--   · Validación de puesto (no encontrado / referencia ambigua) y de capacidad
--     disponible (authorized_quantity frente a ocupación real + reservas del
--     mismo lote).
--   · Contrato migrado (tipo activo, fecha de inicio, fin para DETERMINADO,
--     fin posterior al inicio) y saldo inicial de vacaciones 0..24.
--   · `migration_import_rows` no se toca: sigue validando con esta función y
--     abortando si hay filas ERROR, por lo que queda desbloqueado al corregir
--     esto.
--   · Función de SOLO LECTURA: no crea ni modifica trabajadores, contratos,
--     plazas, asignaciones ni vacantes.
--
-- ----------------------------------------------------------------------------
-- ALCANCE / REVERSIÓN
--   · CREATE OR REPLACE: conserva OID, propietario y ACL (sin DROP FUNCTION).
--   · No se modifica ninguna migración histórica (20261023_01,
--     20261025_04 y 20261103_01 quedan intactas). Este archivo es el único
--     incremento.
--   · Reversión: volver a aplicar el cuerpo de 20261103_01
--     (record-fix), que restaura el estado previo a este cambio.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migration_validate_rows(
    p_entity_id uuid,
    p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_tenant_id uuid;
    v_row jsonb;
    v_idx integer := 0;
    v_result jsonb := '[]'::jsonb;
    v_status text;
    v_messages text[];
    v_ident text;
    v_start date;
    -- RECORD tipado: la variable tiene estructura desde su declaración, por lo
    -- que es seguro leer v_position.id aunque ninguna fila se haya asignado.
    v_position public.organization_positions%rowtype;
    v_pos_raw text;
    v_pos_id uuid;
    v_pos_label text;
    v_matches integer;
    v_occ integer;
    v_batch jsonb := '{}'::jsonb;
    v_seen jsonb := '{}'::jsonb;
    v_balance text;
    v_contract jsonb;
    v_contract_type_code text;
    v_cstart date;
    v_cend date;
BEGIN
    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;

    SELECT company_client_id INTO v_tenant_id
    FROM public.organization_entities WHERE id = p_entity_id AND is_active = true;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'La entidad no existe o no está activa';
    END IF;

    IF jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'Se esperaba una lista de filas';
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
        v_status := 'VALID';
        v_messages := ARRAY[]::text[];
        v_pos_id := NULL;
        v_pos_label := NULL;
        v_position := NULL;
        v_contract_type_code := NULL;
        v_cstart := NULL;
        v_cend := NULL;

        -- Obligatorios
        IF NULLIF(btrim(COALESCE(v_row ->> 'first_name', '')), '') IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El nombre es obligatorio');
        END IF;
        IF NULLIF(btrim(COALESCE(v_row ->> 'first_surname', '')), '') IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El primer apellido es obligatorio');
        END IF;

        v_ident := NULLIF(btrim(COALESCE(v_row ->> 'identification', '')), '');
        IF v_ident IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El carné de identidad es obligatorio');
        ELSE
            IF v_ident !~ '^[0-9]{11}$' THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'El número de identificación debe contener exactamente 11 dígitos');
            END IF;

            -- VALIDACIÓN CRUZADA PERSONA-EN-MASA (NO BLOQUEANTE). Si dos filas
            -- comparten la misma identificación, o una ya existe en el workspace,
            -- la carga NO se detiene: se crean ambas personas y solo se avisa para
            -- corregir. Por eso estas comprobaciones son WARNING, nunca ERROR.
            IF v_seen ? v_ident THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Identificación repetida dentro del archivo (%s): otra fila usa el mismo carné. Corrija la identificación.', v_ident);
            ELSE
                v_seen := v_seen || jsonb_build_object(v_ident, true);
            END IF;

            IF EXISTS (
                SELECT 1 FROM public.workers w
                WHERE w.company_client_id = v_tenant_id
                  AND w.identification = v_ident
            ) THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Ya existe un trabajador en este workspace con el carné de identidad %s. Se creará igualmente; corrija la identificación.', v_ident);
            END IF;

            IF EXISTS (
                SELECT 1 FROM public.candidates c
                WHERE c.company_client_id = v_tenant_id
                  AND c.identification = v_ident
            ) THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Existe un candidato en este workspace con el carné de identidad %s. Corrija la identificación si no es la misma persona.', v_ident);
            END IF;
        END IF;

        -- Fecha de incorporación
        BEGIN
            v_start := NULLIF(btrim(COALESCE(v_row ->> 'employment_start_date', '')), '')::date;
        EXCEPTION WHEN OTHERS THEN
            v_start := NULL;
        END;
        IF v_start IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'Fecha de incorporación inválida o vacía');
        ELSIF v_start > CURRENT_DATE THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'La fecha de incorporación no puede ser futura');
        END IF;

        -- Puesto (opcional): se acepta id o código estable
        v_pos_raw := NULLIF(btrim(COALESCE(v_row ->> 'position_id', '')), '');
        IF v_pos_raw IS NULL THEN
            v_pos_raw := NULLIF(btrim(COALESCE(v_row ->> 'position_code', '')), '');
        END IF;

        IF v_pos_raw IS NOT NULL THEN
            BEGIN
                v_pos_id := v_pos_raw::uuid;
            EXCEPTION WHEN OTHERS THEN
                v_pos_id := NULL;
            END;
        END IF;

        IF v_pos_id IS NOT NULL THEN
            SELECT op.*
            INTO v_position
            FROM public.organization_positions op
            WHERE op.id = v_pos_id
              AND op.organization_entity_id = p_entity_id
              AND op.is_active = true;
            IF NOT FOUND THEN
                v_pos_id := NULL;
                v_status := 'ERROR';
                v_messages := v_messages || format('Puesto no encontrado (%s)', v_pos_raw);
            END IF;
        ELSIF v_pos_raw IS NOT NULL THEN
            SELECT COUNT(*) INTO v_matches
            FROM public.organization_positions op
            WHERE op.organization_entity_id = p_entity_id
              AND op.is_active = true
              AND upper(op.code) = upper(v_pos_raw);
            IF v_matches = 0 THEN
                v_status := 'ERROR';
                v_messages := v_messages || format('Puesto no encontrado (%s)', v_pos_raw);
            ELSIF v_matches > 1 THEN
                v_status := 'ERROR';
                v_messages := v_messages || format('Referencia de puesto ambigua (%s): use el identificador', v_pos_raw);
            ELSE
                SELECT op.*
                INTO v_position
                FROM public.organization_positions op
                WHERE op.organization_entity_id = p_entity_id
                  AND op.is_active = true
                  AND upper(op.code) = upper(v_pos_raw);
            END IF;
        END IF;

        -- Con %rowtype esta comprobación es segura aunque no se haya asignado nada.
        IF v_position.id IS NOT NULL THEN
            v_pos_id := v_position.id;
            v_pos_label := v_position.name || ' (' || v_position.code || ')';

            SELECT COUNT(*) INTO v_occ
            FROM public.worker_position_assignments a
            JOIN public.workers w ON w.id = a.worker_id
            WHERE a.position_id = v_position.id
              AND a.is_current = true
              AND a.end_date IS NULL
              AND w.employment_status = 'active';

            v_occ := v_occ + COALESCE((v_batch ->> v_position.id::text)::int, 0);

            IF v_occ >= v_position.authorized_quantity THEN
                v_status := 'ERROR';
                v_messages := v_messages || format(
                    'Puesto sin capacidad disponible: %s (capacidad %s, ocupadas %s)',
                    v_position.name, v_position.authorized_quantity, v_occ
                );
            ELSE
                v_batch := v_batch || jsonb_build_object(
                    v_position.id::text, COALESCE((v_batch ->> v_position.id::text)::int, 0) + 1
                );
            END IF;
        ELSIF v_pos_raw IS NULL THEN
            IF v_status <> 'ERROR' THEN
                v_status := 'WARNING';
            END IF;
            v_messages := array_append(v_messages, 'Se importará como pendiente de vinculación a plantilla');
        END IF;

        -- Saldo inicial de vacaciones
        v_balance := NULLIF(btrim(COALESCE(v_row ->> 'initial_vacation_balance', '')), '');
        IF v_balance IS NOT NULL THEN
            BEGIN
                IF v_balance::numeric < 0 OR v_balance::numeric > 24 THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El saldo inicial de vacaciones debe estar entre 0 y 24 días');
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'Saldo inicial de vacaciones inválido');
            END;
            IF NULLIF(btrim(COALESCE(v_row ->> 'vacation_cutoff_date', '')), '') IS NULL
               AND v_status <> 'ERROR' THEN
                v_messages := array_append(v_messages, 'Sin fecha de corte: se usará la fecha de incorporación');
            END IF;
        END IF;

        -- Contrato migrado (opcional, requiere puesto)
        v_contract := v_row -> 'contract';
        IF v_contract IS NOT NULL AND jsonb_typeof(v_contract) = 'object' THEN
            IF v_pos_id IS NULL THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'El contrato migrado requiere que el trabajador se vincule a un puesto');
            ELSE
                SELECT code INTO v_contract_type_code
                FROM public.employment_contract_types
                WHERE id = NULLIF(btrim(COALESCE(v_contract ->> 'contract_type_id', '')), '')::uuid
                  AND is_active = true;
                IF v_contract_type_code IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'Tipo de contrato no encontrado o inactivo');
                END IF;

                BEGIN
                    v_cstart := NULLIF(btrim(COALESCE(v_contract ->> 'start_date', '')), '')::date;
                    v_cend := NULLIF(btrim(COALESCE(v_contract ->> 'end_date', '')), '')::date;
                EXCEPTION WHEN OTHERS THEN
                    v_cstart := NULL; v_cend := NULL;
                END;

                IF v_cstart IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El contrato migrado requiere fecha de inicio');
                END IF;
                IF v_contract_type_code = 'DETERMINADO' AND v_cend IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El contrato por tiempo determinado requiere fecha de fin');
                END IF;
                IF v_cend IS NOT NULL AND v_cstart IS NOT NULL AND v_cend <= v_cstart THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'La fecha de fin del contrato debe ser posterior a su inicio');
                END IF;
            END IF;
        END IF;

        v_result := v_result || jsonb_build_object(
            'index', v_idx,
            'status', v_status,
            'messages', to_jsonb(v_messages),
            'position_id', v_pos_id,
            'position_label', v_pos_label
        );

        v_idx := v_idx + 1;
    END LOOP;

    RETURN v_result;
END;
$$;

-- La firma no cambia: CREATE OR REPLACE conserva la ACL existente. Se repite el
-- GRANT para que la RPC siga siendo invocable desde la aplicación.
GRANT EXECUTE ON FUNCTION public.migration_validate_rows(uuid, jsonb) TO authenticated;
