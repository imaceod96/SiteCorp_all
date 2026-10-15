# FASE 3 de 3 — Plan definitivo de seguridad (PREPARACIÓN, sin ejecutar)

**Naturaleza:** documento de análisis y preparación. **No se ha ejecutado ningún SQL de
modificación, revocación, creación o cambio de política, y no se ha tocado código ni la
configuración de Storage.** Todo lo aquí descrito queda a la espera de autorización explícita.

Rama: `feat/DDD-migration-backend`. Sin commits, push, merge ni despliegues. Sin Supabase
local/Docker. Sin datos sintéticos ni modificación de datos reales. No se reabren las fases 1 y 2.

Base del plan: `docs/fase-3-diagnostico-seguridad.md` (auditoría de solo lectura) + las dos
decisiones de negocio confirmadas.

---

## 0. Decisiones incorporadas y datos de partida verificados

**Decisión A — Avatares privados con URLs firmadas.** Bucket `avatars` con `public = false`;
la aplicación usa `createSignedUrl` y **nunca** `getPublicUrl`; `profiles.avatar_url`
almacena la **ruta relativa** (`<user_id>/<archivo>`), nunca una URL firmada ni una URL
pública. La clave `service_role` no se usa en el frontend (se mantiene el cliente `anon`
autenticado, como hoy).

**Decisión B — Matriz de permisos de roles de plataforma.** `platform_roles.manage` efectivo o
SuperAdmin. `platform_roles.view` se conserva (no se elimina el permiso ni se tocan
asignaciones) pero deja de dar acceso a la matriz rol↔permiso. Se mantienen las reglas de
protección de roles de sistema y de prevención de escalada.

**Datos de partida comprobados (solo lectura):**

| Dato | Valor | Consecuencia para el plan |
|---|---|---|
| Buckets existentes | `documents`, `document-templates`, `worker_documents` (los tres privados) | No hay bucket `avatars`: se creará; ningún dato de Storage que migrar |
| `profiles` | 2 filas, **0** con `avatar_url` | **No hay datos que migrar** en `profiles.avatar_url`; el cambio de semántica (URL → ruta) no requiere migración de datos |
| Componentes que pintan avatar | `src/components/sidebar-user-menu.tsx` (perfil propio) y `src/pages/Account.tsx` (propio) | No existe hoy ningún componente que muestre el avatar de **otra** persona: las listas usan iniciales (`AvatarFallback`) |
| `profiles.avatar_url` legible por terceros | La política `profiles_select_entity_admins`/`_admin` permiten leer perfiles de otros a admins/gestores de entidad | La lectura de avatares ajenos, si algún día se muestra, debe respetar esas mismas funciones (`can_view_*`) |
| Funciones públicas de `public` | ~250; **todas** con EXECUTE para `PUBLIC` por defecto (⇒ `anon`) | El endurecimiento de EXECUTE (grupo 7) es global, no por función, con allowlist explícita |
| Propietario de las funciones afectadas | `postgres` en todas | Tras revocar EXECUTE a `authenticated`/`anon`, las **llamadas internas** entre funciones `SECURITY DEFINER` siguen funcionando (el rol en ejecución es el propietario) |
| `pg_policy` | 163 referencias a `can_access_entity`, 129 a `is_platform_superadmin`, 21 a `has_platform_permission`, 8 a `worker_storage_object_entity`… | **Revocar EXECUTE a `authenticated` en funciones usadas por políticas rompería TODAS las políticas** (ver matriz del grupo 8) |
| FK de `platform_role_permissions` | `platform_permission_id → platform_permissions` con `ON DELETE CASCADE`; `platform_role_id → platform_roles` con `ON DELETE CASCADE` | El trigger del grupo 2 debe contemplar el borrado en cascada del catálogo (ver excepción) |
| App y helpers internos | La app **no** llama a `worker_vacation_balance`, `calculate_worker_vacation_accrual`, `vacation_count_working_days`, `vacation_target_annual`, `worker_vacation_accrual_start/_end`, `worker_vacation_is_employed_on`, `worker_vacation_weekdays_on`, `worker_position_on`, `is_entity_descendant`, `resolve_academic_payment_scope`, `resolve_academic_category_payment_for_flags`, `*_storage_object_entity`, `company_client_deletion_target` | Grupo 8: son candidatas a **revocación** (no a guarda) → cero riesgo para nómina/vacaciones |
| App y RPC legítimas con prefijo engañoso | `migration_validate_rows`, `migration_import_rows`, `migration_create_single_worker`, `prenomina_*`, `has_company_client_permission`, `is_platform_user`, `can_access_entity`, `list_*`, `save_*_role`, `delete_entity_role`, `create_company_client`, `list_company_client_invitations` | **Se conservan** (app-facing). No se clasifican por prefijo |

---

## 1. Grupo A — Protección de roles de sistema (hallazgos 1.1 y 1.2)

### Vulnerabilidad corregida
1.1 (ALTA): los permisos de un rol de sistema de plataforma se podían alterar vía
`save_platform_role` (SECURITY DEFINER) eludiendo la protección de RLS, para todo rol de
sistema distinto de `SuperAdmin`.
1.2 (BAJA): se podía insertar un rol de plataforma con `is_system_role = true`, creando un rol
inmutable e indeleble.

### SQL propuesto

```sql
-- A.1 — Trigger de protección de los permisos de TODOS los roles de sistema de plataforma.
CREATE OR REPLACE FUNCTION public.protect_system_platform_role_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_system boolean;
BEGIN
  SELECT COALESCE(pr.is_system_role, false)
    INTO v_is_system
  FROM public.platform_roles pr
  WHERE pr.id = COALESCE(NEW.platform_role_id, OLD.platform_role_id);

  IF NOT COALESCE(v_is_system, false) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Excepción: cambio de CATÁLOGO. Si la fila de `platform_permissions` ya no existe,
  -- estamos dentro del borrado en cascada de una permiso del catálogo (solo lo puede
  -- provocar un SuperAdmin por RLS) y no de una reducción de permisos del rol.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.platform_permissions pp
                     WHERE pp.id = OLD.platform_permission_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'System platform role permissions cannot be reduced or changed';
END;
$function$;

CREATE TRIGGER platform_role_permissions_protect_system
  BEFORE DELETE OR UPDATE ON public.platform_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_platform_role_permissions();

-- A.2 — `save_platform_role`: el bloqueo de permisos aplica a TODOS los roles de sistema.
--   Cambio puntual: sustituir el bloque
--     IF v_existing_role.name = 'SuperAdmin' THEN  ...  END IF
--   por la comprobación de CONJUNTO para cualquier rol de sistema:
--
--   IF v_existing_role.is_system_role THEN
--     IF EXISTS (
--       WITH selected AS (SELECT unnest(v_permission_ids) AS permission_id),
--            current  AS (SELECT platform_permission_id AS permission_id
--                         FROM public.platform_role_permissions
--                         WHERE platform_role_id = v_role_id)
--       SELECT 1 FROM (
--         (SELECT permission_id FROM selected EXCEPT SELECT permission_id FROM current)
--         UNION ALL
--         (SELECT permission_id FROM current EXCEPT SELECT permission_id FROM selected)
--       ) changed
--     ) THEN
--       RAISE EXCEPTION 'System platform role permissions cannot be reduced or changed';
--     END IF;
--   END IF;
--
--   (Se mantienen intactas las comprobaciones ya existentes: nombre y estado de activación
--    inmutables en roles de sistema, y la comprobación anti-escalada "solo permisos que ya
--    posee" para no-SuperAdmin. La descripción se deja editable, en paridad con el patrón de
--    empresa `protect_system_company_client_role`.)

-- A.3 — Un INSERT directo no puede crear roles de sistema.
ALTER POLICY "platform_roles_insert" ON public.platform_roles
  WITH CHECK (public.is_platform_superadmin() AND is_system_role = false);
```

### Archivos de aplicación a modificar
Ninguno obligatorio. `RolesManager` (usado por `src/pages/RolesPermissions.tsx` y por la
pantalla de roles de entidad) ya marca los roles de sistema como protegidos
(`isProtectedRole`) y no ofrece editarles permisos; se **verificará** que la UI no intente
guardar cambios de permisos en roles de sistema (si lo hiciera, ahora recibiría un error
explícito del backend en lugar de aplicarlo).

### Dependencias
`platform_role_permissions` no tiene triggers previos; el único escritor es `save_platform_role`
y los borrados en cascada de `platform_roles`/`platform_permissions` (ambos ya restringidos a
SuperAdmin por RLS). La app nunca escribe esas tablas directamente (lo hace por RPC).

### Riesgo funcional
Bajo. La gestión normal de roles **no** sistema no cambia. El guardado de un rol de sistema sin
cambiar permisos sigue funcionando (no hay DELETE que dispare el trigger). Si algún flujo
legítimo necesitara cambiar permisos de un rol de sistema, ahora fallará de forma explícita: es
el comportamiento deseado y hay que confirmarlo con negocio (hoy no existe tal flujo).

### Comprobaciones previas
```sql
SELECT id, name, is_system_role, is_active FROM public.platform_roles ORDER BY is_system_role, name;
SELECT p.proname, pg_get_functiondef(p.oid) FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('save_platform_role','protect_system_platform_role_permissions');
SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname = 'platform_roles_insert';
```

### Pruebas posteriores
`run_tests` con `e2e-tests/access-control.spec.ts` y
`e2e-tests/platform-account-administration.spec.ts`; prueba manual (con un usuario
`platform_roles.manage` no-SuperAdmin) de guardar un rol no-sistema (correcto) y de intentar
quitarle un permiso a un rol de sistema (mensaje del backend).

### Reversión
```sql
DROP TRIGGER IF EXISTS platform_role_permissions_protect_system ON public.platform_role_permissions;
DROP FUNCTION IF EXISTS public.protect_system_platform_role_permissions();
-- Restaurar el cuerpo original de save_platform_role y la política, desde el snapshot (§8).
```

---

## 2. Grupo B — Permisos de roles de plataforma (hallazgo 1.3, decisión B)

### Vulnerabilidad corregida
1.3 (MEDIA, confirmada como decisión): `platform_roles.view` permitía leer la matriz
rol↔permiso de todos los roles de plataforma.

### SQL propuesto

```sql
-- B.1 — La matriz solo la consulta quien puede gestionar (o SuperAdmin).
ALTER POLICY "platform_role_permissions_select" ON public.platform_role_permissions
  USING (public.is_platform_superadmin()
         OR public.has_platform_permission('platform_roles.manage'));
```

### Archivos de aplicación a modificar (DDD)

| Archivo | Cambio |
|---|---|
| `src/domains/access-control/infrastructure/roles.repository.ts` | `selectRoleScopeRows(scope, entityId, options)` con `includePermissionMatrix: boolean`; para `scope = 'platform'` **no** consultar `platform_role_permissions` cuando es `false` (evita una lectura inútil y un silencio confuso) |
| `src/domains/access-control/application/roles.queries.ts` | Resolver el permiso efectivo (`loadPlatformPermission('platform_roles.manage')`) y pasarlo como `includePermissionMatrix`; devolver además `canReadPermissionMatrix` en el `RoleScopeWorkspace` |
| `src/domains/access-control/domain/entities.ts` | Añadir `canReadPermissionMatrix: boolean` a `RoleScopeWorkspace` (contrato de la vista) |
| `src/components/roles-manager.tsx` | Cuando `canReadPermissionMatrix === false`: no mostrar la columna/valor de permisos; sustituir por el aviso "Necesitas permiso de gestión de roles para consultar los permisos" y no permitir editar permisos |
| `src/pages/RolesPermissions.tsx` | (Solo si requiere texto) ajustar la descripción para el modo consulta |

Verificado: `create-sitecorp-user` y `create-platform-admin` leen `platform_role_permissions`
con **`service_role`** (no les afecta RLS). Ninguna política RLS ni trigger consume
`platform_role_permissions` directamente (solo `has_platform_permission`, que es
SECURITY DEFINER) → el cambio es seguro.

### Riesgo funcional
Medio-bajo y localizado: los usuarios con `platform_roles.view` sin `manage` dejarán de ver la
matriz; exige el cambio de UI en el mismo despliegue lógico. Ningún otro flujo se ve afectado.

### Comprobaciones previas
```sql
SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname = 'platform_role_permissions_select';
SELECT count(*) FROM public.platform_user_roles pur
JOIN public.platform_roles pr ON pr.id = pur.platform_role_id
JOIN public.platform_role_permissions prp ON prp.platform_role_id = pr.id
JOIN public.platform_permissions pp ON pp.id = prp.platform_permission_id
WHERE pp.code = 'platform_roles.view';   -- usuarios que verán el modo consulta
```
(aplicar tras el grupo A, para que la matriz ya esté protegida).

### Pruebas posteriores
Spec de `access-control` + `platform-account-administration`; prueba manual con un usuario
`platform_roles.view` sin `manage` (debe ver roles y no la matriz; sin errores de red) y con
`platform_roles.manage` (debe verla y poder editar roles no-sistema).

### Reversión
Restaurar la política original desde el snapshot:
`USING (public.is_platform_superadmin() OR public.has_platform_permission('platform_roles.view'))`
y revertir los archivos DDD.

---

## 3. Grupo C — RPC médicas (hallazgos 2.1, 2.2 y 2.3)

### Vulnerabilidad corregida
2.1 (MEDIA) `company_client_id` falsificable; 2.2 (BAJA) `created_by` falsificable;
2.3 (BAJA) tres funciones `SECURITY DEFINER` sin `search_path`.

### SQL propuesto

```sql
-- C.1 — Misma firma pública. Se deriva el cliente del trabajador y se usa auth.uid().
CREATE OR REPLACE FUNCTION public.create_worker_medical_certificate(
  p_tenant_id uuid, p_organization_entity_id uuid, p_worker_id uuid,
  p_start_date date, p_return_date date, p_days integer,
  p_document_id uuid, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_id uuid;
  v_tenant_id uuid;
BEGIN
  IF p_start_date IS NULL OR p_return_date IS NULL OR p_days IS NULL THEN
    RAISE EXCEPTION 'La fecha de salida, la fecha de reincorporación y la cantidad de días son obligatorias';
  END IF;
  IF p_return_date <= p_start_date THEN
    RAISE EXCEPTION 'La fecha de reincorporación debe ser posterior a la fecha de salida';
  END IF;
  IF p_days <= 0 THEN
    RAISE EXCEPTION 'La cantidad de días debe ser mayor que 0';
  END IF;

  IF NOT public.can_access_entity(p_organization_entity_id, 'medical_certificates.manage') THEN
    RAISE EXCEPTION 'Permission denied: medical_certificates.manage is required in this entity';
  END IF;

  -- El workspace SIEMPRE se deriva del trabajador; el parámetro se valida, no se confía.
  SELECT w.company_client_id INTO v_tenant_id
  FROM public.workers w
  WHERE w.id = p_worker_id AND w.organization_entity_id = p_organization_entity_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Worker was not found or does not belong to this entity';
  END IF;
  IF p_tenant_id IS NOT NULL AND p_tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'The workspace does not match the worker';
  END IF;

  IF p_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.worker_documents wd
    WHERE wd.id = p_document_id AND wd.worker_id = p_worker_id
  ) THEN
    RAISE EXCEPTION 'Document was not found or does not belong to this worker';
  END IF;

  INSERT INTO public.worker_medical_certificates (
    company_client_id, organization_entity_id, worker_id,
    start_date, return_date, days, document_id, created_by)
  VALUES (
    v_tenant_id, p_organization_entity_id, p_worker_id,
    p_start_date, p_return_date, p_days, p_document_id, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- C.2 — search_path explícito en las tres funciones médicas.
ALTER FUNCTION public.create_worker_medical_certificate(uuid,uuid,uuid,date,date,integer,uuid,uuid)
  SET search_path TO 'public','auth';
ALTER FUNCTION public.update_worker_medical_certificate(uuid,date,date,integer,uuid)
  SET search_path TO 'public','auth';
ALTER FUNCTION public.get_worker_medical_certificate(uuid)
  SET search_path TO 'public','auth';
```

### Archivos de aplicación a modificar
Ninguno: `medical-certificates.repository.ts` sigue enviando `p_tenant_id`, `p_created_by` y la
resto de parámetros; el backend los valida/ignora. (Opcional, fuera del alcance: dejar de
enviar `p_created_by`; implicaría cambiar la firma y no aporta seguridad.)

### Dependencias
Ninguna función interna llama a `create_worker_medical_certificate` (verificado: `en_funciones = 0`).
`update_worker_medical_certificate` y `get_worker_medical_certificate` no cambian de cuerpo.

### Riesgo funcional
Muy bajo. Sólo se añade una validación que en los flujos actuales siempre se cumple (la app
envía el `tenant_id` real del trabajador) y se cambia la fuente de la autoría (la interfaz no
usa `created_by` para nada). No se alteran cálculos ni flujos.

### Comprobaciones previas
```sql
SELECT count(*) FROM public.worker_medical_certificates c
JOIN public.workers w ON w.id = c.worker_id
WHERE c.company_client_id IS DISTINCT FROM w.company_client_id;   -- debe ser 0
SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE '%medical_certificate%';
```

### Pruebas posteriores
`e2e-tests/expediente-integration.spec.ts`, `e2e-tests/document-generation.spec.ts` (SC-4-04) y
el spec de la pantalla de certificados de la entidad; prueba manual de alta y edición de un
certificado (con documento adjunto) y de invalidación intentando otro `tenant_id`.

### Reversión
Restaurar las definiciones originales del snapshot (`pg_get_functiondef` de las tres funciones)
y `ALTER FUNCTION ... RESET search_path`.

---

## 4. Grupo D — Storage de documentos de trabajador (hallazgo 4.2)

### Vulnerabilidad corregida
4.2 (MEDIA): un usuario desactivado con sesión válida conservaba SELECT/INSERT/UPDATE/DELETE en
su carpeta `workers/<uid>/...` del bucket `worker_documents`.

### SQL propuesto

```sql
ALTER POLICY "worker_documents_select" ON storage.objects
  USING (bucket_id = 'worker_documents'
         AND (storage.foldername(name))[1] = 'workers'
         AND (storage.foldername(name))[2] = (auth.uid())::text
         AND public.is_platform_user_active());

ALTER POLICY "worker_documents_upload" ON storage.objects
  WITH CHECK (bucket_id = 'worker_documents'
              AND (storage.foldername(name))[1] = 'workers'
              AND (storage.foldername(name))[2] = (auth.uid())::text
              AND public.is_platform_user_active());

ALTER POLICY "worker_documents_update" ON storage.objects
  USING (bucket_id = 'worker_documents'
         AND (storage.foldername(name))[1] = 'workers'
         AND (storage.foldername(name))[2] = (auth.uid())::text
         AND public.is_platform_user_active());

ALTER POLICY "worker_documents_delete" ON storage.objects
  USING (bucket_id = 'worker_documents'
         AND (storage.foldername(name))[1] = 'workers'
         AND (storage.foldername(name))[2] = (auth.uid())::text
         AND public.is_platform_user_active());
```

### Archivos de aplicación a modificar
Ninguno (el frontend ya usa `createSignedUrl` en los dominios de expediente y certificados).

### Dependencias
`public.is_platform_user_active()` es SECURITY DEFINER y ya se usa en políticas
(`profiles_update_policy`), por lo que `authenticated` conserva EXECUTE (ver grupo 8: es una de
las funciones que **no** se revocan). Ninguna otra política de Storage se ve afectada: las
rutas de documentos de trabajador gestionadas por permisos de entidad
(`worker_docs_objects_*`, `medical_certificates_storage_*`) ya validan `can_access_entity`.

### Riesgo funcional
Nulo para usuarios activos; los desactivados pierden acceso a Storage en su carpeta (es el
objetivo y ya lo perdían en el resto de capas).

### Comprobaciones previas
```sql
SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'objects' AND pol.polname LIKE 'worker_documents_%';
```

### Pruebas posteriores
Specs de expediente/certificados + prueba manual: usuario activo sube/descarga/borra en su
carpeta; con `profiles.is_active = false`, las cuatro operaciones fallan.

### Reversión
Restaurar las cuatro políticas sin el `AND public.is_platform_user_active()` (snapshot).

---

## 5. Grupo E — Avatares privados con URLs firmadas (decisión A, hallazgo 4.1)

### Vulnerabilidad/brecha corregida
4.1 (MEDIA): el bucket `avatars` no existía y la aplicación resolvía una **URL pública**
incompatible con `public = false`; además, `Account.tsx` reescribía `avatar_url` con el valor
del formulario (riesgo de almacenar URLs temporales como identificadores permanentes).

### SQL propuesto

```sql
-- E.1 — Bucket PRIVADO de avatares (límite de tamaño y tipos de imagen).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', false, 2097152,
        ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- E.2 — Lectura: el titular (necesaria para que él mismo firme su URL).
CREATE POLICY "avatars_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = (auth.uid())::text);

-- E.3 — Lectura de avatares AJENOS: solo con los mismos permisos que dan acceso al perfil.
--       (Hoy no hay pantalla que los muestre; la política deja el contrato listo y correcto.)
CREATE POLICY "avatars_select_profile_viewers" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars'
         AND public.is_platform_user_active()
         AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         AND (public.can_view_platform_user(((storage.foldername(name))[1])::uuid)
              OR public.can_view_entity_user(((storage.foldername(name))[1])::uuid)));

-- E.4 — Escritura: SOLO el titular, y SOLO con perfil activo.
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars'
              AND (storage.foldername(name))[1] = (auth.uid())::text
              AND public.is_platform_user_active());

CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = (auth.uid())::text
         AND public.is_platform_user_active())
  WITH CHECK (bucket_id = 'avatars'
              AND (storage.foldername(name))[1] = (auth.uid())::text
              AND public.is_platform_user_active());

CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = (auth.uid())::text
         AND public.is_platform_user_active());
```

**Caducidad y renovación:** TTL de la URL firmada = **3600 s** (coherente con
`medical-certificates.repository.ts`). La aplicación renueva al montar el layout, al recuperar
el foco de la ventana y cuando la URL lleva más del 80 % de su vida; ante fallo de firma cae al
`AvatarFallback` con iniciales (nunca rompe la pantalla).

### Archivos de aplicación a modificar (DDD)

| Archivo | Cambio |
|---|---|
| `src/domains/access-control/domain/entities.ts` | `ProfileAccountInput` **sin** `avatarUrl` (evita reescribir el avatar desde el formulario); nuevo tipo `AvatarPath` (string relativo) documentado; el campo físico sigue siendo `profiles.avatar_url` |
| `src/domains/access-control/domain/account.rules.ts` (nuevo, reglas puras) | `AVATAR_SIGNED_URL_TTL_SECONDS = 3600`; `avatarObjectPath(userId, fileName)` (ruta `<user_id>/<archivo>` saneada); `avatarPathFromStored(value)` (compatibilidad: si el valor guardado empieza por `http`, extrae la ruta del objeto o devuelve `null`); `avatarSignedUrlNeedsRenewal(expiresAt, now)` |
| `src/domains/access-control/infrastructure/authentication.repository.ts` | `uploadOwnAvatar(userId, file)` → devuelve la **ruta** (sin `getPublicUrl`); nuevas `createOwnAvatarSignedUrl(path, expiresInSeconds)` y `deleteOwnAvatarObject(path)`; se conserva `AVATARS_BUCKET = "avatars"` |
| `src/domains/access-control/infrastructure/user-profiles.repository.ts` | `updateUserProfileAccount` deja de escribir `avatar_url`; `updateUserProfileAvatar(userId, avatarPath)` guarda la ruta; `selectUserProfileById` sigue devolviendo la fila |
| `src/domains/access-control/application/authentication.commands.ts` | `updateOwnAvatar(userId, file, previousPath?)`: sube → guarda la ruta → **elimina el objeto anterior** (reemplazo); nueva `removeOwnAvatar(userId)` |
| `src/domains/access-control/application/account.queries.ts` (nuevo) | `loadOwnAvatarSignedUrl(userId, ttl)`: lee el perfil, resuelve la ruta (`avatarPathFromStored`), firma y devuelve `{ url, expiresAt } | null` |
| `src/contexts/AuthContext.tsx` | Expone `avatarUrl` resuelto (firma + renovación por foco/tiempo) además de `profile`; nunca lee `profile.avatar_url` para pintar |
| `src/components/sidebar-user-menu.tsx` | Usa `avatarUrl` del contexto en lugar de `profile.avatar_url` |
| `src/pages/Account.tsx` | Previsualiza con `loadOwnAvatarSignedUrl`/estado local; quita `avatar_url` del formulario; tras subir/borrar, re-resuelve la URL |
| `src/domains/access-control/index.ts` | Exportar los nuevos símbolos (contrato del dominio) |
| `e2e-tests/access-control.spec.ts` (o spec nuevo de avatares) | Contratos: sin `getPublicUrl`, con `createSignedUrl`/TTL, bucket privado, y páginas sin `@/lib/supabase` |

### Dependencias
`storage.objects` (RLS activa) + `storage.buckets`; helpers `can_view_platform_user`,
`can_view_entity_user` (ya usados por las políticas de `profiles`, por lo que `authenticated`
conserva EXECUTE) e `is_platform_user_active` (no se revoca). El bucket es nuevo: no hay
objetos ni políticas previas que migrar. `profiles.avatar_url` no tiene datos que convertir
(0 filas con avatar).

### Riesgo funcional
Medio (es la única parte que exige cambio coordinado de app + Storage): hasta que el bucket y
las políticas existen y la app usa firmas, la subida/visualización de avatar no funciona — **ya
no funciona hoy**, así que no hay regresión. El resto de perfiles (nombre, usuario, estado) no
cambia. No se usa `service_role` en el frontend.

### Comprobaciones previas
```sql
SELECT id, public FROM storage.buckets WHERE id = 'avatars';        -- no debe existir
SELECT polname FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'objects' AND pg_get_expr(COALESCE(polqual, polwithcheck), polrelid) LIKE '%avatars%';
SELECT count(*) FILTER (WHERE avatar_url IS NOT NULL) FROM public.profiles;
```

### Pruebas posteriores
Spec nuevo `e2e-tests/avatars.spec.ts` (subida, reemplazo con borrado del anterior, borrado,
usuario desactivado sin escritura, URL firmada caducada → renovación, y `getPublicUrl`
ausente en el código); pruebas manuales con dos usuarios distintos (uno no puede escribir en la
carpeta del otro) y con un usuario de plataforma autorizado (puede firmar el avatar ajeno).

### Reversión
```sql
DROP POLICY IF EXISTS "avatars_select_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_select_profile_viewers" ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'avatars';
```
(El `DELETE` del bucket solo si no contiene objetos; en su defecto, dejarlo privado sin
políticas.) Revertir los archivos DDD al estado anterior.

---

## 6. Grupo F — EXECUTE y privilegios de tabla (hallazgo 3.1)

**Principio:** nada de revocaciones masivas indiscriminadas. Se ejecuta en dos sub-fases:
primero la que **no puede romper flujos** (retirar `PUBLIC`/`anon`), después la que exige la
matriz de dependencias (retirar `authenticated` **solo** en funciones internas demostradas).

### F.1 — Retirada de `PUBLIC` y `anon` (riesgo de incompatibilidad: muy bajo)

```sql
-- Todas las funciones del esquema: sin EXECUTE implícito para PUBLIC ni para anon.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Se re-otorga explícitamente a los dos roles que sí lo necesitan.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Mínimo privilegio en tablas: TRUNCATE/REFERENCES/TRIGGER/MAINTAIN no son alcanzables
-- por PostgREST y no los usa ningún flujo; se retiran de anon y authenticated.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated;
```

**Alcance del riesgo:** las políticas RLS y las de Storage se evalúan como `authenticated` (que
conserva EXECUTE), las funciones anidadas se ejecutan como su propietario `postgres` (que
mantiene sus derechos por propiedad), y las Edge Functions usan `service_role`. **No hay
consumidor legítimo de `anon`**: el login y la aceptación de invitaciones se hacen con sesión
autenticada (`accept_company_client_invitation` no se toca, solo cambia que `anon` no puede
invocarla).

**Cambio de comportamiento asumido y documentado:** una petición **no autenticada** a Storage o
a una RPC que dependa de una función revocada devolverá error de permisos en lugar de una
respuesta vacía. Los buckets son privados y no hay superficie anónima legítima; se acepta y se
verifica explícitamente tras aplicar.

### F.2 — Retirada de `authenticated` en funciones INTERNAS (riesgo: alto si se hace mal)

Regla de decisión, verificada con datos reales:

| Condición | Decisión |
|---|---|
| La función aparece en alguna política RLS/Storage (`en_politicas > 0`) | **CONSERVAR** EXECUTE para `authenticated` (si no, todas las políticas fallan) |
| La aplicación la invoca con `supabase.rpc()` | **CONSERVAR** |
| Es función de trigger (`RETURNS trigger`) | Irrelevante para RPC: no se puede invocar directamente |
| Ninguna de las anteriores | **REVOCAR** (interna: solo la llaman funciones `SECURITY DEFINER` cuyo propietario es `postgres`) |

```sql
-- Grupo interno sin consumidores directos (verificado: 0 políticas, 0 llamadas desde la app).
REVOKE EXECUTE ON FUNCTION public.worker_vacation_balance(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_worker_vacation_accrual(uuid,integer,integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.vacation_count_working_days(uuid,date,date,boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.vacation_target_annual(uuid,integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_vacation_accrual_start(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_vacation_accrual_end(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_vacation_is_employed_on(uuid,date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_vacation_weekdays_on(uuid,date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_position_on(uuid,date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_entity_descendant(uuid,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_academic_payment_scope(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_academic_category_payment_for_flags(uuid,boolean,boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_company_wide_role_management(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.company_client_deletion_target() FROM authenticated;      -- opcional
```

> **Esta es la alternativa segura que separa el acceso directo de la ejecución interna
> autorizada** (requisito de la sección 5 del encargo): **no se añade ninguna guarda dentro de
> las funciones**, por lo que los cálculos de vacaciones, prenomina y nómina quedan
> **exactamente igual**; simplemente dejan de ser invocables desde fuera. Se cumple además la
> advertencia de no usar `can_access_entity(entidad, NULL)` sin demostrar suficiencia: no se usa.
>
> Nota sobre el grupo D: las cuatro `*_storage_object_entity` **no se revocan** para
> `authenticated` porque son necesarias dentro de las políticas de `storage.objects`. Para
> `anon` quedan revocadas por F.1 (no hay lectura anónima legítima; los buckets son privados).

### Archivos de aplicación a modificar
Ninguno (verificado: la app no invoca ninguna de las funciones de la lista).

### Matriz de dependencias (extracto verificado)

| Función | Políticas | ¿Trigger? | Funciones SQL que la llaman | App | Decisión |
|---|---|---|---|---|---|
| `can_access_entity` | 163 | no | 128 | sí | Conservar `authenticated` |
| `is_platform_superadmin` | 129 | no | 32 | sí | Conservar |
| `has_platform_permission` | 21 | no | 39 | sí | Conservar |
| `can_use_company_client_permission` | 2 | no | 9 | no | Conservar (políticas) |
| `can_manage_salary_scale` / `can_read_salary_scale` / `can_create_salary_scale` | 7 / 3 / 1 | no | 5 / 0 / 0 | no | Conservar (políticas) |
| `can_grant_company_client_role`, `can_invite_to_company_client`, `can_list_company_client_memberships` | 3 / 3 / 1 | no | 0 | no | Conservar (políticas) |
| `can_view_entity_user_access`, `can_view_invitation_role`, `can_view_company_client_user_roles` | 1 cada una | no | 1 / 1 / 0 | no | Conservar (políticas) |
| `can_view_entity`, `can_view_entity_user`, `can_view_platform_user`, `can_manage_platform_user`, `can_access_document_generation_event`, `is_platform_user_active` | 1 / 1 / 1 / 1 / 2 / 1 | no | — | parcial | Conservar (políticas) |
| `worker_/candidate_/governing_document_/document_template_storage_object_entity` | 8 / 4 / 3 / 4 | no | 0 / 0 / 0 / 1 | no | Conservar `authenticated`; revocar `anon` (F.1) |
| `migration_validate_rows`, `migration_import_rows`, `migration_create_single_worker`, `migration_create_worker` | 0 | no | 2 | **sí** | Conservar |
| `prenomina_*` (13) | 0 | no | — | **sí** | Conservar |
| `has_company_client_permission`, `is_platform_user` | 0 | no | 0 | **sí** | Conservar (¡no por prefijo!) |
| `adjust_worker_vacation_balance`, `register_worker_vacation`, `post_worker_vacation_accrual`, `run_worker_vacation_catchup`, `worker_vacation_summary`, `entity_vacation_overview` | 0 | no | — | sí/algunas | Conservar (ya llevan control interno) |
| `worker_vacation_balance` y el resto de helpers 3.2 | 0 | no | 5/2/3… | **no** | **Revocar** (F.2) |
| `is_entity_descendant` | 0 | no | 3 | **no** | **Revocar** (F.2) |
| `resolve_academic_payment_scope`, `resolve_academic_category_payment_for_flags` | 0 | no | 3 / 3 | **no** | **Revocar** (F.2) |
| `resolve_academic_category_payment`, `get_academic_category_payment_config` | 0 | no | 0 / 1 | **sí** | Conservar |
| `has_company_wide_role_management` | 0 | no | 2 | no | Revocar (F.2, opcional) |
| `company_client_deletion_target` | 0 | no | 2 (triggers) | no | Revocar (F.2, opcional) |
| `protect_*`, `grant_*_to_system_roles`, `ensure_entity_administrator_role`, `enforce_*`, `organization_*_validate`, `candidates_*`, `*_sync_*`, `*_same_company_client` | 0 | **sí** | — | no | Sin acción (no invocables por RPC) |
| `position_working_weekdays`, `resolve_entity_representative(s)`, `format_*`, `sitecorp_code_*`, `can_*` sin consumidores | 0 | no | varios | no | Opcional F.2 (bajo valor) |

### Riesgo de incompatibilidad (crítico a vigilar)
1. **Revocar `authenticated` en una función referenciada por políticas** rompería todas las
   políticas afectadas (p. ej. `can_access_entity`: 163 políticas, 128 funciones y toda la app).
   Mitigación: la lista F.2 contiene **solo** funciones con `en_politicas = 0` y sin llamadas
   desde la app; se verificará la matriz de nuevo inmediatamente antes de ejecutar.
2. Revocar a `anon` cambia el **mensaje** de error de peticiones no autenticadas (de vacío a
   permiso denegado). Asumido y documentado; se comprueba con una petición anónima de prueba.
3. `service_role` conserva todos sus privilegios (no se revoca nada de él) → Edge Functions
   intactas.

### Comprobaciones previas
```sql
-- Estado efectivo actual (incluye lo heredado de PUBLIC).
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f' ORDER BY 1;

-- ACL de tablas (debe conservarse postgres/service_role).
SELECT relname, relacl FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';
```
(Volver a ejecutar la consulta de la matriz de políticas/llamadas justo antes de F.2.)

### Pruebas posteriores
`run_tests` con la suite completa (o al menos `app-boot`, `access-control`,
`platform-account-administration`, `organization-screens`, `expediente-integration`,
`document-generation`, `payroll-preparation`, `worker-transitions`, `company-client`) y prueba
manual de: login, listados por entidad, alta de trabajador, prenomina (crear periodo,
refrescar trabajadores), vacaciones (registrar/consultar), certificado médico, e importación de
trabajadores.

### Reversión
```sql
-- Reversión de F.1
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;   -- o, preferible, función a función
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public TO anon;
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public TO authenticated;

-- Reversión de F.2 (por función)
GRANT EXECUTE ON FUNCTION public.<nombre>(<args>) TO authenticated;
```
(El snapshot del grupo 0/§8 conserva `proacl` y `relacl` exactos para restaurarlos literalmente.)

---

## 7. Orden recomendado de aplicación

| # | Grupo | Vulnerabilidad | Por qué en este orden |
|---|---|---|---|
| 0 | Snapshot de definiciones originales | — | Requisito obligatorio previo (§8) |
| 1 | **A** Roles de sistema (trigger + RPC + INSERT policy) | 1.1, 1.2 | Autocontenido, no depende de nada y cierra la única ALTA de autorización |
| 2 | **B** Matriz de permisos de plataforma + cambio DDD (roles) | 1.3 | Se apoya en A para que la matriz ya esté protegida; toca UI en el mismo paso |
| 3 | **C** RPC médicas | 2.1–2.3 | Autocontenido, bajo riesgo, validable con flujos existentes |
| 4 | **D** Políticas `worker_documents_*` | 4.2 | Cambio de 4 políticas, sin app |
| 5 | **E** Avatares (bucket + políticas + DDD) | 4.1 / decisión A | Primer bloque con cambio coordinado app+Storage |
| 6 | **F.1** EXECUTE `PUBLIC`/`anon` + privilegios de tabla | 3.1 (sistémico) | Sin consumidores legítimos; verificar que nada se rompe |
| 7 | **F.2** EXECUTE `authenticated` en funciones internas | 3.2–3.5 | El más sensible; requiere la verificación de matriz justo antes |
| 8 | Verificación final y cierre | — | Suite completa + comprobaciones de regresión |

Se aplicará **un grupo por paso**, con sus comprobaciones previas y sus pruebas posteriores, y
sin avanzar si el grupo anterior no queda verificado.

---

## 8. Conservación de definiciones originales y reversión

**Estado de recuperabilidad (requisito previo a la autorización):**

- **Todos** los objetos afectados por este plan existen hoy y sus definiciones son exactas y
  recuperables por catálogo: cuerpos con `pg_get_functiondef`, políticas con
  `pg_get_expr(polqual/polwithcheck)`, triggers con `pg_get_triggerdef`, privilegios con
  `proacl`/`relacl`. **No hay ninguna definición irrecoverable en la FASE 3.**
- Los 6 objetos irrecoverables documentados en la FASE 2 (`document_generation_events_select/_insert`
  y las cuatro `candidate_documents_*`) **no forman parte de este plan** y no se tocan: el
  problema de reversión incompleta de la fase 2 no se repite.

**Snapshot obligatorio antes de aplicar (paso 0).** Volcar a
`docs/fase-3-snapshot-originales.sql` (archivo generado en el momento de la autorización, no
ahora) con estas consultas, que guardan el estado literal:

```sql
-- 1) Funciones a reemplazar o alterar (A, C).
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_functiondef(p.oid) AS definicion, p.proacl::text AS acl, p.proconfig AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('save_platform_role','create_worker_medical_certificate',
                    'update_worker_medical_certificate','get_worker_medical_certificate')
ORDER BY 1;

-- 2) Funciones candidatas a revocación de EXECUTE (F.2) con su ACL exacto.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl::text AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'worker_vacation_balance','calculate_worker_vacation_accrual','vacation_count_working_days',
  'vacation_target_annual','worker_vacation_accrual_start','worker_vacation_accrual_end',
  'worker_vacation_is_employed_on','worker_vacation_weekdays_on','worker_position_on',
  'is_entity_descendant','resolve_academic_payment_scope',
  'resolve_academic_category_payment_for_flags','has_company_wide_role_management',
  'company_client_deletion_target') ORDER BY 1;

-- 3) Políticas a alterar (B, D) o a crear (E) con su expresión exacta.
SELECT n.nspname AS esquema, c.relname AS tabla, pol.polname,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
       pol.polcmd, pol.polroles::regrole[] AS roles
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname = 'public' AND pol.polname IN ('platform_roles_insert','platform_role_permissions_select'))
   OR (n.nspname = 'storage' AND pol.polname LIKE 'worker_documents_%')
ORDER BY 1, 2, 3;

-- 4) ACL de TODAS las tablas y funciones de public (para la reversión literal de F.1).
SELECT relname, relacl::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1;
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1, 2;

-- 5) Estado de Storage (para revertir E).
SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;
SELECT polname, pg_get_expr(COALESCE(polqual, polwithcheck), polrelid) AS expr
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'objects' ORDER BY 1;
```

**Reversión por grupo:** incluida en cada apartado; en todos los casos equivale a (a) restaurar
definiciones del snapshot, (b) `DROP` de lo creado (trigger/función/políticas/bucket) y (c)
restaurar `proacl`/`relacl`. En la aplicación, la reversión es volver los ficheros DDD del
grupo correspondiente al estado anterior (no hay datos que deshacer salvo, en E, el borrado del
objeto de avatar sustituido, que es dato del propio usuario).

---

## 9. Plan de pruebas

| Grupo | Specs existentes | Spec nuevo / prueba manual |
|---|---|---|
| A | `access-control.spec.ts`, `platform-account-administration.spec.ts` | Manual: guardar rol no-sistema OK; quitar permiso a rol de sistema → error del backend |
| B | `access-control.spec.ts`, `platform-account-administration.spec.ts` | Manual con usuario `platform_roles.view` sin `manage` (modo consulta sin matriz) y con `manage` (matriz editable); ampliar contrato en spec |
| C | `expediente-integration.spec.ts`, `document-generation.spec.ts` | Manual: alta/edición de certificado con documento; intento con `p_tenant_id` ajeno → error |
| D | `expediente-integration.spec.ts` | Manual: usuario activo OK; desactivado → fallo en las 4 operaciones |
| E | `app-boot.spec.ts` | **Nuevo `e2e-tests/avatars.spec.ts`**: subir → ver (URL firmada) → reemplazar (borra el anterior) → borrar; desactivado sin escritura; sin `getPublicUrl` en el código; páginas sin `@/lib/supabase` |
| F.1 | Suite completa (`app-boot`, `access-control`, `platform-account-administration`, `organization-screens`, `company-client`, `expediente-integration`, `document-generation`, `payroll-preparation`, `worker-transitions`) | Comprobación anónima: una petición sin sesión no obtiene datos |
| F.2 | Mismos specs + recorrido manual: login, listados, alta de trabajador, prenomina (periodo/refresh), vacaciones, certificado, importación | — |

Ejecución: `run_tests` por lotes con los specs afectados; `run_type_checks` tras los cambios
DDD; `run_build` solo si se tocan dependencias o configuración (aquí no es necesario salvo que
el cambio DDD de avatares lo requiera).

---

## 10. Resumen de entregables

1. **Decisiones incorporadas:** avatares privados + URLs firmadas (TTL 3600 s, renovación,
   `avatar_url` = ruta, sin `service_role` en el frontend); matriz de permisos de plataforma
   solo con `platform_roles.manage`/SuperAdmin.
2. **SQL definitivo propuesto:** grupos A, B, C, D, E, F.1 y F.2 (§1–§6), ninguno ejecutado.
3. **Cambios DDD:** capa de dominio (reglas puras de avatar), repositorios
   (`authentication`, `user-profiles`, `roles`), aplicación (`authentication.commands`,
   `roles.queries`, nueva `account.queries`) y presentación (`AuthContext`,
   `sidebar-user-menu`, `Account`, `roles-manager`).
4. **Matriz de dependencias de EXECUTE:** §6, con la regla "políticas ⇒ conservar" y la lista
   explícita de funciones internas revocables.
5. **Riesgos de incompatibilidad:** §6 (revocar funciones de políticas; mensaje para `anon`),
   §5 (cambio coordinado app+Storage) y §2 (modo consulta de roles).
6. **Plan de pruebas:** §9.
7. **Plan de reversión:** por grupo + snapshot obligatorio (§8) con las consultas exactas.
8. **Orden recomendado:** §7 (0 snapshot → A → B → C → D → E → F.1 → F.2 → verificación final).

**Sin autorización no se ejecuta nada.** Al autorizar, el primer paso será generar
`docs/fase-3-snapshot-originales.sql` con las consultas del §8 y revisarlo antes de aplicar el
grupo A.