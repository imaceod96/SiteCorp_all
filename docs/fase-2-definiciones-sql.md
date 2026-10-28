# SiteCorp · FASE 2 — Registro de definiciones SQL de seguridad

Registro **documental** (no es una migración: no se ejecuta ni lo consume la aplicación).
Se guarda fuera de las rutas de migraciones (`supabase/migrations`, `src/db/migrations`) y
no contiene datos personales ni identificadores de usuarios reales.

- Rama: `feat/DDD-migration-backend`
- Alcance: funciones, políticas RLS y triggers tocados en la FASE 2 (roles, generación de
  documentos, documentos de candidatos, usuarios desactivados y visibilidad de roles).
- Origen de las definiciones actuales: lectura directa de Supabase (`pg_get_functiondef`,
  `pg_policies`, `pg_trigger`) inmediatamente después de aplicar cada cambio.
- Los `NOT NULL`/comentarios de ayuda no se reproducen: los cuerpos son literales.

> Aviso de reversión: **no existe reversión exacta de todas las políticas**. Ver §3 y §4.

---

## 1. Definiciones ACTUALES verificadas

### 1.1 Funciones auxiliares nuevas de la FASE 2

```sql
-- Visibilidad de los roles ASIGNADOS a una membresía de cliente.
-- Permite: sus propios roles, superadmin, gestión de roles de plataforma
-- (`tenant_roles.manage`) y gestión de roles en la entidad o la empresa del rol.
CREATE OR REPLACE FUNCTION public.can_view_company_client_user_roles(p_membership_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.company_client_memberships own
      WHERE own.id = p_membership_id AND own.user_id = auth.uid()
    )
    OR public.is_platform_superadmin()
    OR public.has_platform_permission('tenant_roles.manage')
    OR EXISTS (
      SELECT 1
      FROM public.company_client_user_roles cur
      JOIN public.company_client_roles r ON r.id = cur.company_client_role_id
      WHERE cur.company_client_membership_id = p_membership_id
        AND (
          (r.organization_entity_id IS NULL
           AND public.can_use_company_client_permission(r.company_client_id, 'roles.manage'))
          OR
          (r.organization_entity_id IS NOT NULL
           AND public.can_access_entity(r.organization_entity_id, 'roles.manage'))
        )
    );
$function$;
```

```sql
-- Anti-escalada: el rol concedido no puede tener permisos que el actor no posea
-- en el ámbito del destino. `NULL` (sin rol) nunca escala.
CREATE OR REPLACE FUNCTION public.can_grant_company_client_role(p_role_id uuid, p_organization_entity_id uuid, p_company_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT CASE
    WHEN p_role_id IS NULL THEN true
    WHEN public.is_platform_superadmin() THEN true
    WHEN public.has_platform_permission('users.manage_all') THEN true
    ELSE NOT EXISTS (
      SELECT 1
      FROM public.company_client_role_permissions rp
      JOIN public.company_client_permissions p ON p.id = rp.company_client_permission_id
      WHERE rp.company_client_role_id = p_role_id
        AND NOT (
          CASE
            WHEN p_organization_entity_id IS NOT NULL
              THEN public.can_access_entity(p_organization_entity_id, p.code)
            ELSE public.can_use_company_client_permission(p_company_client_id, p.code)
          END
        )
    )
  END;
$function$;
```

```sql
-- Acceso a los eventos de generación documental, por empresa y entidad,
-- incluido el caso de `organization_entity_id IS NULL`.
CREATE OR REPLACE FUNCTION public.can_access_document_generation_event(p_company_client_id uuid, p_organization_entity_id uuid, p_operation text DEFAULT 'VIEW'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.is_platform_user_active()
    AND (
      public.is_platform_superadmin()
      OR CASE
        WHEN p_organization_entity_id IS NOT NULL THEN
          EXISTS (
            SELECT 1 FROM public.organization_entities oe
            WHERE oe.id = p_organization_entity_id
              AND oe.company_client_id = p_company_client_id
          )
          AND CASE
            WHEN p_operation = 'GENERATE' THEN
              public.can_access_entity(p_organization_entity_id, 'workers.manage')
              OR public.can_access_entity(p_organization_entity_id, 'candidates.manage')
            ELSE
              public.can_access_entity(p_organization_entity_id, 'workers.view')
              OR public.can_access_entity(p_organization_entity_id, 'workers.manage')
          END
        ELSE
          EXISTS (
            SELECT 1 FROM public.company_client_memberships m
            WHERE m.user_id = auth.uid()
              AND m.company_client_id = p_company_client_id
              AND m.is_active = true
          )
          AND CASE
            WHEN p_operation = 'GENERATE' THEN
              public.can_use_company_client_permission(p_company_client_id, 'workers.manage')
              OR public.can_use_company_client_permission(p_company_client_id, 'candidates.manage')
            ELSE
              public.can_use_company_client_permission(p_company_client_id, 'workers.view')
              OR public.can_use_company_client_permission(p_company_client_id, 'workers.manage')
          END
      END
    );
$function$;
```

```sql
-- Visibilidad de los accesos (y de sus roles) de una entidad. Cierra la consulta de
-- roles ajenos por `users.view`: propio acceso, superadmin, gestión de roles de
-- plataforma, gestión de roles en la entidad del acceso o gestión de roles de empresa.
CREATE OR REPLACE FUNCTION public.can_view_entity_user_access(p_membership_id uuid, p_organization_entity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.company_client_memberships own
      WHERE own.id = p_membership_id AND own.user_id = auth.uid()
    )
    OR public.is_platform_superadmin()
    OR public.has_platform_permission('tenant_roles.manage')
    OR public.can_access_entity(p_organization_entity_id, 'roles.manage')
    OR EXISTS (
          SELECT 1
          FROM public.company_client_memberships row_m
          WHERE row_m.id = p_membership_id
            AND public.has_company_wide_role_management(row_m.company_client_id)
        );
    $function$;
    ```

```sql
-- Protección efectiva de `profiles.is_active`. NO es SECURITY DEFINER: `current_user`
-- es el rol invocante real, de modo que los mecanismos administrativos
-- (`service_role`/`postgres`/`supabase_admin`) pasan y nadie más cambia el estado,
-- y NADIE cambia el suyo propio (ni estando activo).
CREATE OR REPLACE FUNCTION public.protect_profile_is_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NOT NULL AND auth.uid() = NEW.id THEN
      RAISE EXCEPTION 'No puede cambiar el estado de activacion de su propio usuario'
        USING ERRCODE = '42501';
    END IF;

    IF NOT (public.is_platform_superadmin() OR public.has_platform_permission('users.manage_all')) THEN
      RAISE EXCEPTION 'La activacion o desactivacion de usuarios requiere autorizacion administrativa'
        USING ERRCODE = '42501';
    END IF;
  END IF;
    RETURN NEW;
  END;
  $function$;
  ```
  
  ```sql
  -- Gestión de roles con alcance de EMPRESA (no de entidad): el llamante tiene un rol
  -- activo de empresa (`organization_entity_id IS NULL`) en ese cliente cuyos permisos
  -- incluyen `roles.manage`. Requiere usuario de plataforma activo.
  CREATE OR REPLACE FUNCTION public.has_company_wide_role_management(p_company_client_id uuid)
   RETURNS boolean
   LANGUAGE sql
   STABLE SECURITY DEFINER
   SET search_path TO 'public', 'auth'
  AS $function$
    SELECT public.is_platform_user_active() AND EXISTS (
      SELECT 1
      FROM public.company_client_memberships mine
      JOIN public.company_client_user_roles cur ON cur.company_client_membership_id = mine.id
      JOIN public.company_client_roles r ON r.id = cur.company_client_role_id
      JOIN public.company_client_role_permissions rp ON rp.company_client_role_id = r.id
      JOIN public.company_client_permissions p ON p.id = rp.company_client_permission_id
      WHERE mine.user_id = auth.uid()
        AND mine.is_active = true
        AND mine.company_client_id = p_company_client_id
        AND r.company_client_id = p_company_client_id
        AND r.is_active = true
        AND r.organization_entity_id IS NULL
        AND p.code = 'roles.manage'
    );
  $function$;
  ```
  
  ```sql
  -- ¿Puede el llamante consultar el ROL de esta invitación? El rol de una invitación ajena
  -- sólo es visible con gestión de roles efectiva en su ámbito (empresa o entidad) o para
  -- administradores de plataforma autorizados. La invitación PROPIA es la excepción.
  CREATE OR REPLACE FUNCTION public.can_view_invitation_role(p_company_client_id uuid, p_organization_entity_id uuid, p_email text)
   RETURNS boolean
   LANGUAGE sql
   STABLE SECURITY DEFINER
   SET search_path TO 'public', 'auth'
  AS $function$
    SELECT public.is_platform_user_active() AND (
      -- Invitación PROPIA: el invitado puede consultar el rol de su invitación.
      (auth.uid() IS NOT NULL
        AND p_email IS NOT NULL
        AND lower(p_email) = lower(COALESCE(auth.jwt() ->> 'email', '')))
      OR public.is_platform_superadmin()
      OR public.has_platform_permission('tenant_roles.manage')
      -- Gestión de roles de EMPRESA: rol de empresa con `roles.manage` en ese cliente.
      OR public.has_company_wide_role_management(p_company_client_id)
      -- Gestión de roles DENTRO de la entidad de la invitación.
      OR (p_organization_entity_id IS NOT NULL
          AND public.can_access_entity(p_organization_entity_id, 'roles.manage'))
    );
  $function$;
  ```
  
  ### 1.2 Funciones centrales modificadas en la FASE 2

```sql
CREATE OR REPLACE FUNCTION public.is_platform_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.is_platform_user_active() AND EXISTS (
    SELECT 1
    FROM public.platform_user_roles pur
    JOIN public.platform_roles pr ON pur.platform_role_id = pr.id
    WHERE pur.user_id = auth.uid()
      AND pr.name = 'SuperAdmin'
      AND pr.is_active = true
      AND pr.is_system_role = true
  )
$function$;
```

```sql
CREATE OR REPLACE FUNCTION public.has_platform_permission(permission_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.is_platform_user_active() AND (
    EXISTS (
      SELECT 1
      FROM public.platform_user_roles pur
      JOIN public.platform_roles pr ON pur.platform_role_id = pr.id
      JOIN public.platform_role_permissions prp ON prp.platform_role_id = pr.id
      JOIN public.platform_permissions pp ON pp.id = prp.platform_permission_id
      WHERE pur.user_id = auth.uid()
        AND pr.is_active = true
        AND prp.platform_permission_id = (
          SELECT id FROM public.platform_permissions WHERE code = permission_code
        )
    )
    OR public.is_platform_superadmin()
  );
$function$;
```

```sql
CREATE OR REPLACE FUNCTION public.can_use_company_client_permission(target_tenant_id uuid, permission_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.is_platform_user_active() AND (
    public.is_platform_superadmin()
    OR public.has_platform_permission('organizations.manage_all')
    OR public.has_platform_permission('users.manage_all')
    OR EXISTS (
      SELECT 1
      FROM public.company_client_memberships tm
      JOIN public.company_client_user_roles tur ON tur.company_client_membership_id = tm.id
      JOIN public.company_client_roles tr ON tr.id = tur.company_client_role_id
      JOIN public.company_client_role_permissions trp ON trp.company_client_role_id = tr.id
      JOIN public.company_client_permissions tp ON tp.id = trp.company_client_permission_id
      WHERE tm.user_id = auth.uid()
        AND tm.company_client_id = target_tenant_id
        AND tm.is_active = true
        AND tr.company_client_id = target_tenant_id
        AND tr.is_active = true
        AND tp.code = permission_code
    )
  );
$function$;
```

Funciones **verificadas** (ya contenían la comprobación, no se modificaron):

- `public.is_platform_user_active()` — `COALESCE((SELECT is_active FROM public.profiles WHERE id = auth.uid()), false)`.
- `public.can_access_entity(uuid, text)` — devuelve `false` si `auth.uid()` es nulo o si
  `NOT public.is_platform_user_active()`.

### 1.3 Función de consulta modificada

```sql
-- Mismo contrato de visibilidad de USUARIOS (`users.view` intacto), pero el rol
-- asignado sólo se devuelve a quien puede gestionar roles o al propio interesado.
CREATE OR REPLACE FUNCTION public.list_entity_user_access(target_entity_id uuid)
 RETURNS TABLE(access_id uuid, tenant_membership_id uuid, user_id uuid, full_name text, username text, profile_is_active boolean, tenant_role_id uuid, role_name text, source_entity_id uuid, source_entity_name text, access_scope text, is_direct boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  WITH authorized AS (
    SELECT public.is_platform_superadmin()
        OR public.has_platform_permission('users.view_all')
        OR public.has_platform_permission('users.manage_all')
        OR public.can_access_entity(target_entity_id, 'users.view')
        OR public.can_access_entity(target_entity_id, 'users.manage') AS allowed
  )
  SELECT
    eua.id,
    eua.company_client_membership_id,
    tm.user_id,
    p.full_name,
    p.username,
    COALESCE(p.is_active, true),
    CASE
      WHEN public.can_view_entity_user_access(eua.company_client_membership_id, source.id)
        THEN eua.company_client_role_id
    END,
    CASE
      WHEN public.can_view_entity_user_access(eua.company_client_membership_id, source.id)
        THEN tr.name
    END,
    source.id,
    source.name,
    eua.access_scope,
    source.id = target_entity_id
  FROM public.entity_user_access eua
  JOIN public.company_client_memberships tm ON tm.id = eua.company_client_membership_id
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  JOIN public.company_client_roles tr ON tr.id = eua.company_client_role_id
  JOIN public.organization_entities source ON source.id = eua.organization_entity_id
  CROSS JOIN authorized
  WHERE authorized.allowed
    AND eua.is_active = true
    AND tm.is_active = true
    AND tr.is_active = true
    AND COALESCE(source.is_active, true) = true
    AND (
      source.id = target_entity_id
      OR (
        eua.access_scope = 'SELF_AND_DESCENDANTS'
        AND public.is_entity_descendant(source.id, target_entity_id)
      )
    );
$function$;
```

```sql
-- Consulta de invitaciones de un cliente. Sustituye la lectura DIRECTA de la tabla por
-- parte de la app: la tabla ya no es legible sin gestión de roles (ver 1.4.5), así que el
-- identificador del rol no es alcanzable; aquí se devuelve la fila con el rol ENMASCARADO
-- (NULL) para quien no puede gestionar roles, conservando la consulta para todos los
-- perfiles del ámbito. `ORDER BY created_at DESC` replica el orden que antes fijaba la app.
CREATE OR REPLACE FUNCTION public.list_company_client_invitations(p_company_client_id uuid)
 RETURNS TABLE(invitation_id uuid, email text, status text, expires_at timestamp with time zone, accepted_at timestamp with time zone, created_at timestamp with time zone, organization_entity_id uuid, access_scope text, role_id uuid, role_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    inv.id,
    inv.email,
    inv.status,
    inv.expires_at,
    inv.accepted_at,
    inv.created_at,
    inv.organization_entity_id,
    inv.access_scope,
    -- El identificador y el nombre del rol SÓLO se devuelven a quien puede gestionar roles
    -- en el ámbito de la invitación (o al propio invitado).
    CASE
      WHEN public.can_view_invitation_role(inv.company_client_id, inv.organization_entity_id, inv.email)
        THEN inv.company_client_role_id
    END,
    CASE
      WHEN public.can_view_invitation_role(inv.company_client_id, inv.organization_entity_id, inv.email)
        THEN r.name
    END
  FROM public.company_client_invitations inv
  LEFT JOIN public.company_client_roles r ON r.id = inv.company_client_role_id
  WHERE inv.company_client_id = p_company_client_id
    -- Misma visibilidad de filas que la política actual: nadie pierde la consulta de
    -- invitaciones de su ámbito (plataforma, empresa o entidad).
    AND (
      public.is_platform_superadmin()
      OR public.has_platform_permission('users.view_all')
      OR public.has_platform_permission('users.manage_all')
      OR public.can_use_company_client_permission(inv.company_client_id, 'users.view')
      OR public.can_use_company_client_permission(inv.company_client_id, 'users.invite')
      OR (inv.organization_entity_id IS NOT NULL
          AND public.can_access_entity(inv.organization_entity_id, 'users.invite'))
      OR (auth.uid() IS NOT NULL
          AND lower(inv.email) = lower(COALESCE(auth.jwt() ->> 'email', '')))
    )
  ORDER BY inv.created_at DESC;
$function$;
```

### 1.4 Políticas RLS actuales (todas `TO authenticated`)

```sql
-- 1. Roles de usuario por membresía: sólo roles propios o con gestión de roles.
CREATE POLICY "company_client_user_roles_select" ON public.company_client_user_roles
  FOR SELECT TO authenticated
  USING (public.can_view_company_client_user_roles(company_client_membership_id));

-- 2. Acceso de entidad: alta protegida contra escalada de privilegios.
CREATE POLICY "entity_user_access_insert" ON public.entity_user_access
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_platform_superadmin()
     OR public.has_platform_permission('users.manage_all')
     OR public.can_access_entity(organization_entity_id, 'users.manage'))
    AND public.can_grant_company_client_role(company_client_role_id, organization_entity_id, NULL)
  );

CREATE POLICY "entity_user_access_update" ON public.entity_user_access
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_superadmin()
    OR public.has_platform_permission('users.manage_all')
    OR public.can_access_entity(organization_entity_id, 'users.manage')
  )
  WITH CHECK (
    (public.is_platform_superadmin()
     OR public.has_platform_permission('users.manage_all')
     OR public.can_access_entity(organization_entity_id, 'users.manage'))
    AND public.can_grant_company_client_role(company_client_role_id, organization_entity_id, NULL)
  );

-- 3. Lectura directa de accesos: sin rol ajeno y sin rol de otra entidad.
--    (Alterada conservando nombre y rol: `ALTER POLICY ... USING (...)`.)
CREATE POLICY "entity_user_access_select" ON public.entity_user_access
  FOR SELECT TO authenticated
  USING (public.can_view_entity_user_access(company_client_membership_id, organization_entity_id));

-- 4. Invitaciones: el rol invitado tampoco puede escalar (vía alternativa cerrada,
--    porque `accept_company_client_invitation` es SECURITY DEFINER y salta RLS).
CREATE POLICY "company_client_invitations_insert" ON public.company_client_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_platform_superadmin()
     OR public.has_platform_permission('users.invite')
     OR public.has_platform_permission('users.manage_all')
     OR ((organization_entity_id IS NULL) AND public.can_invite_to_company_client(company_client_id))
     OR ((organization_entity_id IS NOT NULL) AND (company_client_role_id IS NOT NULL)
         AND public.can_access_entity(organization_entity_id, 'users.invite')))
    AND public.can_grant_company_client_role(company_client_role_id, organization_entity_id, company_client_id)
  );

CREATE POLICY "company_client_invitations_update" ON public.company_client_invitations
  FOR UPDATE TO authenticated
  USING (
    (public.is_platform_superadmin()
     OR public.has_platform_permission('users.manage_all')
     OR ((organization_entity_id IS NULL) AND public.can_invite_to_company_client(company_client_id))
     OR ((organization_entity_id IS NOT NULL) AND public.can_access_entity(organization_entity_id, 'users.invite')))
    AND public.can_grant_company_client_role(company_client_role_id, organization_entity_id, company_client_id)
  )
  WITH CHECK (
    (public.is_platform_superadmin()
     OR public.has_platform_permission('users.manage_all')
     OR ((organization_entity_id IS NULL) AND public.can_invite_to_company_client(company_client_id))
     OR ((organization_entity_id IS NOT NULL) AND public.can_access_entity(organization_entity_id, 'users.invite')))
    AND public.can_grant_company_client_role(company_client_role_id, organization_entity_id, company_client_id)
      );
    
    -- 4.b Lectura directa de invitaciones: el rol ajeno NO es alcanzable. La política exige
    --     gestión de roles efectiva en el ámbito de la invitación (o ser el propio invitado),
    --     de modo que quien sólo tiene `users.view` / `users.invite` consulta las invitaciones
    --     por la RPC `list_company_client_invitations` (ver 1.3), ya con el rol enmascarado.
    --     La tabla NO se lee de forma directa desde la app (el identificador del rol no es
    --     alcanzable sin permiso de gestión de roles, que es lo que pedía la FASE 2).
    --     (Alterada conservando nombre y rol: `ALTER POLICY ... USING (...)`.)
    CREATE POLICY "company_client_invitations_select" ON public.company_client_invitations
      FOR SELECT TO authenticated
      USING (public.can_view_invitation_role(company_client_id, organization_entity_id, email));
    
    -- 5. Eventos de generación documental: consulta y generación separadas.
CREATE POLICY "document_generation_events_select" ON public.document_generation_events
  FOR SELECT TO authenticated
  USING (public.can_access_document_generation_event(company_client_id, organization_entity_id, 'VIEW'));

CREATE POLICY "document_generation_events_insert" ON public.document_generation_events
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_document_generation_event(company_client_id, organization_entity_id, 'GENERATE'));

-- 6. Documentos de candidatos: espejo de las políticas de `candidates`.
CREATE POLICY "candidate_documents_select_policy" ON public.candidate_documents
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidates c
    WHERE c.id = candidate_documents.candidate_id
      AND (public.can_access_entity(c.organization_entity_id, 'candidates.view')
        OR public.can_access_entity(c.organization_entity_id, 'candidates.manage'))
  ));

CREATE POLICY "candidate_documents_insert_policy" ON public.candidate_documents
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.candidates c
    WHERE c.id = candidate_documents.candidate_id
      AND public.can_access_entity(c.organization_entity_id, 'candidates.manage')
  ));

CREATE POLICY "candidate_documents_update_policy" ON public.candidate_documents
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidates c
    WHERE c.id = candidate_documents.candidate_id
      AND public.can_access_entity(c.organization_entity_id, 'candidates.manage')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.candidates c
    WHERE c.id = candidate_documents.candidate_id
      AND public.can_access_entity(c.organization_entity_id, 'candidates.manage')
  ));

CREATE POLICY "candidate_documents_delete_policy" ON public.candidate_documents
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidates c
    WHERE c.id = candidate_documents.candidate_id
      AND public.can_access_entity(c.organization_entity_id, 'candidates.manage')
  ));

-- 7. Perfil propio: sin cambios en el `WITH CHECK`; el estado se protege con el trigger.
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((auth.uid() = id) AND public.is_platform_user_active())
  WITH CHECK (auth.uid() = id);
```

### 1.5 Triggers

```sql
CREATE TRIGGER profiles_protect_is_active
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_is_active();
```

### 1.6 Privilegios EXECUTE

No se amplió ningún privilegio `EXECUTE`. Las funciones nuevas se crearon con la ACL por
defecto del esquema (`EXECUTE` a `PUBLIC`), exactamente como las auxiliares que ya existían
(`can_access_entity`, `is_platform_superadmin`, …), que es lo que permite invocarlas desde
las políticas que se ejecutan como `authenticated`.

---

## 2. Definiciones ORIGINALES recuperables (por inversión exacta del cambio)

Estas definiciones previas se reconstruyen con certeza porque el cambio aplicado fue una
**adición mecánica** y basta con retirarla:

| Objeto | Cambio aplicado en FASE 2 | Definición original (inversión exacta) |
|---|---|---|
| `is_platform_superadmin()` | prefijo `public.is_platform_user_active() AND (...)` | el cuerpo actual sin ese prefijo |
| `has_platform_permission(text)` | prefijo `public.is_platform_user_active() AND (...)` | el cuerpo actual sin ese prefijo |
| `can_use_company_client_permission(uuid,text)` | prefijo `public.is_platform_user_active() AND (...)` | el cuerpo actual sin ese prefijo |
| `entity_user_access_insert` (WITH CHECK) | `AND can_grant_company_client_role(...)` | el `WITH CHECK` actual sin ese `AND` |
| `entity_user_access_update` (WITH CHECK) | `AND can_grant_company_client_role(...)` | el `WITH CHECK` actual sin ese `AND` |
| `company_client_invitations_insert` (WITH CHECK) | `AND can_grant_company_client_role(...)` | el `WITH CHECK` actual sin ese `AND` |
| `company_client_invitations_update` (USING y WITH CHECK) | `AND can_grant_company_client_role(...)` | ambas expresiones sin ese `AND` |
| `profiles_update_policy` (USING) | `AND public.is_platform_user_active()` | `USING (auth.uid() = id)` (`WITH CHECK` nunca cambió) |
| `list_entity_user_access` | dos `CASE ... END` de enmascaramiento | el `SELECT` actual devolviendo `eua.company_client_role_id` y `tr.name` directamente |
| `company_client_user_roles_select` | reemplazo completo | `FOR SELECT TO authenticated USING (true)` (según el registro de auditoría de la FASE 2: «permitía a cualquier usuario autenticado ver todos los roles») |
| `company_client_invitations_select` (USING) | reemplazo completo | la expresión de 6 ramas recuperada abajo (texto exacto capturado antes de reemplazarla) |

Original exacto de `company_client_invitations_select` (USING), para restauración literal:

```sql
-- Original (antes de la FASE 2): sin gestión de roles, sólo visibilidad de filas.
CREATE POLICY "company_client_invitations_select" ON public.company_client_invitations
  FOR SELECT TO authenticated
  USING (
    public.is_platform_superadmin()
    OR public.has_platform_permission('users.view_all')
    OR public.has_platform_permission('users.manage_all')
    OR public.can_use_company_client_permission(company_client_id, 'users.view')
    OR public.can_use_company_client_permission(company_client_id, 'users.invite')
    OR ((organization_entity_id IS NOT NULL)
        AND public.can_access_entity(organization_entity_id, 'users.invite'))
  );
```

Restaurar el original exige además revertir el contrato de lectura de la app (que ya no
consulta la tabla de forma directa) o mantener la RPC `list_company_client_invitations`;
sin ese ajuste la pantalla de invitaciones dejaría de mostrar filas.

Retirar los objetos **añadidos** es además inmediato:

```sql
DROP TRIGGER IF EXISTS profiles_protect_is_active ON public.profiles;
DROP FUNCTION IF EXISTS public.protect_profile_is_active();
DROP FUNCTION IF EXISTS public.can_view_entity_user_access(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_view_company_client_user_roles(uuid);
DROP FUNCTION IF EXISTS public.can_grant_company_client_role(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.can_access_document_generation_event(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.can_access_document_generation_event(uuid, uuid);
DROP FUNCTION IF EXISTS public.has_company_wide_role_management(uuid);
DROP FUNCTION IF EXISTS public.can_view_invitation_role(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.list_company_client_invitations(uuid);
```

`has_company_wide_role_management` está además referenciada por
`can_view_entity_user_access`; retirarla exige primero volver a esa función a su versión
inline (misma condición, sin delegación).

---

## 3. Definiciones ORIGINALES NO recuperables

De estos seis objetos se conoce **qué** protegían (hallazgos de la auditoría) pero **no** su
texto literal anterior, porque se reemplazaron de forma completa y ya no existen fuentes
recuperables:

| Objeto | Estado de la definición original | Qué se sabe del original |
|---|---|---|
| `document_generation_events_select` | **no recuperable** | permitía visibilidad de eventos sin el aislamiento por empresa/entidad exigido |
| `document_generation_events_insert` | **no recuperable** | no exigía permiso de gestión ni el ámbito de empresa/entidad |
| `candidate_documents_select_policy` | **no recuperable** | no garantizaba el aislamiento por la entidad del candidato padre |
| `candidate_documents_insert_policy` | **no recuperable** | no exigía `candidates.manage` |
| `candidate_documents_update_policy` | **no recuperable** | no exigía `candidates.manage` |
| `candidate_documents_delete_policy` | **no recuperable** | no exigía `candidates.manage` |

Fuentes consultadas y agotadas para intentar recuperarlas:

- Historial de la conversación: las definiciones se capturaron e imprimieron antes de
  reemplazarlas, pero el historial se compactó y el texto DDL ya no está disponible.
- `pg_stat_statements`: sólo conserva las sentencias **nuevas** (el histórico se había
  desalojado por volumen; 4798 filas ≈ límite del buffer).
- `supabase_migrations.schema_migrations`: no existe/no es accesible en este proyecto.
- `src/db/migrations/`: registra `candidates`, pero **no** `candidate_documents` ni
  `document_generation_events`.
- Copias de seguridad diarias de Supabase: no accesibles desde este entorno.

**Revertir esos seis objetos exigiría reescribirlos a mano** (no es una reversión exacta) y,
además, restauraría las vulnerabilidades corregidas. No se recomienda: `REVOKE`/`DROP` de
los helpers no es equivalente.

---

## 4. Estado de reversión

- **Reversible de forma exacta**: todo lo añadido (§2, `DROP`) y todo lo alterado por
  adición mecánica (§2, retirando el prefijo o el `AND`). `company_client_invitations_select`
  también es restaurable **literalmente** porque su expresión original se capturó (§2), con
  la salvedad de que hay que devolver además la lectura directa de la tabla en la app o
  mantener la RPC de consulta.
- **Reversible sólo por reescritura manual**: los seis objetos de §3. En ese caso la
  reversión **no** es exacta y debe declararse así.
- Los datos **no** se ven afectados por ninguna reversión de políticas, funciones o
  triggers: no se modificó ninguna fila y no se crearon usuarios ni registros sintéticos.
