# FASE 3 de 3 — Diagnóstico de endurecimiento y validación final

**Método:** auditoría **de solo lectura** sobre la base de datos del proyecto (catálogos
`pg_policy`, `pg_proc`, `pg_class.relacl`, `pg_trigger`, `storage.buckets`, `storage.objects`)
y lectura del código de la aplicación y de las Edge Functions.

**Estado:** no se ha modificado nada (ni Supabase, ni políticas, ni funciones, ni permisos, ni
Storage, ni código de la aplicación). La propuesta SQL del final **no está ejecutada**.

**Alcance revisado:** 79 tablas `public` con RLS, 4 tablas `storage` con RLS, 3 buckets,
~250 funciones `public`, 5 Edge Functions, `src/domains/**`.

**Ramawork:** `feat/DDD-migration-backend`. Sin commits, push, merge ni despliegues.

**No se encontró ningún hallazgo CRÍTICO** (las fases 1 y 2 cerraron esa superficie). Se
registran 1 hallazgo ALTA, 5 MEDIA y 5 BAJA.

---

## 1. Protección de roles de sistema

### 1.1 Verificado y correcto (no tocar)

| Objeto | Comprobación |
|---|---|
| `platform_roles` (RLS) | INSERT/UPDATE/DELETE sólo `is_platform_superadmin()`. `platform_roles_update_system_protected` y `platform_roles_delete_protected` exigen `is_system_role = false`, así que ni el SuperAdmin altera o borra un rol de sistema por tabla. |
| Trigger `platform_roles_protect_reserved` (`protect_reserved_platform_role`) | Impide renombrar, desactivar, quitar `is_system_role` y borrar el rol reservado `SuperAdmin`. |
| `company_client_roles` / `company_client_role_permissions` (RLS) | Escrituras sólo `is_platform_superadmin()`; los administradores de empresa/entidad pasan por RPC. |
| Triggers `company_client_roles_protect_system` y `company_client_role_permissions_protect_system` | Impide renombrar, desactivar, cambiar la entidad propietaria, borrar y **reducir/cambiar los permisos** de un rol de sistema (con la única excepción del borrado definitivo del workspace). |
| `save_platform_role` | Bloquea crear un rol llamado `SuperAdmin`, renombrar/desactivar roles de sistema y **cualquier** cambio de permisos del rol `SuperAdmin`. Anti-escalada: un no-SuperAdmin sólo puede asignar permisos de plataforma que **ya tiene**. |
| `save_entity_role` / `delete_entity_role` | Bloquean modificar/borrar roles de sistema, exigen `roles.manage` en la entidad, impiden asignar permisos internos que el llamante no posee y no borran roles con usuarios o invitaciones asignadas. |
| `create-platform-admin` (Edge Function) | Verifica JWT + perfil activo + SuperAdmin y rechaza asignar roles de sistema. |

### Hallazgo 1.1 — Los permisos de un rol de sistema de PLATAFORMA sí se pueden alterar vía RPC

1. **Objeto afectado:** `public.save_platform_role(uuid,text,text,boolean,uuid[])` y la tabla
   `public.platform_role_permissions` (sin trigger de protección).
2. **Comportamiento verificado:** la protección "no cambiar permisos de un rol de sistema"
   sólo se aplica cuando `platform_roles.name = 'SuperAdmin'`. Para cualquier **otro** rol de
   sistema (`is_system_role = true`), la función hace
   `DELETE FROM platform_role_permissions WHERE platform_role_id = v_role_id AND platform_permission_id <> ALL(...)`
   y su `INSERT` correspondiente, además de `UPDATE platform_roles SET description = ...`.
   Al ser `SECURITY DEFINER` (propietario `postgres`, tabla sin `FORCE ROW LEVEL SECURITY`)
   la escritura **no pasa por RLS**, así que la protección de tabla
   (`platform_roles_update_system_protected`) queda eludida. No existe el equivalente de
   `protect_system_company_client_role_permissions` en `platform_role_permissions`.
3. **Riesgo:** un usuario con `platform_roles.manage` (sin ser SuperAdmin) puede **vaciar o
   reescribir** los permisos de un rol de sistema de plataforma y su descripción. No puede
   concederse permisos nuevos (la comprobación anti-escalada lo impide), pero sí degradar
   roles de sistema que usan otros administradores → integridad de la autorización y
   denegación de servicio administrativa.
4. **Gravedad:** **ALTA** (elusión de una protección explícita de roles de sistema).
5. **Corrección recomendada:** trigger `BEFORE DELETE OR UPDATE` en
   `platform_role_permissions` espejo del de empresa + endurecer `save_platform_role` para
   que el bloqueo de permisos aplique a **todos** los roles de sistema (y no sólo a
   `SuperAdmin`), con mensaje explícito.
6. **Impacto funcional:** nulo en flujos legítimos: crear/editar roles **no** sistema sigue
   igual y un "guardado sin cambios" de un rol de sistema sigue funcionando (no hay DELETE que
   dispare el trigger).

### Hallazgo 1.2 — Un SuperAdmin puede crear un rol de plataforma bloqueado

1. **Objeto:** política `platform_roles_insert` (`WITH CHECK (is_platform_superadmin())`).
2. **Comportamiento:** el `INSERT` no restringe `is_system_role`; `save_platform_role` sí
   inserta siempre `false`, pero un SuperAdmin puede insertar por PostgREST un rol con
   `is_system_role = true`, que queda inmediatamente inmutable e indeleble por diseño.
3. **Riesgo:** rol "atascado" que nadie (ni el SuperAdmin) puede corregir o borrar.
4. **Gravedad:** **BAJA** (sólo SuperAdmin, autoinfligido).
5. **Corrección:** añadir `is_system_role = false` al `WITH CHECK` de `platform_roles_insert`
   (o forzarlo con un trigger `BEFORE INSERT`).
6. **Impacto:** nulo (la aplicación nunca crea roles de sistema).

### Hallazgo 1.3 — `platform_roles.view` expone los permisos de todos los roles de plataforma

1. **Objeto:** política `platform_role_permissions_select`
   (`is_platform_superadmin() OR has_platform_permission('platform_roles.view')`).
2. **Comportamiento:** quien tiene `platform_roles.view` lee el mapa rol→permisos de **todos**
   los roles de plataforma, incluido SuperAdmin (las asignaciones de personas en
   `platform_user_roles` sí están restringidas).
3. **Riesgo:** conocimiento de la matriz de autorización de plataforma por un perfil de
   "consulta". No expone roles de personas.
4. **Gravedad:** **MEDIA** (a confirmar: puede ser una capacidad administrativa legítima).
5. **Corrección:** si se decide restringir, exigir `platform_roles.manage` (o SuperAdmin) en
   `platform_role_permissions_select` y mantener `platform_roles.view` sólo para el catálogo.
6. **Impacto:** la pantalla de roles de plataforma en modo consulta dejaría de mostrar los
   permisos de cada rol; requiere confirmación de negocio antes de aplicar.
7. **Clasificación:** *riesgo potencial que necesita comprobación / decisión*, no
   vulnerabilidad confirmada.

---

## 2. Seguridad de las RPC médicas

### 2.1 Verificado y correcto

- Funciones del área: `create_worker_medical_certificate`, `update_worker_medical_certificate`,
  `get_worker_medical_certificate`, `list_entity_medical_certificates`,
  `list_worker_medical_certificates`.
- **Autorización:** las escrituras exigen
  `can_access_entity(organization_entity_id, 'medical_certificates.manage')` y las lecturas
  `'medical_certificates.view'` **o** `'medical_certificates.manage'`; `list_*` exige además
  `auth.uid() IS NOT NULL`. `can_access_entity` comprueba usuario activo, misma
  `company_client_id` en membresía/asignación/rol/entidad, ámbito `SELF`/`SELF_AND_DESCENDANTS`
  y entidad activa.
- **Solo-consulta no gestiona:** un usuario con `medical_certificates.view` **no** puede
  crear, actualizar ni `get`+modificar (los `get/get_worker_medical_certificate` sólo leen).
- **Ámbito empresa/entidad:** tanto la tabla `worker_medical_certificates` (4 políticas
  `TO authenticated`, 2 con `medical_certificates.manage`, 1 de lectura con `view OR manage`)
  como las políticas de Storage del bucket `worker_documents`
  (`medical_certificates_storage_*`, ruta `workers/*/medical-certificates/**`) están acotadas
  por entidad y permiso.
- **Grants:** `worker_medical_certificates` **no** tiene privilegios para `anon`
  (`{postgres, authenticated, service_role}`).
- La tabla de certificados no se escribe desde la interfaz: sólo por estas RPC.

### Hallazgo 2.1 — `create_worker_medical_certificate` acepta un `company_client_id` ajeno

1. **Objeto:** `public.create_worker_medical_certificate(... p_tenant_id uuid ...)`.
2. **Comportamiento verificado:** valida fechas, `medical_certificates.manage`, que el
   trabajador pertenezca a la entidad y que el documento pertenezca al trabajador, pero
   **no** comprueba que `p_tenant_id` sea el `company_client_id` del trabajador/entidad:
   inserta el valor recibido tal cual.
3. **Riesgo:** un usuario con gestión médica en su entidad puede insertar un certificado
   etiquetado con **otra empresa** (falsificación de la columna de pertenencia; afecta a
   informes/contadores y a cualquier futuro uso de `company_client_id`).
4. **Gravedad:** **MEDIA**.
5. **Corrección:** derivar el cliente del trabajador y **rechazar** el parámetro si no
   coincide (manteniendo la firma para no romper la llamada).
6. **Impacto:** ninguno (la aplicación ya envía el valor correcto).

### Hallazgo 2.2 — Autoría del certificado aportada por el cliente

1. **Objeto:** mismo RPC, parámetro `p_created_by`.
2. **Comportamiento:** se escribe en la columna `created_by` sin validar contra `auth.uid()`.
3. **Riesgo:** se puede atribuir la creación de un registro médico a otro usuario
   (falsificación de auditoría).
4. **Gravedad:** **BAJA**.
5. **Corrección:** escribir `created_by = auth.uid()` (parámetro conservado por
   compatibilidad, ignorado).
6. **Impacto:** nulo (la referencia de autoría pasa a ser la real).

### Hallazgo 2.3 — Tres funciones médicas `SECURITY DEFINER` sin `search_path`

1. **Objeto:** `create_worker_medical_certificate`, `update_worker_medical_certificate` y
   `get_worker_medical_certificate` (`proconfig = NULL`).
2. **Comportamiento:** a diferencia del resto de funciones del proyecto
   (`SET search_path TO 'public','auth'` o `''`), estas tres no fijan `search_path`. Usan
   nombres cualificados, por lo que la explotación práctica exige un esquema inyectado en el
   `search_path` de la sesión; el riesgo real es bajo.
3. **Riesgo:** inconsistencia de endurecimiento; superficies de *search_path hijacking* en
   funciones privilegiadas.
4. **Gravedad:** **BAJA**.
5. **Corrección:** `ALTER FUNCTION ... SET search_path TO 'public','auth'`.
6. **Impacto:** nulo.

---

## 3. Revisión general de permisos `EXECUTE`

### 3.1 Hallazgo principal — `PUBLIC`/`anon` puede ejecutar prácticamente todas las funciones

1. **Objeto:** todas las funciones de `public` (EXECUTE otorgado a `PUBLIC` por defecto, y por
   tanto a `anon` y `authenticated`). Ejemplos comprobados con
   `has_function_privilege('anon', oid, 'EXECUTE') = true`:
   `save_platform_role`, `save_company_client_role`, `save_entity_role`, `delete_entity_role`,
   `create_company_client`, `migration_import_rows`, `migration_create_worker`,
   `list_entity_medical_certificates`, `get_worker_medical_certificate`,
   `create_worker_medical_certificate`, `list_company_client_invitations`, etc.
   Además `anon` conserva el ACL completo de tabla (`arwdDxtm`: SELECT, INSERT, UPDATE,
   DELETE, **TRUNCATE**, REFERENCES, TRIGGER) en 52 tablas `public` (p. ej. `profiles`,
   `workers`, `platform_roles`, `platform_user_roles`, `company_client_*`,
   `prenomina_periods`).
2. **Comportamiento verificado:** la mayoría de las funciones **fallan de forma segura** para
   un llamante sin sesión, porque el control está en el cuerpo:
   `can_access_entity` devuelve `false` si `auth.uid() IS NULL`;
   `is_platform_user_active()` es `false` sin perfil; `is_platform_superadmin`,
   `has_platform_permission`, `is_platform_user` también. La invocación por PostgREST
   (`/rest/v1/rpc/...`) no expone `TRUNCATE`, por lo que el ACL de tabla no es alcanzable por
   esa vía.
3. **Riesgo:** (a) superficie de ataque innecesaria en Internet sin autenticación
   (fuzzing, errores detallados, coste); (b) **cualquier función futura que olvide el control
   interno queda explotable sin sesión**; (c) el ACL de tabla es una bomba de relojería si
   alguna vez se entrega una credencial del rol `anon` (p. ej. `TRUNCATE` no respeta RLS).
4. **Gravedad:** **ALTA** (riesgo sistémico, no explotación directa confirmada).
5. **Corrección recomendada (por fases):**
   - Fase A (bajo riesgo, alto valor): `REVOKE EXECUTE ... FROM PUBLIC` y `FROM anon`, y
     `GRANT EXECUTE` a `authenticated` y `service_role` (mantiene intacto todo lo que usa la
     aplicación, las políticas RLS y las Edge Functions), más
     `REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` de `anon`/`authenticated` sobre todas
     las tablas `public`.
   - Fase B (tras inventario por función): revocar `EXECUTE` a `authenticated` en las
     funciones internas (ver 3.2–3.5) y en las auxiliares `can_*`, `has_*`, `is_*`,
     `migration_*`, `prenomina_*`.
6. **Impacto funcional:** Fase A no afecta a ningún flujo actual (todo se invoca con sesión
   autenticada o con `service_role`); requiere ejecutar el inventario de consumidores antes
   (ya levantado: 126 llamadas `rpc()` en `src/domains`, 5 Edge Functions, políticas RLS de
   tabla y de Storage y triggers).

**Dependencias ya comprobadas antes de tocar permisos:**
- App (`src/domains/**`): siempre con sesión de usuario (`authenticated`).
- Edge Functions: `create-platform-admin`, `create-sitecorp-user` y `delete-workspace` usan
  `service_role` para lo administrativo y el **token del usuario** para la RPC autorizada.
- Políticas RLS y de Storage ejecutan como `authenticated`/`service_role`; los triggers no
  comprueban EXECUTE al dispararse, y además la propuesta conserva el grant a
  `authenticated`.
- Funciones internas ya restringidas hoy (precedente válido): `prenomina_recalc_entry`,
  `vacation_post_accrual_internal`.
- No existe función pública legítima para `anon`: el flujo de aceptación de invitaciones se
  ejecuta con sesión (`accept_company_client_invitation`, sin uso desde la interfaz
  actual; no se toca su lógica).

### 3.2 Hallazgo — Lecturas de trabajador sin control de autorización (IDOR por UUID)

1. **Objetos** (`SECURITY DEFINER`, sin `auth.uid()` ni permiso en el cuerpo, y con EXECUTE
   para `anon`): `worker_vacation_balance(uuid)`,
   `calculate_worker_vacation_accrual(uuid,int,int)`, `vacation_count_working_days(...)`,
   `vacation_target_annual(...)`, `worker_vacation_accrual_start/_end(uuid)`,
   `worker_vacation_is_employed_on(...)`, `worker_vacation_weekdays_on(...)`,
   `worker_position_on(uuid,date)`.
2. **Comportamiento verificado:** devuelven datos de **cualquier** trabajador cuyo UUID se
   conozca (saldo de vacaciones, días laborables, puesto vigente, fechas de empleo), sin
   sesión ni ámbito de empresa. `calculate_worker_vacation_accrual` es `STABLE` (no escribe).
3. **Riesgo:** fuga de datos laborales entre empresas y sin autenticación. La explotación
   requiere conocer un UUID (no enumerable) → riesgo real pero acotado.
4. **Gravedad:** **MEDIA**.
5. **Corrección:** guarda común de autorización en cada función
   (`auth.uid() IS NOT NULL` **y** acceso a la entidad del trabajador) y, después,
   `REVOKE EXECUTE ... FROM anon`. Se recomienda una guarda **amplia**
   (`can_access_entity(w.organization_entity_id, NULL)` = "cualquier acceso a la entidad")
   porque estas funciones se invocan internamente desde nómina/prenómina/vacaciones.
6. **Impacto funcional:** **requiere verificación previa de llamantes internos**
   (`register_worker_vacation`, `post_worker_vacation_accrual`, `prenomina_*`,
   `entity_vacation_overview`), que ya validan permisos propios; con la guarda amplia
   conservan su comportamiento.

### 3.3 Hallazgo — Resolución de rutas de Storage sin permiso

1. **Objetos:** `worker_storage_object_entity(text)`, `candidate_storage_object_entity(text)`,
   `governing_document_storage_object_entity(text)`,
   `document_template_storage_object_entity(text)`.
2. **Comportamiento:** reciben un `object_name` arbitrario y devuelven la entidad propietaria.
3. **Riesgo:** oráculo "ruta → entidad" invocable sin sesión (sólo útil si ya se conoce la
   ruta).
4. **Gravedad:** **BAJA**.
5. **Corrección:** revocar `EXECUTE` de `anon` (Fase A de 3.1). Mantener para
   `authenticated`: son necesarias dentro de las políticas de `storage.objects`.
6. **Impacto:** nulo.

### 3.4 Hallazgo — `is_entity_descendant` expuesta

1. **Objeto:** `public.is_entity_descendant(uuid,uuid)` (SECURITY DEFINER, EXECUTE a `anon`).
2. **Comportamiento:** responde si dos entidades cualesquiera tienen relación ancestro/
   descendiente.
3. **Riesgo:** filtración de la jerarquía organizativa entre empresas (requiere conocer ambas
   entidades).
4. **Gravedad:** **BAJA**.
5. **Corrección:** `REVOKE EXECUTE ... FROM anon` (y, opcionalmente, guarda de sesión).
6. **Impacto:** nulo.

### 3.5 Hallazgo — Clasificación de pago académico sin permiso de entidad

1. **Objetos:** `resolve_academic_payment_scope(uuid)`,
   `resolve_academic_category_payment_for_flags(uuid,boolean,boolean)`,
   `resolve_academic_category_payment(uuid,uuid)`.
2. **Comportamiento:** devuelven el régimen/escala de pago de cualquier entidad (`p_entity_id`)
   sin comprobar acceso.
3. **Riesgo:** revela configuración salarial/clasificación de otra empresa.
4. **Gravedad:** **BAJA**.
5. **Corrección:** guarda de acceso a la entidad + `REVOKE ... FROM anon`.
6. **Impacto:** verificar llamantes (`salary.repository`/`academic-payment.repository`), que ya
   operan sobre entidades accesibles.

### 3.6 Observación — Funciones que devuelven `trigger` no son invocables por RPC

`protect_reserved_platform_role`, `protect_system_company_client_role`,
`protect_system_company_client_role_permissions`,
`grant_company_client_permission_to_system_roles`,
`grant_initial_import_permission_to_system_roles`, `ensure_entity_administrator_role`,
`organization_areas_validate`, `organization_entity_hierarchy_is_valid`,
`organization_entity_parent_is_company_client_safe`, `candidates_*`, `enforce_*`,
`representative_assignment_sync_entity`, `entity_user_access_same_company_client`,
`company_client_invitation_*`: PostgreSQL rechaza su invocación directa ("trigger functions
can only be called as triggers"). **No requieren acción**; su EXECUTE es irrelevante.

---

## 4. Seguridad de avatares en Supabase Storage

### 4.1 Hallazgo — El bucket `avatars` no existe (y no tiene políticas)

1. **Objeto:** `storage.buckets` / `storage.objects` y
   `src/domains/access-control/infrastructure/authentication.repository.ts`
   (`const AVATARS_BUCKET = "avatars"`, ruta `<user_id>/<archivo>`, `getPublicUrl`).
2. **Comportamiento verificado:** los buckets existentes son `documents`,
   `document-templates` y `worker_documents` (los tres **privados**). **No existe** el bucket
   `avatars` y **ninguna** política de `storage.objects` lo menciona. Por tanto hoy la subida
   de avatar falla en Storage (bucket inexistente) y, aunque se creara el bucket, seguiría
   denegada porque `storage.objects` tiene RLS activo y no hay política para él.
3. **Riesgo:** (a) funcional: la sustitución de avatar no puede completarse;
   (b) de seguridad: **no** hay vía para que un usuario lea o modifique el avatar de otro vía
   Storage (no hay objetos ni políticas), ni escritura de usuarios desactivados por esa vía.
   El riesgo real es de **configuración**: crear el bucket sin políticas o público de más
   abriría lectura global no intencionada.
4. **Gravedad:** **MEDIA** (brecha de configuración; sin exposición actual).
5. **Corrección recomendada (a autorizar):** crear el bucket y 4 políticas de propietario
   (`foldername(name)[1] = auth.uid()::text`) exigiendo además `is_platform_user_active()`,
   y decidir `public = true` (necesario para que `getPublicUrl` sirva el archivo) frente a
   privado + URLs firmadas. Sin acceso entre usuarios en ningún caso.
6. **Impacto funcional:** habilita la función de avatar (hoy inoperante); no cambia nada más.
   Requiere decisión de negocio sobre public/privado.

### 4.2 Hallazgo — Usuarios desactivados conservan escritura en su carpeta de `worker_documents`

1. **Objeto:** políticas `worker_documents_select`, `worker_documents_upload`,
   `worker_documents_update`, `worker_documents_delete` del bucket `worker_documents`
   (ruta `workers/<uid>/...`).
2. **Comportamiento verificado:** exigen `foldername(name)[2] = auth.uid()::text` pero **no**
   comprueban el estado del perfil. El resto de políticas de Storage sí lo hacen de forma
   transitiva (`can_access_entity` → `is_platform_user_active()`).
3. **Riesgo:** un usuario desactivado (perfil `is_active = false`) con una sesión válida
   conserva subida, reemplazo y borrado en su carpeta de Storage, aunque toda la capa de
   datos ya lo bloquea.
4. **Gravedad:** **MEDIA**.
5. **Corrección:** añadir `AND public.is_platform_user_active()` a las cuatro políticas
   (`ALTER POLICY ... USING/WITH CHECK`).
6. **Impacto funcional:** nulo para usuarios activos.

### 4.3 Verificado y correcto

- Los tres buckets son privados; todas las políticas de `storage.objects` están acotadas a un
  `bucket_id` concreto y a un permiso de entidad (candidatos, documentos de trabajador,
  documentos rectores, plantillas, certificados médicos).
- `profiles.avatar_url` sólo lo puede escribir su titular (`profiles_update_policy`,
  `auth.uid() = id AND is_platform_user_active()`) o un administrador de plataforma con
  `can_manage_platform_user(id)` (`profiles_update_admin`) → capacidad administrativa legítima.
- Rutas y metadatos de Storage se derivan del nombre del objeto; no hay listado global.

---

## 5. Validación final de seguridad

### 5.1 Verificado y correcto

| Área | Evidencia |
|---|---|
| RLS activo | Las 79 tablas `public` y las 8 de `storage` tienen `relrowsecurity = true` (ninguna con `FORCE`; por diseño, porque los `SECURITY DEFINER` del propietario deben poder operar) |
| Políticas permisivas | Sólo catálogos con `USING (true)` y **siempre `TO authenticated`**: `company_client_permissions`, `platform_permissions`, `document_types`, `document_variables`, `document_template_types`, `driving_license_categories`, `education_levels`, `employment_contract_types`, `entity_regimes` (SELECT), `genders`, `marital_statuses`, `municipalities`, `occupational_categories`, `payment_methods`, `preparation_levels`, `provinces`, `skin_colors`, `worker_separation_reasons`. Las escrituras de `entity_regimes` son `TO service_role`. **Ninguna política permisiva anula una restricción real** |
| Aislamiento empresa/entidad | `can_access_entity` exige misma `company_client_id` y ámbito (`SELF`/`SELF_AND_DESCENDANTS`); `worker_medical_certificates`, `workers`, `worker_documents`, `worker_payroll_movements`, `worker_salary_history`, `salary_*`, `academic_category_payments`, `document_batches/_items`, `candidate_documents`, `governing_documents`, `company_client_roles`, `organization_entities` verificadas una a una |
| Tablas sólo-RPC | `worker_vacations`, `worker_vacation_movements`, `prenomina_periods/_worker_entries/_night_entries` sólo tienen política `SELECT` (escritura exclusivamente por RPC `SECURITY DEFINER` autorizada) |
| Bloqueo de desactivados | `is_platform_user_active()` en `is_platform_superadmin`, `has_platform_permission`, `can_use_company_client_permission`, `can_access_entity`, `is_platform_user_active`→`profiles_update_policy`, `can_view_*`, `can_grant_company_client_role`; pendiente Storage propio (4.2) |
| Anti-escalada | `entity_user_access` (INSERT/UPDATE + trigger `*_same_company_client`), `company_client_invitations` (`can_grant_company_client_role`), `save_entity_role`/`save_platform_role` (sólo permisos propios), `delete_entity_role`, `platform_roles_update_system_protected`, `company_client_roles_*` (sólo SuperAdmin). Excepción: hallazgo 1.1 |
| Lectura/gestión separadas | Fase 2 conservada: roles ajenos sólo con gestión de roles efectiva; invitaciones consultables por todos con el rol enmascarado por RPC |
| Integridad de flujos | La app no lee tablas con rol ajeno, no compone SQL y no toca `schema-target`; Edge Functions verifican identidad y autorización; sin `anon` en tablas médicas/perfiles sensibles |

### 5.2 Riesgos potenciales que necesitan comprobación (no confirmados)

1. `platform_roles.view` → permisos de todos los roles de plataforma (1.3): decisión de
   negocio.
2. ACL de tabla para `anon` (`TRUNCATE`/`REFERENCES`/`TRIGGER`): no alcanzable por PostgREST,
   pero contrario a mínimo privilegio (3.1).
3. Bucket `avatars` inexistente: decidir public/privado antes de crearlo (4.1).
4. Idempotencia de la propuesta 3.2: verificar los llamantes internos antes de aplicar la
   guarda de las funciones de vacaciones/puesto.

### 5.3 Configuraciones legítimas que NO deben modificarse

- Rol `service_role` y Edge Functions privilegiadas (`create-platform-admin`,
  `create-sitecorp-user`, `delete-workspace`): patrones correctos (JWT + perfil activo +
  permiso; y RPC autorizada en nombre del usuario).
- Catálogos globales con lectura `TO authenticated` (5.1) y escrituras `TO service_role`.
- `accept_company_client_invitation` y el flujo de aceptación: intactos.
- Protección de roles de sistema de **empresa** (triggers `protect_system_*`): correcta.
- RPC de lectura usadas por la app (`can_access_entity`, `list_*`, `has_*`, `is_*`): deben
  conservar EXECUTE para `authenticated`.

---

## 6. Propuesta SQL (NO ejecutada)

> Orden recomendado: 6.1 (roles de sistema) → 6.2/6.3 (médicas) → 6.4 (Storage) → 6.5
> (EXECUTE) → 6.6 (IDOR). Cada bloque con su verificación previa y su *rollback*.

### 6.1 Roles de sistema (hallazgos 1.1 y 1.2)

```sql
-- H1.1a — Trigger espejo del de empresa para los permisos de roles de sistema de plataforma.
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

  IF COALESCE(v_is_system, false) THEN
    RAISE EXCEPTION 'System platform role permissions cannot be reduced or changed';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER platform_role_permissions_protect_system
  BEFORE DELETE OR UPDATE ON public.platform_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_platform_role_permissions();

-- H1.1b — save_platform_role: el bloqueo de permisos aplica a TODOS los roles de sistema.
--   (Reemplaza el bloque `IF v_existing_role.name = 'SuperAdmin' THEN ... END IF` por una
--    única comprobación de conjunto para cualquier rol de sistema, con mensaje propio, y
--    prohíbe también cambiar la descripción de un rol de sistema.)
-- H1.2 — platform_roles_insert no puede crear roles de sistema:
ALTER POLICY "platform_roles_insert" ON public.platform_roles
  WITH CHECK (public.is_platform_superadmin() AND is_system_role = false);
```

Verificación previa: `SELECT count(*) FROM public.platform_roles WHERE is_system_role` (los
roles de sistema existentes deben conservar sus permisos). Rollback: `DROP TRIGGER` +
`DROP FUNCTION` + restaurar la política anterior.

### 6.2 RPC médicas (hallazgos 2.1, 2.2 y 2.3)

```sql
-- H2.1 + H2.2 — misma firma; el cliente se deriva del trabajador y la autoría es la real.
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

  -- El cliente SIEMPRE se deriva del trabajador; el parámetro se valida, no se confía.
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

-- H2.3 — search_path explícito en las tres funciones médicas.
ALTER FUNCTION public.create_worker_medical_certificate(uuid,uuid,uuid,date,date,integer,uuid,uuid) SET search_path TO 'public','auth';
ALTER FUNCTION public.update_worker_medical_certificate(uuid,date,date,integer,uuid) SET search_path TO 'public','auth';
ALTER FUNCTION public.get_worker_medical_certificate(uuid) SET search_path TO 'public','auth';
```

Verificación previa: la app envía siempre `p_tenant_id` correcto
(`src/domains/vacations-licenses/medical-certificates/**`). Rollback: restaurar las
definiciones anteriores.

### 6.3 Storage — avatares y desactivados (hallazgos 4.1 y 4.2)

```sql
-- H4.1 — Bucket de avatares + políticas de propietario. (Decisión pendiente: public.)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "avatars_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = (auth.uid())::text);

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

-- H4.2 — La carpeta propia de worker_documents exige perfil activo.
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

Impacto: si el bucket es `public`, la lectura por URL pública no pasa por RLS (correcto para
una foto de perfil); la escritura queda estrictamente en la carpeta propia.

### 6.4 Permisos EXECUTE (hallazgo 3.1)

```sql
-- Fase A — sin anon/PUBLIC, conservando authenticated y service_role.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Mínimo privilegio en tablas (no alcanzable por PostgREST; defensa en profundidad).
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Fase B (opcional, por función, tras revisar consumidores):
-- REVOKE EXECUTE ON FUNCTION public.is_entity_descendant(uuid,uuid) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.<helper>(...) FROM authenticated;  -- can_*/has_*/is_*
```

Verificación previa: inventario ya hecho (app con sesión, Edge Functions con `service_role`,
políticas y triggers como `authenticated`/propietario). Rollback: `GRANT EXECUTE ... TO anon`
y `GRANT TRUNCATE, REFERENCES, TRIGGER ... TO anon`.

### 6.5 Lecturas internas sin autorización (hallazgos 3.2 a 3.5)

```sql
-- Guarda común (patrón por función). Ejemplo con worker_vacation_balance:
CREATE OR REPLACE FUNCTION public.worker_vacation_balance(p_worker_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_entity uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT w.organization_entity_id INTO v_entity
  FROM public.workers w WHERE w.id = p_worker_id;

  -- Guarda AMPLIA: basta con tener acceso a la entidad del trabajador (cubre a los
  -- llamantes internos de vacaciones/prenómina/nómina).
  IF v_entity IS NULL OR NOT public.can_access_entity(v_entity, NULL) THEN
    RAISE EXCEPTION 'Worker was not found or you do not have access to it';
  END IF;

  RETURN COALESCE((SELECT sum(amount) FROM public.worker_vacation_movements
                   WHERE worker_id = p_worker_id), 0)::numeric(10,4);
END;
$function$;

-- Mismo patrón en: calculate_worker_vacation_accrual, vacation_count_working_days,
-- vacation_target_annual, worker_vacation_accrual_start/_end,
-- worker_vacation_is_employed_on, worker_vacation_weekdays_on, worker_position_on.
-- Y en resolve_academic_payment_scope / resolve_academic_category_payment_for_flags:
--   IF auth.uid() IS NULL OR NOT public.can_access_entity(p_entity_id, NULL) THEN RAISE ...
-- Y en is_entity_descendant / *_storage_object_entity: al menos exigir sesión.
```

Verificación previa obligatoria: listar los llamantes de cada función
(`register_worker_vacation`, `post_worker_vacation_accrual`, `run_worker_vacation_catchup`,
`entity_vacation_overview`, `worker_vacation_summary`, `prenomina_*`) y confirmar que la
guarda amplia no introduce denegaciones. Rollback: reponer los cuerpos anteriores.

### 6.6 Decisión de negocio pendiente (hallazgo 1.3)

```sql
-- Sólo si se decide que la matriz de permisos de plataforma no debe ser visible con
-- `platform_roles.view`:
ALTER POLICY "platform_role_permissions_select" ON public.platform_role_permissions
  USING (public.is_platform_superadmin()
         OR public.has_platform_permission('platform_roles.manage'));
```

---

## 7. Resumen

| # | Área | Objeto | Gravedad | Estado |
|---|---|---|---|---|
| 1.1 | Roles de sistema | `save_platform_role` + `platform_role_permissions` | **ALTA** | Confirmada |
| 1.2 | Roles de sistema | `platform_roles_insert` | BAJA | Confirmada |
| 1.3 | Roles de sistema | `platform_role_permissions_select` | MEDIA | Potencial (decisión) |
| 2.1 | RPC médicas | `create_worker_medical_certificate` (`company_client_id`) | MEDIA | Confirmada |
| 2.2 | RPC médicas | `create_worker_medical_certificate` (`created_by`) | BAJA | Confirmada |
| 2.3 | RPC médicas | 3 funciones sin `search_path` | BAJA | Confirmada |
| 3.1 | EXECUTE | EXECUTE a `PUBLIC`/`anon` + ACL de tabla | **ALTA** | Confirmada (sistémica) |
| 3.2 | EXECUTE | Lecturas de trabajador sin autorización | MEDIA | Confirmada |
| 3.3 | EXECUTE | `*_storage_object_entity` | BAJA | Confirmada |
| 3.4 | EXECUTE | `is_entity_descendant` | BAJA | Confirmada |
| 3.5 | EXECUTE | `resolve_academic_*` sin permiso | BAJA | Confirmada |
| 4.1 | Storage | Bucket `avatars` inexistente | MEDIA | Confirmada (configuración) |
| 4.2 | Storage | `worker_documents_*` sin perfil activo | MEDIA | Confirmada |

**Sin hallazgos críticos.** Ninguna corrección de las fases 1 y 2 se reabre.