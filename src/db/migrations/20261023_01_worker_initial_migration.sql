-- ============================================================================
-- FASE — MIGRACIÓN INICIAL DE TRABAJADORES
--   · Importación individual y masiva (Excel) de trabajadores preexistentes.
--   · El trabajador migrado es un Worker normal (NO hay tabla paralela).
--   · Área/Cargo/Puesto son OPCIONALES: si faltan, el trabajador queda
--     "Pendiente de vinculación a plantilla" (sin assignment, sin capacidad).
--   · La fecha canónica de antigüedad es workers.employment_start_date.
--   · NO se generan documentos (contrato DOCX, anexos, resoluciones, SC-4-04).
--
-- Se elimina la implementación anterior (migrate_worker_basic) porque insertaba
-- columnas inexistentes (tenant_id / organization_entity_id) en
-- worker_position_assignments y porque exigía Puesto obligatorio.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Limpieza de la implementación anterior (rota).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.migrate_worker_basic(
    uuid, jsonb, uuid, date, numeric, date, text
);

-- ----------------------------------------------------------------------------
-- 1. Creador interno de un trabajador migrado a partir de una fila jsonb.
--    Fuente ÚNICA de lógica para la migración individual y la masiva.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.migration_create_worker(
    p_entity_id uuid,
    p_row jsonb,
    p_batch_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_tenant_id uuid;
    v_entity_name text;
    v_worker_id uuid;
    v_code text;
    v_assignment_id uuid;
    v_contract_id uuid;
    v_position record;
    v_job record;
    v_occ integer;
    v_ident text;
    v_start date;
    v_balance numeric;
    v_cutoff date;
    v_contract jsonb;
    v_rep record;
    v_scale_id uuid;
    v_group_id uuid;
    v_group_seq integer;
    v_attempt integer;
    v_contract_type_code text;
    v_contract_start date;
    v_contract_end date;
BEGIN
    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;

    SELECT company_client_id, name INTO v_tenant_id, v_entity_name
    FROM public.organization_entities
    WHERE id = p_entity_id AND is_active = true;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'La entidad no existe o no está activa';
    END IF;

    -- Datos mínimos obligatorios
    v_ident := NULLIF(btrim(COALESCE(p_row ->> 'identification', '')), '');
    IF v_ident IS NULL THEN
        RAISE EXCEPTION 'El carné de identidad es obligatorio';
    END IF;
    IF NULLIF(btrim(COALESCE(p_row ->> 'first_name', '')), '') IS NULL THEN
        RAISE EXCEPTION 'El nombre es obligatorio';
    END IF;
    IF NULLIF(btrim(COALESCE(p_row ->> 'first_surname', '')), '') IS NULL THEN
        RAISE EXCEPTION 'El primer apellido es obligatorio';
    END IF;

    -- Fecha histórica de incorporación (antigüedad)
    v_start := NULLIF(btrim(COALESCE(p_row ->> 'employment_start_date', '')), '')::date;
    IF v_start IS NULL THEN
        RAISE EXCEPTION 'La fecha de incorporación es obligatoria';
    END IF;
    IF v_start > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha de incorporación no puede ser futura';
    END IF;

    -- Identificación duplicada: misma regla que la BD (tenant + activo).
    -- También protege la idempotencia del lote (reejecución → error claro).
    IF EXISTS (
        SELECT 1 FROM public.workers w
        WHERE w.company_client_id = v_tenant_id
          AND w.identification = v_ident
          AND w.employment_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Ya existe un trabajador activo con el carné de identidad % en este workspace', v_ident;
    END IF;

    -- Puesto OPCIONAL
    IF NULLIF(btrim(COALESCE(p_row ->> 'position_id', '')), '') IS NOT NULL THEN
        SELECT op.id, op.authorized_quantity, op.job_id
        INTO v_position
        FROM public.organization_positions op
        WHERE op.id = (p_row ->> 'position_id')::uuid
          AND op.organization_entity_id = p_entity_id
          AND op.is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Puesto no encontrado o inactivo en esta entidad';
        END IF;

        SELECT COUNT(*) INTO v_occ
        FROM public.worker_position_assignments a
        JOIN public.workers w ON w.id = a.worker_id
        WHERE a.position_id = v_position.id
          AND a.is_current = true
          AND a.end_date IS NULL
          AND w.employment_status = 'active';

        IF v_occ >= v_position.authorized_quantity THEN
            RAISE EXCEPTION 'El puesto no tiene plazas disponibles (capacidad: %, ocupadas: %)',
                v_position.authorized_quantity, v_occ;
        END IF;
    END IF;

    -- Worker (origen MIGRATION, employment_start_date histórica)
    FOR v_attempt IN 1..5 LOOP
        v_code := 'TRB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        BEGIN
            INSERT INTO public.workers (
                company_client_id, organization_entity_id, code,
                first_name, first_surname, second_surname, identification, birth_date,
                gender_id, marital_status_id, education_level_id, specialty, skin_color_id,
                profession_or_trade, address, province, municipality, phone, email,
                hire_date, employment_start_date, employment_status,
                origin, migrated_at, migration_batch_id
            ) VALUES (
                v_tenant_id, p_entity_id, v_code,
                btrim(p_row ->> 'first_name'),
                btrim(p_row ->> 'first_surname'),
                NULLIF(btrim(COALESCE(p_row ->> 'second_surname', '')), ''),
                v_ident,
                NULLIF(btrim(COALESCE(p_row ->> 'birth_date', '')), '')::date,
                NULLIF(btrim(COALESCE(p_row ->> 'gender_id', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'marital_status_id', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'education_level_id', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'specialty', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'skin_color_id', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'profession_or_trade', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'address', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'province', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'municipality', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'phone', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'email', '')), ''),
                v_start, v_start, 'active',
                'MIGRATION', now(), p_batch_id
            ) RETURNING id INTO v_worker_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF SQLERRM LIKE '%workers_tenant_ci_active_unique%' THEN
                RAISE EXCEPTION 'Ya existe un trabajador activo con ese carné de identidad';
            ELSIF SQLERRM LIKE '%workers_tenant_code_unique%' THEN
                v_worker_id := NULL;
            ELSE
                RAISE;
            END IF;
        END;
    END LOOP;
    IF v_worker_id IS NULL THEN
        RAISE EXCEPTION 'No se pudo generar un código único de trabajador. Inténtalo de nuevo.';
    END IF;

    -- Licencias de conducción (catálogo global; reutiliza la tabla existente)
    -- CORRECCIÓN: driving_license_categories.id es text. Se compara en text
    -- (d.id = btrim(c)) y se inserta d.id; se conserva la validación contra el
    -- catálogo y el descarte silencioso de categorías inexistentes.
    IF jsonb_typeof(p_row -> 'driving_license_category_ids') = 'array' THEN
        INSERT INTO public.worker_driving_license_categories (worker_id, driving_license_category_id)
        SELECT DISTINCT v_worker_id, d.id
        FROM jsonb_array_elements_text(p_row -> 'driving_license_category_ids') AS c
        JOIN public.driving_license_categories d ON d.id = btrim(c)
        WHERE NULLIF(btrim(c), '') IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;

    -- Assignment actual (SOLO si se indicó Puesto; nunca ficticio)
    IF v_position.id IS NOT NULL THEN
        INSERT INTO public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
        VALUES (
            v_worker_id,
            v_position.id,
            COALESCE(NULLIF(btrim(COALESCE(p_row ->> 'assignment_start_date', '')), '')::date, v_start),
            NULL,
            true
        )
        RETURNING id INTO v_assignment_id;
    END IF;

    -- Contrato VIGENTE REAL (opcional; solo con Puesto asignado)
    v_contract := p_row -> 'contract';
    IF v_assignment_id IS NOT NULL
       AND v_contract IS NOT NULL
       AND jsonb_typeof(v_contract) = 'object'
       AND NULLIF(btrim(COALESCE(v_contract ->> 'contract_type_id', '')), '') IS NOT NULL THEN

        v_contract_start := NULLIF(btrim(COALESCE(v_contract ->> 'start_date', '')), '')::date;
        v_contract_end := NULLIF(btrim(COALESCE(v_contract ->> 'end_date', '')), '')::date;
        IF v_contract_start IS NULL THEN
            RAISE EXCEPTION 'El contrato migrado requiere fecha de inicio';
        END IF;

        SELECT code INTO v_contract_type_code
        FROM public.employment_contract_types
        WHERE id = (v_contract ->> 'contract_type_id')::uuid AND is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Tipo de contrato no encontrado o inactivo';
        END IF;
        IF v_contract_type_code = 'DETERMINADO' AND v_contract_end IS NULL THEN
            RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de fin';
        END IF;
        IF v_contract_end IS NOT NULL AND v_contract_end <= v_contract_start THEN
            RAISE EXCEPTION 'La fecha de fin del contrato debe ser posterior a su inicio';
        END IF;

        SELECT j.salary_group_id, sg.sequence_number
        INTO v_group_id, v_group_seq
        FROM public.organization_positions op
        JOIN public.organization_jobs j ON j.id = op.job_id
        LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
        WHERE op.id = v_position.id;

        v_scale_id := public.resolve_salary_scale_for_entity(p_entity_id);

        IF NULLIF(btrim(COALESCE(v_contract ->> 'representative_assignment_id', '')), '') IS NOT NULL THEN
            SELECT * INTO v_rep
            FROM public.representative_assignments
            WHERE id = (v_contract ->> 'representative_assignment_id')::uuid
              AND organization_entity_id = p_entity_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Representante no válido para esta entidad';
            END IF;
        END IF;

        -- El salario contractual migrado es el salario REAL del contrato:
        -- nunca se recalcula con la escala salarial actual.
        INSERT INTO public.employment_contracts (
            company_client_id, organization_entity_id, worker_id, assignment_id,
            contract_type_id, start_date, end_date, is_current,
            salary_group_id, salary_scale_id, salary_amount, salary_currency_code,
            salary_effective_date, salary_captured_at, salary_snapshot_status,
            representative_assignment_id, representative_name_snapshot,
            representative_position_snapshot, representative_captured_at,
            entity_name_snapshot,
            signature_date, signature_place, payment_method_id, payment_schedule_text,
            total_compensation_snapshot, conditions_captured_at
        ) VALUES (
            v_tenant_id, p_entity_id, v_worker_id, v_assignment_id,
            (v_contract ->> 'contract_type_id')::uuid, v_contract_start, v_contract_end, true,
            v_group_id, v_scale_id,
            NULLIF(btrim(COALESCE(v_contract ->> 'salary_amount', '')), '')::numeric,
            COALESCE(NULLIF(btrim(COALESCE(v_contract ->> 'salary_currency', '')), ''), 'CUP'),
            v_contract_start, now(), 'CAPTURED',
            (v_contract ->> 'representative_assignment_id')::uuid,
            v_rep.person_name, v_rep.title, now(),
            v_entity_name,
            NULLIF(btrim(COALESCE(v_contract ->> 'signature_date', '')), '')::date,
            NULLIF(btrim(COALESCE(v_contract ->> 'signature_place', '')), ''),
            NULLIF(btrim(COALESCE(v_contract ->> 'payment_method_id', '')), '')::uuid,
            NULLIF(btrim(COALESCE(v_contract ->> 'payment_schedule_text', '')), ''),
            NULLIF(btrim(COALESCE(v_contract ->> 'salary_amount', '')), '')::numeric,
            now()
        ) RETURNING id INTO v_contract_id;

        -- Trazabilidad salarial con el importe REAL (sin pasar por la escala).
        IF NULLIF(btrim(COALESCE(v_contract ->> 'salary_amount', '')), '') IS NOT NULL THEN
            PERFORM public.record_worker_salary_event(
                v_worker_id, v_contract_id, v_assignment_id,
                v_group_id, v_scale_id, NULL,
                NULL,
                (v_contract ->> 'salary_amount')::numeric,
                COALESCE(NULLIF(btrim(COALESCE(v_contract ->> 'salary_currency', '')), ''), 'CUP'),
                v_contract_start,
                'INITIAL_CONTRACT',
                'Contrato migrado (estado inicial)'
            );
        END IF;
    END IF;

    -- Saldo inicial de vacaciones (opening balance + fecha de corte).
    -- Saldo no informado ≠ 0: solo se registra si se indicó explícitamente.
    IF NULLIF(btrim(COALESCE(p_row ->> 'initial_vacation_balance', '')), '') IS NOT NULL THEN
        v_balance := (p_row ->> 'initial_vacation_balance')::numeric;
        v_cutoff := COALESCE(
            NULLIF(btrim(COALESCE(p_row ->> 'vacation_cutoff_date', '')), '')::date,
            v_start
        );
        IF v_balance < 0 OR v_balance > 24 THEN
            RAISE EXCEPTION 'El saldo inicial de vacaciones debe estar entre 0 y 24 días';
        END IF;

        INSERT INTO public.worker_vacation_movements (
            company_client_id, organization_entity_id, worker_id,
            movement_type, amount, calculated_amount, effective_date,
            description, created_by
        ) VALUES (
            v_tenant_id, p_entity_id, v_worker_id,
            'INITIAL_BALANCE', round(v_balance, 4), round(v_balance, 4), v_cutoff,
            format('Saldo inicial a %s', to_char(v_cutoff, 'DD/MM/YYYY')), auth.uid()
        );
    END IF;

    RETURN jsonb_build_object(
        'worker_id', v_worker_id,
        'code', v_code,
        'assignment_id', v_assignment_id,
        'contract_id', v_contract_id
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Migración INDIVIDUAL (una fila).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.migration_create_single_worker(
    p_entity_id uuid,
    p_row jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
    RETURN public.migration_create_worker(p_entity_id, p_row, NULL);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Previsualización / validación de filas (Excel o individual).
--    Devuelve, por fila: estado, mensajes y Puesto resuelto.
--    Estado: VALID (se vincula) | WARNING (se importa como pendiente) | ERROR.
-- ----------------------------------------------------------------------------
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
    v_position record;
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
            v_messages := v_messages || 'El nombre es obligatorio';
        END IF;
        IF NULLIF(btrim(COALESCE(v_row ->> 'first_surname', '')), '') IS NULL THEN
            v_status := 'ERROR';
            v_messages := v_messages || 'El primer apellido es obligatorio';
        END IF;

        v_ident := NULLIF(btrim(COALESCE(v_row ->> 'identification', '')), '');
        IF v_ident IS NULL THEN
            v_status := 'ERROR';
            v_messages := v_messages || 'El carné de identidad es obligatorio';
        ELSE
            -- Duplicado dentro del mismo archivo
            IF v_seen ? v_ident THEN
                v_status := 'ERROR';
                v_messages := v_messages || format('Carné de identidad duplicado dentro del archivo (%s)', v_ident);
            ELSE
                v_seen := v_seen || jsonb_build_object(v_ident, true);
            END IF;
            -- Duplicado contra trabajadores activos existentes
            IF EXISTS (
                SELECT 1 FROM public.workers w
                WHERE w.tenant_id = v_tenant_id
                  AND w.identification = v_ident
                  AND w.employment_status = 'active'
            ) THEN
                v_status := 'ERROR';
                v_messages := v_messages || format('Ya existe un trabajador activo con el carné de identidad %s', v_ident);
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
            v_messages := v_messages || 'Fecha de incorporación inválida o vacía';
        ELSIF v_start > CURRENT_DATE THEN
            v_status := 'ERROR';
            v_messages := v_messages || 'La fecha de incorporación no puede ser futura';
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
            SELECT op.id, op.name, op.code, op.authorized_quantity, op.job_id
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
                SELECT op.id, op.name, op.code, op.authorized_quantity, op.job_id
                INTO v_position
                FROM public.organization_positions op
                WHERE op.organization_entity_id = p_entity_id
                  AND op.is_active = true
                  AND upper(op.code) = upper(v_pos_raw);
            END IF;
        END IF;

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
            v_messages := v_messages || 'Se importará como pendiente de vinculación a plantilla';
        END IF;

        -- Saldo inicial de vacaciones
        v_balance := NULLIF(btrim(COALESCE(v_row ->> 'initial_vacation_balance', '')), '');
        IF v_balance IS NOT NULL THEN
            BEGIN
                IF v_balance::numeric < 0 OR v_balance::numeric > 24 THEN
                    v_status := 'ERROR';
                    v_messages := v_messages || 'El saldo inicial de vacaciones debe estar entre 0 y 24 días';
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_status := 'ERROR';
                v_messages := v_messages || 'Saldo inicial de vacaciones inválido';
            END;
            IF NULLIF(btrim(COALESCE(v_row ->> 'vacation_cutoff_date', '')), '') IS NULL
               AND v_status <> 'ERROR' THEN
                v_messages := v_messages || 'Sin fecha de corte: se usará la fecha de incorporación';
            END IF;
        END IF;

        -- Contrato migrado (opcional, requiere puesto)
        v_contract := v_row -> 'contract';
        IF v_contract IS NOT NULL AND jsonb_typeof(v_contract) = 'object' THEN
            IF v_pos_id IS NULL THEN
                v_status := 'ERROR';
                v_messages := v_messages || 'El contrato migrado requiere que el trabajador se vincule a un puesto';
            ELSE
                SELECT code INTO v_contract_type_code
                FROM public.employment_contract_types
                WHERE id = NULLIF(btrim(COALESCE(v_contract ->> 'contract_type_id', '')), '')::uuid
                  AND is_active = true;
                IF v_contract_type_code IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := v_messages || 'Tipo de contrato no encontrado o inactivo';
                END IF;

                BEGIN
                    v_cstart := NULLIF(btrim(COALESCE(v_contract ->> 'start_date', '')), '')::date;
                    v_cend := NULLIF(btrim(COALESCE(v_contract ->> 'end_date', '')), '')::date;
                EXCEPTION WHEN OTHERS THEN
                    v_cstart := NULL; v_cend := NULL;
                END;

                IF v_cstart IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := v_messages || 'El contrato migrado requiere fecha de inicio';
                END IF;
                IF v_contract_type_code = 'DETERMINADO' AND v_cend IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := v_messages || 'El contrato por tiempo determinado requiere fecha de fin';
                END IF;
                IF v_cend IS NOT NULL AND v_cstart IS NOT NULL AND v_cend <= v_cstart THEN
                    v_status := 'ERROR';
                    v_messages := v_messages || 'La fecha de fin del contrato debe ser posterior a su inicio';
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

-- ----------------------------------------------------------------------------
-- 4. Importación masiva ATÓMICA (o error → rollback total).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.migration_import_rows(
    p_entity_id uuid,
    p_rows jsonb,
    p_batch_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_row jsonb;
    v_created jsonb;
    v_ids jsonb := '[]'::jsonb;
    v_total integer := 0;
BEGIN
    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;
    IF NULLIF(btrim(COALESCE(p_batch_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'El lote de migración es obligatorio';
    END IF;
    IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'No hay filas para importar';
    END IF;

    -- Idempotencia: un lote ya procesado no se vuelve a aplicar.
    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.migration_batch_id = p_batch_id) THEN
        RAISE EXCEPTION 'Este lote de migración ya fue importado';
    END IF;

    -- Validación previa (autoridad del backend). Cualquier ERROR aborta el lote.
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(public.migration_validate_rows(p_entity_id, p_rows)) r
        WHERE r ->> 'status' = 'ERROR'
    ) THEN
        RAISE EXCEPTION 'La importación contiene filas con errores. Corrige el archivo y vuelve a validar.';
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
        v_created := public.migration_create_worker(p_entity_id, v_row, p_batch_id);
        v_ids := v_ids || (v_created -> 'worker_id');
        v_total := v_total + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'total_rows', v_total,
        'imported', v_total,
        'worker_ids', v_ids
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. VINCULAR A PLANTILLA (worker existente → assignment).
--    NO crea contrato, NO genera documentos, NO toca employment_start_date.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_worker_to_position(
    p_worker_id uuid,
    p_position_id uuid,
    p_start_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_worker public.workers%ROWTYPE;
    v_position record;
    v_occ integer;
    v_assignment_id uuid;
    v_start date;
BEGIN
    SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trabajador no encontrado';
    END IF;
    IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;
    IF v_worker.employment_status <> 'active' THEN
        RAISE EXCEPTION 'Solo se pueden vincular trabajadores activos';
    END IF;

    -- No inventar historial: solo se admite una vinculación inicial.
    IF EXISTS (
        SELECT 1 FROM public.worker_position_assignments a
        WHERE a.worker_id = p_worker_id AND a.is_current = true AND a.end_date IS NULL
    ) THEN
        RAISE EXCEPTION 'El trabajador ya tiene un puesto actual asignado';
    END IF;

    SELECT op.id, op.name, op.authorized_quantity
    INTO v_position
    FROM public.organization_positions op
    WHERE op.id = p_position_id
      AND op.organization_entity_id = v_worker.organization_entity_id
      AND op.is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Puesto no encontrado, inactivo o de otra entidad';
    END IF;

    SELECT COUNT(*) INTO v_occ
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    WHERE a.position_id = v_position.id
      AND a.is_current = true
      AND a.end_date IS NULL
      AND w.employment_status = 'active';

    IF v_occ >= v_position.authorized_quantity THEN
        RAISE EXCEPTION 'El puesto no tiene plazas disponibles (capacidad: %, ocupadas: %)',
            v_position.authorized_quantity, v_occ;
    END IF;

    -- Fecha de inicio de la asignación: desde cuándo se conoce/aplica la asignación.
    -- Nunca reinicia ni sustituye la antigüedad (employment_start_date).
    v_start := COALESCE(p_start_date, CURRENT_DATE);
    IF v_start < v_worker.hire_date THEN
        v_start := v_worker.hire_date;
    END IF;

    INSERT INTO public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
    VALUES (p_worker_id, v_position.id, v_start, NULL, true)
    RETURNING id INTO v_assignment_id;

    RETURN jsonb_build_object(
        'assignment_id', v_assignment_id,
        'position_id', v_position.id,
        'position_name', v_position.name,
        'start_date', v_start
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Prenómina: excluir trabajadores sin información estructural.
--    Un trabajador pendiente de vinculación no tiene Puesto → no entra.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prenomina_refresh_workers(p_period_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_period public.prenomina_periods%ROWTYPE;
    v_scale_id uuid;
    v_ref date;
    v_added integer := 0;
BEGIN
    SELECT * INTO v_period FROM public.prenomina_periods WHERE id = p_period_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Período de prenómina no encontrado'; END IF;
    IF NOT public.can_access_entity(v_period.organization_entity_id, 'prenomina.manage') THEN
        RAISE EXCEPTION 'Sin permiso para gestionar la prenómina';
    END IF;
    IF v_period.status <> 'BORRADOR' THEN
        RAISE EXCEPTION 'La prenómina está cerrada y no puede actualizarse';
    END IF;

    v_ref := (make_date(v_period.period_year, v_period.period_month, 1)
              + interval '1 month' - interval '1 day')::date;
    v_scale_id := public.resolve_salary_scale_for_entity(v_period.organization_entity_id);

    UPDATE public.prenomina_worker_entries e SET
        worker_name_snapshot = trim(concat_ws(' ', w.first_name, w.first_surname, w.second_surname)),
        identification_snapshot = w.identification,
        area_name_snapshot = ar.name,
        job_name_snapshot = j.name,
        position_name_snapshot = p.name,
        salary_group_id = sg.id,
        salary_group_sequence = sg.sequence_number,
        salary_scale_id = sg.salary_scale_id,
        salary_scale_amount = CASE
            WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                THEN (SELECT r.amount FROM public.resolve_salary_group_value(sg.id) r)
            ELSE NULL END,
        salary_currency = CASE
            WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                THEN (SELECT r.currency_code FROM public.resolve_salary_group_value(sg.id) r)
            ELSE NULL END,
        workday_hours = p.daily_hours,
        employment_start_date_snapshot = tn.start_date,
        tenure_reference_date = v_ref,
        tenure_years = tn.years,
        tenure_months = tn.months_rem,
        tenure_total_months = CASE WHEN tn.years IS NULL THEN NULL
                                   ELSE (tn.years * 12 + tn.months_rem)::numeric(10,2) END,
        tenure_band_id = band.id,
        tenure_band_label = CASE
            WHEN band.id IS NULL THEN NULL
            WHEN band.to_months IS NULL THEN 'Desde ' || trim(to_char(band.from_months, 'FM999999990')) || ' meses'
            ELSE trim(to_char(band.from_months, 'FM999999990')) || '–' || trim(to_char(band.to_months, 'FM999999990')) || ' meses'
        END,
        tenure_base_amount = band.amount,
        tenure_status = CASE
            WHEN tn.start_date IS NULL THEN 'NO_START_DATE'
            WHEN band.id IS NULL THEN 'NO_BAND'
            ELSE 'OK'
        END,
        updated_at = now()
    FROM public.workers w
    LEFT JOIN public.worker_position_assignments a
        ON a.worker_id = w.id AND a.is_current = true AND a.end_date IS NULL
    LEFT JOIN public.organization_positions p ON p.id = a.position_id
    LEFT JOIN public.organization_jobs j ON j.id = p.job_id
    LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
    LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
    LEFT JOIN LATERAL (
        SELECT
            s.sd AS start_date,
            CASE WHEN s.sd IS NOT NULL AND s.sd <= v_ref
                 THEN date_part('year', age(v_ref, s.sd))::int END AS years,
            CASE WHEN s.sd IS NOT NULL AND s.sd <= v_ref
                 THEN date_part('month', age(v_ref, s.sd))::int END AS months_rem
        FROM (SELECT COALESCE(w.employment_start_date, w.hire_date) AS sd) s
    ) tn ON true
    LEFT JOIN LATERAL (
        SELECT t.* FROM public.tenure_payment_scales t
        WHERE tn.years IS NOT NULL
          AND t.organization_entity_id = v_period.organization_entity_id
          AND t.is_active = true
          AND (tn.years * 12 + tn.months_rem) >= t.from_months
          AND (t.to_months IS NULL OR (tn.years * 12 + tn.months_rem) < t.to_months)
        ORDER BY t.from_months DESC
        LIMIT 1
    ) band ON true
    WHERE e.period_id = v_period.id
      AND e.worker_id = w.id
      AND EXISTS (
          SELECT 1 FROM public.worker_position_assignments current_assignment
          JOIN public.organization_positions valid_position ON valid_position.id = current_assignment.position_id
          WHERE current_assignment.worker_id = w.id
            AND current_assignment.is_current = true
            AND current_assignment.end_date IS NULL
            AND valid_position.is_active = true
            AND valid_position.organization_entity_id = w.organization_entity_id
      );

    DELETE FROM public.prenomina_worker_entries e
    WHERE e.period_id = v_period.id
      AND NOT EXISTS (
          SELECT 1 FROM public.worker_position_assignments current_assignment
          JOIN public.organization_positions valid_position ON valid_position.id = current_assignment.position_id
          WHERE current_assignment.worker_id = e.worker_id
            AND current_assignment.is_current = true
            AND current_assignment.end_date IS NULL
            AND valid_position.is_active = true
            AND valid_position.organization_entity_id = e.organization_entity_id
      );

    -- Solo trabajadores con Puesto actual válido: los pendientes no participan en Prenómina.
    INSERT INTO public.prenomina_worker_entries (
        period_id, organization_entity_id, worker_id,
        worker_name_snapshot, identification_snapshot,
        area_name_snapshot, job_name_snapshot, position_name_snapshot,
        salary_group_id, salary_group_sequence, salary_scale_id, salary_scale_amount, salary_currency,
        workday_hours,
        employment_start_date_snapshot, tenure_reference_date, tenure_years, tenure_months,
        tenure_total_months, tenure_band_id, tenure_band_label, tenure_base_amount, tenure_status
    )
    SELECT
        v_period.id, v_period.organization_entity_id, w.id,
        trim(concat_ws(' ', w.first_name, w.first_surname, w.second_surname)),
        w.identification,
        ar.name, j.name, p.name,
        sg.id, sg.sequence_number, sg.salary_scale_id,
        CASE
            WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                THEN (SELECT r.amount FROM public.resolve_salary_group_value(sg.id) r)
            ELSE NULL END,
        CASE
            WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                THEN (SELECT r.currency_code FROM public.resolve_salary_group_value(sg.id) r)
            ELSE NULL END,
        p.daily_hours,
        tn.start_date, v_ref, tn.years, tn.months_rem,
        CASE WHEN tn.years IS NULL THEN NULL
             ELSE (tn.years * 12 + tn.months_rem)::numeric(10,2) END,
        band.id,
        CASE
            WHEN band.id IS NULL THEN NULL
            WHEN band.to_months IS NULL THEN 'Desde ' || trim(to_char(band.from_months, 'FM999999990')) || ' meses'
            ELSE trim(to_char(band.from_months, 'FM999999990')) || '–' || trim(to_char(band.to_months, 'FM999999990')) || ' meses'
        END,
        band.amount,
        CASE
            WHEN tn.start_date IS NULL THEN 'NO_START_DATE'
            WHEN band.id IS NULL THEN 'NO_BAND'
            ELSE 'OK'
        END
    FROM public.workers w
    JOIN public.worker_position_assignments a
        ON a.worker_id = w.id AND a.is_current = true AND a.end_date IS NULL
    LEFT JOIN public.organization_positions p ON p.id = a.position_id
    LEFT JOIN public.organization_jobs j ON j.id = p.job_id
    LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
    LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
    LEFT JOIN LATERAL (
        SELECT
            s.sd AS start_date,
            CASE WHEN s.sd IS NOT NULL AND s.sd <= v_ref
                 THEN date_part('year', age(v_ref, s.sd))::int END AS years,
            CASE WHEN s.sd IS NOT NULL AND s.sd <= v_ref
                 THEN date_part('month', age(v_ref, s.sd))::int END AS months_rem
        FROM (SELECT COALESCE(w.employment_start_date, w.hire_date) AS sd) s
    ) tn ON true
    LEFT JOIN LATERAL (
        SELECT t.* FROM public.tenure_payment_scales t
        WHERE tn.years IS NOT NULL
          AND t.organization_entity_id = v_period.organization_entity_id
          AND t.is_active = true
          AND (tn.years * 12 + tn.months_rem) >= t.from_months
          AND (t.to_months IS NULL OR (tn.years * 12 + tn.months_rem) < t.to_months)
        ORDER BY t.from_months DESC
        LIMIT 1
    ) band ON true
    WHERE w.organization_entity_id = v_period.organization_entity_id
      AND w.employment_status = 'active'
      AND NOT EXISTS (
          SELECT 1 FROM public.prenomina_worker_entries x
          WHERE x.period_id = v_period.id AND x.worker_id = w.id
      );

    GET DIAGNOSTICS v_added = ROW_COUNT;

    PERFORM public.prenomina_recalc_entry(e.id)
    FROM public.prenomina_worker_entries e
    WHERE e.period_id = v_period.id;

    RETURN v_added;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Permisos
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.migration_create_worker(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.migration_create_single_worker(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.migration_validate_rows(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.migration_import_rows(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_worker_to_position(uuid, uuid, date) TO authenticated;
