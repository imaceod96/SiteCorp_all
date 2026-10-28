# FASE 3 — Endurecimiento de seguridad e integridad · Informe final consolidado

**Rama:** `feat/DDD-migration-backend` (no se tocó `dev`).
**Base temporal:** PostgreSQL 17.6 (proyecto Supabase conectado, sin entorno local ni Docker).
**Autorización:** implementación completa de los grupos A, B, C, D, E, F.1 y F.2.
**Sin commits, sin push, sin merge y sin despliegues manuales.**

Documentos relacionados: `docs/fase-3-plan-seguridad.md` (plan), `docs/fase-3-diagnostico-seguridad.md`
(auditoría), `docs/fase-3-snapshot-originales.sql` (definiciones literales y SQL de reversión),
`docs/fase-3-informe-snapshot.md` (paso 0: estado de partida comprobado).

---

## 1. Estado de partida (comprobado antes de aplicar nada)

| Elemento | Valor |
| --- | --- |
| Roles de plataforma | 2 (1 de sistema) |
| Permisos de plataforma | 28 (5 en la matriz rol↔permiso) |
| Asignaciones de usuario a rol de plataforma | 2 |
| Perfiles con avatar | 2 perfiles, **0 con avatar** |
| Certificados médicos incoherentes | 0 de 1 |
| Bucket `avatars` | **no existía** |
| Triggers en `platform_role_permissions` | **ninguno** |
| Funciones en `public` | 415 (223 propias de la app, 192 de extensión de `supabase_admin`) |

---

## 2. Grupo A — Protección de los roles de sistema (plataforma)

**SQL ejecutado**

1. `public.protect_system_platform_role_permissions()` (nueva) + trigger
   `platform_role_permissions_protect_system` `BEFORE DELETE OR UPDATE ON public.platform_role_permissions`.
   Replica el precedente de empresa (`protect_system_company_client_role_permissions`).
   Contempla la excepción legítima de **cambio de catálogo**: si la fila de `platform_permissions`
   ya no existe (borrado en cascada del catálogo), el cambio no se bloquea.
2. `save_platform_role(...)`: cuerpo endurecido. Protege el **conjunto de permisos de todos los
   roles de sistema**, no sólo los reservados de SuperAdmin. Mensaje actual:
   `System platform role permissions cannot be reduced or changed`.
3. Política `platform_roles_insert`: `WITH CHECK (is_platform_superadmin() AND is_system_role = false)`.

**Verificado:** los tres triggers existen con la definición esperada
(`platform_role_permissions_protect_system`, `company_client_role_permissions_protect_system`,
`platform_roles_protect_reserved`).

**Consecuencia en la app:** `isProtectedRole(role)` pasa a un único argumento (todo rol de sistema
está protegido en ambos ámbitos) y `roles.rules.ts` traduce el mensaje **real** que eleva ahora el
backend. Se retiró la traducción `superadmin permissions cannot be reduced`, que ya no puede
producirse, y no se añadieron traducciones para mensajes inexistentes.

---

## 3. Grupo B — Matriz de permisos de plataforma (RLS + DDD + UI)

**SQL ejecutado:** `platform_role_permissions_select` → SuperAdmin **o**
`has_platform_permission('platform_roles.manage')`.

**Verificado:** la política contiene ambas comprobaciones; `platform_roles.view` se conserva y
permite listar roles, pero **no** leer su matriz.

**Código:** `loadRoleScopeWorkspace` resuelve `loadPlatformPermissionSafe("platform_roles.manage")`
y propaga `canReadPermissionMatrix`; `selectRoleScopeRows(..., { includePermissionMatrix })` sólo
pide la matriz cuando está permitido; `roles-manager.tsx` muestra el ámbito en **modo consulta**
(avisos, recuentos y acciones deshabilitadas) cuando no se puede consultar la matriz.

---

## 4. Grupo C — RPC médicas

**SQL ejecutado**

- `create_worker_medical_certificate`: `company_client_id` se **deriva del trabajador**, el
  parámetro se valida y el autor sale de `auth.uid()`.
- `ALTER FUNCTION ... SET search_path` explícito en `create_worker_medical_certificate`,
  `update_worker_medical_certificate` y `get_worker_medical_certificate`.

**Firmas públicas intactas** (sin cambios de aplicación). 1 certificado existente, 0 incoherentes.

---

## 5. Grupo D — Documentos del expediente (Storage)

**SQL ejecutado:** las cuatro políticas `worker_documents_*` incorporan `is_platform_user_active()`.

**Verificado** (incluido el `WITH CHECK` de la política de subida):

| Política | Comando | `is_platform_user_active()` |
| --- | --- | --- |
| `worker_documents_select` | SELECT | sí (`USING`) |
| `worker_documents_upload` | INSERT | sí (`WITH CHECK`) |
| `worker_documents_update` | UPDATE | sí (`USING`) |
| `worker_documents_delete` | DELETE | sí (`USING`) |

---

## 6. Grupo E — Avatares como objeto privado

**SQL ejecutado:** bucket `avatars` **privado** (`public = false`), límite 2 MB, tipos
`image/png, image/jpeg, image/webp` y cinco políticas: `avatars_select_own`,
`avatars_select_profile_viewers`, `avatars_insert_own`, `avatars_update_own`, `avatars_delete_own`.

**Verificado:** `public = false`, `file_size_limit = 2097152`, los tres MIME y **5 políticas**.

**Código (DDD):** `profiles.avatar_url` guarda la **ruta** (`<user_id>/<archivo>`); la interfaz
pinta una **URL firmada** (TTL 3600 s) renovada al 80 % de su vida y al recuperar el foco.
`AuthContext` expone `avatarUrl` y `refreshAvatar`; `Account.tsx` previsualiza, valida antes de
subir, reemplaza (borrando el objeto anterior) y permite eliminar; el menú del usuario usa la
misma URL firmada. Ninguna URL pública se almacena ni se devuelve.

---

## 7. Grupo F — Privilegios (endurecimiento corregido)

### F.1 · EXECUTE y privilegios de tabla

- `REVOKE EXECUTE ... FROM PUBLIC, anon` sobre las **224 funciones propias de la app**
  (bloque dinámico). Las **192 funciones de extensión** de `supabase_admin` quedan **intactas**.
- No se concedió **nada** nuevo: no hubo `GRANT ... ON ALL`.
- `REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated`.

### F.2 · Funciones internas

`REVOKE EXECUTE ... FROM authenticated` en **13 funciones internas verificadas**:
`worker_vacation_balance`, `calculate_worker_vacation_accrual`, `vacation_count_working_days`,
`vacation_target_annual`, `worker_vacation_accrual_start`, `worker_vacation_accrual_end`,
`worker_vacation_is_employed_on`, `worker_vacation_weekdays_on`, `worker_position_on`,
`is_entity_descendant`, `resolve_academic_payment_scope`, `has_company_wide_role_management`,
`company_client_deletion_target`.

**Verificaciones previas que lo autorizaron**

1. Ninguna de las 13 aparece en **ninguna política RLS** (0 coincidencias sobre las 285 políticas).
2. **Todos** sus invocadores son `SECURITY DEFINER` (ejecutan como propietario), así que no
   necesitan el privilegio del llamador. Se verificaron 32 relaciones invocador↔invocada.
3. La app **no** las invoca por RPC.
4. `resolve_academic_category_payment_for_flags` (que la app **sí** invoca) quedó **excluida** y
   conserva EXECUTE para `authenticated`.

### Estado final de privilegios EXECUTE

| Propietario | Funciones | PUBLIC | anon | authenticated | service_role |
| --- | --- | --- | --- | --- | --- |
| `postgres` (app) | 224 | **0** | **0** | 209 | 224 |
| `supabase_admin` (extensiones) | 192 | 192 | 192 | 192 | 192 |
| **Total** | **416** | 192 | 192 | **401** | **416** |

- Sin EXECUTE para `authenticated`: las 13 internas de F.2 + las 2 que ya lo estaban
  (`prenomina_recalc_entry`, `vacation_post_accrual_internal`).
- Funciones usadas por políticas que **conservan** EXECUTE para `authenticated`:
  `can_access_entity` (163 políticas), `is_platform_superadmin`, `has_platform_permission`,
  `is_platform_user_active`, más las `*_storage_object_entity` y las tres funciones de trigger.
- RPC públicas que **conservan** `authenticated` y pierden `anon`: `register_worker_vacation`,
  `adjust_worker_vacation_balance`, `cancel_worker_vacation`, `worker_vacation_summary`,
  `entity_vacation_overview`, `run_worker_vacation_catchup`, `save_platform_role`,
  `save_company_client_role`, `resolve_academic_category_payment_for_flags`.
- Privilegios de tabla fuera de SELECT/INSERT/UPDATE/DELETE para `anon`/`authenticated` en
  `public`: **0**.
- 416 funciones = 415 del estado de partida + la función del trigger nuevo del grupo A.

---

## 8. Pruebas y verificaciones ejecutadas

**Type checks:** sin errores (`No type errors found.`).

**Playwright, por spec**

| Spec | Resultado |
| --- | --- |
| `avatars.spec.ts` (**nuevo**, 6 pruebas) | ✅ 6 |
| `access-control.spec.ts` | ✅ 19 |
| `platform-account-administration.spec.ts` | ✅ 14 |
| `session-layout-resolution.spec.ts` | ⚠️ 6 ✅ / 3 ❌ (infraestructura, ver §9) |
| `authenticated-schema.spec.ts` | ✅ 1 |
| `app-boot.spec.ts` | ✅ 1 |
| `expediente-integration.spec.ts` | ✅ 6 |
| `document-generation.spec.ts` | ✅ 14 |
| `payroll-preparation.spec.ts` | ✅ 17 |
| `organization-screens.spec.ts` | ✅ 9 |
| `company-client.spec.ts` | ✅ 6 |
| `people-registration.spec.ts` | ✅ 6 |

`authenticated-schema.spec.ts` es la prueba decisiva del endurecimiento: inicia sesión **real** con
la cuenta de prueba aislada y comprueba que el arranque conversa con el esquema real sin errores
(ninguna respuesta 400/404 en `/rest/v1/`). Es decir: **las RLS y los privilegios endurecidos no
rompen el camino autenticado de la aplicación.**

**Ajustes en pruebas existentes (contratos que el cambio dejó obsoletos)**

- `platform-account-administration.spec.ts`: los contratos del avatar pasan a exigir bucket
  privado, ruta resuelta por la regla del dominio, `createSignedUrl` y **ausencia** de
  `getPublicUrl`; el avatar se escribe sólo como ruta en su operación dedicada.
- `access-control.spec.ts`: la traducción de permisos de sistema de plataforma se contrasta con el
  mensaje **real** del backend endurecido.
- `session-layout-resolution.spec.ts`: dos comprobaciones **preexistentes y defectuosas** se
  corrigieron para expresar su intención (se verificó contra el commit anterior que el código que
  las rompía no provenía de FASE 3):
  - `?? []` al final de `selectActiveMemberships` (código correcto: lanza el error y sólo traduce
    `data` nulo a lista vacía) coincidía con un patrón pensado para la degradación silenciosa.
  - `not.toMatch(/AuthProvider/)` sobre `AuthContext.ts` coincidía con el mensaje del guard
    `useAuth must be used within an AuthProvider`.

**Cobertura nueva:** `e2e-tests/avatars.spec.ts` reproduce el flujo por contrato y reglas: ruta
dentro de la carpeta del usuario (incluido intento de escape con `../`), lectura de lo guardado
(incluido el formato anterior), renovación al 80 %, validación previa del archivo, firma temporal
sin URL pública, alta/reemplazo/baja y frontera de Storage en la presentación.

---

## 9. Riesgos residuales y pendientes

1. **`resolve_academic_category_payment_for_flags`** no valida el acceso a la entidad y se ha
   dejado sin corregir por ser una decisión de negocio (añadir guarda interna o aceptar el riesgo).
   Su definición original está capturada en `docs/fase-3-snapshot-originales.sql` §2.F.
2. **Borrado de un rol de sistema de plataforma distinto de SuperAdmin:** el trigger
   `platform_roles_protect_reserved` sólo protege el rol reservado `SuperAdmin`, y
   `platform_roles_delete_protected` sólo limita el borrado a SuperAdmin. La interfaz ya no ofrece
   el borrado (todo rol de sistema está protegido), pero el backend no lo impone para el resto.
   Fuera del alcance autorizado de los grupos A–F: se documenta para decidir si se extiende.
3. **`session-layout-resolution.spec.ts`, 3 casos de navegador (2.º a 4.º):** fallan por
   infraestructura del usuario de prueba aislado de Supabase, no por código. Evidencia:
   (a) el **primer** caso de navegador del mismo spec pasa y ejercita inicio de sesión real,
   pantalla neutral y una única interfaz; (b) las 5 comprobaciones estructurales pasan;
   (c) `authenticated-schema.spec.ts` pasa con la misma cuenta de prueba; (d) el fallo es
   **determinista** (reproducido también ejecutando sólo esos casos) y **ya estaba registrado** en
   la sesión anterior para este mismo spec («Per-test database isolation failed: Couldn't delete the
   previous Supabase test user», «3 passed, 6 failed — not verified»), que nunca llegó a verificarlo.
   **Recomendación:** reintentar esos casos desde el panel de Pruebas (el aislamiento provisiona un
   usuario por caso) cuando el borrado del usuario de prueba anterior funcione.

**Comportamiento asumido tras F.1:** una petición no autenticada obtiene error de permisos en lugar
de un resultado vacío; no existe ninguna política concedida a `anon` y los buckets son privados.

---

## 10. Reversión disponible

- `docs/fase-3-snapshot-originales.sql` §4 contiene el SQL de reversión **por grupo** con las
  definiciones literales previas (cuerpos de funciones, políticas y ACL).
- La reversión de F.1 usa **listas de exclusión** para no conceder privilegios que no existían
  antes (no se otorga a las 18 funciones ni a las tablas que no los tenían).
- Tras revertir, los contadores de EXECUTE vuelven al estado de partida.

## 11. Estado final

- Grupos **A, B, C, D, E, F.1 y F.2 aplicados y verificados** en la base conectada.
- Aplicación coherente con el backend nuevo (roles en modo consulta, avatares privados con URL
  firmada, traducciones alineadas con los mensajes reales).
- Sin errores de tipo; 105 pruebas automatizadas en verde (99 de los specs listados en §8 más los 6
  casos que pasan de `session-layout-resolution.spec.ts`) y 3 casos de navegador pendientes por
  infraestructura (§9.3).
- Sin escrituras de datos de negocio: no se creó, modificó ni eliminó ningún registro real de
  negocio (los usuarios de prueba son aislados y los certificados/roles/perfiles existentes se
  consultaron en lectura).
