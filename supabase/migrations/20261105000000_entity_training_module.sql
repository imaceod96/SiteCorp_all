-- ============================================================================
-- SiteCorp · Módulo de CAPACITACIÓN por Entidad
-- ============================================================================
-- Versión espejo en supabase/migrations para ejecución directa o vía Supabase CLI.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.company_client_permissions') IS NOT NULL THEN
    INSERT INTO public.company_client_permissions (code, description)
    VALUES
      ('training.view',   'Consultar módulo de Capacitación de la entidad'),
      ('training.manage', 'Gestionar carpetas, temas, documentos, sesiones y capacitaciones')
    ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
  ELSIF to_regclass('public.tenant_permissions') IS NOT NULL THEN
    INSERT INTO public.tenant_permissions (code, description)
    VALUES
      ('training.view',   'Consultar módulo de Capacitación de la entidad'),
      ('training.manage', 'Gestionar carpetas, temas, documentos, sesiones y capacitaciones')
    ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.can_view_entity_training(p_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.can_access_entity(p_entity_id, 'training.view')
      OR public.can_access_entity(p_entity_id, 'training.manage')
      OR public.can_access_entity(p_entity_id, 'workers.view')
      OR public.can_access_entity(p_entity_id, 'workers.manage');
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_entity_training(p_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.can_access_entity(p_entity_id, 'training.manage')
      OR public.can_access_entity(p_entity_id, 'workers.manage');
$function$;

REVOKE ALL ON FUNCTION public.can_view_entity_training(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_entity_training(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_manage_entity_training(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_entity_training(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.training_folders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  area_id                uuid NOT NULL REFERENCES public.organization_areas(id) ON DELETE CASCADE,
  area_name_snapshot     text NOT NULL,
  description            text,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_folders_area_name_not_blank CHECK (btrim(area_name_snapshot) <> ''),
  CONSTRAINT training_folders_entity_area_unique UNIQUE (organization_entity_id, area_id)
);

CREATE INDEX IF NOT EXISTS training_folders_entity_idx
  ON public.training_folders (organization_entity_id, created_at);

CREATE OR REPLACE FUNCTION public.validate_training_folder_area_entity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_area_entity_id uuid;
  v_area_name text;
BEGIN
  SELECT oa.organization_entity_id, oa.name
    INTO v_area_entity_id, v_area_name
  FROM public.organization_areas oa
  WHERE oa.id = NEW.area_id;

  IF v_area_entity_id IS NULL THEN
    RAISE EXCEPTION 'El área seleccionada no existe.';
  END IF;

  IF v_area_entity_id <> NEW.organization_entity_id THEN
    RAISE EXCEPTION 'El área seleccionada no pertenece a la entidad indicada.';
  END IF;

  IF NEW.area_name_snapshot IS NULL OR btrim(NEW.area_name_snapshot) = '' THEN
    NEW.area_name_snapshot := v_area_name;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS training_folders_validate_area_trg ON public.training_folders;
CREATE TRIGGER training_folders_validate_area_trg
  BEFORE INSERT OR UPDATE ON public.training_folders
  FOR EACH ROW EXECUTE FUNCTION public.validate_training_folder_area_entity();

CREATE TABLE IF NOT EXISTS public.training_topics (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  folder_id              uuid NOT NULL REFERENCES public.training_folders(id) ON DELETE CASCADE,
  area_id                uuid NOT NULL REFERENCES public.organization_areas(id) ON DELETE CASCADE,
  title                  text NOT NULL,
  description            text,
  frequency              text NOT NULL DEFAULT 'ANUAL',
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_topics_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT training_topics_frequency_check CHECK (
    frequency IN ('UNICA', 'MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'SEGUN_NECESIDAD')
  )
);

CREATE INDEX IF NOT EXISTS training_topics_entity_folder_idx
  ON public.training_topics (organization_entity_id, folder_id);

CREATE TABLE IF NOT EXISTS public.training_topic_documents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  topic_id               uuid NOT NULL REFERENCES public.training_topics(id) ON DELETE CASCADE,
  file_name              text NOT NULL,
  storage_path           text NOT NULL,
  mime_type              text NOT NULL DEFAULT 'application/octet-stream',
  file_size              bigint NOT NULL DEFAULT 0,
  data_url               text,
  uploaded_by            uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_topic_documents_file_name_not_blank CHECK (btrim(file_name) <> ''),
  CONSTRAINT training_topic_documents_file_size_check CHECK (file_size >= 0)
);

CREATE INDEX IF NOT EXISTS training_topic_documents_topic_idx
  ON public.training_topic_documents (organization_entity_id, topic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.training_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  folder_id              uuid NOT NULL REFERENCES public.training_folders(id) ON DELETE CASCADE,
  area_id                uuid NOT NULL REFERENCES public.organization_areas(id) ON DELETE CASCADE,
  topic_id               uuid NOT NULL REFERENCES public.training_topics(id) ON DELETE CASCADE,
  scheduled_date         date NOT NULL,
  status                 text NOT NULL DEFAULT 'PROGRAMADA',
  notes                  text,
  participant_worker_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  completed_at           timestamptz,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_sessions_status_check CHECK (
    status IN ('PROGRAMADA', 'REALIZADA', 'NO_REALIZADA')
  )
);

CREATE INDEX IF NOT EXISTS training_sessions_entity_date_idx
  ON public.training_sessions (organization_entity_id, scheduled_date);

CREATE INDEX IF NOT EXISTS training_sessions_topic_idx
  ON public.training_sessions (topic_id, scheduled_date);

CREATE TABLE IF NOT EXISTS public.worker_training_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  worker_id              uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  session_id             uuid REFERENCES public.training_sessions(id) ON DELETE SET NULL,
  topic_id               uuid REFERENCES public.training_topics(id) ON DELETE SET NULL,
  topic_title_snapshot   text NOT NULL,
  area_id_snapshot       uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name_snapshot     text,
  received_date          date NOT NULL,
  status                 text NOT NULL DEFAULT 'RECIBIDA',
  kind                   text NOT NULL DEFAULT 'SESION',
  notes                  text,
  created_by             uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_training_records_title_not_blank CHECK (btrim(topic_title_snapshot) <> ''),
  CONSTRAINT worker_training_records_status_check CHECK (status IN ('RECIBIDA')),
  CONSTRAINT worker_training_records_kind_check CHECK (kind IN ('SESION', 'CAPACITACION_INICIAL'))
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_training_records_session_worker_unique
  ON public.worker_training_records (session_id, worker_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS worker_training_records_worker_date_idx
  ON public.worker_training_records (worker_id, received_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS worker_training_records_entity_idx
  ON public.worker_training_records (organization_entity_id, received_date DESC);

CREATE TABLE IF NOT EXISTS public.training_initial_notifications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  worker_id              uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  candidate_id           uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  hire_key               text NOT NULL,
  worker_name            text NOT NULL,
  worker_code            text,
  worker_identification  text,
  area_id                uuid REFERENCES public.organization_areas(id) ON DELETE SET NULL,
  area_name              text,
  position_name          text,
  hire_date              date NOT NULL DEFAULT CURRENT_DATE,
  status                 text NOT NULL DEFAULT 'PENDIENTE',
  completed_at           timestamptz,
  completed_record_id    uuid REFERENCES public.worker_training_records(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_initial_notifications_status_check CHECK (
    status IN ('PENDIENTE', 'COMPLETADA')
  ),
  CONSTRAINT training_initial_notifications_entity_hire_key_unique UNIQUE (organization_entity_id, hire_key)
);

CREATE INDEX IF NOT EXISTS training_initial_notifications_entity_status_idx
  ON public.training_initial_notifications (organization_entity_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS training_initial_notifications_worker_idx
  ON public.training_initial_notifications (worker_id, status);

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
  v_hire_key text;
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

  IF EXISTS (
    SELECT 1 FROM public.training_initial_notifications tin
    WHERE tin.organization_entity_id = v_worker.organization_entity_id
      AND tin.worker_id = v_worker.id
  ) THEN
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

  v_hire_date := COALESCE(NEW.start_date, v_worker.hire_date, CURRENT_DATE);
  v_hire_key  := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || v_hire_date::text || ':hire';
  v_full_name := btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname));

  INSERT INTO public.training_initial_notifications (
    organization_entity_id,
    worker_id,
    hire_key,
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
    COALESCE(NULLIF(v_full_name, ''), 'Nuevo trabajador'),
    v_worker.code,
    v_worker.identification,
    v_area_id,
    v_area_name,
    v_pos_name,
    v_hire_date,
    'PENDIENTE'
  )
  ON CONFLICT (organization_entity_id, hire_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS worker_assignment_training_notification_trg ON public.worker_position_assignments;
CREATE TRIGGER worker_assignment_training_notification_trg
  AFTER INSERT ON public.worker_position_assignments
  FOR EACH ROW EXECUTE FUNCTION public.handle_worker_hiring_training_notification();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.training_folders,
  public.training_topics,
  public.training_topic_documents,
  public.training_sessions,
  public.worker_training_records,
  public.training_initial_notifications
TO authenticated, service_role;

ALTER TABLE public.training_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_topic_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_training_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_initial_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_folders_select ON public.training_folders;
CREATE POLICY training_folders_select ON public.training_folders
  FOR SELECT TO authenticated
  USING (public.can_view_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_folders_insert ON public.training_folders;
CREATE POLICY training_folders_insert ON public.training_folders
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_folders_update ON public.training_folders;
CREATE POLICY training_folders_update ON public.training_folders
  FOR UPDATE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id))
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_folders_delete ON public.training_folders;
CREATE POLICY training_folders_delete ON public.training_folders
  FOR DELETE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_topics_select ON public.training_topics;
CREATE POLICY training_topics_select ON public.training_topics
  FOR SELECT TO authenticated
  USING (public.can_view_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_topics_insert ON public.training_topics;
CREATE POLICY training_topics_insert ON public.training_topics
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_topics_update ON public.training_topics;
CREATE POLICY training_topics_update ON public.training_topics
  FOR UPDATE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id))
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_topics_delete ON public.training_topics;
CREATE POLICY training_topics_delete ON public.training_topics
  FOR DELETE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_topic_documents_select ON public.training_topic_documents;
CREATE POLICY training_topic_documents_select ON public.training_topic_documents
  FOR SELECT TO authenticated
  USING (public.can_view_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_topic_documents_insert ON public.training_topic_documents;
CREATE POLICY training_topic_documents_insert ON public.training_topic_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_topic_documents_update ON public.training_topic_documents;
CREATE POLICY training_topic_documents_update ON public.training_topic_documents
  FOR UPDATE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id))
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_topic_documents_delete ON public.training_topic_documents;
CREATE POLICY training_topic_documents_delete ON public.training_topic_documents
  FOR DELETE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_sessions_select ON public.training_sessions;
CREATE POLICY training_sessions_select ON public.training_sessions
  FOR SELECT TO authenticated
  USING (public.can_view_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_sessions_insert ON public.training_sessions;
CREATE POLICY training_sessions_insert ON public.training_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_sessions_update ON public.training_sessions;
CREATE POLICY training_sessions_update ON public.training_sessions
  FOR UPDATE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id))
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_sessions_delete ON public.training_sessions;
CREATE POLICY training_sessions_delete ON public.training_sessions
  FOR DELETE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS worker_training_records_select ON public.worker_training_records;
CREATE POLICY worker_training_records_select ON public.worker_training_records
  FOR SELECT TO authenticated
  USING (public.can_view_entity_training(organization_entity_id));

DROP POLICY IF EXISTS worker_training_records_insert ON public.worker_training_records;
CREATE POLICY worker_training_records_insert ON public.worker_training_records
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS worker_training_records_update ON public.worker_training_records;
CREATE POLICY worker_training_records_update ON public.worker_training_records
  FOR UPDATE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id))
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS worker_training_records_delete ON public.worker_training_records;
CREATE POLICY worker_training_records_delete ON public.worker_training_records
  FOR DELETE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_initial_notifications_select ON public.training_initial_notifications;
CREATE POLICY training_initial_notifications_select ON public.training_initial_notifications
  FOR SELECT TO authenticated
  USING (public.can_view_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_initial_notifications_insert ON public.training_initial_notifications;
CREATE POLICY training_initial_notifications_insert ON public.training_initial_notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_entity_training(organization_entity_id)
    OR public.can_access_entity(organization_entity_id, 'candidates.manage')
  );

DROP POLICY IF EXISTS training_initial_notifications_update ON public.training_initial_notifications;
CREATE POLICY training_initial_notifications_update ON public.training_initial_notifications
  FOR UPDATE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id))
  WITH CHECK (public.can_manage_entity_training(organization_entity_id));

DROP POLICY IF EXISTS training_initial_notifications_delete ON public.training_initial_notifications;
CREATE POLICY training_initial_notifications_delete ON public.training_initial_notifications
  FOR DELETE TO authenticated
  USING (public.can_manage_entity_training(organization_entity_id));

NOTIFY pgrst, 'reload schema';

COMMIT;
