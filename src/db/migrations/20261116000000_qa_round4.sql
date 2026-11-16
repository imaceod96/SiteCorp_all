-- =============================================================================
-- MIGRACIÓN: 20261116000000_qa_round4.sql
-- Ronda 4 de QA sobre app.sitecorp.cu + pendientes de la ronda anterior
-- Zona horaria de negocio: America/Havana (public.cuba_current_date())
-- =============================================================================
-- Contenido:
--   BLOQUE A. Cola y generación automática de TODOS los documentos en el backend
--             (`public.document_generation_jobs`, triggers en las 6 tablas fuente,
--              RPCs de encolado/reclamo/resultado, pg_net + pg_cron con diagnóstico
--              explícito y backfill de registros sin documento).
--   BLOQUE B.
--     B2: `trigger_type` ('CONTRATACION' | 'CAMBIO_CARGO') en
--         `public.training_initial_notifications` y trigger actualizado.
--     B3: `change_worker_position` y `change_worker_contract` con soporte para
--         `p_effective_date > public.cuba_current_date()` (asignación/contrato
--         programado con `is_current = false` hasta su fecha de inicio).
--     B4: Trabajadores con `hire_date > public.cuba_current_date()` excluidos del
--         devengo y vista activa de vacaciones y prenómina hasta su incorporación.
--     B5: `public.contract_expiry_alerts` devuelve `resolved_salary_amount` y
--         `resolved_salary_currency` calculados en el backend.
--     B7: Validaciones de fechas y campos obligatorios en tablas de SST
--         (`sst_accidents_incidents`, `sst_worker_health_aptitude`,
--          `sst_preventive_actions`, `sst_emergency_plans`).
--     B10: `public.addendum_change_display` unificado con formato `4,500.00 CUP`.
--   BLOQUE C.
--     C1: Prorrateo en `public.prenomina_refresh_workers` y
--         `public.prenomina_recalc_entry` cuando `salary_group_values` cambia a
--         mitad de mes dentro de una misma ventana laboral.
--     C4: Verificación explícita de `cron.job` con `RAISE NOTICE` y ampliación de
--         `public.apply_due_scheduled_separations` para activar asignaciones y
--         contratos programados cuya fecha efectiva ya llegó.
--     C5: Mensaje claro de stock agotado en `trg_fn_validate_sst_epp_delivery`.
--     C7: Tabla `public.candidate_pool_metadata` con RLS por `company_client_id`.
--   VERIFICACIÓN FINAL: Bloque `DO $$ ... RAISE EXCEPTION ... $$` de comprobación.
-- =============================================================================

BEGIN;

-- =============================================================================
-- BLOQUE A. Cola de generación automática de documentos (`document_generation_jobs`)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.document_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN (
      'CONTRACT',
      'ADDENDUM',
      'RESOLUTION',
      'PAYROLL_MOVEMENT',
      'VACATION',
      'MEDICAL_CERTIFICATE'
    )
  ),
  source_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDIENTE' CHECK (
    status IN ('PENDIENTE', 'GENERANDO', 'GENERADO', 'ERROR', 'SIN_PLANTILLA')
  ),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  worker_document_id uuid REFERENCES public.worker_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS document_generation_jobs_kind_source_uidx
  ON public.document_generation_jobs (kind, source_id);

CREATE INDEX IF NOT EXISTS document_generation_jobs_entity_status_idx
  ON public.document_generation_jobs (organization_entity_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS document_generation_jobs_due_idx
  ON public.document_generation_jobs (status, next_attempt_at)
  WHERE status IN ('PENDIENTE', 'ERROR', 'GENERANDO');

ALTER TABLE public.document_generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_generation_jobs_select_policy ON public.document_generation_jobs;
CREATE POLICY document_generation_jobs_select_policy
  ON public.document_generation_jobs
  FOR SELECT
  TO authenticated
  USING (
    public.can_access_entity(organization_entity_id, 'workers.view')
    OR public.can_access_entity(organization_entity_id, 'workers.manage')
    OR public.can_access_entity(organization_entity_id, 'contracts.view')
    OR public.can_access_entity(organization_entity_id, 'contracts.manage')
    OR public.can_access_entity(organization_entity_id, 'vacations.view')
    OR public.can_access_entity(organization_entity_id, 'vacations.manage')
    OR public.can_access_entity(organization_entity_id, 'medical_certificates.view')
    OR public.can_access_entity(organization_entity_id, 'medical_certificates.manage')
  );

DROP POLICY IF EXISTS document_generation_jobs_modify_policy ON public.document_generation_jobs;
CREATE POLICY document_generation_jobs_modify_policy
  ON public.document_generation_jobs
  FOR ALL
  TO authenticated
  USING (
    public.can_access_entity(organization_entity_id, 'workers.manage')
    OR public.can_access_entity(organization_entity_id, 'contracts.manage')
    OR public.can_access_entity(organization_entity_id, 'workers.view')
    OR public.can_access_entity(organization_entity_id, 'vacations.manage')
    OR public.can_access_entity(organization_entity_id, 'medical_certificates.manage')
  )
  WITH CHECK (
    public.can_access_entity(organization_entity_id, 'workers.manage')
    OR public.can_access_entity(organization_entity_id, 'contracts.manage')
    OR public.can_access_entity(organization_entity_id, 'workers.view')
    OR public.can_access_entity(organization_entity_id, 'vacations.manage')
    OR public.can_access_entity(organization_entity_id, 'medical_certificates.manage')
  );

GRANT SELECT, INSERT, UPDATE ON public.document_generation_jobs TO authenticated, service_role;

-- Helper: resuelve (organization_entity_id, worker_id, completed_worker_document_id, skip_cuadro)
CREATE OR REPLACE FUNCTION public.resolve_document_job_context(
  p_kind text,
  p_source_id uuid,
  OUT organization_entity_id uuid,
  OUT worker_id uuid,
  OUT completed_worker_document_id uuid,
  OUT skip_generation boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clean_kind text := upper(btrim(COALESCE(p_kind, '')));
BEGIN
  organization_entity_id := NULL;
  worker_id := NULL;
  completed_worker_document_id := NULL;
  skip_generation := false;

  IF v_clean_kind = 'CONTRACT' THEN
    SELECT ec.organization_entity_id,
           ec.worker_id,
           EXISTS (
             SELECT 1
             FROM public.worker_position_assignments wpa
             JOIN public.organization_positions op ON op.id = wpa.position_id
             JOIN public.organization_jobs oj ON oj.id = op.job_id
             LEFT JOIN public.occupational_categories oc ON oc.id = oj.occupational_category_id
             WHERE wpa.id = ec.assignment_id
               AND (
                 COALESCE(oj.is_cuadro, false) = true
                 OR upper(btrim(COALESCE(oc.code, oc.name, ''))) = 'CUADRO'
               )
           )
      INTO organization_entity_id, worker_id, skip_generation
    FROM public.employment_contracts ec
    WHERE ec.id = p_source_id;

    SELECT wd.id INTO completed_worker_document_id
    FROM public.worker_documents wd
    WHERE wd.employment_contract_id = p_source_id
      AND COALESCE(wd.generation_status, 'COMPLETED') = 'COMPLETED'
      AND wd.storage_path IS NOT NULL
    ORDER BY wd.created_at DESC
    LIMIT 1;

  ELSIF v_clean_kind = 'ADDENDUM' THEN
    SELECT ca.organization_entity_id, ca.worker_id
      INTO organization_entity_id, worker_id
    FROM public.contract_addendums ca
    WHERE ca.id = p_source_id;

    SELECT wd.id INTO completed_worker_document_id
    FROM public.worker_documents wd
    WHERE wd.contract_addendum_id = p_source_id
      AND COALESCE(wd.generation_status, 'COMPLETED') = 'COMPLETED'
      AND wd.storage_path IS NOT NULL
    ORDER BY wd.created_at DESC
    LIMIT 1;

  ELSIF v_clean_kind = 'RESOLUTION' THEN
    SELECT wr.organization_entity_id, wr.worker_id
      INTO organization_entity_id, worker_id
    FROM public.worker_resolutions wr
    WHERE wr.id = p_source_id;

    SELECT wd.id INTO completed_worker_document_id
    FROM public.worker_documents wd
    WHERE wd.document_source_type = 'RESOLUTION'
      AND wd.document_source_id = p_source_id
      AND COALESCE(wd.generation_status, 'COMPLETED') = 'COMPLETED'
      AND wd.storage_path IS NOT NULL
    ORDER BY wd.created_at DESC
    LIMIT 1;

  ELSIF v_clean_kind = 'PAYROLL_MOVEMENT' THEN
    SELECT wpm.organization_entity_id, wpm.worker_id
      INTO organization_entity_id, worker_id
    FROM public.worker_payroll_movements wpm
    WHERE wpm.id = p_source_id;

    SELECT wd.id INTO completed_worker_document_id
    FROM public.worker_documents wd
    WHERE wd.document_source_type = 'PAYROLL_MOVEMENT'
      AND wd.document_source_id = p_source_id
      AND COALESCE(wd.generation_status, 'COMPLETED') = 'COMPLETED'
      AND wd.storage_path IS NOT NULL
    ORDER BY wd.created_at DESC
    LIMIT 1;

  ELSIF v_clean_kind = 'VACATION' THEN
    SELECT w.organization_entity_id, wv.worker_id, (wv.status = 'CANCELLED')
      INTO organization_entity_id, worker_id, skip_generation
    FROM public.worker_vacations wv
    JOIN public.workers w ON w.id = wv.worker_id
    WHERE wv.id = p_source_id;

    SELECT wd.id INTO completed_worker_document_id
    FROM public.worker_documents wd
    WHERE wd.document_source_type = 'VACATION'
      AND wd.document_source_id = p_source_id
      AND COALESCE(wd.generation_status, 'COMPLETED') = 'COMPLETED'
      AND wd.storage_path IS NOT NULL
    ORDER BY wd.created_at DESC
    LIMIT 1;

  ELSIF v_clean_kind = 'MEDICAL_CERTIFICATE' THEN
    SELECT COALESCE(wmc.organization_entity_id, w.organization_entity_id), wmc.worker_id
      INTO organization_entity_id, worker_id
    FROM public.worker_medical_certificates wmc
    JOIN public.workers w ON w.id = wmc.worker_id
    WHERE wmc.id = p_source_id;

    SELECT wd.id INTO completed_worker_document_id
    FROM public.worker_documents wd
    WHERE wd.document_source_type = 'MEDICAL_CERTIFICATE'
      AND wd.document_source_id = p_source_id
      AND COALESCE(wd.generation_status, 'COMPLETED') = 'COMPLETED'
      AND wd.storage_path IS NOT NULL
    ORDER BY wd.created_at DESC
    LIMIT 1;
  END IF;
END;
$function$;

-- Disparo asíncrono hacia la Edge Function `process-document-jobs` vía pg_net (si está configurado)
CREATE OR REPLACE FUNCTION public.notify_process_document_jobs(p_job_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := nullif(btrim(COALESCE(current_setting('app.settings.supabase_url', true), '')), '');
  v_key text := nullif(btrim(COALESCE(
    current_setting('app.settings.service_role_key', true),
    current_setting('app.settings.anon_key', true),
    ''
  )), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;

  IF v_url IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
    rtrim(v_url, '/') || '/functions/v1/process-document-jobs',
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', CASE WHEN v_key IS NOT NULL THEN 'Bearer ' || v_key ELSE '' END
    )::text,
    jsonb_build_object('job_id', p_job_id)::text
  );
END;
$function$;

-- Encolar o reintentar un trabajo de generación documental
CREATE OR REPLACE FUNCTION public.enqueue_document_generation_job(
  p_kind text,
  p_source_id uuid,
  p_force_retry boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_clean_kind text := upper(btrim(COALESCE(p_kind, '')));
  v_ctx record;
  v_job public.document_generation_jobs%ROWTYPE;
BEGIN
  IF v_clean_kind NOT IN (
    'CONTRACT',
    'ADDENDUM',
    'RESOLUTION',
    'PAYROLL_MOVEMENT',
    'VACATION',
    'MEDICAL_CERTIFICATE'
  ) THEN
    RAISE EXCEPTION 'Tipo de trabajo documental no válido: %', p_kind;
  END IF;

  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'El identificador de origen (source_id) es obligatorio';
  END IF;

  SELECT * INTO v_ctx
  FROM public.resolve_document_job_context(v_clean_kind, p_source_id);

  IF v_ctx.organization_entity_id IS NULL THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'SOURCE_NOT_FOUND');
  END IF;

  IF v_ctx.skip_generation THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'SKIPPED_BY_RULE');
  END IF;

  -- Si ya tiene un documento completado y no es un reintento/regeneración forzada,
  -- se registra directamente como GENERADO.
  IF v_ctx.completed_worker_document_id IS NOT NULL AND NOT COALESCE(p_force_retry, false) THEN
    INSERT INTO public.document_generation_jobs (
      organization_entity_id,
      worker_id,
      kind,
      source_id,
      status,
      attempts,
      last_error,
      next_attempt_at,
      worker_document_id,
      updated_at
    ) VALUES (
      v_ctx.organization_entity_id,
      v_ctx.worker_id,
      v_clean_kind,
      p_source_id,
      'GENERADO',
      0,
      NULL,
      now(),
      v_ctx.completed_worker_document_id,
      now()
    )
    ON CONFLICT (kind, source_id) DO UPDATE
      SET status = 'GENERADO',
          worker_document_id = EXCLUDED.worker_document_id,
          last_error = NULL,
          updated_at = now()
    RETURNING * INTO v_job;

    RETURN jsonb_build_object(
      'enqueued', false,
      'job_id', v_job.id,
      'status', v_job.status,
      'worker_document_id', v_job.worker_document_id
    );
  END IF;

  INSERT INTO public.document_generation_jobs (
    organization_entity_id,
    worker_id,
    kind,
    source_id,
    status,
    attempts,
    last_error,
    next_attempt_at,
    worker_document_id,
    updated_at
  ) VALUES (
    v_ctx.organization_entity_id,
    v_ctx.worker_id,
    v_clean_kind,
    p_source_id,
    'PENDIENTE',
    0,
    NULL,
    now(),
    v_ctx.completed_worker_document_id,
    now()
  )
  ON CONFLICT (kind, source_id) DO UPDATE
    SET status = CASE
          WHEN COALESCE(p_force_retry, false) THEN 'PENDIENTE'
          WHEN public.document_generation_jobs.status = 'GENERADO' THEN 'GENERADO'
          ELSE 'PENDIENTE'
        END,
        attempts = CASE
          WHEN COALESCE(p_force_retry, false) THEN 0
          ELSE public.document_generation_jobs.attempts
        END,
        last_error = CASE
          WHEN COALESCE(p_force_retry, false) THEN NULL
          ELSE public.document_generation_jobs.last_error
        END,
        next_attempt_at = CASE
          WHEN COALESCE(p_force_retry, false) THEN now()
          ELSE LEAST(public.document_generation_jobs.next_attempt_at, now())
        END,
        organization_entity_id = EXCLUDED.organization_entity_id,
        worker_id = EXCLUDED.worker_id,
        updated_at = now()
  RETURNING * INTO v_job;

  IF v_clean_kind = 'CONTRACT' AND v_job.status = 'PENDIENTE' THEN
    UPDATE public.employment_contracts
    SET document_status = 'PENDIENTE',
        document_error = NULL,
        document_status_updated_at = now()
    WHERE id = p_source_id;
  END IF;

  IF v_job.status = 'PENDIENTE' THEN
    PERFORM public.notify_process_document_jobs(v_job.id);
  END IF;

  RETURN jsonb_build_object(
    'enqueued', (v_job.status = 'PENDIENTE'),
    'job_id', v_job.id,
    'status', v_job.status,
    'worker_document_id', v_job.worker_document_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.enqueue_document_generation_job(text, uuid, boolean)
  TO authenticated, service_role;

-- Reclamar trabajos pendientes o en error con FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_due_document_generation_jobs(
  p_limit integer DEFAULT 10,
  p_source_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL
)
RETURNS SETOF public.document_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_clean_kind text := NULLIF(upper(btrim(COALESCE(p_kind, ''))), '');
BEGIN
  -- Liberar trabajos que quedaron en GENERANDO por más de 3 minutos (timeout de worker previo)
  UPDATE public.document_generation_jobs
  SET status = 'ERROR',
      last_error = COALESCE(last_error, 'Tiempo de espera agotado durante la generación; reintentando.'),
      next_attempt_at = now(),
      updated_at = now()
  WHERE status = 'GENERANDO'
    AND updated_at < now() - interval '3 minutes';

  RETURN QUERY
  WITH due AS (
    SELECT j.id
    FROM public.document_generation_jobs j
    WHERE (
        (p_source_id IS NOT NULL AND j.source_id = p_source_id AND (v_clean_kind IS NULL OR j.kind = v_clean_kind) AND j.status <> 'GENERADO')
        OR (
          p_source_id IS NULL
          AND (v_clean_kind IS NULL OR j.kind = v_clean_kind)
          AND j.status IN ('PENDIENTE', 'ERROR')
          AND j.attempts < 5
          AND j.next_attempt_at <= now()
        )
      )
    ORDER BY
      CASE WHEN j.status = 'PENDIENTE' THEN 0 ELSE 1 END ASC,
      j.next_attempt_at ASC,
      j.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.document_generation_jobs target
  SET status = 'GENERANDO',
      updated_at = now()
  FROM due
  WHERE target.id = due.id
  RETURNING target.*;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_due_document_generation_jobs(integer, uuid, text)
  TO authenticated, service_role;

-- Registrar resultado de un trabajo de la cola (GENERADO | SIN_PLANTILLA | ERROR)
CREATE OR REPLACE FUNCTION public.mark_document_generation_job_result(
  p_job_id uuid,
  p_status text,
  p_worker_document_id uuid DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS public.document_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_clean_status text := upper(btrim(COALESCE(p_status, '')));
  v_job public.document_generation_jobs%ROWTYPE;
  v_next_attempts integer;
  v_backoff interval;
BEGIN
  IF v_clean_status NOT IN ('GENERADO', 'SIN_PLANTILLA', 'ERROR', 'PENDIENTE') THEN
    RAISE EXCEPTION 'Estado de resultado no válido para trabajo documental: %', p_status;
  END IF;

  SELECT * INTO v_job
  FROM public.document_generation_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajo de generación documental no encontrado: %', p_job_id;
  END IF;

  IF v_clean_status = 'GENERADO' THEN
    UPDATE public.document_generation_jobs
    SET status = 'GENERADO',
        worker_document_id = COALESCE(p_worker_document_id, worker_document_id),
        last_error = NULL,
        updated_at = now()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    IF v_job.kind = 'CONTRACT' THEN
      UPDATE public.employment_contracts
      SET document_status = 'GENERADO',
          document_error = NULL,
          document_status_updated_at = now()
      WHERE id = v_job.source_id;
    END IF;

  ELSIF v_clean_status = 'SIN_PLANTILLA' THEN
    UPDATE public.document_generation_jobs
    SET status = 'SIN_PLANTILLA',
        last_error = COALESCE(NULLIF(btrim(COALESCE(p_error, '')), ''), 'No hay plantilla activa vigente para este tipo de documento.'),
        updated_at = now()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    IF v_job.kind = 'CONTRACT' THEN
      UPDATE public.employment_contracts
      SET document_status = 'ERROR',
          document_error = v_job.last_error,
          document_status_updated_at = now()
      WHERE id = v_job.source_id;
    END IF;

  ELSIF v_clean_status = 'PENDIENTE' THEN
    UPDATE public.document_generation_jobs
    SET status = 'PENDIENTE',
        attempts = 0,
        last_error = NULL,
        next_attempt_at = now(),
        updated_at = now()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    IF v_job.kind = 'CONTRACT' THEN
      UPDATE public.employment_contracts
      SET document_status = 'PENDIENTE',
          document_error = NULL,
          document_status_updated_at = now()
      WHERE id = v_job.source_id;
    END IF;

  ELSE
    v_next_attempts := COALESCE(v_job.attempts, 0) + 1;
    v_backoff := CASE
      WHEN v_next_attempts <= 1 THEN interval '1 minute'
      WHEN v_next_attempts = 2 THEN interval '5 minutes'
      ELSE interval '15 minutes'
    END;

    UPDATE public.document_generation_jobs
    SET status = 'ERROR',
        attempts = v_next_attempts,
        last_error = COALESCE(NULLIF(btrim(COALESCE(p_error, '')), ''), 'Error al generar el documento.'),
        next_attempt_at = now() + v_backoff,
        updated_at = now()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    IF v_job.kind = 'CONTRACT' THEN
      UPDATE public.employment_contracts
      SET document_status = 'ERROR',
          document_error = v_job.last_error,
          document_status_updated_at = now()
      WHERE id = v_job.source_id;
    END IF;
  END IF;

  RETURN v_job;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_document_generation_job_result(uuid, text, uuid, text)
  TO authenticated, service_role;

-- Sincronizar automáticamente `document_generation_jobs` cuando se completa un `worker_documents`
CREATE OR REPLACE FUNCTION public.trg_fn_sync_contract_document_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text := NULL;
  v_source_id uuid := NULL;
BEGIN
  IF NEW.employment_contract_id IS NOT NULL THEN
    v_kind := 'CONTRACT';
    v_source_id := NEW.employment_contract_id;
    IF COALESCE(NEW.generation_status, 'COMPLETED') = 'COMPLETED' AND NEW.storage_path IS NOT NULL THEN
      UPDATE public.employment_contracts
      SET document_status = 'GENERADO',
          document_error = NULL,
          document_status_updated_at = now()
      WHERE id = NEW.employment_contract_id;
    ELSIF NEW.generation_status = 'FAILED' THEN
      UPDATE public.employment_contracts
      SET document_status = 'ERROR',
          document_error = COALESCE(NEW.generation_error, 'No se pudo completar la generación del documento.'),
          document_status_updated_at = now()
      WHERE id = NEW.employment_contract_id
        AND document_status <> 'GENERADO';
    END IF;
  ELSIF NEW.contract_addendum_id IS NOT NULL THEN
    v_kind := 'ADDENDUM';
    v_source_id := NEW.contract_addendum_id;
  ELSIF NEW.document_source_id IS NOT NULL
        AND NEW.document_source_type IN ('RESOLUTION', 'PAYROLL_MOVEMENT', 'VACATION', 'MEDICAL_CERTIFICATE') THEN
    v_kind := NEW.document_source_type;
    v_source_id := NEW.document_source_id;
  END IF;

  IF v_kind IS NOT NULL AND v_source_id IS NOT NULL THEN
    IF COALESCE(NEW.generation_status, 'COMPLETED') = 'COMPLETED' AND NEW.storage_path IS NOT NULL THEN
      INSERT INTO public.document_generation_jobs (
        organization_entity_id,
        worker_id,
        kind,
        source_id,
        status,
        attempts,
        last_error,
        next_attempt_at,
        worker_document_id,
        updated_at
      ) VALUES (
        NEW.organization_entity_id,
        NEW.worker_id,
        v_kind,
        v_source_id,
        'GENERADO',
        0,
        NULL,
        now(),
        NEW.id,
        now()
      )
      ON CONFLICT (kind, source_id) DO UPDATE
        SET status = 'GENERADO',
            worker_document_id = NEW.id,
            last_error = NULL,
            updated_at = now();
    ELSIF NEW.generation_status = 'FAILED' THEN
      UPDATE public.document_generation_jobs
      SET status = CASE
            WHEN COALESCE(NEW.generation_error, '') ILIKE '%plantilla%' THEN 'SIN_PLANTILLA'
            ELSE 'ERROR'
          END,
          last_error = COALESCE(NEW.generation_error, 'Error al generar el documento.'),
          attempts = attempts + 1,
          next_attempt_at = now() + interval '1 minute',
          updated_at = now()
      WHERE kind = v_kind
        AND source_id = v_source_id
        AND status <> 'GENERADO';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_contract_document_status ON public.worker_documents;
CREATE TRIGGER trg_sync_contract_document_status
AFTER INSERT OR UPDATE ON public.worker_documents
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_sync_contract_document_status();

-- Triggers de encolado automático en las 6 tablas fuente

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_contract_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.signature_date IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.signature_date IS NULL) THEN
    PERFORM public.enqueue_document_generation_job('CONTRACT', NEW.id, false);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_contract_document_job ON public.employment_contracts;
CREATE TRIGGER trg_enqueue_contract_document_job
AFTER INSERT OR UPDATE OF signature_date ON public.employment_contracts
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_enqueue_contract_document_job();

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_addendum_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'FORMALIZED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'FORMALIZED') THEN
    PERFORM public.enqueue_document_generation_job('ADDENDUM', NEW.id, false);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_addendum_document_job ON public.contract_addendums;
CREATE TRIGGER trg_enqueue_addendum_document_job
AFTER INSERT OR UPDATE OF status ON public.contract_addendums
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_enqueue_addendum_document_job();

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_resolution_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.enqueue_document_generation_job('RESOLUTION', NEW.id, false);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_resolution_document_job ON public.worker_resolutions;
CREATE TRIGGER trg_enqueue_resolution_document_job
AFTER INSERT ON public.worker_resolutions
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_enqueue_resolution_document_job();

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_payroll_movement_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.enqueue_document_generation_job('PAYROLL_MOVEMENT', NEW.id, false);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_payroll_movement_document_job ON public.worker_payroll_movements;
CREATE TRIGGER trg_enqueue_payroll_movement_document_job
AFTER INSERT ON public.worker_payroll_movements
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_enqueue_payroll_movement_document_job();

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_vacation_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.status, '') <> 'CANCELLED' THEN
    PERFORM public.enqueue_document_generation_job('VACATION', NEW.id, false);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_vacation_document_job ON public.worker_vacations;
CREATE TRIGGER trg_enqueue_vacation_document_job
AFTER INSERT ON public.worker_vacations
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_enqueue_vacation_document_job();

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_medical_certificate_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.enqueue_document_generation_job('MEDICAL_CERTIFICATE', NEW.id, false);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_medical_certificate_document_job ON public.worker_medical_certificates;
CREATE TRIGGER trg_enqueue_medical_certificate_document_job
AFTER INSERT ON public.worker_medical_certificates
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_enqueue_medical_certificate_document_job();

-- Función de backfill para todos los registros existentes sin documento
CREATE OR REPLACE FUNCTION public.backfill_missing_document_generation_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  rec record;
BEGIN
  -- 1. Contratos firmados (excepto cuadros)
  FOR rec IN
    SELECT ec.id
    FROM public.employment_contracts ec
    WHERE ec.signature_date IS NOT NULL
  LOOP
    PERFORM public.enqueue_document_generation_job('CONTRACT', rec.id, false);
    v_count := v_count + 1;
  END LOOP;

  -- 2. Anexos formalizados
  FOR rec IN
    SELECT ca.id
    FROM public.contract_addendums ca
    WHERE ca.status = 'FORMALIZED'
  LOOP
    PERFORM public.enqueue_document_generation_job('ADDENDUM', rec.id, false);
    v_count := v_count + 1;
  END LOOP;

  -- 3. Resoluciones
  FOR rec IN
    SELECT wr.id
    FROM public.worker_resolutions wr
  LOOP
    PERFORM public.enqueue_document_generation_job('RESOLUTION', rec.id, false);
    v_count := v_count + 1;
  END LOOP;

  -- 4. Movimientos de nómina
  FOR rec IN
    SELECT wpm.id
    FROM public.worker_payroll_movements wpm
  LOOP
    PERFORM public.enqueue_document_generation_job('PAYROLL_MOVEMENT', rec.id, false);
    v_count := v_count + 1;
  END LOOP;

  -- 5. Vacaciones no canceladas
  FOR rec IN
    SELECT wv.id
    FROM public.worker_vacations wv
    WHERE COALESCE(wv.status, '') <> 'CANCELLED'
  LOOP
    PERFORM public.enqueue_document_generation_job('VACATION', rec.id, false);
    v_count := v_count + 1;
  END LOOP;

  -- 6. Certificados médicos
  FOR rec IN
    SELECT wmc.id
    FROM public.worker_medical_certificates wmc
  LOOP
    PERFORM public.enqueue_document_generation_job('MEDICAL_CERTIFICATE', rec.id, false);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.backfill_missing_document_generation_jobs()
  TO authenticated, service_role;

-- Ejecutar backfill de los registros existentes
SELECT public.backfill_missing_document_generation_jobs();

-- =============================================================================
-- BLOQUE B2. Cambio de cargo vs nueva contratación en Capacitación inicial
-- =============================================================================

ALTER TABLE public.training_initial_notifications
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'CONTRATACION';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'training_initial_notifications_trigger_type_check'
  ) THEN
    ALTER TABLE public.training_initial_notifications
      ADD CONSTRAINT training_initial_notifications_trigger_type_check
      CHECK (trigger_type IN ('CONTRATACION', 'CAMBIO_CARGO'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_worker_hiring_training_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_worker record;
  v_pos_name text;
  v_area_id uuid;
  v_area_name text;
  v_hire_date date;
  v_event_date date;
  v_hire_key text;
  v_full_name text;
  v_existing record;
  v_has_prior_assignment boolean := false;
  v_trigger_type text := 'CONTRATACION';
BEGIN
  SELECT
    w.id,
    w.code,
    w.first_name,
    w.first_surname,
    w.second_surname,
    w.identification,
    w.hire_date,
    w.employment_start_date,
    w.organization_entity_id
  INTO v_worker
  FROM public.workers w
  WHERE w.id = NEW.worker_id;

  IF v_worker.id IS NULL OR v_worker.organization_entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    op.name,
    oa.id,
    oa.name
  INTO v_pos_name, v_area_id, v_area_name
  FROM public.organization_positions op
  LEFT JOIN public.organization_jobs oj ON oj.id = op.job_id
  LEFT JOIN public.organization_areas oa ON oa.id = oj.area_id
  WHERE op.id = NEW.position_id;

  -- Determinar si ya existía una asignación anterior en el período laboral actual
  SELECT EXISTS (
    SELECT 1
    FROM public.worker_position_assignments wpa
    WHERE wpa.worker_id = v_worker.id
      AND wpa.id <> NEW.id
      AND wpa.start_date >= COALESCE(v_worker.employment_start_date, v_worker.hire_date, '1900-01-01'::date)
  ) INTO v_has_prior_assignment;

  IF v_has_prior_assignment THEN
    v_trigger_type := 'CAMBIO_CARGO';
    v_event_date := COALESCE(NEW.start_date, public.cuba_current_date());
    v_hire_date := v_event_date;
    v_hire_key := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || v_event_date::text || ':position_change';
  ELSE
    v_trigger_type := 'CONTRATACION';
    v_hire_date := COALESCE(v_worker.hire_date, NEW.start_date, public.cuba_current_date());
    v_hire_key := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || v_hire_date::text || ':hire';
  END IF;

  v_full_name := btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname));

  -- Si es la contratación inicial y ya completó su capacitación inicial para esa misma alta, no reabrir
  IF v_trigger_type = 'CONTRATACION' AND EXISTS (
    SELECT 1 FROM public.training_initial_notifications tin
    WHERE tin.organization_entity_id = v_worker.organization_entity_id
      AND tin.worker_id = v_worker.id
      AND tin.hire_key = v_hire_key
      AND tin.status = 'COMPLETADA'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT tin.id, tin.status
    INTO v_existing
  FROM public.training_initial_notifications tin
  WHERE tin.organization_entity_id = v_worker.organization_entity_id
    AND tin.worker_id = v_worker.id
    AND tin.status = 'PENDIENTE'
  ORDER BY tin.created_at DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.training_initial_notifications
    SET area_id = v_area_id,
        area_name = v_area_name,
        position_name = v_pos_name,
        hire_date = v_hire_date,
        trigger_type = v_trigger_type,
        worker_name = COALESCE(NULLIF(v_full_name, ''), 'Trabajador'),
        worker_code = v_worker.code,
        worker_identification = v_worker.identification,
        status = 'PENDIENTE'
    WHERE id = v_existing.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.training_initial_notifications (
    organization_entity_id,
    worker_id,
    hire_key,
    trigger_type,
    worker_name,
    worker_code,
    worker_identification,
    area_id,
    area_name,
    position_name,
    hire_date,
    status
  )
  VALUES (
    v_worker.organization_entity_id,
    v_worker.id,
    v_hire_key,
    v_trigger_type,
    COALESCE(NULLIF(v_full_name, ''), 'Trabajador'),
    v_worker.code,
    v_worker.identification,
    v_area_id,
    v_area_name,
    v_pos_name,
    v_hire_date,
    'PENDIENTE'
  )
  ON CONFLICT (organization_entity_id, hire_key) DO UPDATE
    SET trigger_type = EXCLUDED.trigger_type,
        area_id = EXCLUDED.area_id,
        area_name = EXCLUDED.area_name,
        position_name = EXCLUDED.position_name,
        hire_date = EXCLUDED.hire_date;

  RETURN NEW;
END;
$function$;

-- Reparar filas existentes en `training_initial_notifications` que correspondan a un cambio de cargo
UPDATE public.training_initial_notifications tin
SET trigger_type = 'CAMBIO_CARGO'
FROM public.workers w
WHERE w.id = tin.worker_id
  AND tin.trigger_type = 'CONTRATACION'
  AND (
    tin.hire_date > w.hire_date
    OR EXISTS (
      SELECT 1
      FROM public.worker_employment_movements wem
      WHERE wem.worker_id = tin.worker_id
        AND wem.movement_type = 'CAMBIO_PUESTO'
        AND wem.effective_date = tin.hire_date
    )
  );

-- =============================================================================
-- BLOQUE B3, B4 y C4. Cambios de puesto y contrato con fecha futura,
-- trabajadores con hire_date futura y activación automática en el job diario
-- =============================================================================

-- Actualizar `resolve_worker_target_assignment` para admitir asignaciones vigentes
-- que ya tienen `end_date >= cuba_current_date()` por un cambio de puesto futuro programado
CREATE OR REPLACE FUNCTION public.resolve_worker_target_assignment(
  p_worker_id uuid,
  p_assignment_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
  v_count integer;
  v_target uuid;
BEGIN
  IF p_assignment_id IS NOT NULL THEN
    SELECT a.id INTO v_target
    FROM public.worker_position_assignments a
    WHERE a.id = p_assignment_id
      AND a.worker_id = p_worker_id
      AND a.is_current = true
      AND (a.end_date IS NULL OR a.end_date >= v_today);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'La asignación seleccionada no está vigente o no pertenece al trabajador';
    END IF;
    RETURN v_target;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND a.is_current = true
    AND a.start_date <= v_today
    AND (a.end_date IS NULL OR a.end_date >= v_today);

  IF v_count = 0 THEN
    -- Fallback por si el trabajador tiene incorporación futura (`start_date > v_today`)
    SELECT count(*) INTO v_count
    FROM public.worker_position_assignments a
    WHERE a.worker_id = p_worker_id
      AND a.is_current = true
      AND a.end_date IS NULL;
  END IF;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'El trabajador no tiene un puesto actual asignado';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'El trabajador tiene % contratos activos: identifique la asignación a modificar', v_count;
  END IF;

  SELECT a.id INTO v_target
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND a.is_current = true
    AND (a.end_date IS NULL OR a.end_date >= v_today)
  ORDER BY
    CASE WHEN a.start_date <= v_today THEN 0 ELSE 1 END ASC,
    a.start_date DESC
  LIMIT 1;

  RETURN v_target;
END;
$function$;

-- B3.1: `public.change_worker_position` con soporte de fecha efectiva futura
CREATE OR REPLACE FUNCTION public.change_worker_position(
  p_worker_id uuid,
  p_new_position_id uuid,
  p_effective_date date,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_create_addendum boolean DEFAULT true,
  p_signature_date date DEFAULT NULL,
  p_signature_place text DEFAULT NULL,
  p_representative_assignment_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
  p_require_formalized boolean DEFAULT false,
  p_resolution_date date DEFAULT NULL,
  p_target_assignment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
  v_is_future boolean := false;
  v_worker public.workers%rowtype;
  v_current public.worker_position_assignments%rowtype;
  v_position public.organization_positions%rowtype;
  v_job public.organization_jobs%rowtype;
  v_is_principal boolean := false;
  v_resolution_id uuid := null;
  v_occupied integer;
  v_new_assignment_id uuid;
  v_contract_id uuid;
  v_group_id uuid;
  v_scale_id uuid;
  v_value_id uuid;
  v_amount numeric;
  v_currency text;
  v_previous_salary numeric;
  v_old_group uuid;
  v_old_amount numeric;
  v_old_seq integer;
  v_history_id uuid;
  v_preview jsonb;
  v_changes jsonb;
  v_addendum jsonb := null;
  v_skipped text := null;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'La fecha efectiva es obligatoria';
  END IF;

  v_is_future := (p_effective_date > v_today);

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
  END IF;

  IF v_worker.employment_status <> 'active' THEN
    RAISE EXCEPTION 'El trabajador no está activo';
  END IF;

  SELECT * INTO v_current FROM public.worker_position_assignments
  WHERE id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  FOR UPDATE;

  IF v_current.position_id = p_new_position_id THEN
    RAISE EXCEPTION 'El trabajador ya ocupa el puesto seleccionado';
  END IF;

  IF p_effective_date <= v_current.start_date THEN
    RAISE EXCEPTION 'La fecha efectiva debe ser posterior al inicio del puesto actual';
  END IF;

  SELECT ctx.salary_group_id, ctx.amount INTO v_old_group, v_old_amount
  FROM public.position_salary_context(v_current.position_id, p_effective_date) ctx;
  IF v_old_group IS NOT NULL THEN
    SELECT sg.sequence_number INTO v_old_seq FROM public.salary_groups sg WHERE sg.id = v_old_group;
  END IF;

  SELECT * INTO v_position FROM public.organization_positions WHERE id = p_new_position_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El puesto seleccionado no existe';
  END IF;

  IF v_position.organization_entity_id <> v_worker.organization_entity_id THEN
    RAISE EXCEPTION 'El puesto seleccionado no pertenece a la entidad del trabajador';
  END IF;

  IF NOT v_position.is_active THEN
    RAISE EXCEPTION 'El puesto seleccionado no está activo';
  END IF;

  SELECT * INTO v_job FROM public.organization_jobs WHERE id = v_position.job_id;
  v_is_principal := coalesce(v_job.is_principal_specialist, false);

  SELECT count(*) INTO v_occupied
  FROM public.worker_position_assignments a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.position_id = p_new_position_id
    AND a.is_current = true
    AND (a.end_date IS NULL OR a.end_date >= v_today)
    AND w.employment_status = 'active';

  IF v_occupied >= v_position.authorized_quantity THEN
    RAISE EXCEPTION 'El puesto seleccionado ya no tiene vacantes disponibles';
  END IF;

  SELECT id INTO v_contract_id
  FROM public.employment_contracts
  WHERE assignment_id = v_current.id AND is_current = true
  ORDER BY start_date DESC LIMIT 1;

  v_preview := public.position_change_preview(
    p_worker_id, p_new_position_id, p_effective_date, v_current.id
  );
  v_changes := coalesce(v_preview->'changes', '[]'::jsonb);

  IF v_is_future THEN
    -- Si la fecha efectiva es futura: la asignación actual sigue siendo la vigente hoy
    -- (`is_current = true`) con `end_date = p_effective_date - 1`, y la nueva asignación
    -- queda programada (`is_current = false`) hasta que llegue `p_effective_date`.
    UPDATE public.worker_position_assignments
    SET end_date = p_effective_date - 1,
        is_current = true,
        updated_at = now()
    WHERE id = v_current.id;

    INSERT INTO public.worker_position_assignments (
      worker_id, position_id, start_date, end_date, is_current
    )
    VALUES (
      p_worker_id, p_new_position_id, p_effective_date, NULL, false
    )
    RETURNING id INTO v_new_assignment_id;
  ELSE
    UPDATE public.worker_position_assignments
    SET end_date = p_effective_date - 1,
        is_current = false,
        updated_at = now()
    WHERE id = v_current.id;

    INSERT INTO public.worker_position_assignments (
      worker_id, position_id, start_date, end_date, is_current
    )
    VALUES (
      p_worker_id, p_new_position_id, p_effective_date, NULL, true
    )
    RETURNING id INTO v_new_assignment_id;

    IF v_contract_id IS NOT NULL THEN
      UPDATE public.employment_contracts
      SET assignment_id = v_new_assignment_id, updated_at = now()
      WHERE id = v_contract_id;

      UPDATE public.worker_vacations
      SET assignment_id = v_new_assignment_id, updated_at = now()
      WHERE worker_id = p_worker_id AND assignment_id = v_current.id;

      UPDATE public.worker_vacation_movements
      SET assignment_id = v_new_assignment_id
      WHERE worker_id = p_worker_id AND assignment_id = v_current.id;
    END IF;
  END IF;

  INSERT INTO public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, created_by
  ) VALUES (
    p_worker_id, 'CAMBIO_PUESTO', v_current.id, v_new_assignment_id,
    p_effective_date,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  );

  SELECT ctx.salary_group_id, ctx.salary_scale_id, ctx.salary_group_value_id, ctx.amount, ctx.currency_code
  INTO v_group_id, v_scale_id, v_value_id, v_amount, v_currency
  FROM public.position_salary_context(p_new_position_id, p_effective_date) ctx;

  IF v_amount IS NOT NULL THEN
    v_previous_salary := public.worker_last_recorded_salary(p_worker_id, p_effective_date);
    IF v_previous_salary IS DISTINCT FROM v_amount THEN
      v_history_id := public.record_worker_salary_event(
        p_worker_id, v_contract_id, v_new_assignment_id,
        v_group_id, v_scale_id, v_value_id,
        v_previous_salary, v_amount, v_currency, p_effective_date,
        'POSITION_CHANGE', p_reason
      );
    END IF;
  END IF;

  IF v_is_principal THEN
    v_resolution_id := (public.create_worker_resolution(
      p_worker_id, v_new_assignment_id, p_new_position_id,
      coalesce(p_resolution_date, p_effective_date),
      p_representative_assignment_id, null, 'MOVEMENT'
    )->>'resolution_id')::uuid;
    v_skipped := 'PRINCIPAL_SPECIALIST';
  ELSIF p_create_addendum AND jsonb_array_length(v_changes) > 0 THEN
    IF v_contract_id IS NULL THEN
      v_skipped := 'NO_CONTRACT';
    ELSE
      v_addendum := public.create_contract_addendum(
        p_worker_id, v_changes,
        coalesce(nullif(btrim(coalesce(p_reason_code, '')), ''), 'POSITION_CHANGE'),
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Cambio de puesto'),
        p_effective_date, p_notes, 'POSITION_CHANGE', v_new_assignment_id, v_history_id,
        'CONTRACT_VARIATION_ADDENDUM', p_signature_date, p_signature_place,
        p_representative_assignment_id, p_require_formalized, null,
        (v_preview->>'total_before')::numeric, (v_preview->>'total_after')::numeric, v_contract_id
      );
    END IF;
  END IF;

  PERFORM public.create_payroll_movement(
    p_worker_id, 'REUBICACION', p_effective_date,
    v_current.position_id, p_new_position_id, v_new_assignment_id, v_new_assignment_id,
    v_old_amount, v_old_seq, v_amount, null
  );

  RETURN jsonb_build_object(
    'previous_assignment_id', v_current.id,
    'new_assignment_id', v_new_assignment_id,
    'effective_date', p_effective_date,
    'scheduled_future', v_is_future,
    'employment_contract_id', v_contract_id,
    'salary_history_id', v_history_id,
    'changes', v_changes,
    'has_contractual_changes', jsonb_array_length(v_changes) > 0,
    'is_principal_specialist', v_is_principal,
    'resolution_id', v_resolution_id,
    'addendum_skipped', v_skipped,
    'addendum', v_addendum
  );
END;
$function$;

-- B3.4: `public.change_worker_contract` con soporte de fecha efectiva futura
CREATE OR REPLACE FUNCTION public.change_worker_contract(
  p_worker_id uuid,
  p_new_contract_type_id uuid,
  p_effective_date date,
  p_new_end_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_representative_assignment_id uuid DEFAULT NULL,
  p_signature_date date DEFAULT NULL,
  p_signature_place text DEFAULT NULL,
  p_payment_method_id uuid DEFAULT NULL,
  p_compensation_components jsonb DEFAULT NULL,
  p_payment_schedule_text text DEFAULT NULL,
  p_target_contract_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
  v_is_future boolean := false;
  v_worker public.workers%ROWTYPE;
  v_current public.employment_contracts%ROWTYPE;
  v_type public.employment_contract_types%ROWTYPE;
  v_assignment_id uuid;
  v_new_contract_id uuid;
  v_conditions jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'La fecha efectiva es obligatoria';
  END IF;

  IF p_new_contract_type_id IS NULL THEN
    RAISE EXCEPTION 'El nuevo tipo de contrato es obligatorio';
  END IF;

  v_is_future := (p_effective_date > v_today);

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;

  IF v_worker.employment_status <> 'active' THEN
    RAISE EXCEPTION 'El trabajador no está activo';
  END IF;

  SELECT * INTO v_type FROM public.employment_contract_types
  WHERE id = p_new_contract_type_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
  END IF;

  SELECT * INTO v_current FROM public.employment_contracts
  WHERE id = public.resolve_worker_target_contract(p_worker_id, p_target_contract_id)
  FOR UPDATE;

  IF p_effective_date <= v_current.start_date THEN
    RAISE EXCEPTION 'La fecha efectiva debe ser posterior al inicio del contrato vigente';
  END IF;

  IF v_type.code = 'DETERMINADO' AND p_new_end_date IS NULL THEN
    RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de finalización';
  END IF;

  IF p_new_end_date IS NOT NULL AND p_new_end_date <= p_effective_date THEN
    RAISE EXCEPTION 'La fecha de finalización debe ser posterior a la fecha efectiva';
  END IF;

  v_assignment_id := v_current.assignment_id;

  IF v_is_future THEN
    -- Si la fecha efectiva es futura, el contrato actual sigue vigente hoy (`is_current = true`)
    -- con `actual_end_date = p_effective_date - 1`, y el nuevo queda programado (`is_current = false`).
    UPDATE public.employment_contracts
    SET is_current = true,
        actual_end_date = p_effective_date - 1,
        updated_at = now()
    WHERE id = v_current.id;

    INSERT INTO public.employment_contracts (
      company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
      start_date, end_date, actual_end_date, is_current
    ) VALUES (
      v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment_id,
      p_new_contract_type_id, p_effective_date,
      CASE WHEN v_type.code = 'DETERMINADO' THEN p_new_end_date ELSE NULL END,
      NULL, false
    ) RETURNING id INTO v_new_contract_id;
  ELSE
    UPDATE public.employment_contracts
    SET is_current = false,
        actual_end_date = p_effective_date - 1,
        updated_at = now()
    WHERE id = v_current.id;

    INSERT INTO public.employment_contracts (
      company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
      start_date, end_date, actual_end_date, is_current
    ) VALUES (
      v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment_id,
      p_new_contract_type_id, p_effective_date,
      CASE WHEN v_type.code = 'DETERMINADO' THEN p_new_end_date ELSE NULL END,
      NULL, true
    ) RETURNING id INTO v_new_contract_id;
  END IF;

  PERFORM public.capture_contract_salary_snapshot(v_new_contract_id, 'CONTRACT_CHANGE', p_effective_date, p_notes);
  PERFORM public.capture_contract_party_snapshot(
    v_new_contract_id, p_representative_assignment_id, coalesce(p_signature_date, p_effective_date)
  );

  v_conditions := public.apply_contract_conditions(
    v_new_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
    p_compensation_components, p_representative_assignment_id,
    COALESCE(nullif(btrim(coalesce(p_payment_schedule_text, '')), ''), v_current.payment_schedule_text)
  );

  INSERT INTO public.worker_employment_movements (
    worker_id, movement_type, previous_contract_id, new_contract_id,
    effective_date, reason, notes, created_by
  ) VALUES (
    p_worker_id, 'CAMBIO_CONTRATO', v_current.id, v_new_contract_id,
    p_effective_date, v_type.name,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  );

  RETURN jsonb_build_object(
    'previous_contract_id', v_current.id,
    'new_contract_id', v_new_contract_id,
    'effective_date', p_effective_date,
    'scheduled_future', v_is_future,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
END;
$function$;

-- B3.2, B4 y C4: Ampliar `public.apply_due_scheduled_separations` para que el job diario
-- también active las asignaciones de puesto y contratos programados cuya fecha efectiva
-- ya llegó (`start_date <= public.cuba_current_date()`).
CREATE OR REPLACE FUNCTION public.apply_due_scheduled_separations(
  p_entity_id uuid DEFAULT NULL::uuid,
  p_worker_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
  v_is_system_call boolean := (
    auth.uid() IS NULL
    AND current_user IN ('postgres', 'supabase_admin', 'service_role')
  );
  v_row record;
  v_asg record;
  v_ctr record;
  v_reason_name text;
  v_remaining integer;
  v_applied integer := 0;
BEGIN
  IF auth.uid() IS NULL AND NOT v_is_system_call THEN
    RETURN 0;
  END IF;

  -- 1. Activar cambios de puesto programados cuya fecha de inicio ya llegó (`start_date <= v_today`)
  FOR v_asg IN
    SELECT wem.id AS movement_id,
           wem.worker_id,
           wem.previous_assignment_id,
           wem.new_assignment_id,
           a_new.start_date,
           w.organization_entity_id
    FROM public.worker_employment_movements wem
    JOIN public.worker_position_assignments a_new ON a_new.id = wem.new_assignment_id
    JOIN public.workers w ON w.id = wem.worker_id
    WHERE wem.movement_type = 'CAMBIO_PUESTO'
      AND a_new.is_current = false
      AND a_new.start_date <= v_today
      AND (a_new.end_date IS NULL OR a_new.end_date >= v_today)
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(w.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY a_new.start_date ASC
  LOOP
    IF v_asg.previous_assignment_id IS NOT NULL THEN
      UPDATE public.worker_position_assignments
      SET is_current = false,
          end_date = COALESCE(end_date, v_asg.start_date - 1),
          updated_at = now()
      WHERE id = v_asg.previous_assignment_id;

      UPDATE public.employment_contracts
      SET assignment_id = v_asg.new_assignment_id,
          updated_at = now()
      WHERE assignment_id = v_asg.previous_assignment_id
        AND is_current = true;

      UPDATE public.worker_vacations
      SET assignment_id = v_asg.new_assignment_id,
          updated_at = now()
      WHERE worker_id = v_asg.worker_id
        AND assignment_id = v_asg.previous_assignment_id;

      UPDATE public.worker_vacation_movements
      SET assignment_id = v_asg.new_assignment_id
      WHERE worker_id = v_asg.worker_id
        AND assignment_id = v_asg.previous_assignment_id;
    END IF;

    UPDATE public.worker_position_assignments
    SET is_current = true,
        updated_at = now()
    WHERE id = v_asg.new_assignment_id;

    v_applied := v_applied + 1;
  END LOOP;

  -- 2. Activar cambios de contrato programados cuya fecha de inicio ya llegó (`start_date <= v_today`)
  FOR v_ctr IN
    SELECT wem.id AS movement_id,
           wem.worker_id,
           wem.previous_contract_id,
           wem.new_contract_id,
           c_new.start_date,
           w.organization_entity_id
    FROM public.worker_employment_movements wem
    JOIN public.employment_contracts c_new ON c_new.id = wem.new_contract_id
    JOIN public.workers w ON w.id = wem.worker_id
    WHERE wem.movement_type = 'CAMBIO_CONTRATO'
      AND c_new.is_current = false
      AND c_new.start_date <= v_today
      AND (c_new.actual_end_date IS NULL OR c_new.actual_end_date >= v_today)
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(w.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY c_new.start_date ASC
  LOOP
    IF v_ctr.previous_contract_id IS NOT NULL THEN
      UPDATE public.employment_contracts
      SET is_current = false,
          actual_end_date = COALESCE(actual_end_date, v_ctr.start_date - 1),
          updated_at = now()
      WHERE id = v_ctr.previous_contract_id;
    END IF;

    UPDATE public.employment_contracts
    SET is_current = true,
        updated_at = now()
    WHERE id = v_ctr.new_contract_id;

    v_applied := v_applied + 1;
  END LOOP;

  -- 3. Aplicar bajas diferidas cuya fecha efectiva ya llegó (`scheduled_separation_date <= v_today`)
  FOR v_row IN
    SELECT a.id AS assignment_id,
           a.worker_id,
           a.position_id,
           a.scheduled_separation_date AS eff_date,
           a.scheduled_separation_reason_id AS reason_id,
           a.scheduled_separation_notes AS notes,
           w.organization_entity_id
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    WHERE a.is_current = true
      AND (a.end_date IS NULL OR a.end_date >= v_today)
      AND a.scheduled_separation_date IS NOT NULL
      AND a.scheduled_separation_date <= v_today
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(w.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY a.scheduled_separation_date ASC
    FOR UPDATE OF a
  LOOP
    SELECT name INTO v_reason_name
    FROM public.worker_separation_reasons
    WHERE id = v_row.reason_id;

    UPDATE public.worker_position_assignments
    SET end_date = v_row.eff_date,
        is_current = false,
        scheduled_separation_date = NULL,
        scheduled_separation_reason_id = NULL,
        scheduled_separation_notes = NULL,
        updated_at = now()
    WHERE id = v_row.assignment_id;

    UPDATE public.employment_contracts
    SET is_current = false,
        actual_end_date = v_row.eff_date,
        updated_at = now()
    WHERE assignment_id = v_row.assignment_id AND is_current = true;

    SELECT count(*) INTO v_remaining
    FROM public.worker_position_assignments a2
    WHERE a2.worker_id = v_row.worker_id
      AND a2.is_current = true
      AND (a2.end_date IS NULL OR a2.end_date >= v_today)
      AND a2.id <> v_row.assignment_id;

    IF v_remaining = 0 THEN
      UPDATE public.workers
      SET employment_status = 'inactive', updated_at = now()
      WHERE id = v_row.worker_id;

      UPDATE public.sst_onboarding_notifications
      SET status = 'DESCARTADA'
      WHERE worker_id = v_row.worker_id
        AND status IN ('PENDIENTE', 'EN_PROCESO');

      UPDATE public.training_initial_notifications
      SET status = 'DESCARTADA'
      WHERE worker_id = v_row.worker_id
        AND status = 'PENDIENTE';
    END IF;

    INSERT INTO public.worker_employment_movements (
      worker_id, movement_type, previous_assignment_id, new_assignment_id,
      effective_date, reason, notes, separation_reason_id, created_by
    ) VALUES (
      v_row.worker_id, 'BAJA', v_row.assignment_id, NULL,
      v_row.eff_date, v_reason_name, v_row.notes, v_row.reason_id, auth.uid()
    );

    PERFORM public.create_payroll_movement(
      v_row.worker_id, 'BAJA', v_row.eff_date,
      v_row.position_id, NULL, v_row.assignment_id, v_row.assignment_id
    );

    v_applied := v_applied + 1;
  END LOOP;

  RETURN v_applied;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_due_scheduled_separations(uuid, uuid)
  TO authenticated, service_role;

-- B3.5 y B4 en Vacaciones (`entity_vacation_overview`):
--   - Excluir trabajadores cuya fecha de incorporación (`hire_date`) es posterior a hoy (`cuba_current_date()`).
--   - Resolver la asignación vigente hoy con `a2.start_date <= v_today AND (a2.end_date IS NULL OR a2.end_date >= v_today)`.
CREATE OR REPLACE FUNCTION public.entity_vacation_overview(p_entity_id uuid)
RETURNS TABLE(
  worker_id uuid,
  assignment_id uuid,
  full_name text,
  area_name text,
  job_name text,
  position_name text,
  balance numeric,
  next_accrual numeric,
  projected_balance numeric,
  status text,
  scheduled_future_days numeric,
  current_vacation_end date,
  next_vacation_start date,
  has_schedule boolean,
  active_vacation boolean,
  reconciliation_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
  w record;
  a record;
  s jsonb;
  v_weekdays integer[];
  v_has_assignment boolean;
  v_reconciliation boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT (
    public.can_access_entity(p_entity_id, 'vacations.view')
    OR public.can_access_entity(p_entity_id, 'vacations.manage')
  ) THEN
    RAISE EXCEPTION 'Permission denied: vacations.view is required in this entity';
  END IF;

  FOR w IN
    SELECT wk.*
    FROM public.workers wk
    WHERE wk.organization_entity_id = p_entity_id
      AND wk.employment_status = 'active'
      AND (wk.hire_date IS NULL OR wk.hire_date <= v_today)
    ORDER BY wk.first_surname, wk.first_name
  LOOP
    v_has_assignment := false;
    FOR a IN
      SELECT a2.id AS assignment_id, a2.position_id AS position_id
      FROM public.worker_position_assignments a2
      WHERE a2.worker_id = w.id
        AND a2.is_current = true
        AND a2.start_date <= v_today
        AND (a2.end_date IS NULL OR a2.end_date >= v_today)
      ORDER BY a2.start_date
    LOOP
      v_has_assignment := true;
      PERFORM public.run_worker_vacation_catchup(w.id, a.assignment_id);
      s := public.worker_vacation_summary(w.id, a.assignment_id);

      worker_id := w.id;
      assignment_id := a.assignment_id;
      full_name := btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, ''));

      SELECT ar.name INTO area_name
      FROM public.organization_positions p
      JOIN public.organization_jobs j ON j.id = p.job_id
      JOIN public.organization_areas ar ON ar.id = j.area_id
      WHERE p.id = a.position_id;

      SELECT j.name INTO job_name
      FROM public.organization_positions p
      JOIN public.organization_jobs j ON j.id = p.job_id
      WHERE p.id = a.position_id;

      SELECT p.name INTO position_name
      FROM public.organization_positions p WHERE p.id = a.position_id;

      balance := (s->>'balance')::numeric;
      next_accrual := (s->>'next_accrual')::numeric;
      projected_balance := (s->>'projected_balance')::numeric;
      status := s->>'status';
      scheduled_future_days := (s->>'scheduled_future_days')::numeric;
      current_vacation_end := (s->>'current_vacation_end')::date;
      next_vacation_start := (s->>'next_vacation_start')::date;
      v_weekdays := public.worker_vacation_weekdays_on(w.id, v_today, a.assignment_id);
      has_schedule := v_weekdays IS NOT NULL AND coalesce(array_length(v_weekdays, 1), 0) > 0;
      active_vacation := current_vacation_end IS NOT NULL;
      v_reconciliation := coalesce((s->>'reconciliation_required')::boolean, false);
      reconciliation_required := v_reconciliation;

      RETURN NEXT;
    END LOOP;

    IF NOT v_has_assignment THEN
      PERFORM public.run_worker_vacation_catchup(w.id, NULL);
      s := public.worker_vacation_summary(w.id, NULL);

      worker_id := w.id;
      assignment_id := NULL;
      full_name := btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, ''));
      area_name := NULL; job_name := NULL; position_name := NULL;
      balance := (s->>'balance')::numeric;
      next_accrual := (s->>'next_accrual')::numeric;
      projected_balance := (s->>'projected_balance')::numeric;
      status := s->>'status';
      scheduled_future_days := (s->>'scheduled_future_days')::numeric;
      current_vacation_end := (s->>'current_vacation_end')::date;
      next_vacation_start := (s->>'next_vacation_start')::date;
      v_weekdays := public.worker_vacation_weekdays_on(w.id, v_today, NULL);
      has_schedule := v_weekdays IS NOT NULL AND coalesce(array_length(v_weekdays, 1), 0) > 0;
      active_vacation := current_vacation_end IS NOT NULL;
      v_reconciliation := coalesce((s->>'reconciliation_required')::boolean, false);
      reconciliation_required := v_reconciliation;

      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- =============================================================================
-- BLOQUE B5. Alertas de vencimiento contractual con salario resuelto en el backend
-- =============================================================================

DROP FUNCTION IF EXISTS public.contract_expiry_alerts(uuid, integer, uuid);

CREATE OR REPLACE FUNCTION public.contract_expiry_alerts(
  target_entity_id uuid,
  horizon_days integer DEFAULT 30,
  target_worker_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  worker_id uuid,
  worker_code text,
  worker_name text,
  identification text,
  area_name text,
  job_name text,
  position_name text,
  position_code text,
  contract_id uuid,
  contract_type_name text,
  contract_type_code text,
  contract_start_date date,
  contract_end_date date,
  salary_group_id uuid,
  salary_scale_id uuid,
  salary_group_sequence_number integer,
  days_remaining integer,
  alert_state text,
  assignment_id uuid,
  resolved_salary_amount numeric,
  resolved_salary_currency text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT (public.can_access_entity(target_entity_id, 'contract_alerts.view')
          OR public.can_access_entity(target_entity_id, 'workers.view')
          OR public.can_access_entity(target_entity_id, 'workers.manage')
          OR public.can_access_entity(target_entity_id, 'contracts.view')
          OR public.can_access_entity(target_entity_id, 'contracts.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar los vencimientos contractuales de esta entidad';
  END IF;

  RETURN QUERY
  WITH horizon AS (
    SELECT GREATEST(COALESCE(horizon_days, 30), 0) AS days
  )
  SELECT
    w.id AS worker_id,
    w.code AS worker_code,
    concat_ws(' ', w.first_name, w.first_surname, w.second_surname) AS worker_name,
    w.identification::text AS identification,
    ar.name AS area_name,
    j.name AS job_name,
    p.name AS position_name,
    NULL::text AS position_code,
    c.id AS contract_id,
    ct.name AS contract_type_name,
    ct.code AS contract_type_code,
    c.start_date AS contract_start_date,
    c.end_date AS contract_end_date,
    COALESCE(sg.id, c.salary_group_id) AS salary_group_id,
    COALESCE(sg.salary_scale_id, c.salary_scale_id) AS salary_scale_id,
    sg.sequence_number AS salary_group_sequence_number,
    (c.end_date - v_today)::integer AS days_remaining,
    CASE
      WHEN c.end_date IS NULL THEN 'NO_END_DATE'
      WHEN c.end_date < v_today THEN 'OVERDUE'
      WHEN c.end_date = v_today THEN 'DUE_TODAY'
      WHEN c.end_date <= v_today + 7 THEN 'DUE_IN_7'
      WHEN c.end_date <= v_today + 15 THEN 'DUE_IN_15'
      WHEN c.end_date <= v_today + 30 THEN 'DUE_IN_30'
      ELSE 'DUE_AFTER_30'
    END AS alert_state,
    COALESCE(a.id, c.assignment_id) AS assignment_id,
    COALESCE(
      sal.amount,
      c.salary_amount
    ) AS resolved_salary_amount,
    COALESCE(
      sal.currency_code,
      c.salary_currency_code,
      'CUP'
    ) AS resolved_salary_currency
  FROM public.employment_contracts c
  JOIN public.employment_contract_types ct ON ct.id = c.contract_type_id
  JOIN public.workers w ON w.id = c.worker_id
  LEFT JOIN LATERAL (
    SELECT a_inner.*
    FROM public.worker_position_assignments a_inner
    WHERE (c.assignment_id IS NOT NULL AND a_inner.id = c.assignment_id)
       OR (c.assignment_id IS NULL AND a_inner.worker_id = w.id AND a_inner.is_current = true)
    ORDER BY
      CASE WHEN a_inner.id = c.assignment_id THEN 0 ELSE 1 END ASC,
      a_inner.start_date DESC
    LIMIT 1
  ) a ON true
  LEFT JOIN public.organization_positions p ON p.id = a.position_id
  LEFT JOIN public.organization_jobs j ON j.id = p.job_id
  LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
  LEFT JOIN public.salary_groups sg ON sg.id = COALESCE(j.salary_group_id, c.salary_group_id)
  LEFT JOIN LATERAL (
    SELECT sgv.amount, sgv.currency_code
    FROM public.salary_group_values sgv
    WHERE sgv.salary_group_id = COALESCE(sg.id, c.salary_group_id)
      AND sgv.is_active = true
      AND sgv.effective_from <= GREATEST(v_today, COALESCE(c.start_date, v_today))
      AND (sgv.effective_to IS NULL OR sgv.effective_to >= v_today)
    ORDER BY sgv.effective_from DESC
    LIMIT 1
  ) sal ON true
  CROSS JOIN horizon h
  WHERE c.is_current = true
    AND (c.actual_end_date IS NULL OR c.actual_end_date >= v_today)
    AND ct.code = 'DETERMINADO'
    AND w.employment_status = 'active'
    AND w.organization_entity_id = target_entity_id
    AND (target_worker_id IS NULL OR w.id = target_worker_id)
    AND (c.end_date IS NULL OR c.end_date <= v_today + h.days)
  ORDER BY c.end_date ASC NULLS LAST, w.first_surname ASC, w.first_name ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.contract_expiry_alerts(uuid, integer, uuid)
  TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.contract_expiry_alerts(uuid, integer, uuid)
  FROM public, anon;

-- =============================================================================
-- BLOQUE B7 y C5. Validaciones de fechas y existencias en SST (backend)
-- =============================================================================

-- B7.1: Accidentes e incidentes laborales: `occurred_at` no puede ser futura
CREATE OR REPLACE FUNCTION public.trg_fn_validate_sst_accident_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.occurred_at IS NOT NULL AND NEW.occurred_at > public.cuba_current_date() THEN
    RAISE EXCEPTION 'La fecha de ocurrencia del accidente o incidente (%) no puede ser futura.',
      to_char(NEW.occurred_at, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_sst_accident_incident ON public.sst_accidents_incidents;
CREATE TRIGGER trg_validate_sst_accident_incident
BEFORE INSERT OR UPDATE ON public.sst_accidents_incidents
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_sst_accident_incident();

-- B7.2: Salud ocupacional: `next_review_date` debe ser posterior a `evaluation_date`
CREATE OR REPLACE FUNCTION public.trg_fn_validate_sst_health_aptitude()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.next_review_date IS NOT NULL
     AND NEW.evaluation_date IS NOT NULL
     AND NEW.next_review_date <= NEW.evaluation_date THEN
    RAISE EXCEPTION 'La fecha del próximo chequeo médico (%) debe ser posterior a la fecha de evaluación (%).',
      to_char(NEW.next_review_date, 'DD/MM/YYYY'),
      to_char(NEW.evaluation_date, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_sst_health_aptitude ON public.sst_worker_health_aptitude;
CREATE TRIGGER trg_validate_sst_health_aptitude
BEFORE INSERT OR UPDATE ON public.sst_worker_health_aptitude
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_sst_health_aptitude();

-- B7.3: Plan de prevención: `due_date` en acciones nuevas no puede ser anterior a hoy
CREATE OR REPLACE FUNCTION public.trg_fn_validate_sst_preventive_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     AND NEW.due_date IS NOT NULL
     AND NEW.due_date < public.cuba_current_date() THEN
    RAISE EXCEPTION 'La fecha límite de una nueva medida preventiva (%) no puede ser anterior a hoy (%).',
      to_char(NEW.due_date, 'DD/MM/YYYY'),
      to_char(public.cuba_current_date(), 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_sst_preventive_action ON public.sst_preventive_actions;
CREATE TRIGGER trg_validate_sst_preventive_action
BEFORE INSERT ON public.sst_preventive_actions
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_sst_preventive_action();

-- B7.4: Planes de emergencia: `last_drill_date` (fecha de simulacro) obligatoria al registrar
CREATE OR REPLACE FUNCTION public.trg_fn_validate_sst_emergency_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.last_drill_date IS NULL THEN
    RAISE EXCEPTION 'La fecha del simulacro es obligatoria para registrar un plan de emergencia.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_sst_emergency_plan ON public.sst_emergency_plans;
CREATE TRIGGER trg_validate_sst_emergency_plan
BEFORE INSERT ON public.sst_emergency_plans
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_sst_emergency_plan();

-- C5: Entrega de EPP sin existencias con mensaje claro de negocio
CREATE OR REPLACE FUNCTION public.trg_fn_validate_sst_epp_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stock integer;
  v_name text;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad de EPP a entregar debe ser mayor que 0.';
  END IF;

  SELECT stock_quantity, name
    INTO v_stock, v_name
  FROM public.sst_epp_catalog
  WHERE id = NEW.epp_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El equipo de protección personal (EPP) seleccionado no existe.';
  END IF;

  IF COALESCE(v_stock, 0) <= 0 THEN
    RAISE EXCEPTION 'No hay existencias de %. Stock disponible: 0', v_name;
  END IF;

  IF NEW.quantity > COALESCE(v_stock, 0) THEN
    RAISE EXCEPTION 'No hay existencias de %. Stock disponible: %', v_name, COALESCE(v_stock, 0);
  END IF;

  UPDATE public.sst_epp_catalog
  SET stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) - NEW.quantity),
      updated_at = now()
  WHERE id = NEW.epp_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_sst_epp_delivery ON public.sst_worker_epp_deliveries;
CREATE TRIGGER trg_validate_sst_epp_delivery
BEFORE INSERT ON public.sst_worker_epp_deliveries
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_sst_epp_delivery();

-- =============================================================================
-- BLOQUE B10. Formato monetario uniforme en `addendum_change_display` (`4,500.00 CUP`)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.addendum_change_display(
  p_field_code text,
  p_raw_value text,
  p_currency text DEFAULT 'CUP'
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := upper(btrim(COALESCE(p_field_code, '')));
  v_val text := btrim(COALESCE(p_raw_value, ''));
  v_curr text := COALESCE(NULLIF(btrim(COALESCE(p_currency, '')), ''), 'CUP');
  v_num numeric;
BEGIN
  IF v_val = '' THEN
    RETURN NULL;
  END IF;

  IF v_code IN (
    'SALARY',
    'ADDITIONAL_PAYMENT',
    'ABNORMAL_CONDITIONS',
    'OTHER_PAYMENT',
    'TOTAL_COMPENSATION'
  ) THEN
    BEGIN
      v_num := v_val::numeric;
      RETURN btrim(to_char(v_num, 'FM999,999,990.00')) || ' ' || v_curr;
    EXCEPTION WHEN OTHERS THEN
      RETURN v_val;
    END;
  END IF;

  IF v_code IN ('DAILY_HOURS', 'WEEKLY_HOURS', 'MONTHLY_HOURS') THEN
    RETURN v_val || ' h';
  END IF;

  RETURN v_val;
END;
$function$;

-- =============================================================================
-- BLOQUE C1. Prorrateo en Prenómina cuando cambia el valor del grupo salarial a mitad de mes
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prenomina_prorated_scale_salary(
  p_salary_group_id uuid,
  p_win_start date,
  p_win_end date,
  p_worked_days numeric,
  OUT eff_scale_amount numeric(12,2),
  OUT prorated_base_earned numeric(12,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_cal_days integer := GREATEST((p_win_end - p_win_start) + 1, 1);
  v_weighted_scale numeric := 0;
  v_seg_count integer := 0;
  v_last_amount numeric(12,2) := NULL;
  rec record;
BEGIN
  eff_scale_amount := 0;
  prorated_base_earned := 0;

  IF p_salary_group_id IS NULL OR p_win_start IS NULL OR p_win_end IS NULL OR p_win_end < p_win_start THEN
    RETURN;
  END IF;

  -- Dividir el intervalo [p_win_start, p_win_end] por los tramos de vigencia de `salary_group_values`
  FOR rec IN
    WITH applicable_values AS (
      SELECT
        sgv.amount,
        GREATEST(sgv.effective_from, p_win_start) AS seg_start,
        LEAST(
          COALESCE(
            sgv.effective_to,
            LEAD(sgv.effective_from - 1) OVER (ORDER BY sgv.effective_from ASC, sgv.created_at ASC),
            p_win_end
          ),
          p_win_end
        ) AS seg_end
      FROM (
        SELECT DISTINCT ON (effective_from)
          id, amount, effective_from, effective_to, created_at
        FROM public.salary_group_values
        WHERE salary_group_id = p_salary_group_id
          AND is_active = true
          AND effective_from <= p_win_end
          AND (effective_to IS NULL OR effective_to >= p_win_start)
        ORDER BY effective_from ASC, created_at DESC
      ) sgv
    )
    SELECT
      amount,
      seg_start,
      seg_end,
      ((seg_end - seg_start) + 1)::integer AS cal_days
    FROM applicable_values
    WHERE seg_end >= seg_start
    ORDER BY seg_start ASC
  LOOP
    v_seg_count := v_seg_count + 1;
    v_last_amount := rec.amount;
    v_weighted_scale := v_weighted_scale + (rec.amount * (rec.cal_days::numeric / v_total_cal_days::numeric));
  END LOOP;

  IF v_seg_count = 0 THEN
    SELECT v.amount INTO v_last_amount
    FROM public.resolve_salary_group_value(p_salary_group_id, p_win_end) v
    LIMIT 1;
    eff_scale_amount := COALESCE(v_last_amount, 0);
    prorated_base_earned := round((eff_scale_amount / 24.0) * COALESCE(p_worked_days, 0), 2);
  ELSIF v_seg_count = 1 THEN
    eff_scale_amount := COALESCE(v_last_amount, 0);
    prorated_base_earned := round((eff_scale_amount / 24.0) * COALESCE(p_worked_days, 0), 2);
  ELSE
    eff_scale_amount := round(v_weighted_scale, 2);
    prorated_base_earned := round((v_weighted_scale / 24.0) * COALESCE(p_worked_days, 0), 2);
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.prenomina_prorated_scale_salary(uuid, date, date, numeric)
  TO authenticated, service_role;

-- Actualizar `public.prenomina_refresh_workers` con prorrateo salarial intrames (C1)
-- y exclusión de trabajadores con `hire_date > v_end` (B4)
CREATE OR REPLACE FUNCTION public.prenomina_refresh_workers(p_period_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_period public.prenomina_periods%ROWTYPE;
  v_start  date;
  v_end    date;
  v_ref    date;
  w        record;
  win      record;
  v_pos    record;
  v_scale_amount numeric(12,2);
  v_base_earned numeric(12,2);
  v_tenure record;
  v_acad   record;
  v_cla_day_rate   numeric(12,2);
  v_cla_night_1    numeric(12,2);
  v_cla_night_2    numeric(12,2);
  v_entry_id       uuid;
  v_count          integer := 0;
  v_seen_ids       uuid[] := ARRAY[]::uuid[];
  v_prop           record;
  v_cur_worked     numeric(6,2);
  v_cur_manual     boolean;
  v_eff_worked     numeric(6,2);
BEGIN
  SELECT * INTO v_period FROM public.prenomina_periods WHERE id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período de prenómina no encontrado'; END IF;
  IF NOT public.can_manage_prenomina(v_period.organization_entity_id) THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar la prenómina de esta entidad';
  END IF;
  IF v_period.status = 'CLOSED' THEN
    RAISE EXCEPTION 'El período está cerrado y no admite cambios';
  END IF;

  v_start := make_date(v_period.year, v_period.month, 1);
  v_end   := (v_start + interval '1 month - 1 day')::date;
  v_ref   := LEAST(public.cuba_current_date(), v_end);

  FOR w IN
    SELECT wk.*
    FROM public.workers wk
    WHERE wk.organization_entity_id = v_period.organization_entity_id
      AND (wk.hire_date IS NULL OR wk.hire_date <= v_end)
      AND (
        wk.employment_status = 'active'
        OR EXISTS (
          SELECT 1 FROM public.worker_position_assignments a
          WHERE a.worker_id = wk.id
            AND a.start_date <= v_end
            AND (a.end_date IS NULL OR a.end_date >= v_start)
        )
      )
    ORDER BY wk.first_surname, wk.first_name
  LOOP
    FOR win IN
      WITH raw_windows AS (
        SELECT
          a.id AS assignment_id,
          a.position_id,
          GREATEST(a.start_date, COALESCE(w.hire_date, a.start_date), v_start) AS eff_start,
          LEAST(COALESCE(a.end_date, v_end), v_end) AS eff_end,
          a.is_current,
          a.start_date
        FROM public.worker_position_assignments a
        WHERE a.worker_id = w.id
          AND a.start_date <= v_end
          AND (a.end_date IS NULL OR a.end_date >= v_start)
      ),
      valid_windows AS (
        SELECT * FROM raw_windows WHERE eff_end >= eff_start
      ),
      fallback_window AS (
        SELECT
          NULL::uuid AS assignment_id,
          NULL::uuid AS position_id,
          GREATEST(COALESCE(w.hire_date, v_start), v_start) AS eff_start,
          v_end AS eff_end,
          true AS is_current,
          COALESCE(w.hire_date, v_start) AS start_date
        WHERE NOT EXISTS (SELECT 1 FROM valid_windows)
          AND w.employment_status = 'active'
          AND (w.hire_date IS NULL OR w.hire_date <= v_end)
      )
      SELECT * FROM valid_windows
      UNION ALL
      SELECT * FROM fallback_window
      ORDER BY eff_start ASC, start_date ASC
    LOOP
      v_pos := NULL;
      v_scale_amount := 0;
      v_base_earned := 0;
      v_cla_day_rate := 0;
      v_cla_night_1  := 0;
      v_cla_night_2  := 0;

      IF win.position_id IS NOT NULL THEN
        SELECT
          p.id AS position_id, p.name AS position_name,
          j.id AS job_id, j.name AS job_name,
          j.has_abnormal_conditions, j.cla_day_enabled, j.cla_day_hourly_rate, j.cla_night_enabled,
          ar.id AS area_id, ar.name AS area_name,
          sg.id AS salary_group_id, sg.sequence_number AS group_seq,
          sc.id AS salary_scale_id
        INTO v_pos
        FROM public.organization_positions p
        JOIN public.organization_jobs j ON j.id = p.job_id
        LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
        LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
        LEFT JOIN public.salary_scales sc ON sc.id = sg.salary_scale_id
        WHERE p.id = win.position_id;

        IF v_pos.job_id IS NOT NULL AND COALESCE(v_pos.has_abnormal_conditions, false) THEN
          IF COALESCE(v_pos.cla_day_enabled, false) THEN
            v_cla_day_rate := COALESCE(v_pos.cla_day_hourly_rate, 0);
          END IF;
          IF COALESCE(v_pos.cla_night_enabled, false) THEN
            SELECT COALESCE(MAX(CASE WHEN segment_order = 1 THEN hourly_rate END), 0),
                   COALESCE(MAX(CASE WHEN segment_order = 2 THEN hourly_rate END), 0)
            INTO v_cla_night_1, v_cla_night_2
            FROM public.job_cla_night_segments
            WHERE job_id = v_pos.job_id;
          END IF;
        END IF;
      END IF;

      SELECT * INTO v_tenure
      FROM public.resolve_tenure_payment_for_worker(v_period.organization_entity_id, w.id, LEAST(v_ref, win.eff_end))
      LIMIT 1;

      SELECT * INTO v_acad
      FROM public.resolve_academic_category_payment_for_worker(v_period.organization_entity_id, w.id)
      LIMIT 1;

      SELECT * INTO v_prop
      FROM public.prenomina_calculate_window_days(
        w.id,
        win.position_id,
        v_period.year,
        v_period.month,
        win.eff_start,
        win.eff_end,
        win.assignment_id
      );

      SELECT id, worked_days, worked_days_manual
      INTO v_entry_id, v_cur_worked, v_cur_manual
      FROM public.prenomina_worker_entries
      WHERE period_id = p_period_id
        AND worker_id = w.id
        AND (
          (win.assignment_id IS NOT NULL AND assignment_id = win.assignment_id)
          OR (win.assignment_id IS NULL AND assignment_id IS NULL)
        )
      LIMIT 1;

      IF v_entry_id IS NOT NULL AND COALESCE(v_cur_manual, false) THEN
        v_eff_worked := LEAST(COALESCE(v_cur_worked, 0), v_prop.max_Workable_Days);
      ELSE
        v_eff_worked := COALESCE(v_prop.proposed_worked_days, 0);
      END IF;

      -- C1: Calcular salario de escala y salario básico devengado prorrateando cambios intrames
      IF v_pos.salary_group_id IS NOT NULL THEN
        SELECT p.eff_scale_amount, p.prorated_base_earned
        INTO v_scale_amount, v_base_earned
        FROM public.prenomina_prorated_scale_salary(
          v_pos.salary_group_id,
          win.eff_start,
          win.eff_end,
          v_eff_worked
        ) p;
      END IF;

      IF v_entry_id IS NULL THEN
        INSERT INTO public.prenomina_worker_entries (
          company_client_id, organization_entity_id, period_id, worker_id,
          worker_code_snapshot, worker_name_snapshot, identification_snapshot,
          area_id_snapshot, area_name_snapshot,
          job_id_snapshot, job_name_snapshot,
          position_id_snapshot, position_name_snapshot,
          assignment_id, window_start_date, window_end_date,
          salary_group_id_snapshot, salary_group_seq_snapshot, salary_scale_amount,
          worked_days, worked_days_manual,
          proposed_worked_days, max_workable_days,
          vacation_Return_Days_Month, vacation_Absent_Days_Month,
          medical_Absent_Days_Month, unpaid_Absent_Days_Month,
          schedule_configured, calculation_notes,
          base_earned,
          tenure_years_snapshot, tenure_months_snapshot, tenure_description_snapshot, tenure_amount,
          academic_category_snapshot, academic_amount,
          cla_day_rate_snapshot, cla_night_seg1_rate_snapshot, cla_night_seg2_rate_snapshot,
          total_devengado
        ) VALUES (
          v_period.company_client_id, v_period.organization_entity_id, p_period_id, w.id,
          w.code,
          btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, '')),
          w.identification,
          v_pos.area_id, v_pos.area_name,
          v_pos.job_id, v_pos.job_name,
          v_pos.position_id, v_pos.position_name,
          win.assignment_id, win.eff_start, win.eff_end,
          v_pos.salary_group_id, v_pos.group_seq, COALESCE(v_scale_amount, 0),
          v_eff_worked, false,
          COALESCE(v_prop.proposed_worked_days, 0), COALESCE(v_prop.max_workable_days, 0),
          COALESCE(v_prop.vacation_return_days, 0), COALESCE(v_prop.vacation_absent_days, 0),
          COALESCE(v_prop.medical_absent_days, 0), COALESCE(v_prop.unpaid_absent_days, 0),
          COALESCE(v_prop.schedule_configured, false), v_prop.calculation_notes,
          COALESCE(v_base_earned, 0),
          v_tenure.years, v_tenure.months, v_tenure.human_description, COALESCE(v_tenure.amount, 0),
          v_acad.category, COALESCE(v_acad.amount, 0),
          v_cla_day_rate, v_cla_night_1, v_cla_night_2,
          COALESCE(v_base_earned, 0) + COALESCE(v_tenure.amount, 0) + COALESCE(v_acad.amount, 0)
        )
        RETURNING id INTO v_entry_id;
      ELSE
        UPDATE public.prenomina_worker_entries e
        SET worker_code_snapshot         = w.code,
            worker_name_snapshot         = btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, '')),
            identification_snapshot      = w.identification,
            area_id_snapshot             = v_pos.area_id,
            area_name_snapshot           = v_pos.area_name,
            job_id_snapshot              = v_pos.job_id,
            job_name_snapshot            = v_pos.job_name,
            position_id_snapshot         = v_pos.position_id,
            position_name_snapshot       = v_pos.position_name,
            assignment_id                = win.assignment_id,
            window_start_date            = win.eff_start,
            window_end_date              = win.eff_end,
            salary_group_id_snapshot     = v_pos.salary_group_id,
            salary_group_seq_snapshot    = v_pos.group_seq,
            salary_scale_amount          = COALESCE(v_scale_amount, 0),
            worked_days                  = v_eff_worked,
            proposed_worked_days         = COALESCE(v_prop.proposed_worked_days, 0),
            max_workable_days            = COALESCE(v_prop.max_workable_days, 0),
            vacation_return_days_month   = COALESCE(v_prop.vacation_return_days, 0),
            vacation_absent_days_month   = COALESCE(v_prop.vacation_absent_days, 0),
            medical_absent_days_month    = COALESCE(v_prop.medical_absent_days, 0),
            unpaid_absent_days_month     = COALESCE(v_prop.unpaid_absent_days, 0),
            schedule_configured          = COALESCE(v_prop.schedule_configured, false),
            calculation_notes            = v_prop.calculation_notes,
            base_earned                  = COALESCE(v_base_earned, 0),
            tenure_years_snapshot        = v_tenure.years,
            tenure_months_snapshot       = v_tenure.months,
            tenure_description_snapshot  = v_tenure.human_description,
            tenure_amount                = COALESCE(v_tenure.amount, 0),
            academic_category_snapshot   = v_acad.category,
            academic_amount              = COALESCE(v_acad.amount, 0),
            cla_day_rate_snapshot        = v_cla_day_rate,
            cla_night_seg1_rate_snapshot = v_cla_night_1,
            cla_night_seg2_rate_snapshot = v_cla_night_2,
            cla_day_amount               = round(e.cla_day_hours * v_cla_day_rate, 2),
            cla_night_seg1_amount        = round(e.cla_night_seg1_hours * v_cla_night_1, 2),
            cla_night_seg2_amount        = round(e.cla_night_seg2_hours * v_cla_night_2, 2),
            updated_at                   = now()
        WHERE e.id = v_entry_id;

        PERFORM public.prenomina_recalc_entry(v_entry_id);
      END IF;

      v_seen_ids := array_append(v_seen_ids, v_entry_id);
      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  DELETE FROM public.prenomina_worker_entries
  WHERE period_id = p_period_id
    AND NOT (id = ANY(v_seen_ids));

  RETURN v_count;
END;
$function$;

-- Actualizar `public.prenomina_recalc_entry` para respetar el prorrateo intrames (C1)
CREATE OR REPLACE FUNCTION public.prenomina_recalc_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  e public.prenomina_worker_entries%ROWTYPE;
  v_scale_amount numeric(12,2);
  v_base numeric(12,2);
  v_cla_day numeric(12,2);
  v_cla_n1 numeric(12,2);
  v_cla_n2 numeric(12,2);
  v_other numeric(12,2);
  v_total numeric(12,2);
BEGIN
  SELECT * INTO e FROM public.prenomina_worker_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF e.salary_group_id_snapshot IS NOT NULL AND e.window_start_date IS NOT NULL AND e.window_end_date IS NOT NULL THEN
    SELECT p.eff_scale_amount, p.prorated_base_earned
    INTO v_scale_amount, v_base
    FROM public.prenomina_prorated_scale_salary(
      e.salary_group_id_snapshot,
      e.window_start_date,
      e.window_end_date,
      e.worked_days
    ) p;
    v_scale_amount := COALESCE(v_scale_amount, e.salary_scale_amount);
    v_base := COALESCE(v_base, round((e.salary_scale_amount / 24.0) * e.worked_days, 2));
  ELSE
    v_scale_amount := e.salary_scale_amount;
    v_base := round((e.salary_scale_amount / 24.0) * e.worked_days, 2);
  END IF;

  v_cla_day := round(e.cla_day_hours * e.cla_day_rate_snapshot, 2);
  v_cla_n1  := round(e.cla_night_seg1_hours * e.cla_night_seg1_rate_snapshot, 2);
  v_cla_n2  := round(e.cla_night_seg2_hours * e.cla_night_seg2_rate_snapshot, 2);

  SELECT COALESCE(SUM(amount), 0) INTO v_other
  FROM public.prenomina_entry_payments
  WHERE entry_id = p_entry_id;

  v_total := v_base
           + COALESCE(e.tenure_amount, 0)
           + COALESCE(e.academic_amount, 0)
           + v_cla_day + v_cla_n1 + v_cla_n2
           + COALESCE(e.vacation_payment_amount, 0)
           + v_other;

  UPDATE public.prenomina_worker_entries
  SET salary_scale_amount   = v_scale_amount,
      base_earned           = v_base,
      cla_day_amount        = v_cla_day,
      cla_night_seg1_amount = v_cla_n1,
      cla_night_seg2_amount = v_cla_n2,
      other_payments_total  = v_other,
      total_devengado       = v_total,
      updated_at            = now()
  WHERE id = p_entry_id;
END;
$function$;

-- =============================================================================
-- BLOQUE C7. Tabla `public.candidate_pool_metadata` en reemplazo de `localStorage`
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.candidate_pool_metadata (
  candidate_id uuid PRIMARY KEY REFERENCES public.candidates(id) ON DELETE CASCADE,
  company_client_id uuid REFERENCES public.company_clients(id) ON DELETE CASCADE,
  organization_entity_id uuid REFERENCES public.organization_entities(id) ON DELETE SET NULL,
  area_id uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  entity_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS candidate_pool_metadata_tenant_idx
  ON public.candidate_pool_metadata (company_client_id);

ALTER TABLE public.candidate_pool_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS candidate_pool_metadata_select_policy ON public.candidate_pool_metadata;
CREATE POLICY candidate_pool_metadata_select_policy
  ON public.candidate_pool_metadata
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.candidates c
      WHERE c.id = candidate_pool_metadata.candidate_id
    )
  );

DROP POLICY IF EXISTS candidate_pool_metadata_modify_policy ON public.candidate_pool_metadata;
CREATE POLICY candidate_pool_metadata_modify_policy
  ON public.candidate_pool_metadata
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.candidates c
      WHERE c.id = candidate_pool_metadata.candidate_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.candidates c
      WHERE c.id = candidate_pool_metadata.candidate_id
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_pool_metadata
  TO authenticated, service_role;

-- Backfill inicial desde `candidates` y `candidate_additional_info`
INSERT INTO public.candidate_pool_metadata (
  candidate_id,
  company_client_id,
  organization_entity_id,
  entity_ids,
  updated_at
)
SELECT
  c.id,
  c.company_client_id,
  c.organization_entity_id,
  CASE
    WHEN c.organization_entity_id IS NOT NULL THEN ARRAY[c.organization_entity_id]
    ELSE '{}'::uuid[]
  END,
  now()
FROM public.candidates c
ON CONFLICT (candidate_id) DO NOTHING;

-- =============================================================================
-- BLOQUE A.4 y C4. Programación y verificación explícita de `pg_cron` (sin ocultar errores)
-- =============================================================================
-- NOTA PARA PRODUCCIÓN (Supabase Dashboard):
--   1. Si la extensión `pg_cron` está habilitada en Database -> Extensions, los dos
--      jobs (`apply-due-scheduled-separations-daily` y `process-document-jobs-every-minute`)
--      quedan registrados en `cron.job`.
--   2. Para que `process-document-jobs` (Edge Function que renderiza .docx/.xlsx y sube
--      a Storage) se dispare automáticamente desde PostgreSQL, habilita `pg_net` en
--      Database -> Extensions y configura desde SQL Editor:
--        ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<project-ref>.supabase.co';
--        ALTER DATABASE postgres SET app.settings.service_role_key = '<service-role-key>';
--      O bien configura un Cron de Supabase Edge Functions (Dashboard -> Edge Functions ->
--      Schedules) apuntando a `process-document-jobs` (`* * * * *`) y
--      `apply-due-scheduled-separations` (`5 5 * * *`).
-- =============================================================================

DO $$
DECLARE
  v_has_cron boolean;
  v_has_net boolean;
  v_job_names text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') INTO v_has_net;

  IF v_has_cron THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apply-due-scheduled-separations-daily') THEN
      PERFORM cron.unschedule('apply-due-scheduled-separations-daily');
    END IF;
    PERFORM cron.schedule(
      'apply-due-scheduled-separations-daily',
      '5 5 * * *',
      $cron$SELECT public.apply_due_scheduled_separations();$cron$
    );

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-document-jobs-every-minute') THEN
      PERFORM cron.unschedule('process-document-jobs-every-minute');
    END IF;
    PERFORM cron.schedule(
      'process-document-jobs-every-minute',
      '* * * * *',
      $cron$SELECT public.notify_process_document_jobs(NULL);$cron$
    );

    SELECT string_agg(jobname || ' (' || schedule || ')', ', ' ORDER BY jobname)
      INTO v_job_names
    FROM cron.job;

    RAISE NOTICE '[QA-Round4 C4] pg_cron ACTIVO. Jobs registrados en cron.job: % (pg_net=%).',
      COALESCE(v_job_names, 'ninguno'),
      v_has_net;
  ELSE
    RAISE NOTICE '[QA-Round4 C4] La extensión pg_cron NO está instalada en esta instancia. Habilítala en Supabase Dashboard (Database -> Extensions -> pg_cron) o programa las Edge Functions apply-due-scheduled-separations (5 5 * * *) y process-document-jobs (* * * * *).';
  END IF;
END $$;

-- =============================================================================
-- BLOQUE DE COMPROBACIÓN FINAL (RAISE EXCEPTION si falta algún artefacto crítico)
-- =============================================================================

DO $$
DECLARE
  v_fmt text;
BEGIN
  -- 1. Verificar tabla `public.document_generation_jobs`
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'document_generation_jobs'
  ) THEN
    RAISE EXCEPTION 'Fallo de verificación QA Round 4: no existe public.document_generation_jobs';
  END IF;

  -- 2. Verificar columna `trigger_type` en `public.training_initial_notifications`
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'training_initial_notifications'
      AND column_name = 'trigger_type'
  ) THEN
    RAISE EXCEPTION 'Fallo de verificación QA Round 4: falta columna trigger_type en public.training_initial_notifications';
  END IF;

  -- 3. Verificar tabla `public.candidate_pool_metadata`
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'candidate_pool_metadata'
  ) THEN
    RAISE EXCEPTION 'Fallo de verificación QA Round 4: no existe public.candidate_pool_metadata';
  END IF;

  -- 4. Verificar formato monetario de `public.addendum_change_display`
  v_fmt := public.addendum_change_display('SALARY', '4500', 'CUP');
  IF v_fmt <> '4,500.00 CUP' THEN
    RAISE EXCEPTION 'Fallo de verificación QA Round 4: addendum_change_display devolvió % en vez de 4,500.00 CUP', v_fmt;
  END IF;

  -- 5. Verificar triggers de SST
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_sst_accident_incident'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_sst_health_aptitude'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_sst_preventive_action'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_sst_emergency_plan'
  ) THEN
    RAISE EXCEPTION 'Fallo de verificación QA Round 4: faltan triggers de validación en SST';
  END IF;
END $$;

COMMIT;
