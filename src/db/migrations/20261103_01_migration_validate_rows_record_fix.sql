-- ============================================================================
-- SiteCorp · Carga inicial de trabajadores
-- Corrección: 55000 «record "v_position" is not assigned yet»
--             en public.migration_validate_rows(uuid, jsonb)
--
-- ----------------------------------------------------------------------------
-- CAUSA (diagnóstico)
--   La función declaraba `v_position record;` (tipo RECORD sin estructura) y lo
--   reiniciaba en cada fila con `v_position := NULL;`. En PL/pgSQL esa
--   asignación DEJA EL RECORD SIN ASIGNAR (no le da una estructura de campos).
--   Después:
--
--     · Solo dos sentencias `SELECT … INTO v_position` le dan estructura, y
--       ambas exigen una referencia de puesto (`position_id` o `position_code`).
--     · El acceso `IF v_position.id IS NOT NULL THEN` es incondicional y se
--       evalúa también cuando nunca hubo asignación.
--
--   Resultado: `record "v_position" is not assigned yet` (SQLSTATE 55000) y
--   HTTP 500 en la RPC.
--
--   Condición que lo dispara en la práctica: la plantilla oficial de carga
--   inicial NO incluye la columna «Código Puesto» (la carga inicial no vincula
--   puestos), así que `v_pos_raw` es NULL en todas las filas y el record nunca
--   se asigna: la validación falla siempre, antes de evaluar ninguna fila.
--
--   Nota: eliminar `v_position := NULL;` NO lo corrige. Un record que nunca se
--   asigna tampoco tiene estructura; la estructura debe existir por DECLARACIÓN.
--
-- ----------------------------------------------------------------------------
-- CORRECCIÓN (mínima)
--   1. `v_position public.organization_positions%rowtype;`
--      Tipo fila real del esquema ⇒ la variable SIEMPRE tiene estructura y
--      `v_position.id` devuelve NULL cuando no se asignó (nunca lanza 55000).
--      Es la misma convención que ya usan otras funciones del proyecto
--      (p. ej. contract_integrity, pluriempleo).
--   2. `SELECT op.* INTO v_position` (en las dos consultas de resolución),
--      para asignar la fila completa con correspondencia exacta de campos.
--   3. Se conserva `v_position := NULL;` por fila: con %rowtype vacía todos los
--      campos y evita que el puesto de una fila se filtre a la siguiente.
--
--   NO se toca ninguna regla de negocio:
--     · Puesto inexistente            → status ERROR «Puesto no encontrado».
--     · Referencia ambigua por código → status ERROR «Referencia de puesto ambigua».
--     · Puesto sin vacantes           → status ERROR «Puesto sin capacidad disponible»
--                                       (capacidad = authorized_quantity, ocupación
--                                        real + reservas del mismo lote v_batch).
--     · Fila sin puesto               → status WARNING «Se importará como pendiente
--                                       de vinculación a plantilla».
--     · Identificación: exactamente 11 dígitos (ERROR si no).
--     · Identificaciones repetidas en el archivo / ya existentes (trabajador o
--       candidato) → WARNING no bloqueante (se importa y se avisa).
--     · Contrato migrado: exige puesto vinculado, tipo activo, fecha de inicio y
--       fecha de fin para DETERMINADO.
--     · Saldo inicial de vacaciones 0..24.
--   La función es de SOLO LECTURA: no crea ni modifica trabajadores, contratos,
--   plazas, asignaciones ni vacantes; tampoco crea puestos duplicados.
--
-- ----------------------------------------------------------------------------
-- ALCANCE
--   · Firma pública intacta: (p_entity_id uuid, p_rows jsonb) RETURNS jsonb.
--     Compatible con src/modules/people/infrastructure/worker-migration.repository.ts
--     (`supabase.rpc("migration_validate_rows", { p_entity_id, p_rows })`) y con
--     MigrationPreviewRow { index, status, messages, position_id, position_label }.
--   · Cuerpo reproducido VERBATIM de la definición viva en Supabase
--     (incluye los cambios posteriores: company_client_id, regla de 11 dígitos y
--     avisos no bloqueantes de identificación), más los puntos 1 y 2 anteriores.
--     No se modifican migraciones históricas ni el resto de funciones.
--   · CREATE OR REPLACE conserva OID, propietario y ACL (no hay DROP FUNCTION).
--
--   Revisar también, fuera de este alcance y sin cambios aquí:
--     `migration_create_worker` (ruta de importación) declara `v_rep record` y lo
--     reinicia con `v_rep := NULL;`; si un lote llegara con contrato pero sin
--     representante, el INSERT de contrato accedería a `v_rep.person_name` sin
--     asignación y fallaría con 55000. No lo provoca la plantilla inicial (no
--     envía contrato) y corregirlo afecta a la ruta de escritura: se deja como
--     hallazgo separado.
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
            IF v_ident !~ '^[0-9]{11}$' THEN
                v_status := 'ERROR';
                v_messages := v_messages || 'El número de identificación debe contener exactamente 11 dígitos';
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

-- La firma no cambia: CREATE OR REPLACE conserva la ACL existente. Se repite el
-- GRANT para que la RPC siga siendo invocable desde la aplicación si la función
-- se hubiera recreado previamente por cualquier otra vía.
GRANT EXECUTE ON FUNCTION public.migration_validate_rows(uuid, jsonb) TO authenticated;
