-- ============================================================================
-- SiteCorp · FASE 2/3 — 12. VERIFICACIÓN DE PERMISOS Y ACL (invariante)
--   [sustituye al antiguo 09: ya NO se restaura ninguna ACL porque ya no se
--    destruye ninguna; se DEMUESTRA que no ha cambiado]
--
-- POR QUÉ ESTE FICHERO YA NO RESTAURA PERMISOS
--   El diseño final del fichero 11 NO usa DROP FUNCTION: renombra con ALTER FUNCTION
--   y sustituye el cuerpo con CREATE OR REPLACE FUNCTION sobre la MISMA firma.
--   En PostgreSQL ambas operaciones conservan el OID de la función y, con él:
--     · el PROPIETARIO (pg_proc.proowner)
--     · la ACL exacta (pg_proc.proacl), incluidos los REVOKE históricos
--     · los GRANT por OID de las políticas RLS y los enlaces de los triggers
--   Consecuencia: es IMPOSIBLE que una función recreada gane un EXECUTE adicional.
--   Este fichero lo comprueba de forma objetiva (por OID) en lugar de prometerlo.
--
--   LAS DOS FUNCIONES SENSIBLES que en su día recibieron REVOKE (evidencia del
--   repositorio: 20260922_03 y 20261001_03) y su ACL real observada el 2026-10-27:
--     · delete_workspace(uuid, text)            → {postgres, authenticated, service_role}
--                                                 SIN PUBLIC y SIN anon
--     · workspace_deletion_summary(uuid)       → {postgres, authenticated, service_role}
--                                                 SIN PUBLIC y SIN anon
--     · save_tenant_role(uuid,uuid,text,text,boolean,uuid[])
--                                               → {postgres, anon, authenticated, service_role}
--                                                 SIN PUBLIC
--   El resto de funciones afectadas tienen la ACL por defecto enriquecida de Supabase
--   ({=X/postgres, postgres, anon, authenticated, service_role}).
--
-- ORDEN: ejecutar DESPUÉS del fichero 11. Si algo falla aquí, NO se despliega la
--        aplicación y se activa el plan de recuperación (fichero 90).
-- Solo lectura: no modifica permisos.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- V.1 Ninguna función debe haber desaparecido (prueba de que no hubo DROP).
--     ESPERADO: 0 filas.
-- ---------------------------------------------------------------------------
SELECT s.function_oid, s.function_name, s.identity_arguments
FROM phase2_migration.function_definition_snapshot s
WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = s.function_oid)
ORDER BY 2, 3;

-- ---------------------------------------------------------------------------
-- V.2 La ACL exacta (texto de pg_proc.proacl) debe ser IDÉNTICA, por OID.
--     Compara también NULL = ACL por defecto.
--     ESPERADO: 0 filas.
-- ---------------------------------------------------------------------------
SELECT s.function_name AS nombre_antes,
       coalesce(p.proname, '(desaparecida)') AS nombre_ahora,
       s.acl_text AS acl_antes,
       p.proacl::text AS acl_ahora
FROM phase2_migration.function_definition_snapshot s
LEFT JOIN pg_proc p ON p.oid = s.function_oid
WHERE p.oid IS NULL
   OR p.proacl IS DISTINCT FROM s.acl_text::aclitem[]
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- V.3 El PROPIETARIO debe ser el mismo. ESPERADO: 0 filas.
-- ---------------------------------------------------------------------------
SELECT s.function_name AS nombre_antes, s.owner_name AS propietario_antes,
       pg_get_userbyid(p.proowner) AS propietario_ahora
FROM phase2_migration.function_definition_snapshot s
JOIN pg_proc p ON p.oid = s.function_oid
WHERE pg_get_userbyid(p.proowner) IS DISTINCT FROM s.owner_name
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- V.4 Diferencial de concesiones por rol (¿alguien ganó algo?).
--     ESPERADO: todas las filas con diferencia 0.
-- ---------------------------------------------------------------------------
WITH antes AS (
  SELECT grantee, privilege_type, count(*) AS n
  FROM phase2_migration.function_acl_snapshot
  GROUP BY 1, 2
), despues AS (
  SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
         a.privilege_type,
         count(*) AS n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE n.nspname = 'public'
  GROUP BY 1, 2
)
SELECT coalesce(antes.grantee, despues.grantee) AS concesionario,
       coalesce(antes.privilege_type, despues.privilege_type) AS privilegio,
       coalesce(antes.n, 0) AS antes,
       coalesce(despues.n, 0) AS despues,
       coalesce(despues.n, 0) - coalesce(antes.n, 0) AS diferencia
FROM antes
FULL JOIN despues
  ON despues.grantee = antes.grantee AND despues.privilege_type = antes.privilege_type
ORDER BY 1, 2;

-- ---------------------------------------------------------------------------
-- V.5 CONTROL DIRECTO DE LAS FUNCIONES SENSIBLES DE CLIENTE
--     ESPERADO: 0 filas (PUBLIC NO debe poder ejecutar ninguna de ellas).
-- ---------------------------------------------------------------------------
SELECT p.proname AS funcion_expuesta_a_public,
       pg_get_function_identity_arguments(p.oid) AS argumentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE n.nspname = 'public'
  AND a.grantee = 0                       -- PUBLIC
  AND p.proname IN ('delete_company_client',
                    'company_client_deletion_summary',
                    'save_company_client_role',
                    'create_company_client')
ORDER BY 1, 2;

-- ---------------------------------------------------------------------------
-- V.6 ACL de TABLAS y SECUENCIAS: los renombrados no mueven privilegios.
--     ESPERADO: 0 filas (ninguna diferencia antes/después).
-- ---------------------------------------------------------------------------
WITH antes AS (
  SELECT relation_name, grantee, privilege_type, count(*) AS n
  FROM phase2_migration.relation_acl_snapshot
  GROUP BY 1, 2, 3
), despues AS (
  SELECT c.relname AS relation_name,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
         a.privilege_type,
         count(*) AS n
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  GROUP BY 1, 2, 3
)
SELECT coalesce(antes.relation_name, despues.relation_name) AS relacion,
       coalesce(antes.grantee, despues.grantee) AS concesionario,
       coalesce(antes.privilege_type, despues.privilege_type) AS privilegio,
       coalesce(antes.n, 0) AS antes,
       coalesce(despues.n, 0) AS despues
FROM antes
FULL JOIN despues
  ON despues.relation_name = antes.relation_name
 AND despues.grantee = antes.grantee
 AND despues.privilege_type = antes.privilege_type
WHERE coalesce(antes.n, 0) <> coalesce(despues.n, 0)
   OR antes.relation_name IS NULL
   OR despues.relation_name IS NULL
ORDER BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- V.7 Correspondencia nombre anterior → nombre actual (informativo y auditable).
--     ESPERADO: exactamente 18 funciones de RPC/trigger-helper con nombre nuevo y
--     el resto conservando su nombre.
-- ---------------------------------------------------------------------------
SELECT s.function_name AS nombre_antes,
       p.proname AS nombre_actual,
       s.identity_arguments,
       (s.function_name <> p.proname) AS renombrada
FROM phase2_migration.function_definition_snapshot s
JOIN pg_proc p ON p.oid = s.function_oid
WHERE p.proname <> s.function_name
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- V.8 DICTAMEN FINAL: una sola fila que resume si la migración de permisos es neutra.
--     ESPERADO: veredicto = 'NEUTRO (sin cambios de permisos)'.
-- ---------------------------------------------------------------------------
WITH v2 AS (
  SELECT count(*) AS n
  FROM phase2_migration.function_definition_snapshot s
  LEFT JOIN pg_proc p ON p.oid = s.function_oid
  WHERE p.oid IS NULL OR p.proacl IS DISTINCT FROM s.acl_text::aclitem[]
), v3 AS (
  SELECT count(*) AS n
  FROM phase2_migration.function_definition_snapshot s
  JOIN pg_proc p ON p.oid = s.function_oid
  WHERE pg_get_userbyid(p.proowner) IS DISTINCT FROM s.owner_name
), v5 AS (
  SELECT count(*) AS n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE n.nspname = 'public' AND a.grantee = 0
    AND p.proname IN ('delete_company_client', 'company_client_deletion_summary',
                      'save_company_client_role', 'create_company_client')
)
SELECT CASE WHEN (SELECT n FROM v2) = 0
             AND (SELECT n FROM v3) = 0
             AND (SELECT n FROM v5) = 0
            THEN 'NEUTRO (sin cambios de permisos)'
            ELSE 'REVISAR: hay diferencias de permisos' END AS veredicto,
       (SELECT n FROM v2) AS acl_distintas,
       (SELECT n FROM v3) AS propietarios_distintos,
       (SELECT n FROM v5) AS funciones_sensibles_expuestas_a_public;

COMMIT;

-- ============================================================================
-- NOTA OPERATIVA: si el veredicto no es NEUTRO, NO desplegar la aplicación.
--   La causa más probable sería haber usado DROP + CREATE en lugar de
--   ALTER FUNCTION + CREATE OR REPLACE. En ese caso, restaurar desde
--   phase2_migration.function_acl_snapshot (por OID) y revisar el error.
-- ============================================================================
