# 11 — Resolución del bloqueo de funciones `SECURITY DEFINER` (Bloque 35.2C.3)

> **Solo lectura / preparación.** No se aplicaron migraciones, no se desplegaron Edge Functions,
> no se modificaron usuarios/contraseñas/datos, no se ejecutó Git.
> Resultado global: **PARCIAL** (ver §9). No se declara protección completa.

---

## 1. Investigación de PostgREST (¿existe un pre-request central?)

**Pregunta:** ¿permite Supabase gestionado un mecanismo de autorización *previo* a las
peticiones de PostgREST (p. ej. `db-pre-request`) que cubra tablas **y** RPC?

**Evidencia recogida (consultas reales al catálogo, solo lectura):**

| Comprobación | Resultado |
|---|---|
| `pg_roles.rolconfig` de `authenticator` | `["session_preload_libraries=supautils, safeupdate", "statement_timeout=8s", "lock_timeout=8s"]` |
| `pg_roles.rolconfig` de `anon` / `authenticated` / `service_role` | solo timeouts de sentencia; **ningún `pgrst.*`** |
| `pg_db_role_setting` | ninguna entrada `pgrst.*` / `db_pre_request` (solo `search_path`, timeouts, `log_statement`) |

**Conclusión:** en Supabase gestionado la configuración de PostgREST (`PGRST_DB_PRE_REQUEST`)
**vive fuera de la base de datos** y **no es configurable** por el usuario. La vía de
configuración *in-database* de PostgREST (`ALTER ROLE authenticator SET pgrst.db_pre_request = …`)
**no está disponible ni verificable** aquí (no hay `pgrst.*` y no se puede comprobar el comportamiento
HTTP de PostgREST desde el entorno). Por tanto, **no se asume compatible**: se descarta como
mecanismo central. (Coherente con la instrucción «no asumir compatibilidad sin verificarla».)

Consecuencia: RLS no cubre a `postgres` (propietario de las definer) y no existe *pre-request*
central ⇒ **no hay ningún mecanismo central provisto por la plataforma** para bloquear definer.

## 2. Inventario de las 157 `SECURITY DEFINER` expuestas

`SECURITY INVOKER` (211): se ejecutan como `authenticated` ⇒ **respetan RLS** ⇒ ya cubiertas por la
política restrictiva de tablas (`20261028_02`). No requieren trabajo adicional.

`SECURITY DEFINER` (157): eluden RLS. Clasificación:

| Clase | Patrón | Nº aprox. | ¿Se puede envolver con seguridad? |
|---|---|---|---|
| Autorización/identidad | `can_*`, `is_*`, `has_*_permission` | ~17 | **NO por diseño** (bloquearlas rompería permisos) |
| Lectura de negocio / cálculo | `resolve_*`, `get_*`, `validate_*`, `*_summary`, `*_preview`, `*_context`, `*_checklist` | varias | **SÍ** si firma «simple» (77 total envolturables) |
| Escritura / administración | `create_*`, `save_*`, `delete_*`, `set_*`, `update_*`, `migration_*`, `prenomina_*`, `recompute_*`, … | varias | **SÍ** si firma «simple» |
| Documentos / Storage | `begin_*_generation`, `*_storage_object_entity` | varias | **SÍ** (las `*_storage_object_entity` entran) |
| Firma no simple | SETOF/TABLE, OUT/INOUT, DEFAULT, VARIADIC | **80** | **PENDIENTE** (revisión de contrato individual) |

**Distinción EXECUTE concedido vs capacidad efectiva:** todas las de la tabla tienen `EXECUTE`
concedido a `authenticated` (por tanto *ejecutables* vía PostgREST). Pero la *explotación* real
requiere además que la función no valide internamente identidad/rol; por eso las de autorización se
excluyen (deben responder) y el resto se bloquea con la guarda.

Cifras verificadas: **157 = 77 envolturables + 80 pendientes**.

## 3. Mecanismo elegido y justificación

**«Envoltura con guarda»** (patrón central, sin reescribir cuerpos de función):

1. `ALTER FUNCTION <original> RENAME TO <original>__pcgate_<oid>` (interno).
2. `CREATE FUNCTION <original>(misma firma)` = guarda + delegación posicional al interno.
3. `REVOKE` del interno a `PUBLIC/anon/authenticated`; `GRANT` del envoltorio a `authenticated`.

Implementado en `src/db/migrations/20261028_04_rpc_password_change_gate.sql` (**preparado, no aplicado**).

**Por qué es la mejor opción disponible:**
- **Centralizado**: una migración, un patrón, un helper (`public.assert_password_change_allowed()`).
- **Seguro**: no se reescriben cuerpos (no hay riesgo de alterar la lógica de negocio); la firma se
  preserva ⇒ los llamadores no cambian; el interno queda inaccesible ⇒ no se puede *saltar* la guarda.
- **Mantenible / idempotente / reversible**: registro `password_gate_wrapped_functions`; reversión
  documentada en la propia migración.
- **Sin recursión**: guarda `SECURITY DEFINER` que lee la tabla directamente; para `service_role` y
  llamadas internas (triggers) `auth.uid()` es NULL ⇒ `false` ⇒ no-op.
- **Excepciones mínimas**: se excluyen `can_*`/`is_*`/`has_*` y los dos helpers de la barrera.

## 4. Cobertura real de PostgREST

- **Tablas `public`** (79 con políticas a `authenticated`): cubiertas por `20261028_02` (RLS
  restrictiva). Las 211 invoker heredan esa cobertura.
- **RPC `SECURITY DEFINER`**: cubiertas **77 de 157** por `20261028_04`. **80 pendientes** (§2).
- **Storage** (`storage.objects`): cubierto por `20261028_03` (preparado).
- **Edge Functions**: 5 con JWT ya gated en bloques previos; `change-initial-password` es la vía legítima.

## 5. RPC protegidas y pendientes

- **Protegidas por `_04` (77):** todas las definer con firma simple expuestas a `authenticated`
  (escrituras/administración, lectura de negocio, `*_storage_object_entity`, `migration_*`,
  `prenomina_*`, `validate_*`, `resolve_*`, `get_*_document_data`, etc.).
- **Pendientes (80):** definer con `SETOF`/`TABLE`, argumentos `OUT`/`INOUT`, `DEFAULT` o
  `VARIADIC`; y las ~17 de autorización (excluidas por diseño). Requieren revisión de contrato
  individual (envoltura específica por grupo/dependencias), en bloques posteriores.

## 6. Revisión de migraciones existentes (Bloque 35.2C.2) — SIN cambios

`20261028_02_password_change_gate.sql`
- Idempotencia: `CREATE OR REPLACE` del helper + `IF NOT EXISTS` por política. **OK**.
- Compatibilidad Supabase/PG: `CREATE POLICY … AS RESTRICTIVE FOR ALL TO authenticated` (PG10+). **OK**.
- Privilegios: políticas en tablas `public` propiedad de `postgres`. **OK**.
- Excepciones mínimas: `profiles`, `user_password_lifecycle`, `company_client_memberships`. **OK**.
- Recursión: helper `SECURITY DEFINER` (bypassa RLS) leyendo la tabla; sin recursión. **OK**.
- Reversión: incluida. Protección efectiva: no-op para usuarios sin cambio pendiente. **OK**.

`20261028_03_storage_password_change_gate.sql`
- Idempotencia (`IF NOT EXISTS`), recursión nula (helper definer), reversión (`DROP POLICY`). **OK**.
- **Caveat**: `storage.objects` pertenece a `supabase_storage_admin`; verificar privilegios al aplicar.

Ambas: **APTA**, sin cambios. No aplicadas.

## 7. Recuperación «Auth OK + `mark_password_changed` falla» (§5) — reforzada

- **Nueva verificación en servidor**: tras `auth.admin.updateUserById`, `change-initial-password`
  intenta `signInWithPassword(email, new_password)` con un cliente **anónimo efímero**; si no inicia
  sesión, **no** confirma el ciclo (`needs_retry`, HTTP 500). Así la prueba de que la contraseña
  cambió es una **comprobación real del servidor**, nunca una afirmación del navegador.
  La sesión de verificación se cierra inmediatamente (`signOut { scope: "local" }`).
- **Idempotencia**: si el ciclo ya está `false`, responde éxito sin volver a tocar la contraseña;
  si sigue `true`, reintenta E→E2→G.
- **El cliente no puede forzar `must_change_password=false`**: la tabla sólo concede `SELECT` a
  `authenticated` (RLS self/admin); `mark_password_changed` es `SECURITY DEFINER` con `EXECUTE`
  **solo** para `service_role`. (Reafirmado; no se cambió el esquema.)
- **Límite honesto**: no existe forma de leer el hash de contraseña desde la BD; la verificación se
  apoya en la Auth Admin API + el inicio de sesión de comprobación. Si el usuario no tuviera email,
  se registra un `warning` y se omite esa verificación concreta (caso no presente hoy: auth por email).

## 8. Pruebas

### 8.1 Ejecutadas en este bloque
- Consultas de catálogo (solo lectura) para §1, §2, §4/§5 (roles/config, inventario, conteos 157/77/80).
- **No** se han ejecutado migraciones ni funciones en la BD (prohibido aplicar).

### 8.2 Pendientes (requieren JWT real y entorno con servidor)
> Deben ejecutarse **tras** autorizar y aplicar `_04` (y `_02`/`_03`). Ninguna se puede dar por
> buena sin ejecutarse. No se afirma que hayan pasado.

| # | Escenario | Criterio de éxito |
|---|---|---|
| T1 | Tabla `public` con `must_change_password=true` | `SELECT/INSERT/UPDATE/DELETE` denegados (RLS) |
| T2 | RPC definer envuelta con `must_change_password=true` | error `42501` (guarda) |
| T3 | Misma RPC con `must_change_password=false` o sin fila | comportamiento idéntico al previo |
| T4 | `service_role` invocando una RPC envuelta | OK (no-op de la guarda) |
| T5 | Storage (`avatars`/`documents`) con cambio pendiente | lectura/escritura denegadas |
| T6 | Edge Functions gated con cambio pendiente | `403`/bloqueo de servidor |
| T7 | Usuario legacy (sin fila de ciclo) | acceso normal (no-op) |
| T8 | Cambio obligatorio completo (D→E→E2→G) | `success`, ciclo `false`, login con la nueva contraseña |
| T9 | Fallo simulado de `mark_password_changed` | `needs_retry`, requisito sigue `true`; reintento idempotente completa |
| T10 | Intento de cliente de `UPDATE user_password_lifecycle` | denegado (RLS + sin GRANT) |
| T11 | Reintento con verificación de login fallida (E2) | `needs_retry`; ciclo NO confirmado |

### 8.3 Validaciones de build/lint (externas)
`pnpm exec tsc -b`, `pnpm run build`, `pnpm test`, Playwright (`playwright-dyad.config.ts`).
No disponibles en este entorno ⇒ **solicitadas**.

## 9. Cambios realizados

1. `src/db/migrations/20261028_04_rpc_password_change_gate.sql` — **nueva, preparada, NO aplicada.**
2. `supabase/functions/change-initial-password/index.ts` — verificación servidor E2 + cierre de sesión.
3. `docs/auditoria-hardcoding/11-resolucion-bloqueo-security-definer.md` — este informe.
4. `docs/auditoria-hardcoding/10-endurecimiento-cambio-obligatorio.md` — nota de resolución (§3).

(4 archivos ≤ 20. Sin Git. Sin despliegue. Sin aplicar migraciones.)

## 10. Migraciones listas para aplicar (en orden)

1. `20261028_02_password_change_gate.sql` — barrera de tablas (helper + RLS restrictiva).
2. `20261028_03_storage_password_change_gate.sql` — barrera de Storage.
3. `20261028_04_rpc_password_change_gate.sql` — barrera de RPC definer (77 funciones).

Requieren **autorización expresa**. `_03` y `_04` dependen de `_02`.

## 11. Riesgos de seguridad

- **80 definer pendientes** siguen accesibles con un JWT de cambio pendiente ⇒ **no** se declara completo.
- **Almacenamiento**: dependencia de privilegios de `postgres` sobre `storage.objects` (verificar al aplicar).
- **Crecimiento del superficie**: nuevas definer con firma simple se auto-excluyen hasta ejecutar `_04`
  (idempotente) ⇒ conviene re-ejecutar/registrar tras añadir funciones.
- **Overhead**: cada RPC envuelta añade una llamada a la guarda (no-op para usuarios normales).
- **`inviteUserByEmail`** (bloques previos) no crea fila de ciclo ⇒ decisión de negocio pendiente.
- Sin **reset administrativo** ni **reactivación** (no implementados; requieren autorización).

## 12. Bloqueos restantes

1. Aplicar `_02`, `_03`, `_04` (autorización).
2. Cerrar las **80** definer pendientes por grupos/dependencias (revisión de contrato individual).
3. Desplegar `change-initial-password` (autorización).
4. Decisión de negocio: invitaciones vs ciclo obligatorio; reset administrativo.
5. Ejecutar las pruebas §8.2 con JWT real.

**El sistema permanece PARCIAL: existen operaciones sensibles accesibles con un JWT de usuario
pendiente de cambio. Bloque 36 NO iniciado.**
