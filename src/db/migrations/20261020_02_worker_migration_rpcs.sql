-- ============================================================================
-- FASE — RPCs PARA MIGRACIÓN DE TRABAJADORES EXISTENTES
-- Funciones backend para migración manual (básica y completa) y validación Excel.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. MIGRACIÓN BÁSICA (manual)
-- Crea Worker + Assignment + baseline vacaciones (opcional).
-- NO crea contrato.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.migrate_worker_basic(
    p_entity_id uuid,
    p_worker jsonb,
    p_position_id uuid,
    p_hire_date date,
    p_initial_vacation_balance numeric(10,4) DEFAULT NULL,
    p_vacation_cutoff_date date DEFAULT NULL,
    p_migration_batch_id text DEFAULT NULL
)
RETURNS TABLE (
    worker_id uuid,
    assignment_id uuid,
    vacation_balance_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_worker_id uuid;
    v_assignment_id uuid;
    v_vacation_balance_id uuid;
    v_tenant_id uuid;
    v_job_id uuid;
    v_area_id uuid;
    v_position_row record;
    v_job_row record;
    v_area_row record;
    v_current_assignments integer;
    v_authorized_quantity integer;
    v_identification text;
    v_existing_worker uuid;
BEGIN
    -- 1. Verificar permiso workers.manage
    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;

    -- 2. Obtener company_client_id de la entidad
    SELECT company_client_id INTO v_tenant_id
    FROM public.organization_entities
    WHERE id = p_entity_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Entidad no encontrada';
    END IF;

    -- 3. Validar posición: existe, activa, misma entidad, tiene capacidad
    SELECT op.*, oj.id as job_id, oj.area_id
    INTO v_position_row
    FROM public.organization_positions op
    JOIN public.organization_jobs oj ON oj.id = op.job_id
    WHERE op.id = p_position_id
      AND op.organization_entity_id = p_entity_id
      AND op.is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Puesto no encontrado, inactivo o no pertenece a esta entidad';
    END IF;

    v_job_id := v_position_row.job_id;
    v_area_id := v_position_row.area_id;
    v_authorized_quantity := v_position_row.authorized_quantity;

    -- 4. Verificar capacidad del puesto (ocupación actual + importación en curso)
    SELECT COUNT(*) INTO v_current_assignments
    FROM public.worker_position_assignments wpa
    JOIN public.workers w ON w.id = wpa.worker_id
    WHERE wpa.position_id = p_position_id
      AND wpa.is_current = true
      AND wpa.end_date IS NULL
      AND w.employment_status = 'active'
      AND w.organization_entity_id = p_entity_id;

    -- Considerar trabajadores del mismo lote de migración (idempotencia)
    IF p_migration_batch_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_current_assignments
        FROM public.workers
        WHERE organization_entity_id = p_entity_id
          AND migration_batch_id = p_migration_batch_id
          AND id != v_worker_id; -- se actualizará después
    END IF;

    IF v_current_assignments >= v_authorized_quantity THEN
        RAISE EXCEPTION 'El puesto no tiene plazas disponibles (capacidad: %, ocupadas: %)', v_authorized_quantity, v_current_assignments;
    END IF;

    -- 5. Validar CI único en la entidad (incluyendo mismo lote)
    v_identification := (p_worker ->> 'identification')::text;
    IF v_identification IS NULL OR v_identification = '' THEN
        RAISE EXCEPTION 'El carné de identidad es obligatorio';
    END IF;

    SELECT id INTO v_existing_worker
    FROM public.workers
    WHERE organization_entity_id = p_entity_id
      AND identification = v_identification
      AND (p_migration_batch_id IS NULL OR migration_batch_id IS DISTINCT FROM p_migration_batch_id);

    IF FOUND THEN
        RAISE EXCEPTION 'Ya existe un trabajador con este CI en la entidad';
    END IF;

    -- 6. Verificar duplicado dentro del mismo lote (idempotencia)
    IF p_migration_batch_id IS NOT NULL THEN
        SELECT id INTO v_existing_worker
        FROM public.workers
        WHERE organization_entity_id = p_entity_id
          AND migration_batch_id = p_migration_batch_id
          AND identification = v_identification;

        IF FOUND THEN
            -- Ya existe en este lote: devolver el existente (idempotente)
            v_worker_id := v_existing_worker;
            
            -- Verificar si ya tiene assignment
            SELECT id INTO v_assignment_id
            FROM public.worker_position_assignments
            WHERE worker_id = v_worker_id
              AND position_id = p_position_id
              AND is_current = true
              AND end_date IS NULL;

            IF v_assignment_id IS NULL THEN
                -- Crear assignment faltante
                INSERT INTO public.worker_position_assignments (
                    tenant_id, organization_entity_id, worker_id, position_id,
                    start_date, is_current
                ) VALUES (
                    v_tenant_id, p_entity_id, v_worker_id, p_position_id,
                    p_hire_date, true
                ) RETURNING id INTO v_assignment_id;
            END IF;

            -- Verificar baseline vacaciones
            IF p_initial_vacation_balance IS NOT NULL AND p_vacation_cutoff_date IS NOT NULL THEN
                SELECT id INTO v_vacation_balance_id
                FROM public.worker_vacation_movements
                WHERE worker_id = v_worker_id
                  AND movement_type = 'INITIAL_BALANCE'
                  AND effective_date = p_vacation_cutoff_date;

                IF v_vacation_balance_id IS NULL THEN
                    INSERT INTO public.worker_vacation_movements (
                        tenant_id, organization_entity_id, worker_id,
                        movement_type, amount, effective_date,
                        description, reason
                    ) VALUES (
                        v_tenant_id, p_entity_id, v_worker_id,
                        'INITIAL_BALANCE', p_initial_vacation_balance, p_vacation_cutoff_date,
                        'Saldo inicial de migración básica', 'MIGRATION_BASIC'
                    ) RETURNING id INTO v_vacation_balance_id;
                END IF;
            END IF;

            RETURN QUERY SELECT v_worker_id, v_assignment_id, v_vacation_balance_id;
            RETURN;
        END IF;
    END IF;

    -- 7. Crear Worker (origen MIGRATION)
    INSERT INTO public.workers (
        tenant_id,
        organization_entity_id,
        code,
        first_name,
        first_surname,
        second_surname,
        identification,
        birth_date,
        gender_id,
        marital_status_id,
        education_level_id,
        specialty,
        profession_or_trade,
        skin_color_id,
        address,
        province,
        municipality,
        phone,
        email,
        hire_date,
        employment_start_date,
        employment_status,
        origin,
        migrated_at,
        migration_batch_id
    ) VALUES (
        v_tenant_id,
        p_entity_id,
        'MIG-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
        (p_worker ->> 'first_name')::text,
        (p_worker ->> 'first_surname')::text,
        NULLIF((p_worker ->> 'second_surname')::text, ''),
        v_identification,
        NULLIF((p_worker ->> 'birth_date')::text, '')::date,
        NULLIF((p_worker ->> 'gender_id')::text, '')::uuid,
        NULLIF((p_worker ->> 'marital_status_id')::text, '')::uuid,
        NULLIF((p_worker ->> 'education_level_id')::text, '')::uuid,
        NULLIF((p_worker ->> 'specialty')::text, ''),
        NULLIF((p_worker ->> 'profession_or_trade')::text, ''),
        NULLIF((p_worker ->> 'skin_color_id')::text, '')::uuid,
        NULLIF((p_worker ->> 'address')::text, ''),
        NULLIF((p_worker ->> 'province')::text, ''),
        NULLIF((p_worker ->> 'municipality')::text, ''),
        NULLIF((p_worker ->> 'phone')::text, ''),
        NULLIF((p_worker ->> 'email')::text, ''),
        p_hire_date,
        p_hire_date, -- employment_start_date = hire_date para migración
        'active',
        'MIGRATION',
        now(),
        p_migration_batch_id
    ) RETURNING id INTO v_worker_id;

    -- 8. Crear Assignment actual
    INSERT INTO public.worker_position_assignments (
        tenant_id, organization_entity_id, worker_id, position_id,
        start_date, is_current
    ) VALUES (
        v_tenant_id, p_entity_id, v_worker_id, p_position_id,
        p_hire_date, true
    ) RETURNING id INTO v_assignment_id;

    -- 9. Baseline vacaciones (opcional)
    IF p_initial_vacation_balance IS NOT NULL AND p_vacation_cutoff_date IS NOT NULL THEN
        INSERT INTO public.worker_vacation_movements (
            tenant_id, organization_entity_id, worker_id,
            movement_type, amount, effective_date,
            description, reason
        ) VALUES (
            v_tenant_id, p_entity_id, v_worker_id,
            'INITIAL_BALANCE', p_initial_vacation_balance, p_vacation_cutoff_date,
            'Saldo inicial de migración básica', 'MIGRATION_BASIC'
        ) RETURNING id INTO v_vacation_balance_id;
    END IF;

    RETURN QUERY SELECT v_worker_id, v_assignment_id, v_vacation_balance_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. MIGRACIÓN COMPLETA (manual)
-- Crea Worker + Assignment + baseline vacaciones + Contrato migrado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.migrate_worker_complete(
    p_entity_id uuid,
    p_worker jsonb,
    p_position_id uuid,
    p_hire_date date,
    p_initial_vacation_balance numeric(10,4) DEFAULT NULL,
    p_vacation_cutoff_date date DEFAULT NULL,
    p_contract_type_id uuid,
    p_contract_start_date date,
    p_contract_end_date date DEFAULT NULL,
    p_contract_salary_amount numeric(12,2) DEFAULT NULL,
    p_contract_salary_currency text DEFAULT 'CUP',
    p_signature_date date,
    p_signature_place text,
    p_payment_method_id uuid,
    p_payment_schedule_text text DEFAULT NULL,
    p_compensation_components jsonb DEFAULT '[]'::jsonb,
    p_representative_assignment_id uuid,
    p_migration_batch_id text DEFAULT NULL
)
RETURNS TABLE (
    worker_id uuid,
    assignment_id uuid,
    contract_id uuid,
    vacation_balance_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_worker_id uuid;
    v_assignment_id uuid;
    v_contract_id uuid;
    v_vacation_balance_id uuid;
    v_tenant_id uuid;
    v_job_id uuid;
    v_area_id uuid;
    v_position_row record;
    v_job_row record;
    v_area_row record;
    v_current_assignments integer;
    v_authorized_quantity integer;
    v_identification text;
    v_existing_worker uuid;
    v_contract_type_code text;
    v_salary_group_id uuid;
    v_salary_group_seq integer;
    v_rep_row record;
BEGIN
    -- 1. Verificar permiso workers.manage Y contracts.manage
    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;
    IF NOT public.can_access_entity(p_entity_id, 'contracts.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para formalizar contratos en esta entidad';
    END IF;

    -- 2. Obtener company_client_id de la entidad
    SELECT company_client_id INTO v_tenant_id
    FROM public.organization_entities
    WHERE id = p_entity_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Entidad no encontrada';
    END IF;

    -- 3. Validar posición
    SELECT op.*, oj.id as job_id, oj.area_id, oj.salary_group_id
    INTO v_position_row
    FROM public.organization_positions op
    JOIN public.organization_jobs oj ON oj.id = op.job_id
    WHERE op.id = p_position_id
      AND op.organization_entity_id = p_entity_id
      AND op.is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Puesto no encontrado, inactivo o no pertenece a esta entidad';
    END IF;

    v_job_id := v_position_row.job_id;
    v_area_id := v_position_row.area_id;
    v_salary_group_id := v_position_row.salary_group_id;
    v_authorized_quantity := v_position_row.authorized_quantity;

    -- 4. Verificar capacidad
    SELECT COUNT(*) INTO v_current_assignments
    FROM public.worker_position_assignments wpa
    JOIN public.workers w ON w.id = wpa.worker_id
    WHERE wpa.position_id = p_position_id
      AND wpa.is_current = true
      AND wpa.end_date IS NULL
      AND w.employment_status = 'active'
      AND w.organization_entity_id = p_entity_id;

    IF p_migration_batch_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_current_assignments
        FROM public.workers
        WHERE organization_entity_id = p_entity_id
          AND migration_batch_id = p_migration_batch_id
          AND id != v_worker_id;
    END IF;

    IF v_current_assignments >= v_authorized_quantity THEN
        RAISE EXCEPTION 'El puesto no tiene plazas disponibles (capacidad: %, ocupadas: %)', v_authorized_quantity, v_current_assignments;
    END IF;

    -- 5. Validar CI único
    v_identification := (p_worker ->> 'identification')::text;
    IF v_identification IS NULL OR v_identification = '' THEN
        RAISE EXCEPTION 'El carné de identidad es obligatorio';
    END IF;

    SELECT id INTO v_existing_worker
    FROM public.workers
    WHERE organization_entity_id = p_entity_id
      AND identification = v_identification
      AND (p_migration_batch_id IS NULL OR migration_batch_id IS DISTINCT FROM p_migration_batch_id);

    IF FOUND THEN
        RAISE EXCEPTION 'Ya existe un trabajador con este CI en la entidad';
    END IF;

    -- 6. Idempotencia por lote
    IF p_migration_batch_id IS NOT NULL THEN
        SELECT id INTO v_existing_worker
        FROM public.workers
        WHERE organization_entity_id = p_entity_id
          AND migration_batch_id = p_migration_batch_id
          AND identification = v_identification;

        IF FOUND THEN
            v_worker_id := v_existing_worker;
            
            -- Verificar assignment
            SELECT id INTO v_assignment_id
            FROM public.worker_position_assignments
            WHERE worker_id = v_worker_id
              AND position_id = p_position_id
              AND is_current = true
              AND end_date IS NULL;

            IF v_assignment_id IS NULL THEN
                INSERT INTO public.worker_position_assignments (
                    tenant_id, organization_entity_id, worker_id, position_id,
                    start_date, is_current
                ) VALUES (
                    v_tenant_id, p_entity_id, v_worker_id, p_position_id,
                    p_hire_date, true
                ) RETURNING id INTO v_assignment_id;
            END IF;

            -- Verificar baseline vacaciones
            IF p_initial_vacation_balance IS NOT NULL AND p_vacation_cutoff_date IS NOT NULL THEN
                SELECT id INTO v_vacation_balance_id
                FROM public.worker_vacation_movements
                WHERE worker_id = v_worker_id
                  AND movement_type = 'INITIAL_BALANCE'
                  AND effective_date = p_vacation_cutoff_date;

                IF v_vacation_balance_id IS NULL THEN
                    INSERT INTO public.worker_vacation_movements (
                        tenant_id, organization_entity_id, worker_id,
                        movement_type, amount, effective_date,
                        description, reason
                    ) VALUES (
                        v_tenant_id, p_entity_id, v_worker_id,
                        'INITIAL_BALANCE', p_initial_vacation_balance, p_vacation_cutoff_date,
                        'Saldo inicial de migración completa', 'MIGRATION_COMPLETE'
                    ) RETURNING id INTO v_vacation_balance_id;
                END IF;
            END IF;

            -- Verificar contrato migrado
            SELECT id INTO v_contract_id
            FROM public.employment_contracts
            WHERE worker_id = v_worker_id
              AND assignment_id = v_assignment_id
              AND contract_type_id = p_contract_type_id
              AND start_date = p_contract_start_date
              AND (p_contract_end_date IS NULL OR end_date = p_contract_end_date);

            IF v_contract_id IS NULL THEN
                -- Crear contrato migrado
                SELECT code INTO v_contract_type_code
                FROM public.employment_contract_types
                WHERE id = p_contract_type_id;

                SELECT sequence_number INTO v_salary_group_seq
                FROM public.salary_groups
                WHERE id = v_salary_group_id;

                SELECT * INTO v_rep_row
                FROM public.representative_assignments
                WHERE id = p_representative_assignment_id;

                INSERT INTO public.employment_contracts (
                    tenant_id, organization_entity_id, worker_id, assignment_id,
                    contract_type_id, start_date, end_date, actual_end_date,
                    is_current, salary_amount, salary_currency_code,
                    salary_effective_date, salary_snapshot_status,
                    salary_group_id, salary_group_sequence,
                    representative_name_snapshot, representative_position_snapshot,
                    representative_captured_at, entity_name_snapshot,
                    signature_date, signature_place, payment_method_id,
                    payment_schedule_text, total_compensation_snapshot,
                    conditions_captured_at
                ) VALUES (
                    v_tenant_id, p_entity_id, v_worker_id, v_assignment_id,
                    p_contract_type_id, p_contract_start_date, p_contract_end_date, NULL,
                    true, p_contract_salary_amount, p_contract_salary_currency,
                    p_contract_start_date, 'CAPTURED',
                    v_salary_group_id, v_salary_group_seq,
                    v_rep_row.person_name, v_rep_row.title,
                    now(), (SELECT name FROM public.organization_entities WHERE id = p_entity_id),
                    p_signature_date, p_signature_place, p_payment_method_id,
                    p_payment_schedule_text,
                    (SELECT COALESCE(SUM((comp ->> 'amount')::numeric), 0) FROM jsonb_array_elements(p_compensation_components) comp),
                    now()
                ) RETURNING id INTO v_contract_id;

                -- Insertar componentes del contrato
                INSERT INTO public.contract_compensation_components (
                    tenant_id, organization_entity_id, contract_id,
                    description, amount, currency_code, is_recurring, sort_order
                )
                SELECT v_tenant_id, p_entity_id, v_contract_id,
                    comp ->> 'description',
                    (comp ->> 'amount')::numeric,
                    comp ->> 'currency_code',
                    (comp ->> 'is_recurring')::boolean,
                    idx
                FROM jsonb_array_elements(p_compensation_components) WITH ORDINALITY AS comp(comp, idx);
            END IF;

            RETURN QUERY SELECT v_worker_id, v_assignment_id, v_contract_id, v_vacation_balance_id;
            RETURN;
        END IF;
    END IF;

    -- 7. Validar tipo de contrato
    SELECT code INTO v_contract_type_code
    FROM public.employment_contract_types
    WHERE id = p_contract_type_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tipo de contrato no encontrado o inactivo';
    END IF;

    IF v_contract_type_code = 'DETERMINADO' AND p_contract_end_date IS NULL THEN
        RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de fin';
    END IF;

    IF p_contract_end_date IS NOT NULL AND p_contract_end_date <= p_contract_start_date THEN
        RAISE EXCEPTION 'La fecha de fin del contrato debe ser posterior a su inicio';
    END IF;

    -- 8. Validar representante
    SELECT * INTO v_rep_row
    FROM public.representative_assignments
    WHERE id = p_representative_assignment_id
      AND organization_entity_id = p_entity_id
      AND (end_date IS NULL OR end_date >= p_signature_date)
      AND start_date <= p_signature_date;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay representantes configurados para la fecha de firma seleccionada';
    END IF;

    -- 9. Validar forma de pago
    IF NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE id = p_payment_method_id) THEN
        RAISE EXCEPTION 'Forma de pago no válida';
    END IF;

    -- 10. Validar componentes
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_compensation_components) comp
        WHERE (comp ->> 'description') IS NULL OR (comp ->> 'description') = ''
           OR (comp ->> 'amount') IS NULL OR (comp ->> 'amount')::numeric < 0
    ) THEN
        RAISE EXCEPTION 'Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)';
    END IF;

    -- 11. Obtener secuencia del grupo salarial
    SELECT sequence_number INTO v_salary_group_seq
    FROM public.salary_groups
    WHERE id = v_salary_group_id;

    -- 12. Crear Worker
    INSERT INTO public.workers (
        tenant_id,
        organization_entity_id,
        code,
        first_name,
        first_surname,
        second_surname,
        identification,
        birth_date,
        gender_id,
        marital_status_id,
        education_level_id,
        specialty,
        profession_or_trade,
        skin_color_id,
        address,
        province,
        municipality,
        phone,
        email,
        hire_date,
        employment_start_date,
        employment_status,
        origin,
        migrated_at,
        migration_batch_id
    ) VALUES (
        v_tenant_id,
        p_entity_id,
        'MIG-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
        (p_worker ->> 'first_name')::text,
        (p_worker ->> 'first_surname')::text,
        NULLIF((p_worker ->> 'second_surname')::text, ''),
        v_identification,
        NULLIF((p_worker ->> 'birth_date')::text, '')::date,
        NULLIF((p_worker ->> 'gender_id')::text, '')::uuid,
        NULLIF((p_worker ->> 'marital_status_id')::text, '')::uuid,
        NULLIF((p_worker ->> 'education_level_id')::text, '')::uuid,
        NULLIF((p_worker ->> 'specialty')::text, ''),
        NULLIF((p_worker ->> 'profession_or_trade')::text, ''),
        NULLIF((p_worker ->> 'skin_color_id')::text, '')::uuid,
        NULLIF((p_worker ->> 'address')::text, ''),
        NULLIF((p_worker ->> 'province')::text, ''),
        NULLIF((p_worker ->> 'municipality')::text, ''),
        NULLIF((p_worker ->> 'phone')::text, ''),
        NULLIF((p_worker ->> 'email')::text, ''),
        p_hire_date,
        p_hire_date,
        'active',
        'MIGRATION',
        now(),
        p_migration_batch_id
    ) RETURNING id INTO v_worker_id;

    -- 13. Crear Assignment
    INSERT INTO public.worker_position_assignments (
        tenant_id, organization_entity_id, worker_id, position_id,
        start_date, is_current
    ) VALUES (
        v_tenant_id, p_entity_id, v_worker_id, p_position_id,
        p_hire_date, true
    ) RETURNING id INTO v_assignment_id;

    -- 14. Baseline vacaciones
    IF p_initial_vacation_balance IS NOT NULL AND p_vacation_cutoff_date IS NOT NULL THEN
        INSERT INTO public.worker_vacation_movements (
            tenant_id, organization_entity_id, worker_id,
            movement_type, amount, effective_date,
            description, reason
        ) VALUES (
            v_tenant_id, p_entity_id, v_worker_id,
            'INITIAL_BALANCE', p_initial_vacation_balance, p_vacation_cutoff_date,
            'Saldo inicial de migración completa', 'MIGRATION_COMPLETE'
        ) RETURNING id INTO v_vacation_balance_id;
    END IF;

    -- 15. Crear Contrato MIGRADO (origin = MIGRATION implícito por no generar documento)
    INSERT INTO public.employment_contracts (
        tenant_id, organization_entity_id, worker_id, assignment_id,
        contract_type_id, start_date, end_date, actual_end_date,
        is_current, salary_amount, salary_currency_code,
        salary_effective_date, salary_snapshot_status,
        salary_group_id, salary_group_sequence,
        representative_name_snapshot, representative_position_snapshot,
        representative_captured_at, entity_name_snapshot,
        signature_date, signature_place, payment_method_id,
        payment_schedule_text, total_compensation_snapshot,
        conditions_captured_at
    ) VALUES (
        v_tenant_id, p_entity_id, v_worker_id, v_assignment_id,
        p_contract_type_id, p_contract_start_date, p_contract_end_date, NULL,
        true, p_contract_salary_amount, p_contract_salary_currency,
        p_contract_start_date, 'CAPTURED',
        v_salary_group_id, v_salary_group_seq,
        v_rep_row.person_name, v_rep_row.title,
        now(), (SELECT name FROM public.organization_entities WHERE id = p_entity_id),
        p_signature_date, p_signature_place, p_payment_method_id,
        p_payment_schedule_text,
        (SELECT COALESCE(SUM((comp ->> 'amount')::numeric), 0) FROM jsonb_array_elements(p_compensation_components) comp),
        now()
    ) RETURNING id INTO v_contract_id;

    -- 16. Insertar componentes del contrato
    INSERT INTO public.contract_compensation_components (
        tenant_id, organization_entity_id, contract_id,
        description, amount, currency_code, is_recurring, sort_order
    )
    SELECT v_tenant_id, p_entity_id, v_contract_id,
        comp ->> 'description',
        (comp ->> 'amount')::numeric,
        comp ->> 'currency_code',
        (comp ->> 'is_recurring')::boolean,
        idx
    FROM jsonb_array_elements(p_compensation_components) WITH ORDINALITY AS comp(comp, idx);

    RETURN QUERY SELECT v_worker_id, v_assignment_id, v_contract_id, v_vacation_balance_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. VALIDACIÓN DE FILA EXCEL (para previsualización)
-- Valida una fila individual sin persistir.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_migration_row(
    p_entity_id uuid,
    p_row jsonb,
    p_migration_type text, -- 'BASIC' | 'COMPLETE'
    p_migration_batch_id text DEFAULT NULL
)
RETURNS TABLE (
    valid boolean,
    error_code text,
    error_message text,
    warnings text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_identification text;
    v_position_id uuid;
    v_position_row record;
    v_current_assignments integer;
    v_authorized_quantity integer;
    v_existing_worker uuid;
    v_contract_type_id uuid;
    v_contract_type_code text;
    v_contract_start_date date;
    v_contract_end_date date;
    v_rep_row record;
    v_warnings text[] := '{}';
BEGIN
    -- Validar campos obligatorios comunes
    IF (p_row ->> 'first_name') IS NULL OR (p_row ->> 'first_name') = '' THEN
        RETURN QUERY SELECT false, 'MISSING_FIRST_NAME', 'El nombre es obligatorio', v_warnings;
        RETURN;
    END IF;
    IF (p_row ->> 'first_surname') IS NULL OR (p_row ->> 'first_surname') = '' THEN
        RETURN QUERY SELECT false, 'MISSING_FIRST_SURNAME', 'El primer apellido es obligatorio', v_warnings;
        RETURN;
    END IF;

    v_identification := (p_row ->> 'identification')::text;
    IF v_identification IS NULL OR v_identification = '' THEN
        RETURN QUERY SELECT false, 'MISSING_IDENTIFICATION', 'El carné de identidad es obligatorio', v_warnings;
        RETURN;
    END IF;

    -- Validar CI duplicado en BD (excluyendo mismo lote)
    SELECT id INTO v_existing_worker
    FROM public.workers
    WHERE organization_entity_id = p_entity_id
      AND identification = v_identification
      AND (p_migration_batch_id IS NULL OR migration_batch_id IS DISTINCT FROM p_migration_batch_id);

    IF FOUND THEN
        RETURN QUERY SELECT false, 'DUPLICATE_CI', 'Ya existe un trabajador con este CI en la entidad', v_warnings;
        RETURN;
    END IF;

    -- Validar CI duplicado dentro del mismo lote
    IF p_migration_batch_id IS NOT NULL THEN
        SELECT id INTO v_existing_worker
        FROM public.workers
        WHERE organization_entity_id = p_entity_id
          AND migration_batch_id = p_migration_batch_id
          AND identification = v_identification;

        IF FOUND THEN
            RETURN QUERY SELECT false, 'DUPLICATE_CI_BATCH', 'CI duplicado dentro del mismo archivo de importación', v_warnings;
            RETURN;
        END IF;
    END IF;

    -- Validar fecha de incorporación
    IF (p_row ->> 'hire_date') IS NULL OR (p_row ->> 'hire_date') = '' THEN
        RETURN QUERY SELECT false, 'MISSING_HIRE_DATE', 'La fecha de incorporación es obligatoria', v_warnings;
        RETURN;
    END IF;

    -- Validar posición
    v_position_id := NULLIF((p_row ->> 'position_id')::text, '')::uuid;
    IF v_position_id IS NULL THEN
        RETURN QUERY SELECT false, 'MISSING_POSITION', 'El puesto es obligatorio', v_warnings;
        RETURN;
    END IF;

    SELECT op.*, oj.id as job_id, oj.area_id, oj.salary_group_id
    INTO v_position_row
    FROM public.organization_positions op
    JOIN public.organization_jobs oj ON oj.id = op.job_id
    WHERE op.id = v_position_id
      AND op.organization_entity_id = p_entity_id
      AND op.is_active = true;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'INVALID_POSITION', 'Puesto no encontrado, inactivo o no pertenece a esta entidad', v_warnings;
        RETURN;
    END IF;

    v_authorized_quantity := v_position_row.authorized_quantity;

    -- Verificar capacidad (ocupación actual + filas válidas previas del mismo lote)
    SELECT COUNT(*) INTO v_current_assignments
    FROM public.worker_position_assignments wpa
    JOIN public.workers w ON w.id = wpa.worker_id
    WHERE wpa.position_id = v_position_id
      AND wpa.is_current = true
      AND wpa.end_date IS NULL
      AND w.employment_status = 'active'
      AND w.organization_entity_id = p_entity_id;

    IF p_migration_batch_id IS NOT NULL THEN
        -- Contar filas válidas previas en este lote para el mismo puesto
        -- Nota: esto es aproximado; la validación exacta se hace en backend al confirmar
        v_warnings := v_warnings || 'La capacidad final se valida al confirmar la importación';
    END IF;

    IF v_current_assignments >= v_authorized_quantity THEN
        RETURN QUERY SELECT false, 'POSITION_FULL', format('El puesto no tiene plazas disponibles (capacidad: %s, ocupadas: %s)', v_authorized_quantity, v_current_assignments), v_warnings;
        RETURN;
    END IF;

    -- Validaciones específicas por tipo de migración
    IF p_migration_type = 'COMPLETE' THEN
        -- Tipo de contrato
        v_contract_type_id := NULLIF((p_row ->> 'contract_type_id')::text, '')::uuid;
        IF v_contract_type_id IS NULL THEN
            RETURN QUERY SELECT false, 'MISSING_CONTRACT_TYPE', 'El tipo de contrato es obligatorio en migración completa', v_warnings;
            RETURN;
        END IF;

        SELECT code INTO v_contract_type_code
        FROM public.employment_contract_types
        WHERE id = v_contract_type_id AND is_active = true;

        IF NOT FOUND THEN
            RETURN QUERY SELECT false, 'INVALID_CONTRACT_TYPE', 'Tipo de contrato no encontrado o inactivo', v_warnings;
            RETURN;
        END IF;

        -- Fecha inicio contrato
        v_contract_start_date := NULLIF((p_row ->> 'contract_start_date')::text, '')::date;
        IF v_contract_start_date IS NULL THEN
            RETURN QUERY SELECT false, 'MISSING_CONTRACT_START', 'La fecha de inicio del contrato es obligatoria', v_warnings;
            RETURN;
        END IF;

        -- Fecha fin contrato (obligatorio para DETERMINADO)
        v_contract_end_date := NULLIF((p_row ->> 'contract_end_date')::text, '')::date;
        IF v_contract_type_code = 'DETERMINADO' AND v_contract_end_date IS NULL THEN
            RETURN QUERY SELECT false, 'MISSING_CONTRACT_END', 'El contrato por tiempo determinado requiere una fecha de fin', v_warnings;
            RETURN;
        END IF;

        IF v_contract_end_date IS NOT NULL AND v_contract_end_date <= v_contract_start_date THEN
            RETURN QUERY SELECT false, 'INVALID_CONTRACT_DATES', 'La fecha de fin del contrato debe ser posterior a su inicio', v_warnings;
            RETURN;
        END IF;

        -- Validar salario contractual
        IF (p_row ->> 'contract_salary_amount') IS NOT NULL AND (p_row ->> 'contract_salary_amount') != '' THEN
            IF (p_row ->> 'contract_salary_amount')::numeric < 0 THEN
                RETURN QUERY SELECT false, 'INVALID_SALARY', 'El salario contractual no puede ser negativo', v_warnings;
                RETURN;
            END IF;
        END IF;

        -- Validar fecha de firma
        IF (p_row ->> 'signature_date') IS NULL OR (p_row ->> 'signature_date') = '' THEN
            RETURN QUERY SELECT false, 'MISSING_SIGNATURE_DATE', 'La fecha de firma del contrato es obligatoria', v_warnings;
            RETURN;
        END IF;

        -- Validar lugar de firma
        IF (p_row ->> 'signature_place') IS NULL OR (p_row ->> 'signature_place') = '' THEN
            RETURN QUERY SELECT false, 'MISSING_SIGNATURE_PLACE', 'El lugar de firma es obligatorio', v_warnings;
            RETURN;
        END IF;

        -- Validar forma de pago
        IF (p_row ->> 'payment_method_id') IS NULL OR (p_row ->> 'payment_method_id') = '' THEN
            RETURN QUERY SELECT false, 'MISSING_PAYMENT_METHOD', 'La forma de pago es obligatoria', v_warnings;
            RETURN;
        END IF;

        -- Validar representante
        IF (p_row ->> 'representative_assignment_id') IS NULL OR (p_row ->> 'representative_assignment_id') = '' THEN
            RETURN QUERY SELECT false, 'MISSING_REPRESENTATIVE', 'El representante es obligatorio', v_warnings;
            RETURN;
        END IF;

        SELECT * INTO v_rep_row
        FROM public.representative_assignments
        WHERE id = (p_row ->> 'representative_assignment_id')::uuid
          AND organization_entity_id = p_entity_id
          AND (end_date IS NULL OR end_date >= (p_row ->> 'signature_date')::date)
          AND start_date <= (p_row ->> 'signature_date')::date;

        IF NOT FOUND THEN
            RETURN QUERY SELECT false, 'INVALID_REPRESENTATIVE', 'No hay representantes configurados para la fecha de firma seleccionada', v_warnings;
            RETURN;
        END IF;

        -- Validar componentes retributivos
        IF (p_row ->> 'compensation_components') IS NOT NULL THEN
            IF EXISTS (
                SELECT 1 FROM jsonb_array_elements((p_row ->> 'compensation_components')::jsonb) comp
                WHERE (comp ->> 'description') IS NULL OR (comp ->> 'description') = ''
                   OR (comp ->> 'amount') IS NULL OR (comp ->> 'amount')::numeric < 0
            ) THEN
                RETURN QUERY SELECT false, 'INVALID_COMPONENTS', 'Conceptos retributivos inválidos', v_warnings;
                RETURN;
            END IF;
        END IF;
    END IF;

    -- Validar vacaciones (opcionales pero si se dan, deben ser coherentes)
    IF (p_row ->> 'initial_vacation_balance') IS NOT NULL AND (p_row ->> 'initial_vacation_balance') != '' THEN
        IF (p_row ->> 'initial_vacation_balance')::numeric < 0 THEN
            RETURN QUERY SELECT false, 'INVALID_VACATION_BALANCE', 'El saldo inicial de vacaciones no puede ser negativo', v_warnings;
            RETURN;
        END IF;
        IF (p_row ->> 'vacation_cutoff_date') IS NULL OR (p_row ->> 'vacation_cutoff_date') = '' THEN
            v_warnings := v_warnings || 'Se proporcionó saldo inicial sin fecha de corte; se usará la fecha de incorporación como corte';
        END IF;
    END IF;

    IF (p_row ->> 'vacation_cutoff_date') IS NOT NULL AND (p_row ->> 'vacation_cutoff_date') != '' THEN
        IF (p_row ->> 'initial_vacation_balance') IS NULL OR (p_row ->> 'initial_vacation_balance') = '' THEN
            v_warnings := v_warnings || 'Se proporcionó fecha de corte sin saldo inicial; el baseline no se creará';
        END IF;
    END IF;

    RETURN QUERY SELECT true, NULL, NULL, v_warnings;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. CONFIRMACIÓN DE IMPORTACIÓN MASIVA (atómica)
-- Procesa todas las filas validadas en una transacción.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_migration_batch(
    p_entity_id uuid,
    p_migration_type text, -- 'BASIC' | 'COMPLETE'
    p_rows jsonb, -- array de filas ya validadas
    p_migration_batch_id text
)
RETURNS TABLE (
    total_rows integer,
    successful integer,
    failed integer,
    errors jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_row record;
    v_worker_id uuid;
    v_assignment_id uuid;
    v_contract_id uuid;
    v_vacation_balance_id uuid;
    v_successful integer := 0;
    v_failed integer := 0;
    v_errors jsonb := '[]'::jsonb;
    v_row_error text;
BEGIN
    -- Verificar permiso
    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;
    IF p_migration_type = 'COMPLETE' AND NOT public.can_access_entity(p_entity_id, 'contracts.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para formalizar contratos en esta entidad';
    END IF;

    -- Verificar que no existe ya este batch_id (idempotencia)
    IF EXISTS (SELECT 1 FROM public.workers WHERE migration_batch_id = p_migration_batch_id) THEN
        RAISE EXCEPTION 'Este lote de migración ya fue procesado (idempotencia)';
    END IF;

    -- Procesar cada fila
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) AS row
    LOOP
        BEGIN
            IF p_migration_type = 'BASIC' THEN
                SELECT * INTO v_worker_id, v_assignment_id, v_vacation_balance_id
                FROM public.migrate_worker_basic(
                    p_entity_id,
                    v_row -> 'worker',
                    (v_row ->> 'position_id')::uuid,
                    (v_row ->> 'hire_date')::date,
                    NULLIF((v_row ->> 'initial_vacation_balance')::text, '')::numeric(10,4),
                    NULLIF((v_row ->> 'vacation_cutoff_date')::text, '')::date,
                    p_migration_batch_id
                );
            ELSE
                SELECT * INTO v_worker_id, v_assignment_id, v_contract_id, v_vacation_balance_id
                FROM public.migrate_worker_complete(
                    p_entity_id,
                    v_row -> 'worker',
                    (v_row ->> 'position_id')::uuid,
                    (v_row ->> 'hire_date')::date,
                    NULLIF((v_row ->> 'initial_vacation_balance')::text, '')::numeric(10,4),
                    NULLIF((v_row ->> 'vacation_cutoff_date')::text, '')::date,
                    (v_row ->> 'contract_type_id')::uuid,
                    (v_row ->> 'contract_start_date')::date,
                    NULLIF((v_row ->> 'contract_end_date')::text, '')::date,
                    NULLIF((v_row ->> 'contract_salary_amount')::text, '')::numeric(12,2),
                    COALESCE(NULLIF((v_row ->> 'contract_salary_currency')::text, ''), 'CUP'),
                    (v_row ->> 'signature_date')::date,
                    (v_row ->> 'signature_place')::text,
                    (v_row ->> 'payment_method_id')::uuid,
                    NULLIF((v_row ->> 'payment_schedule_text')::text, ''),
                    COALESCE((v_row -> 'compensation_components')::jsonb, '[]'::jsonb),
                    (v_row ->> 'representative_assignment_id')::uuid,
                    p_migration_batch_id
                );
            END IF;
            v_successful := v_successful + 1;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_object(
                'row', v_row,
                'error', SQLERRM
            );
        END;
    END LOOP;

    -- Política atómica: si hay cualquier fallo, rollback total
    IF v_failed > 0 THEN
        RAISE EXCEPTION 'Importación atómica fallida: % filas con errores. Ninguna fila se importó.', v_failed
            USING HINT = v_errors;
    END IF;

    RETURN QUERY SELECT 
        jsonb_array_length(p_rows)::integer,
        v_successful,
        v_failed,
        v_errors;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. OBTENER DATOS PARA PLANTILLAS EXCEL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_migration_template_data(
    p_entity_id uuid,
    p_migration_type text -- 'BASIC' | 'COMPLETE'
)
RETURNS TABLE (
    areas jsonb,
    jobs jsonb,
    positions jsonb,
    contract_types jsonb,
    payment_methods jsonb,
    representatives jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
    IF NOT public.can_access_entity(p_entity_id, 'workers.view') 
       AND NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para ver la plantilla de esta entidad';
    END IF;

    RETURN QUERY SELECT
        (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) ORDER BY hierarchy_order)
         FROM public.organization_areas
         WHERE organization_entity_id = p_entity_id AND is_active = true) as areas,
        (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'area_id', area_id) ORDER BY name)
         FROM public.organization_jobs
         WHERE organization_entity_id = p_entity_id AND is_active = true) as jobs,
        (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'job_id', job_id, 'authorized_quantity', authorized_quantity) ORDER BY name)
         FROM public.organization_positions
         WHERE organization_entity_id = p_entity_id AND is_active = true) as positions,
        (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) ORDER BY name)
         FROM public.employment_contract_types
         WHERE is_active = true) as contract_types,
        (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) ORDER BY name)
         FROM public.payment_methods) as payment_methods,
        (SELECT jsonb_agg(jsonb_build_object('id', id, 'person_name', person_name, 'title', title) ORDER BY person_name)
         FROM public.representative_assignments
         WHERE organization_entity_id = p_entity_id
           AND (end_date IS NULL OR end_date >= CURRENT_DATE)
           AND start_date <= CURRENT_DATE) as representatives;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. PERMISOS PARA MIGRACIÓN
-- ---------------------------------------------------------------------------
INSERT INTO public.tenant_permissions (code, description) VALUES
    ('workers.migrate', 'Migrar trabajadores existentes (plantilla inicial)')
ON CONFLICT (code) DO NOTHING;