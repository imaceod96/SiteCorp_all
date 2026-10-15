-- =====================================================================================
-- SITECORP — FASE 3 · PASO 0: SNAPSHOT DE DEFINICIONES ORIGINALES Y REVERSIÓN
-- =====================================================================================
-- Rama: feat/DDD-migration-backend
-- Naturaleza: documento de PREPARACIÓN. NO se ha ejecutado nada de lo que contiene.
-- Contenido:
--   §0  Metadatos y cómo usar este archivo
--   §1  Estado de partida verificado (consultas de solo lectura ya ejecutadas)
--   §2  Definiciones ORIGINALES literales de los objetos a modificar (A, B, C, D, E)
--   §3  Privilegios efectivos ORIGINALES (F.1 y F.2) + listas de exclusión
--   §4  SQL de REVERSIÓN por grupo (listo para ejecutar, NO ejecutado)
--   §5  Garantía de que la reversión NO otorga privilegios adicionales
--   §6  Correcciones al plan derivadas de este snapshot
-- =====================================================================================


-- =====================================================================================
-- §0 · METADATOS Y USO
-- =====================================================================================
-- Este archivo cumple el requisito de la FASE 3: "conservar las definiciones SQL
-- originales exactas de todos los objetos afectados" antes de cualquier ejecución.
--
-- Cómo se usará (cuando se autorice cada grupo):
--   1. Aplicar el grupo (SQL propuesto en docs/fase-3-plan-seguridad.md, revisado en §6).
--   2. Si algo falla, ejecutar ÚNICAMENTE el bloque de reversión de §4 de ese grupo.
--   3. Verificar con las consultas de comprobación de §1 que el estado volvió al original.
--
-- Regla de seguridad de este archivo:
--   · Los bloques "REVERSIÓN" de §4 están listos para ejecutar y están escritos para
--     restaurar EXACTAMENTE el estado capturado (ver la garantía de §5).
--   · Los bloques "ORIGINAL" de §2 son la fuente de verdad literal (salida de
--     pg_get_functiondef / pg_get_expr / pg_get_triggerdef). No reinterpretar.
--
-- Convención de propietarios (verificado): 415 funciones en public; 223 propiedad de
-- `postgres` (aplicación SiteCorp) y 192 de `supabase_admin` (extensiones: btree_gist,
-- unaccent, pg_trgm...). Todo el endurecimiento de §4 se limita a las de `postgres`.


-- =====================================================================================
-- §1 · ESTADO DE PARTIDA VERIFICADO (solo lectura; resultados ya registrados)
-- =====================================================================================
-- Se conservan aquí las consultas para poder RE-VERIFICAR antes y después de cada grupo.

-- 1.1 Roles de plataforma (grupo A)
--     Resultado: 2 filas
--       SuperAdmin      | is_system_role = true  | is_active = true  | ffe97c59-c582-444d-88bf-2c75a47b9960
--       Platform Test   | is_system_role = false | is_active = true  | f797a9b6-6852-4143-9048-8791e1b78f09
SELECT id, name, is_system_role, is_active FROM public.platform_roles ORDER BY is_system_role DESC, name;

-- 1.2 Catálogo y asignaciones (grupo A / B)
--     Resultado: platform_permissions = 28; platform_role_permissions = 5;
--                platform_user_roles = 2; company_client_role_permissions = 331.
SELECT (SELECT count(*) FROM public.platform_permissions)          AS permisos_plataforma,
       (SELECT count(*) FROM public.platform_role_permissions)     AS asignaciones_rol_permiso,
       (SELECT count(*) FROM public.platform_user_roles)           AS asignaciones_usuario_rol,
       (SELECT count(*) FROM public.company_client_role_permissions) AS asignaciones_empresa;

-- 1.3 Escritores/lectores de platform_role_permissions (grupo A)
--     Resultado: SOLO `has_platform_permission` (SELECT) y `save_platform_role` (escritura).
--     No hay ningún otro escritor: el trigger de protección cubre el 100% de la superficie.
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND pg_get_functiondef(p.oid) ILIKE '%platform_role_permissions%'
ORDER BY 1;

-- 1.4 Triggers existentes (grupo A)
--     Resultado en public.platform_roles:
--       platform_roles_protect_reserved  BEFORE DELETE OR UPDATE -> protect_reserved_platform_role()
--       platform_roles_updated_at        BEFORE UPDATE          -> handle_platform_roles_updated_at()
--     Resultado en public.platform_role_permissions: NINGUNO.
--     => El trigger nuevo es el PRIMERO sobre esa tabla: su DROP de reversión no colisiona.
SELECT n.nspname AS esquema, c.relname AS tabla, t.tgname, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND ((n.nspname = 'public' AND c.relname IN ('platform_roles','platform_role_permissions'))
       OR (n.nspname = 'storage' AND c.relname = 'objects'))
ORDER BY 1, 2, 3;

-- 1.5 Constraints de las tablas de roles de plataforma (grupo A)
--     Resultado:
--       platform_role_permissions_pkey                                   PRIMARY KEY (id)
--       platform_role_permissions_platform_permission_id_fkey            FOREIGN KEY -> platform_permissions(id) ON DELETE CASCADE
--       platform_role_permissions_platform_role_id_fkey                  FOREIGN KEY -> platform_roles(id)      ON DELETE CASCADE
--       platform_role_permissions_platform_role_id_platform_permiss_key  UNIQUE (platform_role_id, platform_permission_id)
--       platform_roles_name_key                                          UNIQUE (name)
--       platform_roles_pkey                                              PRIMARY KEY (id)
--     => El borrado de un permiso del CATÁLOGO arrastra sus filas (CASCADE): de ahí la
--        excepción "cambio de catálogo" del trigger (ver §6).
SELECT conname, contype, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid IN ('public.platform_role_permissions'::regclass, 'public.platform_roles'::regclass)
ORDER BY conrelid::regclass::text, conname;

-- 1.6 Buckets de Storage (grupo E)
--     Resultado: document-templates, documents, worker_documents (los tres public = false).
--     NO existe el bucket `avatars`. No hay objetos que migrar.
SELECT id, name, public, file_size_limit, allowed_mime_types::text, created_at::text
FROM storage.buckets ORDER BY id;

-- 1.7 Datos afectados por la decisión A (grupo E)
--     Resultado: perfiles = 2; con avatar_url NO nulo = 0.
--     => El cambio de semántica de profiles.avatar_url (URL -> ruta) NO requiere migración.
SELECT (SELECT count(*) FROM public.profiles)                        AS perfiles,
       (SELECT count(*) FROM public.profiles WHERE avatar_url IS NOT NULL) AS con_avatar;

-- 1.8 Datos afectados por el grupo C
--     Resultado: certificados = 1; incoherentes (company_client_id <> workers.company_client_id) = 0.
--     => La nueva validación no rechaza ningún registro histórico.
SELECT (SELECT count(*) FROM public.worker_medical_certificates) AS certificados_totales,
       (SELECT count(*) FROM public.worker_medical_certificates c
          JOIN public.workers w ON w.id = c.worker_id
         WHERE c.company_client_id IS DISTINCT FROM w.company_client_id) AS certificados_incoherentes;

-- 1.9 Políticas concedidas al rol anon
--     Resultado: NINGUNA (ni en public ni en storage). No hay superficie anónima legítima.
SELECT n.nspname AS esquema, c.relname AS tabla, pol.polname, pol.polcmd
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE 'anon'::regrole::oid = ANY(pol.polroles)
ORDER BY 1, 2, 3;


-- =====================================================================================
-- §2 · DEFINICIONES ORIGINALES LITERALES DE LOS OBJETOS A MODIFICAR
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- §2.A · GRUPO A — Protección de roles de sistema (hallazgos 1.1 y 1.2)
-- -------------------------------------------------------------------------------------

-- §2.A.1 ORIGINAL: public.save_platform_role (oid 18390)
--   proacl : {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   proconfig: {"search_path=public, auth"}
--   OJO: NO tiene EXECUTE para PUBLIC (creada con ACL explícito). El cambio del grupo A
--   es de CUERPO; el ACL no se toca (ver §6, corrección 2).
CREATE OR REPLACE FUNCTION public.save_platform_role(p_role_id uuid, p_name text, p_description text, p_is_active boolean, p_permission_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role_id uuid;
  v_name text := btrim(p_name);
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_permission_ids uuid[];
  v_existing_role public.platform_roles%ROWTYPE;
  v_selected_count integer;
  v_catalog_count integer;
  v_authorized_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    public.is_platform_superadmin()
    OR public.has_platform_permission('platform_roles.manage')
  ) THEN
    RAISE EXCEPTION 'Permission denied: platform_roles.manage is required';
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Role name is required';
  END IF;

  IF p_role_id IS NULL AND lower(v_name) = 'superadmin' THEN
    RAISE EXCEPTION 'SuperAdmin is a reserved system role name';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT selected_permission_id
    FROM unnest(COALESCE(p_permission_ids, ARRAY[]::uuid[])) AS selected_permission_id
    WHERE selected_permission_id IS NOT NULL
  ) INTO v_permission_ids;

  IF v_permission_ids IS NULL THEN
    v_permission_ids := ARRAY[]::uuid[];
  END IF;

  v_selected_count := COALESCE(cardinality(v_permission_ids), 0);

  SELECT count(*) INTO v_catalog_count
  FROM public.platform_permissions
  WHERE id = ANY(v_permission_ids);

  IF v_catalog_count <> v_selected_count THEN
    RAISE EXCEPTION 'One or more platform permissions are invalid';
  END IF;

  IF v_selected_count > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(v_permission_ids) AS selected_permission_id
      JOIN public.platform_permissions pp ON pp.id = selected_permission_id
      WHERE COALESCE(pp.is_platform_scope, false) = false
        AND (
          p_role_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.platform_role_permissions existing
            WHERE existing.platform_role_id = p_role_id
              AND existing.platform_permission_id = selected_permission_id
          )
        )
    ) THEN
      RAISE EXCEPTION 'Only platform permissions can be assigned to platform roles';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.platform_roles existing
    WHERE lower(btrim(existing.name)) = lower(v_name)
      AND (p_role_id IS NULL OR existing.id <> p_role_id)
  ) THEN
    RAISE EXCEPTION 'A platform role with this name already exists'
      USING ERRCODE = '23505';
  END IF;

  IF NOT public.is_platform_superadmin() THEN
    SELECT count(DISTINCT prp.platform_permission_id) INTO v_authorized_count
    FROM public.platform_user_roles pur
    JOIN public.platform_roles pr ON pr.id = pur.platform_role_id
    JOIN public.platform_role_permissions prp ON prp.platform_role_id = pr.id
    WHERE pur.user_id = auth.uid()
      AND pr.is_active = true
      AND prp.platform_permission_id = ANY(v_permission_ids);

    IF v_authorized_count <> v_selected_count THEN
      RAISE EXCEPTION 'You may only assign platform permissions that you currently have';
    END IF;
  END IF;

  IF p_role_id IS NULL THEN
    INSERT INTO public.platform_roles (name, description, is_system_role, is_active)
    VALUES (v_name, v_description, false, COALESCE(p_is_active, true))
    RETURNING id INTO v_role_id;
  ELSE
    SELECT * INTO v_existing_role
    FROM public.platform_roles
    WHERE id = p_role_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Platform role was not found';
    END IF;

    v_role_id := v_existing_role.id;

    IF v_existing_role.is_system_role THEN
      IF v_name <> v_existing_role.name THEN
        RAISE EXCEPTION 'System role names cannot be changed';
      END IF;

      IF COALESCE(p_is_active, true) <> COALESCE(v_existing_role.is_active, true) THEN
        RAISE EXCEPTION 'System role activation status cannot be changed';
      END IF;

      IF v_existing_role.name = 'SuperAdmin' THEN
        IF EXISTS (
          WITH selected_permissions AS (
            SELECT unnest(v_permission_ids) AS permission_id
          ),
          current_permissions AS (
            SELECT platform_permission_id AS permission_id
            FROM public.platform_role_permissions
            WHERE platform_role_id = v_role_id
          )
          SELECT 1
          FROM (
            (SELECT permission_id FROM selected_permissions
             EXCEPT
             SELECT permission_id FROM current_permissions)
            UNION ALL
            (SELECT permission_id FROM current_permissions
             EXCEPT
             SELECT permission_id FROM selected_permissions)
          ) AS changed_permissions
        ) THEN
          RAISE EXCEPTION 'SuperAdmin permissions cannot be reduced or changed';
        END IF;
      END IF;
    END IF;

    UPDATE public.platform_roles
    SET name = v_name,
        description = v_description,
        is_active = COALESCE(p_is_active, true)
    WHERE id = v_role_id;
  END IF;

  DELETE FROM public.platform_role_permissions
  WHERE platform_role_id = v_role_id
    AND platform_permission_id <> ALL(v_permission_ids);

  INSERT INTO public.platform_role_permissions (platform_role_id, platform_permission_id)
  SELECT v_role_id, pp.id
  FROM public.platform_permissions pp
  WHERE pp.id = ANY(v_permission_ids)
  ON CONFLICT DO NOTHING;

  RETURN v_role_id;
END;
$function$;

-- §2.A.2 ORIGINAL: política public.platform_roles / platform_roles_insert
--   polcmd = a (INSERT) · polpermissive = true · roles = {authenticated}
--   USING: (ninguno)   WITH CHECK: is_platform_superadmin()
--   (El grupo A le añade `AND is_system_role = false`.)
ALTER POLICY "platform_roles_insert" ON public.platform_roles
  WITH CHECK (public.is_platform_superadmin());

-- §2.A.3 REFERENCIA (no se modifica): trigger equivalente de EMPRESA, que sirve de modelo.
--   Existe ya en el sistema:
--     company_client_role_permissions_protect_system
--       BEFORE DELETE OR UPDATE ON public.company_client_role_permissions
--       FOR EACH ROW EXECUTE FUNCTION protect_system_company_client_role_permissions()
--   Cuerpo original de protect_system_company_client_role_permissions (modelo de diseño):
--     usa public.company_client_deletion_target() como válvula de escape para el borrado.
CREATE OR REPLACE FUNCTION public.protect_system_company_client_role_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_system boolean;
  v_role_tenant uuid;
BEGIN
  SELECT COALESCE(tr.is_system_role, false), tr.company_client_id
    INTO v_is_system, v_role_tenant
  FROM public.company_client_roles tr
  WHERE tr.id = COALESCE(NEW.company_client_role_id, OLD.company_client_role_id);

  IF COALESCE(v_is_system, false) THEN
    IF TG_OP = 'DELETE'
       AND public.company_client_deletion_target() IS NOT NULL
       AND public.company_client_deletion_target() = v_role_tenant THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'System organization role permissions cannot be reduced or changed';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- -------------------------------------------------------------------------------------
-- §2.B · GRUPO B — Matriz de permisos de plataforma (hallazgo 1.3, decisión B)
-- -------------------------------------------------------------------------------------

-- §2.B.1 ORIGINAL: política public.platform_role_permissions / platform_role_permissions_select
--   polcmd = r (SELECT) · polpermissive = true · roles = {authenticated}
--   USING: (is_platform_superadmin() OR has_platform_permission('platform_roles.view'::text))
--   (El grupo B sustituye 'platform_roles.view' por 'platform_roles.manage'.)
ALTER POLICY "platform_role_permissions_select" ON public.platform_role_permissions
  USING (public.is_platform_superadmin()
         OR public.has_platform_permission('platform_roles.view'::text));

-- §2.B.2 ORIGINAL (contexto, no se modifican): resto de políticas de las dos tablas.
--   public.platform_role_permissions / platform_role_permissions_insert  (a) WITH CHECK is_platform_superadmin()
--   public.platform_role_permissions / platform_role_permissions_update  (w) USING      is_platform_superadmin()
--   public.platform_role_permissions / platform_role_permissions_delete  (d) USING      is_platform_superadmin()
--   public.platform_roles / platform_roles_select_active           (r) USING (is_active = true) AND (is_system_role = false)
--   public.platform_roles / platform_roles_select_all_superadmin   (r) USING is_platform_superadmin()
--   public.platform_roles / platform_roles_select_managers         (r) USING has_platform_permission('platform_roles.view')
--   public.platform_roles / platform_roles_update                  (w) USING is_platform_superadmin()
--   public.platform_roles / platform_roles_update_system_protected (w) USING (is_platform_superadmin()) AND (is_system_role = false)
--   public.platform_roles / platform_roles_delete_protected        (d) USING (is_platform_superadmin()) AND (is_system_role = false)

-- -------------------------------------------------------------------------------------
-- §2.C · GRUPO C — RPC médicas (hallazgos 2.1, 2.2, 2.3)
-- -------------------------------------------------------------------------------------

-- §2.C.1 ORIGINAL: public.create_worker_medical_certificate (oid 21071)
--   proacl   : {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   proconfig: NULL  <-- hallazgo 2.3 (SECURITY DEFINER sin search_path)
CREATE OR REPLACE FUNCTION public.create_worker_medical_certificate(p_tenant_id uuid, p_organization_entity_id uuid, p_worker_id uuid, p_start_date date, p_return_date date, p_days integer, p_document_id uuid, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Validaciones básicas
  IF p_start_date IS NULL OR p_return_date IS NULL OR p_days IS NULL THEN
    RAISE EXCEPTION 'La fecha de salida, la fecha de reincorporación y la cantidad de días son obligatorias';
  END IF;

  IF p_return_date <= p_start_date THEN
    RAISE EXCEPTION 'La fecha de reincorporación debe ser posterior a la fecha de salida';
  END IF;

  IF p_days <= 0 THEN
    RAISE EXCEPTION 'La cantidad de días debe ser mayor que 0';
  END IF;

  -- Verificar acceso a la entidad
  IF NOT public.can_access_entity(p_organization_entity_id, 'medical_certificates.manage') THEN
    RAISE EXCEPTION 'Permission denied: medical_certificates.manage is required in this entity';
  END IF;

  -- Verificar que el trabajador pertenece a la entidad
  IF NOT EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.id = p_worker_id AND w.organization_entity_id = p_organization_entity_id
  ) THEN
    RAISE EXCEPTION 'Worker was not found or does not belong to this entity';
  END IF;

  -- Verificar que el documento pertenece al trabajador (si se proporciona)
  IF p_document_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.worker_documents wd
      WHERE wd.id = p_document_id AND wd.worker_id = p_worker_id
    ) THEN
      RAISE EXCEPTION 'Document was not found or does not belong to this worker';
    END IF;
  END IF;

  -- Insertar el certificado médico
  INSERT INTO public.worker_medical_certificates (
    company_client_id,
    organization_entity_id,
    worker_id,
    start_date,
    return_date,
    days,
    document_id,
    created_by
  ) VALUES (
    p_tenant_id,
    p_organization_entity_id,
    p_worker_id,
    p_start_date,
    p_return_date,
    p_days,
    p_document_id,
    p_created_by
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- §2.C.2 ORIGINAL: public.update_worker_medical_certificate (oid 21108)
--   proacl: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   proconfig: NULL  <-- hallazgo 2.3
--   NOTA: los DEFAULT forman parte de la firma y deben conservarse.
CREATE OR REPLACE FUNCTION public.update_worker_medical_certificate(p_certificate_id uuid, p_start_date date DEFAULT NULL::date, p_return_date date DEFAULT NULL::date, p_days integer DEFAULT NULL::integer, p_document_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cert public.worker_medical_certificates%ROWTYPE;
BEGIN
  SELECT * INTO v_cert FROM public.worker_medical_certificates WHERE id = p_certificate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Certificate was not found';
  END IF;

  IF NOT public.can_access_entity(v_cert.organization_entity_id, 'medical_certificates.manage') THEN
    RAISE EXCEPTION 'Permission denied: medical_certificates.manage is required in this entity';
  END IF;

  IF p_start_date IS NOT NULL AND p_return_date IS NOT NULL AND p_return_date <= p_start_date THEN
    RAISE EXCEPTION 'La fecha de reincorporación debe ser posterior a la fecha de salida';
  END IF;

  IF p_days IS NOT NULL AND p_days <= 0 THEN
    RAISE EXCEPTION 'La cantidad de días debe ser mayor que 0';
  END IF;

  IF p_document_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.worker_documents wd
      WHERE wd.id = p_document_id AND wd.worker_id = v_cert.worker_id
    ) THEN
      RAISE EXCEPTION 'Document was not found or does not belong to this worker';
    END IF;
  END IF;

  UPDATE public.worker_medical_certificates
  SET
    start_date = COALESCE(p_start_date, start_date),
    return_date = COALESCE(p_return_date, return_date),
    days = COALESCE(p_days, days),
    document_id = COALESCE(p_document_id, document_id),
    updated_at = now()
  WHERE id = p_certificate_id;
END;
$function$;

-- §2.C.3 ORIGINAL: public.get_worker_medical_certificate (oid 21106)
--   proacl: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   proconfig: NULL  <-- hallazgo 2.3
CREATE OR REPLACE FUNCTION public.get_worker_medical_certificate(p_certificate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cert public.worker_medical_certificates%ROWTYPE;
  v_doc public.worker_documents%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_medical_certificates c
    WHERE c.id = p_certificate_id
    AND (public.can_access_entity(c.organization_entity_id, 'medical_certificates.view')
         OR public.can_access_entity(c.organization_entity_id, 'medical_certificates.manage'))
  ) THEN
    RAISE EXCEPTION 'Certificate was not found or you do not have access to it';
  END IF;

  SELECT * INTO v_cert FROM public.worker_medical_certificates WHERE id = p_certificate_id;

  IF v_cert.document_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.worker_documents WHERE id = v_cert.document_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_cert.id,
    'tenant_id', v_cert.company_client_id,
    'organization_entity_id', v_cert.organization_entity_id,
    'worker_id', v_cert.worker_id,
    'start_date', v_cert.start_date,
    'return_date', v_cert.return_date,
    'days', v_cert.days,
    'document_id', v_cert.document_id,
    'document', CASE WHEN v_doc.id IS NOT NULL THEN jsonb_build_object(
      'id', v_doc.id,
      'file_name', v_doc.file_name,
      'mime_type', v_doc.mime_type,
      'file_size', v_doc.file_size,
      'storage_path', v_doc.storage_path
    ) ELSE null END,
    'created_by', v_cert.created_by,
    'created_at', v_cert.created_at,
    'updated_at', v_cert.updated_at
  );
END;
$function$;

-- -------------------------------------------------------------------------------------
-- §2.D · GRUPO D — Storage de documentos de trabajador (hallazgo 4.2)
-- -------------------------------------------------------------------------------------
-- Las cuatro políticas ORIGINALES de storage.objects (roles = {authenticated} en todas):

ALTER POLICY "worker_documents_select" ON storage.objects
  USING (bucket_id = 'worker_documents'::text
         AND (storage.foldername(name))[1] = 'workers'::text
         AND (storage.foldername(name))[2] = (auth.uid())::text);

ALTER POLICY "worker_documents_upload" ON storage.objects
  WITH CHECK (bucket_id = 'worker_documents'::text
              AND (storage.foldername(name))[1] = 'workers'::text
              AND (storage.foldername(name))[2] = (auth.uid())::text);

ALTER POLICY "worker_documents_update" ON storage.objects
  USING (bucket_id = 'worker_documents'::text
         AND (storage.foldername(name))[1] = 'workers'::text
         AND (storage.foldername(name))[2] = (auth.uid())::text);

ALTER POLICY "worker_documents_delete" ON storage.objects
  USING (bucket_id = 'worker_documents'::text
         AND (storage.foldername(name))[1] = 'workers'::text
         AND (storage.foldername(name))[2] = (auth.uid())::text);

-- Contexto (no se modifica): las políticas de documentos de trabajador gestionadas por
-- permisos de ENTIDAD en el mismo bucket siguen validando can_access_entity y NO se tocan:
--   medical_certificates_storage_select / _insert / _update / _delete   (workers/<uid>/<worker>/medical-certificates/...)
--   worker_docs_objects_select / _insert / _update / _delete            (bucket `documents`)
--   candidate_docs_objects_* / governing_docs_objects_* / document_templates_objects_*

-- -------------------------------------------------------------------------------------
-- §2.E · GRUPO E — Avatares privados (decisión A / hallazgo 4.1)
-- -------------------------------------------------------------------------------------
-- §2.E.1 ORIGINAL: el bucket NO existe. No hay nada que revertir en datos de Storage.
--   Fila de referencia (formato de los buckets actuales, para comparar tras aplicar):
--     id/name        public  file_size_limit  allowed_mime_types  created_at
--     documents      false   NULL             NULL                2026-09-25 21:14:59.838241+00
--     document-templates false 10485760       NULL                2026-09-30 21:30:01.174466+00
--     worker_documents   false NULL           NULL                2026-10-02 17:30:15.209707+00
--
-- §2.E.2 ORIGINAL: políticas de storage.objects cuyo predicado menciona 'avatars'
--   Resultado: NINGUNA. Las cinco políticas del grupo E son nuevas; su DROP de reversión
--   no colisiona con nada existente.

-- §2.E.3 ORIGINAL (contexto, no se modifica): políticas de public.profiles, que definen
--   qué usuarios pueden ver el perfil de quién. Las políticas de lectura de avatares AJENOS
--   (grupo E.3) se alinean con estas funciones:
--     profiles_select_policy         (r) USING auth.uid() = id
--     profiles_select_admin          (r) USING can_view_platform_user(id)
--     profiles_select_entity_admins  (r) USING can_view_entity_user(id)
--     profiles_update_policy         (w) USING (auth.uid() = id) AND is_platform_user_active()  / CHECK auth.uid() = id
--     profiles_update_admin          (w) USING/CHECK can_manage_platform_user(id)
--   Columnas de public.profiles (para el cambio de semántica de avatar_url):
--     id uuid NOT NULL · username text · full_name text · avatar_url text · is_active boolean DEFAULT true
--     created_at timestamptz DEFAULT now() · updated_at timestamptz DEFAULT now()

-- -------------------------------------------------------------------------------------
-- §2.F · DEFINICIONES ORIGINALES DE LAS FUNCIONES DE PAGO ACADÉMICO
--        (no se modifican en el plan vigente; se capturan porque el §6, corrección 3,
--         deja abierta la posibilidad de añadir una guarda interna a la segunda)
-- -------------------------------------------------------------------------------------

-- §2.F.1 ORIGINAL: public.resolve_academic_category_payment_for_flags
--   proacl   : {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   proconfig: {"search_path=public, auth"}
--   APP: SÍ la invoca (rpcResolveAcademicCategoryPaymentForFlags) -> NO revocar.
CREATE OR REPLACE FUNCTION public.resolve_academic_category_payment_for_flags(p_entity_id uuid, p_has_masters boolean, p_has_doctorate boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_scope text;
  v_regime text;
  v_category text;
  v_amount numeric;
  v_has_row boolean := false;
BEGIN
  v_scope := public.resolve_academic_payment_scope(p_entity_id);

  SELECT upper(btrim(coalesce(regime_id, ''))) INTO v_regime
  FROM public.organization_entities
  WHERE id = p_entity_id;

  -- Doctor tiene prioridad salarial sobre Máster. Los indicadores NO se suman.
  v_category := CASE
    WHEN coalesce(p_has_doctorate, false) THEN 'DOCTOR'
    WHEN coalesce(p_has_masters, false) THEN 'MASTER'
    ELSE NULL
  END;

  -- Sin categoría académica no hay importe que resolver: 0 (no es "no configurado").
  IF v_category IS NULL THEN
    RETURN jsonb_build_object(
      'category', NULL,
      'amount', 0,
      'configured', true,
      'regime', v_regime,
      'scope', v_scope
    );
  END IF;

  IF v_scope = 'PRESUPUESTADA_GLOBAL' THEN
    SELECT a.amount, true INTO v_amount, v_has_row
    FROM public.academic_category_payments a
    WHERE a.scope_type = 'PRESUPUESTADA_GLOBAL'
      AND a.category = v_category
      AND a.is_active = true
    LIMIT 1;
  ELSIF v_scope = 'EMPRESARIAL_ENTITY' THEN
    SELECT a.amount, true INTO v_amount, v_has_row
    FROM public.academic_category_payments a
    WHERE a.scope_type = 'EMPRESARIAL_ENTITY'
      AND a.organization_entity_id = p_entity_id
      AND a.category = v_category
      AND a.is_active = true
    LIMIT 1;
  ELSE
    v_has_row := false;
  END IF;

  -- 0 = configurado explícitamente sin pago. NULL / sin registro = NO CONFIGURADO.
  RETURN jsonb_build_object(
    'category', v_category,
    'amount', CASE WHEN coalesce(v_has_row, false) AND v_amount IS NOT NULL THEN v_amount ELSE NULL END,
    'configured', coalesce(v_has_row, false) AND v_amount IS NOT NULL,
    'regime', v_regime,
    'scope', v_scope
  );
END $function$;

-- §2.F.2 ORIGINAL: public.resolve_academic_payment_scope (interna; sí revocable)
--   proacl: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   proconfig: {"search_path=public, auth"}
CREATE OR REPLACE FUNCTION public.resolve_academic_payment_scope(p_entity_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_regime text;
BEGIN
  IF p_entity_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT regime_id INTO v_regime
  FROM public.organization_entities
  WHERE id = p_entity_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Presupuestada → configuración global; cualquier otro régimen → configuración
  -- propia de la entidad. Nunca hay fallback entre regímenes.
  IF upper(btrim(coalesce(v_regime, ''))) = 'PRESUPUESTADA' THEN
    RETURN 'PRESUPUESTADA_GLOBAL';
  END IF;

  RETURN 'EMPRESARIAL_ENTITY';
END $function$;

-- -------------------------------------------------------------------------------------
-- §2.G · ESTADO DE CÓDIGO DE APLICACIÓN A REVERTIR (grupos B y E)
-- -------------------------------------------------------------------------------------
-- La reversión del código es por Git (no hay migraciones ni datos). Estado actual:
--
-- GRUPO E · Avatares (comportamiento actual, incompatible con el bucket privado):
--   src/domains/access-control/infrastructure/authentication.repository.ts
--     L29  const AVATARS_BUCKET = "avatars"
--     L89  export async function uploadOwnAvatar(userId: string, file: File): Promise<string> {
--     L90    const filePath = `${userId}/${file.name}`
--     L92    const { error: uploadError } = await supabase.storage
--     L93      .from(AVATARS_BUCKET)
--     L94      .upload(filePath, file, { contentType: file.type })
--     L95    if (uploadError) throw uploadError
--     L96    const { data: publicUrlData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(filePath)
--     L97    return publicUrlData.publicUrl
--     L98  }
--   src/pages/Account.tsx
--     L23  avatar_url: profile?.avatar_url || ""        (se envía al formulario de cuenta)
--     L47  avatarUrl: formData.avatar_url               (reescribe profiles.avatar_url)
--     L51  await updateOwnAvatar(user?.id ?? "", avatarFile)
--     L122-123 {profile?.avatar_url ? <img src={profile.avatar_url} .../> : <AvatarFallback .../>}
--   src/components/sidebar-user-menu.tsx
--     L86-87 {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} .../> : ...}
--
-- GRUPO B · Roles (comportamiento actual, lee la matriz sin condicionarla al permiso):
--   src/domains/access-control/infrastructure/roles.repository.ts  L89 y L107
--     (selectRoleScopeRows: `platform_roles` y `platform_role_permissions` sin condición)
--   src/pages/RolesPermissions.tsx · src/components/roles-manager.tsx
--
-- Reversión: `git restore` de esos archivos (o revertir el commit del turno en que se
-- cambiaron). No hay datos que deshacer: perfiles con avatar = 0 (§1.7).
-- =====================================================================================


-- =====================================================================================
-- §3 · PRIVILEGIOS EFECTIVOS ORIGINALES (GRUPO F)
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- §3.1 Panorama de EXECUTE en public (verificado)
-- -------------------------------------------------------------------------------------
--   Total funciones (prokind='f') ...................... 415
--     · propiedad de postgres (aplicación SiteCorp) .... 223
--     · propiedad de supabase_admin (extensiones) ...... 192
--   Con EXECUTE para PUBLIC ............................ 397
--   Con EXECUTE para anon .............................. 404
--   Con EXECUTE para authenticated ..................... 413
--   Con EXECUTE para service_role ...................... 415  (ninguna excepción)
--   proacl IS NULL (default del sistema) ............... 0    (todas con ACL explícito)
--
--   Patrón ACL dominante de las funciones de aplicación:
--     {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   Patrón de las funciones de extensión:
--     {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl::text AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f' ORDER BY 1, 2;

-- -------------------------------------------------------------------------------------
-- §3.2 EXCEPCIONES DE EXECUTE (imprescindibles para una reversión sin privilegios extra)
-- -------------------------------------------------------------------------------------
-- §3.2.a Funciones SIN EXECUTE para PUBLIC (18) — la reversión NO debe otorgárselo.
--   capture_contract_party_snapshot(uuid,uuid,date)
--   company_client_deletion_summary(uuid)
--   contract_expiry_alerts(uuid,integer,uuid)
--   delete_company_client(uuid,text)
--   prenomina_recalc_entry(uuid)
--   resolve_entity_representative(uuid,date)
--   resolve_entity_representatives(uuid,date)
--   save_company_client_role(uuid,uuid,text,text,boolean,uuid[])
--   save_platform_role(uuid,text,text,boolean,uuid[])
--   save_position_with_schedule(uuid,uuid,uuid,text,text,text,integer,text,numeric,numeric,numeric,integer,text,jsonb)
--   vacation_post_accrual_internal(uuid,integer,integer)
--   validate_candidate_contract_readiness(uuid)
--   validate_employment_contract_readiness(uuid)
--   validate_entity_contract_readiness(uuid)
--   validate_hiring_readiness(uuid,uuid,uuid,date,uuid,text,uuid,uuid,date,date)
--   validate_job_contract_readiness(uuid)
--   validate_position_contract_readiness(uuid)
--   validate_worker_contract_readiness(uuid)
--
-- §3.2.b Funciones SIN EXECUTE para anon (11) — la reversión NO debe otorgárselo.
--   company_client_deletion_summary(uuid)
--   delete_company_client(uuid,text)
--   prenomina_recalc_entry(uuid)
--   vacation_post_accrual_internal(uuid,integer,integer)
--   validate_candidate_contract_readiness(uuid)
--   validate_employment_contract_readiness(uuid)
--   validate_entity_contract_readiness(uuid)
--   validate_hiring_readiness(uuid,uuid,uuid,date,uuid,text,uuid,uuid,date,date)
--   validate_job_contract_readiness(uuid)
--   validate_position_contract_readiness(uuid)
--   validate_worker_contract_readiness(uuid)
--
-- §3.2.c Funciones SIN EXECUTE para authenticated (2) — la reversión NO debe otorgárselo.
--   prenomina_recalc_entry(uuid)
--   vacation_post_accrual_internal(uuid,integer,integer)
--
-- §3.2.d Funciones SIN EXECUTE para service_role: NINGUNA (415/415).

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl::text AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND (p.proacl::text !~ '(^|[{,])=X/'
       OR p.proacl::text !~ '(^|[{,])anon=X/'
       OR p.proacl::text !~ '(^|[{,])authenticated=X/')
ORDER BY 1;

-- -------------------------------------------------------------------------------------
-- §3.3 Privilegios de tabla originales (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN)
-- -------------------------------------------------------------------------------------
-- ACL literal de las 80 tablas de public (todas con el mismo patrón de letras `arwdDxtm`,
-- donde D=TRUNCATE, x=REFERENCES, t=TRIGGER, m=MAINTAIN).
SELECT relname, relacl::text AS acl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1;

-- §3.3.a Tablas SIN anon (26) — la reversión NO debe otorgarle privilegios a anon.
--   candidate_academic_formations, candidate_additional_info, candidate_notes,
--   candidate_work_experiences, document_batch_items, document_batches,
--   document_generation_events, driving_license_categories, education_levels,
--   employment_contract_types, employment_contracts, employment_types, entity_regimes,
--   genders, marital_statuses, organization_areas, organization_entities,
--   organization_positions, political_affiliations, rehire_statuses, skin_colors,
--   worker_documents, worker_employment_movements, worker_medical_certificates,
--   worker_payroll_movements, worker_separation_reasons
--
-- §3.3.b Tablas donde authenticated NO tiene TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (2)
--   (su ACL es `authenticated=arwd/postgres`, sin `Dxtm`):
--   employment_contract_types, employment_contracts

-- -------------------------------------------------------------------------------------
-- §3.4 Matriz de dependencias de las funciones candidatas a revocación (F.2)
-- -------------------------------------------------------------------------------------
-- Regla: si `en_politicas > 0` o la aplicación la invoca -> CONSERVAR EXECUTE para
-- authenticated. Verificado con pg_policy y con búsqueda en src/.
--
--   Función                                  en_politicas  llamada desde (funciones SQL)              App   Decisión
--   worker_vacation_balance                       0        adjust_worker_vacation_balance, cancel_worker_vacation,
--                                                           register_worker_vacation, vacation_post_accrual_internal,
--                                                           worker_vacation_summary                     no    REVOCAR
--   calculate_worker_vacation_accrual             0        vacation_post_accrual_internal, worker_vacation_summary  no  REVOCAR
--   vacation_count_working_days                   0        calculate_worker_vacation_accrual, vacation_target_annual   no  REVOCAR
--   vacation_target_annual                        0        calculate_worker_vacation_accrual           no    REVOCAR
--   worker_vacation_accrual_start                 0        run_worker_vacation_catchup,
--                                                           worker_vacation_is_employed_on,
--                                                           worker_vacation_weekdays_on                 no    REVOCAR
--   worker_vacation_accrual_end                   0        run_worker_vacation_catchup,
--                                                           worker_vacation_is_employed_on              no    REVOCAR
--   worker_vacation_is_employed_on                0        vacation_count_working_days                 no    REVOCAR
--   worker_vacation_weekdays_on                   0        calculate_worker_vacation_accrual,
--                                                           entity_vacation_overview,
--                                                           vacation_count_working_days,
--                                                           worker_vacation_summary                     no    REVOCAR
--   worker_position_on                            0        calculate_worker_vacation_accrual,
--                                                           worker_vacation_weekdays_on                 no    REVOCAR
--   is_entity_descendant                          0        can_access_entity, list_entity_user_access,
--                                                           report_worker_demographics                  no    REVOCAR
--   resolve_academic_payment_scope                0        get_academic_category_payment_config,
--                                                           resolve_academic_category_payment_for_flags,
--                                                           save_academic_category_payment              no    REVOCAR
--   resolve_academic_category_payment_for_flags    0       entity_staffing_export, prenomina_refresh_workers,
--                                                           resolve_academic_category_payment           **SÍ**  CONSERVAR  (ver §6, corrección 3)
--   has_company_wide_role_management              0        can_view_entity_user_access,
--                                                           can_view_invitation_role                    no    REVOCAR
--   company_client_deletion_target                0        protect_system_company_client_role,
--                                                           protect_system_company_client_role_permissions  no REVOCAR
--   vacation_post_accrual_internal                0        post_worker_vacation_accrual,
--                                                           run_worker_vacation_catchup                 no    YA restringida (solo postgres+service_role)
--   prenomina_recalc_entry                        0        prenomina_delete_night, prenomina_refresh_workers,
--                                                           prenomina_save_cla, prenomina_save_night,
--                                                           prenomina_upsert_inputs                     no    YA restringida (solo postgres+service_role)
--
-- Justificación de seguridad de la revocación: todas las funciones propietarias de las
-- llamadas internas son SECURITY DEFINER de `postgres`; al ejecutarse, el rol efectivo es
-- el propietario, que CONSERVA EXECUTE. Por eso revocar a `authenticated` no altera ningún
-- cálculo de vacaciones, prenomina ni nómina (no se añade ninguna guarda interna).
SELECT pol.polname, c.relname
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
WHERE pg_get_expr(COALESCE(pol.polqual, pol.polwithcheck), pol.polrelid) ILIKE '%is_platform_user_active%'
ORDER BY 1;

-- -------------------------------------------------------------------------------------
-- §3.5 ACL del esquema storage (contexto: NO se modifica en F.1/F.2)
-- -------------------------------------------------------------------------------------
--   storage.objects        : anon=arwd, authenticated=arwd  (RLS decide fila a fila)
--   storage.buckets        : anon=arwd, authenticated=arwd
--   El endurecimiento de privilegios de tabla de F.1 se limita a `public` (ver §6,
--   corrección 1): tocar storage.* sería modificar objetos gestionados por Supabase.
SELECT n.nspname AS esquema, c.relname AS tabla, c.relacl::text AS acl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'storage' AND c.relkind IN ('r','v') ORDER BY 1, 2;


-- =====================================================================================
-- §4 · SQL DE REVERSIÓN POR GRUPO  (listo para ejecutar · NO EJECUTADO)
-- =====================================================================================
-- Se ejecuta SOLO el bloque del grupo que se haya aplicado y solo si hace falta revertir.

-- -------------------------------------------------------------------------------------
-- §4.A · Reversión del grupo A
-- -------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS platform_role_permissions_protect_system ON public.platform_role_permissions;
DROP FUNCTION IF EXISTS public.protect_system_platform_role_permissions();

-- Restaura el cuerpo ORIGINAL de save_platform_role: ejecutar §2.A.1 tal cual.
-- Restaura la política ORIGINAL: ejecutar §2.A.2 tal cual.
-- Comprobación posterior: §1.1 (2 roles), §1.4 (ningún trigger en platform_role_permissions).

-- -------------------------------------------------------------------------------------
-- §4.B · Reversión del grupo B
-- -------------------------------------------------------------------------------------
-- Restaura la política ORIGINAL: ejecutar §2.B.1 tal cual.
-- (No hay cambios de esquema: la reversión de la aplicación es volver los archivos DDD.)
-- Comprobación posterior:
--   SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname = 'platform_role_permissions_select';

-- -------------------------------------------------------------------------------------
-- §4.C · Reversión del grupo C
-- -------------------------------------------------------------------------------------
-- Restaura los cuerpos ORIGINALES: ejecutar §2.C.1, §2.C.2 y §2.C.3 tal cual.
-- Y retira el search_path añadido (el original era NULL):
ALTER FUNCTION public.create_worker_medical_certificate(uuid,uuid,uuid,date,date,integer,uuid,uuid) RESET search_path;
ALTER FUNCTION public.update_worker_medical_certificate(uuid,date,date,integer,uuid)                   RESET search_path;
ALTER FUNCTION public.get_worker_medical_certificate(uuid)                                            RESET search_path;
-- Comprobación posterior:
--   SELECT proname, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND proname LIKE '%medical_certificate%';   -- proconfig debe ser NULL

-- -------------------------------------------------------------------------------------
-- §4.D · Reversión del grupo D
-- -------------------------------------------------------------------------------------
-- Restaura las cuatro políticas ORIGINALES: ejecutar §2.D tal cual.

-- -------------------------------------------------------------------------------------
-- §4.E · Reversión del grupo E
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "avatars_select_own"              ON storage.objects;
DROP POLICY IF EXISTS "avatars_select_profile_viewers"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_own"              ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own"              ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_own"              ON storage.objects;

-- El bucket es NUEVO: se elimina. Ejecutar SOLO si está vacío (no debe contener objetos,
-- porque la funcionalidad nunca llegó a estar operativa antes de aplicar el grupo).
-- Si contuviera objetos, NO borrar: dejar `public = false` y sin políticas.
DELETE FROM storage.buckets WHERE id = 'avatars' AND NOT EXISTS (
  SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'avatars'
);
-- Comprobación posterior: §1.6 (deben quedar exactamente 3 buckets) y §2.E.2 (0 políticas con 'avatars').

-- -------------------------------------------------------------------------------------
-- §4.F.1 · Reversión del endurecimiento de EXECUTE y privilegios de tabla
-- -------------------------------------------------------------------------------------
-- IMPORTANTE: la reversión NO puede ser un GRANT en bloque, porque eso otorgaría
-- privilegios que NUNCA existieron (§3.2 y §3.3). Se restaura el estado exacto:

-- (1) EXECUTE de funciones: solo para las funciones propiedad de `postgres`, y respetando
--     las tres listas de exclusión de §3.2 (18 sin PUBLIC, 11 sin anon, 2 sin authenticated).
DO $$
DECLARE
  r record;
  sin_public text[] := ARRAY[
    'capture_contract_party_snapshot(uuid,uuid,date)',
    'company_client_deletion_summary(uuid)',
    'contract_expiry_alerts(uuid,integer,uuid)',
    'delete_company_client(uuid,text)',
    'prenomina_recalc_entry(uuid)',
    'resolve_entity_representative(uuid,date)',
    'resolve_entity_representatives(uuid,date)',
    'save_company_client_role(uuid,uuid,text,text,boolean,uuid[])',
    'save_platform_role(uuid,text,text,boolean,uuid[])',
    'save_position_with_schedule(uuid,uuid,uuid,text,text,text,integer,text,numeric,numeric,numeric,integer,text,jsonb)',
    'vacation_post_accrual_internal(uuid,integer,integer)',
    'validate_candidate_contract_readiness(uuid)',
    'validate_employment_contract_readiness(uuid)',
    'validate_entity_contract_readiness(uuid)',
    'validate_hiring_readiness(uuid,uuid,uuid,date,uuid,text,uuid,uuid,date,date)',
    'validate_job_contract_readiness(uuid)',
    'validate_position_contract_readiness(uuid)',
    'validate_worker_contract_readiness(uuid)'
  ];
  sin_anon text[] := ARRAY[
    'company_client_deletion_summary(uuid)',
    'delete_company_client(uuid,text)',
    'prenomina_recalc_entry(uuid)',
    'vacation_post_accrual_internal(uuid,integer,integer)',
    'validate_candidate_contract_readiness(uuid)',
    'validate_employment_contract_readiness(uuid)',
    'validate_entity_contract_readiness(uuid)',
    'validate_hiring_readiness(uuid,uuid,uuid,date,uuid,text,uuid,uuid,date,date)',
    'validate_job_contract_readiness(uuid)',
    'validate_position_contract_readiness(uuid)',
    'validate_worker_contract_readiness(uuid)'
  ];
  sin_authenticated text[] := ARRAY[
    'prenomina_recalc_entry(uuid)',
    'vacation_post_accrual_internal(uuid,integer,integer)'
  ];
  v_sig text;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND p.proowner = 'postgres'::regrole          -- excluye las 192 de extensión
  LOOP
    v_sig := r.sig;
    IF NOT (v_sig = ANY(sin_public)) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', v_sig);
    END IF;
    IF NOT (v_sig = ANY(sin_anon)) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', v_sig);
    END IF;
    IF NOT (v_sig = ANY(sin_authenticated)) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
    END IF;
    -- service_role nunca se revoca (415/415): no hay nada que restaurar.
  END LOOP;
END $$;

-- (2) Privilegios de tabla: TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, respetando §3.3.
DO $$
DECLARE
  t text;
  sin_anon text[] := ARRAY[
    'candidate_academic_formations','candidate_additional_info','candidate_notes',
    'candidate_work_experiences','document_batch_items','document_batches',
    'document_generation_events','driving_license_categories','education_levels',
    'employment_contract_types','employment_contracts','employment_types','entity_regimes',
    'genders','marital_statuses','organization_areas','organization_entities',
    'organization_positions','political_affiliations','rehire_statuses','skin_colors',
    'worker_documents','worker_employment_movements','worker_medical_certificates',
    'worker_payroll_movements','worker_separation_reasons'
  ];
  sin_avanzados_authenticated text[] := ARRAY[
    'employment_contract_types','employment_contracts'
  ];
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  LOOP
    IF NOT (t = ANY(sin_avanzados_authenticated)) THEN
      EXECUTE format('GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.%I TO authenticated', t);
    END IF;
    IF NOT (t = ANY(sin_anon)) THEN
      EXECUTE format('GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.%I TO anon', t);
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------------------------------
-- §4.F.2 · Reversión de la revocación de EXECUTE a authenticated en funciones internas
-- -------------------------------------------------------------------------------------
-- Solo las 13 funciones realmente revocadas (§6, corrección 3: la lista del plan pierde
-- `resolve_academic_category_payment_for_flags`, que la aplicación invoca).
GRANT EXECUTE ON FUNCTION public.worker_vacation_balance(uuid)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_worker_vacation_accrual(uuid,integer,integer)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.vacation_count_working_days(uuid,date,date,boolean)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.vacation_target_annual(uuid,integer)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_vacation_accrual_start(uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_vacation_accrual_end(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_vacation_is_employed_on(uuid,date)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_vacation_weekdays_on(uuid,date)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_position_on(uuid,date)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_entity_descendant(uuid,uuid)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_academic_payment_scope(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_wide_role_management(uuid)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_client_deletion_target()                                   TO authenticated;

-- Comprobación posterior (debe volver a 404 / 413 / 397 respectivamente):
--   SELECT count(*) FILTER (WHERE has_function_privilege('public', p.oid, 'EXECUTE')) AS con_public,
--          count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))   AS con_anon,
--          count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS con_authenticated
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f';


-- =====================================================================================
-- §5 · GARANTÍA DE QUE LA REVERSIÓN NO OTORGA PRIVILEGIOS ADICIONALES
-- =====================================================================================
-- 1. EXECUTE de funciones (§4.F.1-1)
--    · Se restringe a `p.proowner = 'postgres'::regrole`, por lo que NO toca las 192
--      funciones de extensión (btree_gist, unaccent, pg_trgm), cuyo ACL original
--      ({=X/supabase_admin,...}) queda intacto. Un `GRANT ... ON ALL FUNCTIONS` sí las
--      habría modificado: por eso no se usa.
--    · Las tres listas de exclusión reproducen literalmente §3.2.a/b/c, de modo que las
--      18/11/2 funciones que no tenían PUBLIC/anon/authenticated siguen sin tenerlo.
--    · service_role nunca se revoca: no se re-otorga nada.
--    · Resultado esperado tras la reversión: 397 con PUBLIC, 404 con anon, 413 con
--      authenticated, 415 con service_role (idéntico a §3.1).
--
-- 2. Privilegios de tabla (§4.F.1-2)
--    · El GRANT de `authenticated` excluye las 2 tablas cuyo ACL original era `arwd`
--      (sin Dxtm): `employment_contract_types` y `employment_contracts`. Un
--      `GRANT ... ON ALL TABLES` sí les habría añadido TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
--    · El GRANT de `anon` excluye las 26 tablas que no tenían entrada para `anon`.
--    · No se otorga nada a PUBLIC en tablas (ninguna tabla tenía privilegios de PUBLIC:
--      no hay entrada `=` en ningún relacl).
--    · Los esquemas storage/auth NO se tocan (§3.5).
--
-- 3. Grupo A/B/C/D/E
--    · A: la reversión hace DROP del trigger y de la función nuevas y reescribe el cuerpo
--      y la política con el texto literal de §2. No crea objetos ni permisos nuevos.
--    · B/D: `ALTER POLICY` con la expresión original exacta. No cambia roles de política
--      (siguen siendo {authenticated}).
--    · C: se restauran los cuerpos y se hace RESET search_path (el original era NULL).
--      Los ACL no se tocan en este grupo.
--    · E: se eliminan las cinco políticas nuevas y el bucket nuevo. No hay objeto previo
--      que restaurar porque el bucket no existía.
--
-- 4. No hay `GRANT` incondicional ni `ON ALL ...` en ningún bloque de §4.


-- =====================================================================================
-- §6 · CORRECCIONES AL PLAN DERIVADAS DE ESTE SNAPSHOT
-- =====================================================================================
-- (1) F.1 estaba sobredimensionado. `REVOKE/GRANT ... ON ALL FUNCTIONS IN SCHEMA public`
--     afectaría a las 192 funciones de EXTENSIÓN propiedad de `supabase_admin`. El
--     endurecimiento debe limitarse a las funciones propiedad de `postgres` (223).
--     Igualmente, `REVOKE ... ON ALL TABLES` se mantiene porque en `public` no hay tablas
--     de extensión, pero el GRANT de reversión debe ser por tabla (§4.F.1-2).
--
-- (2) El supuesto "todas las funciones tienen EXECUTE para PUBLIC" es FALSO para 18 de
--     ellas (§3.2.a). Consecuencia: el `GRANT EXECUTE ... TO authenticated` en bloque del
--     plan habría otorgado EXECUTE a `prenomina_recalc_entry` y
--     `vacation_post_accrual_internal`, que hoy son exclusivas de postgres/service_role.
--
-- (3) `resolve_academic_category_payment_for_flags` NO se puede revocar: la aplicación la
--     invoca directamente (`src/domains/organization-structure/infrastructure/
--     academic-payment.repository.ts`, `rpcResolveAcademicCategoryPaymentForFlags`) y la
--     usan `entity_staffing_export` y `prenomina_refresh_workers`. Sale de la lista F.2.
--     Su hallazgo (no valida acceso a la entidad) requiere una DECISIÓN DE NEGOCIO:
--       · Opción 1 (preferida): añadir dentro de la función
--         `IF NOT (public.can_access_entity(p_entity_id,'workers.view')
--                  OR public.can_access_entity(p_entity_id,'workers.manage')) THEN RAISE EXCEPTION ...`
--         y, si algún llamante interno legítimo no tiene ese permiso, extraer el cálculo a
--         una función interna sin guarda (patrón ya usado por el sistema en
--         `vacation_post_accrual_internal` y `prenomina_recalc_entry`) y dejar la pública
--         con la guarda.
--       · Opción 2: no revocar ni añadir guarda y aceptar el hallazgo como riesgo residual.
--     Ambas opciones quedan PENDIENTES de confirmación; no se incluyen en §4.
--
-- (4) Existe ya un precedente arquitectónico idéntico para el grupo A en el ámbito de
--     empresa (`protect_system_company_client_role_permissions` + trigger
--     `company_client_role_permissions_protect_system`, BEFORE DELETE OR UPDATE). El
--     trigger de plataforma del grupo A replica ese patrón, lo que reduce el riesgo de
--     diseño. La diferencia es la válvula de escape: empresa usa
--     `company_client_deletion_target()`; plataforma no tiene equivalente, así que la
--     excepción se apoya en el borrado en cascada del catálogo (§1.5).
--
-- (5) `platform_role_permissions` NO tenía ningún trigger (§1.4), así que el trigger nuevo
--     es el único: no hay interacción con otros triggers ni riesgo de orden de disparo.
-- =====================================================================================
-- FIN DEL SNAPSHOT. Nada de este archivo se ha ejecutado.
-- =====================================================================================
