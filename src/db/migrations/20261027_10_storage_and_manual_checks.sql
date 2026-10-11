-- ============================================================================
-- SiteCorp · FASE 2/3 — 10. STORAGE, VISTAS Y COMPROBACIONES MANUALES OBLIGATORIAS
--
-- ESTE FICHERO NO MODIFICA NADA. Contiene:
--   (a) hallazgos verificados que evitan trabajo innecesario,
--   (b) el listado EXACTO de lo que NO se ha podido verificar y debe comprobarse
--       a mano antes de autorizar la ventana (bloqueos de la Fase 2).
--
-- ---------------------------------------------------------------------------
-- (a) HALLAZGOS VERIFICADOS (introspección de solo lectura)
-- ---------------------------------------------------------------------------
--  A.1 VISTAS: no existe ninguna vista ni vista materializada en `public`.
--      → No hay definiciones de vista que reescribir tras el renombrado.
--      (Control permanente: consulta §4.1 del fichero 01.)
--
--  A.2 STORAGE — RUTAS: ninguna ruta de objeto contiene el identificador de cliente.
--      Evidencia (cuerpos actuales, todos verificados):
--        · complete_document_generation():  'workers/<worker_id>/generated/<documento>.docx'
--                                           'workers/<worker_id>/generated/<documento>.xlsx'
--        · worker_storage_object_entity():  <bucket 'workers'>/<worker_id>/...
--        · candidate_storage_object_entity(): <bucket 'candidates'>/<candidate_id>/... y 'candidate_<uuid>…'
--        · governing_document_storage_object_entity(): 'governing-documents/<entity_id>/...'
--        · document_template_storage_object_entity(): 'entity/<entity_id>/...'
--      Conclusión: NO hay que migrar objetos de Storage por el renombrado de
--      `tenants.id → company_clients.id` (el UUID es el mismo y no aparece en la ruta).
--      Las funciones auxiliares de Storage NO mencionan `tenants` ni `tenant_id`
--      → NO requieren reescritura.
--
--  A.3 ESQUEMA DE TRABAJO: `phase2_migration` no está expuesto por la Data API
--      (Supabase expone únicamente `public` y `graphql_public`). Debe eliminarse al
--      cerrar la Fase 3 (ver “limpieza” al final del fichero 90).
--
-- ---------------------------------------------------------------------------
-- (b) NO VERIFICADO / BLOQUEADO — comprobación manual obligatoria
-- ---------------------------------------------------------------------------
--  B.1 POLÍTICAS DE STORAGE (bloqueo real): la introspección utilizada solo cubre el
--      esquema `public`. Las políticas de `storage.objects` NO se han podido leer, por
--      lo que NO se puede afirmar que estén libres de nomenclatura legacy.
--      Ejecutar a mano (SOLO LECTURA, no modifica nada):
--
--        SELECT schemaname, tablename, policyname, cmd, qual, with_check
--        FROM pg_policies
--        WHERE schemaname = 'storage'
--        ORDER BY tablename, policyname;
--
--        SELECT id, name, public, file_size_limit, allowed_mime_types
--        FROM storage.buckets
--        ORDER BY id;
--
--        -- ¿Alguna política de Storage menciona el cliente/tenant por nombre?
--        SELECT policyname, qual, with_check
--        FROM pg_policies
--        WHERE schemaname = 'storage'
--          AND (coalesce(qual,'') || coalesce(with_check,'')) ~ 'tenant';
--
--      Interpretación:
--        · 0 filas en la tercera consulta  → Storage queda fuera del alcance de la fase.
--        · >0 filas                        → añadir un fichero 11 de Storage antes de
--          la ventana. El renombrado de tablas/columnas NO invalida esas políticas
--          (van por OID), pero el texto podría quedar incoherente y debe revisarse.
--
--  B.2 BUCKETS: confirmar que solo existen los cuatro bucket privados esperados por el
--      código (documentos de trabajador, documentos de candidato, documentos rectores,
--      plantillas por entidad) y que NINGUNO es público. Si existiera un bucket público
--      con datos de clientes, sería un hallazgo de seguridad que debe resolverse antes
--      de declarar el aislamiento verificado.
--
--  B.3 EXTENSIONES: `btree_gist` (índice GiST de rangos en
--      organization_representative_assignments) y `unaccent` están instaladas en el
--      esquema `public`. El índice gist `ora_no_overlap` no contiene 'tenant' en su
--      definición, así que el renombrado no le afecta; se deja constancia porque su
--      operador por rango se usa en la validación de representantes.
--
--  B.4 LÍMITES DE LA VALIDACIÓN ESTÁTICA: ningún fichero de esta fase ha sido
--      ejecutado contra Supabase (ni remoto ni local). Las comprobaciones realizadas
--      son de catálogo (metadatos) y de código. La ausencia de errores sintácticos en
--      los bloques DO exige ejecutarlos en un entorno desechable antes de la ventana.
--
--  B.5 RLS: NO se ha probado ninguna política. Que una tabla tenga RLS habilitado y
--      políticas definidas NO demuestra aislamiento. Las pruebas positivas/negativas
--      de acceso cruzado entre clientes son parte de la Fase 3 (informe §8).
--
-- ---------------------------------------------------------------------------
-- CONSULTAS DE INVENTARIO PARA LA REVISIÓN MANUAL (solo lectura)
-- ---------------------------------------------------------------------------
-- Estado final de las tablas del cliente:
SELECT cl.relname AS tabla, cl.relrowsecurity AS rls_activo,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = cl.oid) AS politicas,
       (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = cl.oid AND NOT t.tgisinternal) AS triggers
FROM pg_class cl
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'public'
  AND cl.relkind = 'r'
  AND cl.relname LIKE 'company_client%'
ORDER BY 1;

-- Funciones SECURITY DEFINER: deben conservar `SET search_path` tras la reescritura.
-- ESPERADO: `search_path_configurado` = true en todas (o documentar las excepciones).
SELECT p.proname AS funcion,
       p.prosecdef AS security_definer,
       EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
               WHERE c LIKE 'search_path=%') AS search_path_configurado
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
ORDER BY 1;
