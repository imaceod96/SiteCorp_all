-- ============================================================================
-- SiteCorp · FASE 2/3 — 10. STORAGE Y COMPROBACIONES MANUALES
--   [revisado: el bloqueo de Storage queda RESUELTO con evidencia del catálogo real]
--
-- ============================================================================
-- §1  STORAGE — DICTAMEN: NO REQUIERE NINGÚN CAMBIO
-- ============================================================================
-- Se revisaron las definiciones REALES (pg_policies del esquema `storage`) y los
-- buckets (`storage.buckets`). Evidencia observada el 2026-10-27:
--   · 21 políticas, todas sobre `storage.objects`, agrupadas en 6 familias
--     (candidate_docs, document_templates, governing_docs, medical_certificates,
--     worker_docs, worker_documents).
--   · 3 buckets, TODOS privados (`public = false`): documents, document-templates,
--     worker_documents.
--   · 0 políticas referencian `tenants`, `tenant_id`, `tenant_memberships`,
--     `tenant_roles` ni ninguna función SQL renombrada.
--   · 0 políticas mencionan la cadena `tenant` (ni en USING ni en WITH CHECK).
--
-- Qué usan las políticas, y por qué no les afecta el renombrado:
--   · `storage.foldername(name)`, `bucket_id`, `auth.uid()`  → objetos del sistema.
--   · `can_access_entity(<entidad>, '<código de permiso>')`  → función NO renombrada
--     y códigos de permiso que se conservan (decisión nº 4).
--   · Funciones auxiliares de ruta `*_storage_object_entity(name)`
--     (candidate_, document_template_, governing_document_, worker_) → NO están entre
--     las 56 funciones afectadas: no mencionan `tenant*` y no se renombran.
--   · Las políticas se enlazan por OID: aunque se renombrara una función que invocan,
--     el texto se actualizaría solo (y ninguna lo hace).
--
-- Conclusión: NINGUNA política de Storage depende de `tenants`, `tenant_id`,
-- `tenant_memberships` ni de funciones SQL renombradas → **no hay cambios que preparar
-- y no queda ningún bloqueo pendiente en Storage**.
--
-- Verificación a ejecutar en la ventana (tras el fichero 11). ESPERADO: 0.
-- ---------------------------------------------------------------------------
SELECT count(*) AS politicas_storage_con_tenant
FROM pg_policies
WHERE schemaname = 'storage'
  AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'tenant';

-- Inventario de buckets (los tres deben seguir siendo privados). ESPERADO: 3 filas,
-- todas con public = false.
SELECT id, name, public, file_size_limit
FROM storage.buckets
ORDER BY id;

-- ============================================================================
-- §2  COMPROBACIONES MANUALES (lo que no se puede automatizar sin riesgo)
-- ============================================================================
-- Estas comprobaciones NO modifican nada: son consultas de revisión que deben
-- ejecutarse y leerse ANTES de cerrar la ventana.

-- 2.1 Tablas con `tenant_id` SIN clave foránea a `tenants`.
--     Integridad referencial incompleta: NO se corrige en esta fase (crear FKs es un
--     cambio funcional distinto), pero debe quedar documentado, porque tras el
--     renombrado el riesgo de huérfanos no desaparece.
--     Revisar el resultado y anotarlo en el informe de la ventana.
SELECT c.relname AS tabla_sin_fk
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attname = 'tenant_id'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint fk
    WHERE fk.conrelid = c.oid
      AND fk.contype = 'f'
      AND fk.conkey = ARRAY[a.attnum]
  )
ORDER BY 1;

-- 2.2 Literales que se CONSERVAN a propósito (decisión nº 2, 3, 4 y 5) y que nadie
--     debe "corregir" por error. Repaso del inventario verificado:
--       · 'tenant_id', 'tenant_name'      → claves JSON devueltas al cliente.
--       · 'tenants.delete'                → código de permiso de plataforma almacenado.
--       · 'tenant_roles.manage',
--         'Permission denied: roles.manage or tenant_roles.manage is required'
--                                        → código de permiso y mensaje congelado.
--       · '(^areas\.|^jobs\.|^tenant_roles\.|_global$|_empresarial$)'
--                                        → patrón de catálogo de permisos.
--       · '%workers_tenant_code_unique%'  → nombre de índice que NO se renombra.
--       · '%workers_tenant_ci_active_unique%' → rama muerta (el índice no existe).
--       · 'app.workspace_deletion'        → ajuste de sesión interno del borrado.
--     Consulta de control (debe devolver exactamente los casos anteriores):
SELECT p.proname AS funcion,
       coalesce(substring(p.prosrc from '''([^'']*tenant[^'']*)'''), '') AS literal_legacy
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ~ '(tenants|tenant_id|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id)'
  AND p.prosrc ~ '''[^'']*tenant[^'']*'''
ORDER BY 1;

-- 2.3 Defectos PREEXISTENTES detectados durante la revisión (NO se corrigen aquí:
--     corregirlos cambiaría comportamiento y excede la Fase 2). Deben quedar en el
--     informe como deuda técnica aceptada:
--       a) `migration_create_worker` referencia `public.representative_assignments`,
--          tabla que NO existe con ese nombre en el esquema.
--       b) `create_worker_with_position` compara `%workers_tenant_ci_active_unique%`,
--          índice que NO existe (el real es `workers_tenant_ci_unique`): rama muerta.
--       c) `finalize_salary_change_event` inserta
--          `tenant_id = coalesce(v_tenant, gen_random_uuid())` con
--          `organization_entity_id = NULL`: genera un UUID que NO es un cliente y puede
--          violar la FK. Es el ÚNICO punto del esquema que genera identificadores en
--          esta ruta, y es anterior a esta migración. ESTA MIGRACIÓN NO GENERA NINGÚN
--          UUID EN NINGÚN PASO.
--       d) 8 tablas con `tenant_id` sin FK (ver 2.1).
--     Comprobación de que la migración no introduce generación de identificadores:
SELECT count(*) AS funciones_afectadas_que_generan_uuid
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ~ '(gen_random_uuid|uuid_generate_v4|gen_random_bytes)'
  AND p.prosrc ~ '(tenants|tenant_id|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id)';
-- ESPERADO: 1 fila con el valor 1 (solo el caso (c), preexistente). Si aparece más de
-- 1, revisar antes de continuar.

-- 2.4 El frontend NO debe interpretar los mensajes de error congelados como contrato
--     (solo mostrarlos). Revisar:
--       · 'Permission denied: roles.manage or tenant_roles.manage is required'
--       · 'Candidate organization_entity_id must belong to the same tenant as tenant_id'
--       · 'Organization entity parent must belong to the same tenant'
--     Si alguna pantalla compara esos textos literalmente, hay que actualizarla en la
--     MISMA ventana (se documenta en el informe §7).
