-- ============================================================================
-- 20261104_01_migration_create_worker_fix.sql
--
-- CORRECCIÓN — public.migration_create_worker (error 42883)
--
-- Definición desplegada de referencia (al crear esta migración):
--   md5(prosrc)   = 7881eaa573ec136bbab6c7d29d10f871
--   length(prosrc)= 12111 bytes
--   firma         = public.migration_create_worker(p_entity_id uuid, p_row jsonb, p_batch_id text)
--   SECURITY DEFINER = true ; search_path = public, auth ; owner = postgres
--
-- Defecto 1 — Categorías de permiso de conducción (causa del 42883)
--   La sentencia de licencias comparaba la columna text
--   public.driving_license_categories.id contra un valor casteado a uuid:
--       AND EXISTS (SELECT 1 FROM public.driving_license_categories d WHERE d.id = c::uuid)
--   -> operator does not exist: text = uuid  (42883)
--   Corrección: comparar en text con JOIN (d.id = btrim(c)) e insertar d.id.
--   Se conserva la validación contra el catálogo y el ON CONFLICT DO NOTHING.
--
-- Defecto 2 — Referencia a tabla inexistente en el bloque de representantes
--   La función leía de public.representative_assignments (no existe).
--   Tabla real: public.organization_representative_assignments; el snapshot de
--   cargo (v_rep.title) reside en public.organization_representative_positions.title.
--   Corrección: leer de la tabla real con JOIN a la tabla de cargos de representante.
--
-- Invariantes respetadas
--   · Firma, SECURITY DEFINER, search_path y contrato de respuesta (jsonb) intactos.
--   · Reglas de negocio sin cambios (validaciones, snapshot salarial, saldo inicial).
--   · No se altera ninguna otra función ni migración histórica.
--
-- NO EJECUTADA TODAVÍA.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migration_create_worker(p_entity_id uuid, p_row jsonb, p_batch_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_tenant_id uuid;
    v_entity_name text;
    v_worker_id uuid;
    v_code text;
    v_assignment_id uuid;
    v_contract_id uuid;
    v_position record;
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
    v_position := NULL;
    v_rep := NULL;

    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;

    SELECT company_client_id, name INTO v_tenant_id, v_entity_name
    FROM public.organization_entities
    WHERE id = p_entity_id AND is_active = true;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'La entidad no existe o no está activa';
    END IF;

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

    v_start := NULLIF(btrim(COALESCE(p_row ->> 'employment_start_date', '')), '')::date;
    IF v_start IS NULL THEN
        RAISE EXCEPTION 'La fecha de incorporación es obligatoria';
    END IF;
    IF v_start > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha de incorporación no puede ser futura';
    END IF;

    -- VALIDACIÓN CRUZADA PERSONA-EN-MASA (NO BLOQUEANTE). La Carga inicial NO
    -- bloquea por identificaciones repetidas: si ya existe una persona con el mismo
    -- carné (o el propio archivo trae dos filas iguales), la fila se crea de todos
    -- modos y se notifica al final para corregir. Por eso aquí no se lanza excepción.

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
            -- Solo el código de trabajador es único en la carga inicial: el carné de
            -- identidad NO bloquea (el índice excluye las filas de origen MIGRATION).
            IF SQLERRM LIKE '%workers_tenant_code_unique%' THEN
                v_worker_id := NULL;
            ELSE
                RAISE;
            END IF;
        END;
    END LOOP;
    IF v_worker_id IS NULL THEN
        RAISE EXCEPTION 'No se pudo generar un código único de trabajador. Inténtalo de nuevo.';
    END IF;

    -- CORRECCIÓN 1: driving_license_categories.id es text. Se compara en text
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

        -- CORRECCIÓN 2: se lee de la tabla real de asignaciones de representante
        -- (la referencia anterior apuntaba a una tabla inexistente); el snapshot de
        -- cargo se obtiene de organization_representative_positions.title. Se mantiene
        -- la validación de que el representante pertenece a la entidad.
        IF NULLIF(btrim(COALESCE(v_contract ->> 'representative_assignment_id', '')), '') IS NOT NULL THEN
            SELECT ora.person_name, rp.title
            INTO v_rep
            FROM public.organization_representative_assignments ora
            JOIN public.organization_representative_positions rp
              ON rp.id = ora.representative_position_id
            WHERE ora.id = (v_contract ->> 'representative_assignment_id')::uuid
              AND ora.organization_entity_id = p_entity_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Representante no válido para esta entidad';
            END IF;
        END IF;

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
$function$;

-- Los permisos existentes se conservan (CREATE OR REPLACE no altera ACL).
-- Verificación de ACL posterior (referencia):
--   GRANT EXECUTE ON FUNCTION public.migration_create_worker(uuid, jsonb, text) TO authenticated;
