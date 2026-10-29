-- ============================================================================
-- SiteCorp · Módulo de SEGURIDAD Y SALUD EN EL TRABAJO (SST) por Entidad
-- ============================================================================
-- Sincronizado con `src/db/migrations/20261106_01_entity_sst_module.sql`
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.company_client_permissions') IS NOT NULL THEN
    INSERT INTO public.company_client_permissions (code, description)
    VALUES
      ('sst.view',   'Consultar módulo de Seguridad y Salud en el Trabajo (SST) de la entidad'),
      ('sst.manage', 'Gestionar capacitaciones SST, riesgos, EPP, inspecciones y medidas preventivas de la entidad')
    ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
  ELSIF to_regclass('public.tenant_permissions') IS NOT NULL THEN
    INSERT INTO public.tenant_permissions (code, description)
    VALUES
      ('sst.view',   'Consultar módulo de Seguridad y Salud en el Trabajo (SST) de la entidad'),
      ('sst.manage', 'Gestionar capacitaciones SST, riesgos, EPP, inspecciones y medidas preventivas de la entidad')
    ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.can_view_entity_sst(p_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.can_access_entity(p_entity_id, 'sst.view')
      OR public.can_access_entity(p_entity_id, 'sst.manage')
      OR public.can_access_entity(p_entity_id, 'training.view')
      OR public.can_access_entity(p_entity_id, 'training.manage')
      OR public.can_access_entity(p_entity_id, 'workers.view')
      OR public.can_access_entity(p_entity_id, 'workers.manage');
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_entity_sst(p_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.can_access_entity(p_entity_id, 'sst.manage')
      OR public.can_access_entity(p_entity_id, 'training.manage')
      OR public.can_access_entity(p_entity_id, 'workers.manage');
$function$;

REVOKE ALL ON FUNCTION public.can_view_entity_sst(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_entity_sst(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_manage_entity_sst(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_entity_sst(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.sst_job_folders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  job_id                 uuid NOT NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
  job_name_snapshot      text NOT NULL,
  area_id_snapshot       uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot     text,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_job_folders_entity_job_unique UNIQUE (organization_entity_id, job_id)
);

CREATE INDEX IF NOT EXISTS sst_job_folders_entity_idx
  ON public.sst_job_folders (organization_entity_id, created_at);

CREATE TABLE IF NOT EXISTS public.sst_training_topics (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  folder_id              uuid NOT NULL REFERENCES public.sst_job_folders(id) ON DELETE CASCADE,
  job_id                 uuid NOT NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
  title                  text NOT NULL,
  description            text,
  frequency              text NOT NULL DEFAULT 'ANUAL',
  custom_frequency_label text,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_training_topics_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT sst_training_topics_frequency_check CHECK (
    frequency IN ('UNICA', 'MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADA')
  )
);

CREATE INDEX IF NOT EXISTS sst_training_topics_entity_folder_idx
  ON public.sst_training_topics (organization_entity_id, folder_id);

CREATE TABLE IF NOT EXISTS public.sst_topic_documents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  topic_id               uuid NOT NULL REFERENCES public.sst_training_topics(id) ON DELETE CASCADE,
  file_name              text NOT NULL,
  storage_path           text NOT NULL,
  mime_type              text NOT NULL DEFAULT 'application/octet-stream',
  file_size              bigint NOT NULL DEFAULT 0,
  data_url               text,
  uploaded_by            uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_topic_documents_file_name_not_blank CHECK (btrim(file_name) <> ''),
  CONSTRAINT sst_topic_documents_file_size_check CHECK (file_size >= 0)
);

CREATE INDEX IF NOT EXISTS sst_topic_documents_topic_idx
  ON public.sst_topic_documents (organization_entity_id, topic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sst_training_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  folder_id              uuid NOT NULL REFERENCES public.sst_job_folders(id) ON DELETE CASCADE,
  job_id                 uuid NOT NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
  topic_id               uuid NOT NULL REFERENCES public.sst_training_topics(id) ON DELETE CASCADE,
  scheduled_date         date NOT NULL,
  status                 text NOT NULL DEFAULT 'PROGRAMADA',
  notes                  text,
  participant_worker_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  completed_at           timestamptz,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_training_sessions_status_check CHECK (
    status IN ('PROGRAMADA', 'REALIZADA', 'NO_REALIZADA', 'CANCELADA', 'REPROGRAMADA')
  )
);

CREATE INDEX IF NOT EXISTS sst_training_sessions_entity_date_idx
  ON public.sst_training_sessions (organization_entity_id, scheduled_date);

CREATE TABLE IF NOT EXISTS public.sst_worker_training_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  worker_id              uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  session_id             uuid REFERENCES public.sst_training_sessions(id) ON DELETE SET NULL,
  topic_id               uuid REFERENCES public.sst_training_topics(id) ON DELETE SET NULL,
  topic_title_snapshot   text NOT NULL,
  job_id_snapshot        uuid REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
  job_name_snapshot      text,
  area_id_snapshot       uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot     text,
  received_date          date NOT NULL,
  status                 text NOT NULL DEFAULT 'RECIBIDA',
  kind                   text NOT NULL DEFAULT 'SESION_SST',
  notes                  text,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_worker_training_records_title_not_blank CHECK (btrim(topic_title_snapshot) <> ''),
  CONSTRAINT sst_worker_training_records_status_check CHECK (status IN ('RECIBIDA')),
  CONSTRAINT sst_worker_training_records_kind_check CHECK (
    kind IN ('SESION_SST', 'INICIAL_CONTRATACION_SST', 'CAMBIO_CARGO_SST')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sst_worker_training_records_session_worker_unique
  ON public.sst_worker_training_records (session_id, worker_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sst_worker_training_records_worker_date_idx
  ON public.sst_worker_training_records (worker_id, received_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS sst_worker_training_records_entity_idx
  ON public.sst_worker_training_records (organization_entity_id, received_date DESC);

CREATE TABLE IF NOT EXISTS public.sst_onboarding_notifications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  worker_id              uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  event_key              text NOT NULL,
  trigger_type           text NOT NULL DEFAULT 'NUEVA_CONTRATACION',
  worker_name            text NOT NULL,
  worker_code            text,
  worker_identification  text,
  job_id                 uuid REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
  job_name               text,
  area_id                uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name              text,
  position_name          text,
  effective_date         date NOT NULL DEFAULT CURRENT_DATE,
  status                 text NOT NULL DEFAULT 'PENDIENTE',
  completed_at           timestamptz,
  completed_record_id    uuid REFERENCES public.sst_worker_training_records(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_onboarding_notifications_trigger_check CHECK (
    trigger_type IN ('NUEVA_CONTRATACION', 'CAMBIO_CARGO')
  ),
  CONSTRAINT sst_onboarding_notifications_status_check CHECK (
    status IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA')
  ),
  CONSTRAINT sst_onboarding_notifications_entity_event_unique UNIQUE (organization_entity_id, event_key)
);

CREATE INDEX IF NOT EXISTS sst_onboarding_notifications_entity_status_idx
  ON public.sst_onboarding_notifications (organization_entity_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS sst_onboarding_notifications_worker_idx
  ON public.sst_onboarding_notifications (worker_id, status);

CREATE TABLE IF NOT EXISTS public.sst_risk_assessments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  area_id                uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot     text,
  job_id                 uuid REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
  job_name_snapshot      text,
  position_id            uuid REFERENCES public.organization_positions(id) ON DELETE SET NULL,
  position_name_snapshot text,
  facility_name          text,
  risk_type              text NOT NULL DEFAULT 'MECANICO',
  hazard_description     text NOT NULL,
  cause_description      text,
  consequences           text,
  probability_level      text NOT NULL DEFAULT 'MEDIA',
  severity_level         text NOT NULL DEFAULT 'MODERADA',
  risk_level             text NOT NULL DEFAULT 'MODERADO',
  existing_controls      text,
  status                 text NOT NULL DEFAULT 'ACTIVO',
  evaluated_at           date NOT NULL DEFAULT CURRENT_DATE,
  review_date            date,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_risk_assessments_probability_check CHECK (
    probability_level IN ('BAJA', 'MEDIA', 'ALTA')
  ),
  CONSTRAINT sst_risk_assessments_severity_check CHECK (
    severity_level IN ('LEVE', 'MODERADA', 'GRAVE', 'EXTREMA')
  ),
  CONSTRAINT sst_risk_assessments_level_check CHECK (
    risk_level IN ('BAJO', 'MODERADO', 'IMPORTANTE', 'CRITICO')
  ),
  CONSTRAINT sst_risk_assessments_status_check CHECK (
    status IN ('ACTIVO', 'CONTROLADO', 'CERRADO')
  )
);

CREATE INDEX IF NOT EXISTS sst_risk_assessments_entity_idx
  ON public.sst_risk_assessments (organization_entity_id, risk_level, status);

CREATE TABLE IF NOT EXISTS public.sst_preventive_actions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id     uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  origin_type                text NOT NULL DEFAULT 'RIESGO',
  origin_id                  uuid,
  origin_label               text,
  description                text NOT NULL,
  area_id                    uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot         text,
  job_id                     uuid REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
  job_name_snapshot          text,
  responsible_worker_id      uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  responsible_name_snapshot  text,
  priority                   text NOT NULL DEFAULT 'MEDIA',
  due_date                   date NOT NULL,
  completed_date             date,
  status                     text NOT NULL DEFAULT 'PENDIENTE',
  cancellation_justification text,
  verification_notes         text,
  created_by                 uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_preventive_actions_origin_check CHECK (
    origin_type IN ('RIESGO', 'INSPECCION', 'ACCIDENTE', 'INCIDENTE', 'COMITE', 'SIMULACRO', 'REVISION_INTERNA')
  ),
  CONSTRAINT sst_preventive_actions_priority_check CHECK (
    priority IN ('BAJA', 'MEDIA', 'ALTA', 'INMEDIATA')
  ),
  CONSTRAINT sst_preventive_actions_status_check CHECK (
    status IN ('PENDIENTE', 'EN_EJECUCION', 'COMPLETADA', 'VENCIDA', 'CANCELADA')
  )
);

CREATE INDEX IF NOT EXISTS sst_preventive_actions_entity_status_idx
  ON public.sst_preventive_actions (organization_entity_id, status, due_date);

CREATE TABLE IF NOT EXISTS public.sst_epp_catalog (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  category               text NOT NULL DEFAULT 'PROTECCION_GENERAL',
  description            text,
  default_lifespan_days  integer NOT NULL DEFAULT 180,
  stock_quantity         integer NOT NULL DEFAULT 0,
  min_stock_alert        integer NOT NULL DEFAULT 5,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_epp_catalog_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS sst_epp_catalog_entity_idx
  ON public.sst_epp_catalog (organization_entity_id, name);

CREATE TABLE IF NOT EXISTS public.sst_job_epp_requirements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  job_id                 uuid NOT NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
  job_name_snapshot      text,
  epp_id                 uuid NOT NULL REFERENCES public.sst_epp_catalog(id) ON DELETE CASCADE,
  epp_name_snapshot      text NOT NULL,
  is_mandatory           boolean NOT NULL DEFAULT true,
  renewal_months         integer NOT NULL DEFAULT 6,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_job_epp_requirements_unique UNIQUE (organization_entity_id, job_id, epp_id)
);

CREATE INDEX IF NOT EXISTS sst_job_epp_requirements_entity_job_idx
  ON public.sst_job_epp_requirements (organization_entity_id, job_id);

CREATE TABLE IF NOT EXISTS public.sst_worker_epp_deliveries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  worker_id              uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  worker_name_snapshot   text NOT NULL,
  job_id                 uuid REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
  job_name_snapshot      text,
  epp_id                 uuid REFERENCES public.sst_epp_catalog(id) ON DELETE SET NULL,
  epp_name_snapshot      text NOT NULL,
  quantity               integer NOT NULL DEFAULT 1,
  delivery_date          date NOT NULL DEFAULT CURRENT_DATE,
  renewal_due_date       date,
  status                 text NOT NULL DEFAULT 'ENTREGADO',
  signed_receipt         boolean NOT NULL DEFAULT true,
  notes                  text,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_worker_epp_deliveries_status_check CHECK (
    status IN ('ENTREGADO', 'PENDIENTE_REPOSICION', 'REPUESTO', 'DEVUELTO')
  )
);

CREATE INDEX IF NOT EXISTS sst_worker_epp_deliveries_worker_idx
  ON public.sst_worker_epp_deliveries (worker_id, delivery_date DESC);

CREATE INDEX IF NOT EXISTS sst_worker_epp_deliveries_entity_idx
  ON public.sst_worker_epp_deliveries (organization_entity_id, renewal_due_date);

CREATE TABLE IF NOT EXISTS public.sst_inspections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  area_id                uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot     text,
  facility_name          text,
  inspection_type        text NOT NULL DEFAULT 'ORDINARIA',
  inspector_name         text NOT NULL,
  scheduled_date         date NOT NULL,
  executed_date          date,
  status                 text NOT NULL DEFAULT 'PROGRAMADA',
  summary_notes          text,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_inspections_status_check CHECK (
    status IN ('PROGRAMADA', 'ABIERTA', 'EN_SEGUIMIENTO', 'CERRADA')
  )
);

CREATE INDEX IF NOT EXISTS sst_inspections_entity_date_idx
  ON public.sst_inspections (organization_entity_id, scheduled_date DESC);

CREATE TABLE IF NOT EXISTS public.sst_inspection_findings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  inspection_id          uuid NOT NULL REFERENCES public.sst_inspections(id) ON DELETE CASCADE,
  item_checked           text NOT NULL,
  conforms               boolean NOT NULL DEFAULT false,
  finding_description    text,
  severity               text NOT NULL DEFAULT 'MODERADO',
  preventive_action_id   uuid REFERENCES public.sst_preventive_actions(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_inspection_findings_severity_check CHECK (
    severity IN ('LEVE', 'MODERADO', 'GRAVE', 'CRITICO')
  )
);

CREATE INDEX IF NOT EXISTS sst_inspection_findings_inspection_idx
  ON public.sst_inspection_findings (organization_entity_id, inspection_id);

CREATE TABLE IF NOT EXISTS public.sst_worker_health_aptitude (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id      uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  worker_id                   uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  worker_name_snapshot        text NOT NULL,
  job_id                      uuid REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
  job_name_snapshot           text,
  evaluation_type             text NOT NULL DEFAULT 'PERIODICO',
  evaluation_date             date NOT NULL DEFAULT CURRENT_DATE,
  next_review_date            date,
  aptitude_status             text NOT NULL DEFAULT 'APTO',
  administrative_restrictions text,
  administrative_notes        text,
  created_by                  uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_worker_health_aptitude_type_check CHECK (
    evaluation_type IN ('PRE_EMPLEO', 'PERIODICO', 'REINTEGRO', 'CAMBIO_CARGO')
  ),
  CONSTRAINT sst_worker_health_aptitude_status_check CHECK (
    aptitude_status IN ('APTO', 'APTO_CON_RESTRICCIONES', 'NO_APTO_TEMPORAL', 'PENDIENTE')
  )
);

CREATE INDEX IF NOT EXISTS sst_worker_health_aptitude_worker_idx
  ON public.sst_worker_health_aptitude (worker_id, evaluation_date DESC);

CREATE INDEX IF NOT EXISTS sst_worker_health_aptitude_entity_idx
  ON public.sst_worker_health_aptitude (organization_entity_id, next_review_date);

CREATE TABLE IF NOT EXISTS public.sst_accidents_incidents (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id    uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  event_type                text NOT NULL DEFAULT 'INCIDENTE_SIN_LESION',
  occurred_at               date NOT NULL DEFAULT CURRENT_DATE,
  area_id                   uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot        text,
  job_id                    uuid REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
  job_name_snapshot         text,
  affected_worker_id        uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  affected_worker_name      text,
  witness_names             text,
  description               text NOT NULL,
  immediate_causes          text,
  basic_causes              text,
  severity                  text NOT NULL DEFAULT 'LEVE',
  days_lost                 integer NOT NULL DEFAULT 0,
  immediate_actions         text,
  investigation_conclusions text,
  status                    text NOT NULL DEFAULT 'REPORTADO',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_accidents_incidents_type_check CHECK (
    event_type IN ('ACCIDENTE_CON_LESION', 'INCIDENTE_SIN_LESION', 'OTRO')
  ),
  CONSTRAINT sst_accidents_incidents_status_check CHECK (
    status IN ('REPORTADO', 'EN_INVESTIGACION', 'CERRADO')
  )
);

CREATE INDEX IF NOT EXISTS sst_accidents_incidents_entity_idx
  ON public.sst_accidents_incidents (organization_entity_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.sst_emergency_plans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  area_id                uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot     text,
  title                  text NOT NULL,
  plan_type              text NOT NULL DEFAULT 'EMERGENCIA_GENERAL',
  version                text NOT NULL DEFAULT '1.0',
  valid_until            date,
  brigade_members_notes  text,
  equipment_notes        text,
  last_drill_date        date,
  drill_result_notes     text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sst_committee_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  record_type            text NOT NULL DEFAULT 'REUNION',
  title                  text NOT NULL,
  record_date            date NOT NULL DEFAULT CURRENT_DATE,
  member_worker_id       uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  member_name            text,
  member_role            text,
  agreements_or_notes    text,
  status                 text NOT NULL DEFAULT 'VIGENTE',
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sst_safe_work_procedures (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id  uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  code                    text NOT NULL,
  title                   text NOT NULL,
  area_id                 uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot      text,
  job_id                  uuid REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
  job_name_snapshot       text,
  version                 text NOT NULL DEFAULT '1.0',
  status                  text NOT NULL DEFAULT 'VIGENTE',
  requires_special_permit boolean NOT NULL DEFAULT false,
  summary                 text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_worker_sst_assignment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_worker record;
  v_pos_name text;
  v_job_id uuid;
  v_job_name text;
  v_area_id uuid;
  v_area_name text;
  v_prev_job_id uuid;
  v_trigger_type text;
  v_effective_date date;
  v_event_key text;
  v_full_name text;
BEGIN
  SELECT
    w.id,
    w.code,
    w.first_name,
    w.first_surname,
    w.second_surname,
    w.identification,
    w.hire_date,
    w.organization_entity_id
  INTO v_worker
  FROM public.workers w
  WHERE w.id = NEW.worker_id;

  IF v_worker.id IS NULL OR v_worker.organization_entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    op.name,
    oj.id,
    oj.name,
    oa.id,
    oa.name
  INTO v_pos_name, v_job_id, v_job_name, v_area_id, v_area_name
  FROM public.organization_positions op
  LEFT JOIN public.organization_jobs oj ON oj.id = op.job_id
  LEFT JOIN public.organization_areas oa ON oa.id = oj.area_id
  WHERE op.id = NEW.position_id;

  SELECT oj.id
    INTO v_prev_job_id
  FROM public.worker_position_assignments wpa
  JOIN public.organization_positions op ON op.id = wpa.position_id
  LEFT JOIN public.organization_jobs oj ON oj.id = op.job_id
  WHERE wpa.worker_id = v_worker.id
    AND wpa.id <> NEW.id
  ORDER BY wpa.start_date DESC NULLS LAST, wpa.created_at DESC
  LIMIT 1;

  IF v_prev_job_id IS NULL THEN
    v_trigger_type := 'NUEVA_CONTRATACION';
  ELSIF v_job_id IS NOT NULL AND v_prev_job_id IS DISTINCT FROM v_job_id THEN
    v_trigger_type := 'CAMBIO_CARGO';
  ELSE
    RETURN NEW;
  END IF;

  v_effective_date := COALESCE(NEW.start_date, v_worker.hire_date, CURRENT_DATE);
  v_event_key := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || COALESCE(v_job_id::text, 'no-job') || ':' || v_trigger_type || ':' || v_effective_date::text;
  v_full_name := btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname));

  INSERT INTO public.sst_onboarding_notifications (
    organization_entity_id,
    worker_id,
    event_key,
    trigger_type,
    worker_name,
    worker_code,
    worker_identification,
    job_id,
    job_name,
    area_id,
    area_name,
    position_name,
    effective_date,
    status
  )
  VALUES (
    v_worker.organization_entity_id,
    v_worker.id,
    v_event_key,
    v_trigger_type,
    COALESCE(NULLIF(v_full_name, ''), 'Trabajador'),
    v_worker.code,
    v_worker.identification,
    v_job_id,
    v_job_name,
    v_area_id,
    v_area_name,
    v_pos_name,
    v_effective_date,
    'PENDIENTE'
  )
  ON CONFLICT (organization_entity_id, event_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS worker_assignment_sst_notification_trg ON public.worker_position_assignments;
CREATE TRIGGER worker_assignment_sst_notification_trg
  AFTER INSERT ON public.worker_position_assignments
  FOR EACH ROW EXECUTE FUNCTION public.handle_worker_sst_assignment_notification();

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'sst_job_folders',
    'sst_training_topics',
    'sst_topic_documents',
    'sst_training_sessions',
    'sst_worker_training_records',
    'sst_onboarding_notifications',
    'sst_risk_assessments',
    'sst_preventive_actions',
    'sst_epp_catalog',
    'sst_job_epp_requirements',
    'sst_worker_epp_deliveries',
    'sst_inspections',
    'sst_inspection_findings',
    'sst_worker_health_aptitude',
    'sst_accidents_incidents',
    'sst_emergency_plans',
    'sst_committee_records',
    'sst_safe_work_procedures'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated, service_role;', v_table);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_table || '_select', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_entity_sst(organization_entity_id));',
      v_table || '_select',
      v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_table || '_insert', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_manage_entity_sst(organization_entity_id) OR public.can_access_entity(organization_entity_id, ''candidates.manage''));',
      v_table || '_insert',
      v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_table || '_update', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_manage_entity_sst(organization_entity_id)) WITH CHECK (public.can_manage_entity_sst(organization_entity_id));',
      v_table || '_update',
      v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_table || '_delete', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_manage_entity_sst(organization_entity_id));',
      v_table || '_delete',
      v_table
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
