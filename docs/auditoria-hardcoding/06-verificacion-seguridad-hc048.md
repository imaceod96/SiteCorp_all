# 06 — Verificación de seguridad HC-048 (usuarios, roles e identificadores de prueba)

> **Bloque 35.1 — Auditoría de seguridad, SOLO LECTURA.** No se modificó código, base de datos,
> RLS, RPC, usuarios, roles ni permisos. Única escritura: documentos Markdown en
> `docs/auditoria-hardcoding/`.
>
> Se realizaron consultas **de solo lectura** mínimas sobre el proyecto conectado para verificar
> existencia de registros (sin leer contraseñas, tokens, secretos ni datos personales
> innecesarios). **No se modificó ningún registro.**

---

## 1. Metodología y alcance

Búsqueda exhaustiva de `TENANT-A`, `admin`, `isael`, usuarios/roles/tenants de prueba, IDs fijos,
bypass de autenticación y de autorización en: `src/`, `supabase/`, migraciones SQL, `e2e-tests/`,
fixtures/seeds, configuraciones y RPC/RLS. Se revisaron **únicamente directorios existentes**.

**Regla aplicada**: una coincidencia textual no demuestra por sí sola una vulnerabilidad. Cada
referencia se clasifica con evidencia, y se distingue *riesgo demostrado* de *código de pruebas
inocuo*.

---

## 2. Apariciones localizadas (archivo y línea exacta)

| # | Archivo | Línea | Valor | Función / contexto | Consumidores | Entorno |
|---|---------|-------|-------|--------------------|--------------|---------|
| R1 | `src/db/migrations/20260922_02_entity_access_test_data.sql` | 73 | `TENANT-A` | `WHERE code = 'TENANT-A'` (script de test data) | ninguno en runtime | Migración histórica (hand-applied) |
| R2 | idem | 81-82 | `GRUPO-A`/`CUENTA-GRUPO-A` | inserción de entidad business_group | — | idem |
| R3 | idem | 101-104 | `EMPRESA-A`/`CUENTA-EMPRESA-A` | entidad company | — | idem |
| R4 | idem | 121-161 | `EMPRESA-B`,`UEB-A1`,`UEB-A2` | entidades ueb | — | idem |
| R5 | idem | 192-199 | `TENANT-A`,`isael`,`Viewer`,`HR Manager` | asignación de acceso por entidad | — | idem |
| R6 | idem | 210 | `admin` | `AND admin.username = 'admin'` | — | idem |
| R7 | `src/db/migrations/20260922_04_roles_permissions_test_data.sql` | 56-58 | `admin`,`isael` | `platform_user_roles` / `profiles.username` | — | idem |
| R8 | idem | 67,77,84,106 | `TENANT-A` | rol `RRHH Test` y permisos | — | idem |
| R9 | `e2e-tests/access-control.spec.ts` | 544 | `"client-2"`,`"grupo-ajeno"` | fixture en memoria de un test (cross-tenant) | Playwright | Test aislado |
| R10 | `e2e-tests/*.spec.ts` | (varias) | `DYAD_TEST_USER_EMAIL`/`PASSWORD` | login de pruebas vía **variables de entorno** | Playwright | Test aislado (sin credenciales fijas) |
| R11 | `docs/auditoria-hardcoding/*` | (varias) | `TENANT-A`,`isael`,`admin` | documentación de esta auditoría | — | Documentación |
| R12 | `node_modules/**` | (varias) | `/Users/isaelmaceo/...` | rutas absolutas de binarios pnpm | — | Ruido de entorno, **no es dato de la app** |
| R13 | `test-results/results.json` | 5-74 | `/Users/isaelmaceo/...` | rutas absolutas del runner | — | Artefacto de test |

**Búsqueda de bypass**: no se encontró ningún `RETURN true` previo a la comprobación de
`auth.uid()`, ninguna autorización por **nombre de usuario**, y ninguna referencia a estos valores
en el código de aplicación de `src/` (fuera de migraciones y docs).

---

## 3. Clasificación de cada referencia (A–I)

| # | Clasificación | Evidencia |
|---|---------------|-----------|
| R1–R8 | **G. Migración histórica** (y **D. Seed/Test data** aplicado en su día) | El propio encabezado dice *"Versioned audit record … applied to the connected Supabase database through the Dyad SQL console"*. Usan **nombres legacy** (`tenants`, `tenant_memberships`, `tenant_roles`, `tenant_permissions`) que **ya no existen** en el esquema activo (ver §4). |
| R9 | **A. Test automatizado aislado** | `e2e-tests/access-control.spec.ts` construye entidades en memoria; no toca datos reales. |
| R10 | **A. Test automatizado aislado** (con **E. configuración por entorno**) | Credenciales leídas de `process.env.DYAD_TEST_*`; no hay usuario/clave fijos en el repositorio. |
| R11 | **H. Referencia legítima sin riesgo** | Documentación de auditoría. |
| R12–R13 | **H. Referencia legítima sin riesgo** | Rutas de `node_modules`/artefactos; contienen el nombre de usuario del sistema operativo, no de la app. |

**Ninguna** referencia a estos valores fue clasificada como **F. Código ejecutable en producción**
dentro de `src/`.

---

## 4. Verificación en Supabase (solo lectura)

### 4.1 Esquema: las tablas legacy ya no existen (confirma R1–R8 como históricas)
- `tenants` **NO existe** en el esquema activo.
- Existen `company_clients`, `company_client_memberships`, `company_client_roles`,
  `company_client_permissions`, `platform_roles`, `platform_user_roles`, `profiles`.
- ⇒ Los scripts R1–R8, que referencian `public.tenants` y `tenant_*`, **no son ejecutables** en el
  esquema actual (fallarían). Son **históricos**.

### 4.2 Los REGISTROS de prueba SÍ persisten en la base conectada (hallazgo nuevo y comprobado)
Verificación mínima (existencias y flags; sin leer datos sensibles):

| Comprobación | Resultado |
|--------------|-----------|
| `platform_roles` con nombre `Platform Test` | **No existe** (ya no presente) |
| `company_clients` con `code = 'TENANT-A'` | **Existe**, `name='Tenant A'`, `is_active=true` |
| `company_client_roles` (`Viewer`,`HR Manager`,`RRHH Test`) | **4 filas**, todas `is_active=true` (Viewer duplicado ×2) |
| `organization_entities` con códigos de prueba (`GRUPO-A`,`EMPRESA-A`,`EMPRESA-B`,`UEB-A1`,`UEB-A2`) | **5 entidades** |
| `profiles` con `username` en (`admin`,`isael`) | **1** encontrado: `admin`, `is_active=true` (`isael` no existe) |
| Rol de plataforma del usuario `admin` | **`SuperAdmin`** (`is_system_role=true`, `is_active=true`) |
| Asignaciones de roles de prueba a usuarios (company_client_user_roles) | 0 |
| Contexto de la BD | 5 `company_clients` (incluye datos no-test: `COMERICIO-MUWUDU`, `GRUPO-12345-2QS46P`, `GRUPO-INDUSTRIAL-AWLVCQ`, `1234`), 10 `organization_entities` (6 sitecorp), 2 `profiles` |

### 4.3 NO VERIFICADO
- **NO VERIFICADO** si este proyecto conectado es el de **producción** o uno de desarrollo.
- **NO VERIFICADO** (y no verificable sin exponer secretos) la **fortaleza/estado de la contraseña**
  del usuario `admin`. No se accedió a credenciales.

---

## 5. Revisión de autenticación y permisos

- **No hay usuarios privilegiados hardcodeados en el código de aplicación**: la identidad se
  resuelve por `auth.uid()` y RPC (`is_platform_superadmin`, `has_platform_permission`,
  `can_access_entity`, `can_use_company_client_permission`).
- **No hay autorización por nombre de usuario** ni permisos especiales por usuario concreto en `src/`.
- **No hay condiciones que omitan autenticación ni RLS**: las funciones RPC revisadas comienzan
  comprobando `auth.uid() IS NULL` y devuelven `false`/excepción; el superadministrador se resuelve
  por rol del sistema, no por nombre.
- **Las Edge Functions** (`create-platform-admin`, `create-sitecorp-user`) verifican el token del
  llamante con `auth.getUser(token)` y exigen perfil activo + rol `SuperAdmin`/permiso
  `users.manage_all`. Correcto.
- **IDs de organización fijos**: no existen en código; los de prueba sólo aparecen en R1–R8
  (históricos).

### 5.1 Hallazgo NUEVO relacionado (distinto de HC-048): credencial por defecto hardcodeada — HC-079
- `supabase/functions/create-sitecorp-user/index.ts:145` →
  `const password = (body.password ?? "temp1234!").trim()`: si el llamante **omite** la contraseña,
  se crea la cuenta con la **contraseña por defecto `temp1234!`**.
- `src/modules/access-control/presentation/pages/PlatformUsers.tsx:45,84,96,117,128,330,364` →
  el formulario de alta de usuario de plataforma usa `"temp1234!"` como valor por defecto/campo.
- **Naturaleza**: credencial conocida, presente en el repositorio, **alcanzable en producción** para
  creación de usuarios de plataforma (potencialmente privilegiados). No es un bypass de
  autenticación (la cuenta sigue requiriendo login), pero es una **debilidad de credencial por
  defecto**. Clasificación: **F. Código ejecutable en producción**.
- **NO VERIFICADO**: si alguna cuenta existente (p. ej. `admin`) se creó con esta contraseña
  (no se inspeccionan credenciales).

---

## 6. Evaluación del riesgo

| Caso | Explotabilidad | Impacto | Alcance | Condiciones | Severidad |
|------|----------------|---------|---------|-------------|-----------|
| HC-048 (registros de prueba activos) | Media (requiere credenciales) | Alto (cuenta `admin` con rol `SuperAdmin` activo) | Entorno conectado | Autenticarse como `admin`; que el entorno sea productivo | **P1 — riesgo alto confirmado** |
| HC-048 (scripts SQL de test data) | Nula (no ejecutables) | Bajo | — | Ejecución manual | **P3 — referencia histórica aislada** |
| HC-079 (contraseña por defecto `temp1234!`) | Media | Alto (cuentas de plataforma) | Edge Function + UI admin | Crear usuario sin contraseña | **P1 — riesgo alto confirmado** |
| R9/R10 (tests) | Nula | Nulo | Tests | — | **SIN RIESGO** |
| R11–R13 (docs/artefactos) | Nula | Nulo | — | — | **SIN RIESGO** |

**Severidad definitiva de HC-048: P1 (NO P0).** Motivos para **no** mantener P0:
- No existe bypass de autenticación ni de RLS; el acceso exige credenciales.
- No se demostró acceso no autorizado efectivo.
- No se pudo confirmar que el proyecto conectado sea producción.
Motivos para **no** bajar de P1: una cuenta **`admin` con rol `SuperAdmin` activa** coexiste con
datos no-test, y persisten roles/corporación de prueba.

---

## 7. Riesgos confirmados y descartados

**Confirmados**
1. Cuenta `admin` activa con rol de plataforma `SuperAdmin` en la base conectada.
2. Roles de prueba activos (`RRHH Test`, `Viewer` duplicado, `HR Manager`) y corporación/entidades
   de prueba (`TENANT-A`, `GRUPO-A`, `EMPRESA-A/B`, `UEB-A1/A2`).
3. Contraseña por defecto hardcodeada `temp1234!` (HC-079).

**Descartados**
- Bypass de autenticación/autorización (no existe).
- Autorización por nombre de usuario (no existe).
- Credenciales hardcodeadas en tests (usan variables de entorno).
- Uso de valores de prueba en el código de aplicación `src/`.

---

## 8. Comprobaciones pendientes
- Confirmar el **entorno** del proyecto conectado (¿producción?).
- Confirmar si la cuenta `admin` debe existir y quién la usa (decisión de negocio).
- Confirmar política de contraseña de las cuentas creadas por Edge Function / panel.

---

## 9. Plan de corrección (NO implementar)

### 9.1 HC-048 — saneamiento de datos de prueba
- **Archivos/artefactos afectados**: `20260922_02_entity_access_test_data.sql`,
  `20260922_04_roles_permissions_test_data.sql`; registros en `company_clients`,
  `company_client_roles`, `organization_entities`, `profiles`/`platform_user_roles`.
- **Causa**: datos funcionales de prueba aplicados a la base conectada que quedaron activos.
- **Solución recomendada** (Fase de datos, con autorización expresa y en este orden):
  1. Inventariar dependencias FK de los registros de prueba (`created_by`, `assigned_by`,
     `entity_user_access`, etc.) antes de tocar nada.
  2. Revisar el rol `SuperAdmin` del usuario `admin`: confirmar titularidad; si es una cuenta de
     prueba, desactivarla o reasignar; **no eliminar en bloque**.
  3. Renombrar/marcar los datos de prueba como inactivos en vez de borrarlos cuando existan
     dependencias.
- **Pruebas**: verificar que ninguna operación real dependa de esos IDs; Playwright de acceso por
  entidad.
- **Reversión**: respaldo previo; las operaciones de datos son reversibles desde copia.
- **Prioridad**: P1.

### 9.2 HC-079 — eliminar credencial por defecto
- **Archivos**: `supabase/functions/create-sitecorp-user/index.ts:145`;
  `src/modules/access-control/presentation/pages/PlatformUsers.tsx` (valores por defecto).
- **Causa**: contraseña por defecto hardcodeada.
- **Solución recomendada**: exigir contraseña explícita (rechazar si falta) o forzar
  restablecimiento/invitación por email; eliminar `temp1234!` del formulario y del fallback.
- **Pruebas**: Vitest del contrato del repositorio/edge; Playwright de alta de usuario.
- **Reversión**: cambio de código reversible.
- **Prioridad**: P1.

---

## 10. Confirmaciones
- **No se modificó código, base de datos, RLS, RPC, usuarios, roles ni permisos.** Las consultas
  fueron **solo lectura** y mínimas (existencias/flags), sin exponer credenciales ni datos personales
  innecesarios.
- **No se ejecutó Git** ni despliegue alguno.
- Documentos actualizados: este `06-verificacion-seguridad-hc048.md`; y en el inventario/resumen se
  ajusta la clasificación de HC-048 (de “P0 posible” a **P1 confirmado**) y se añade **HC-079**.
