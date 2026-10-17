# 09 — Infraestructura del ciclo de vida de contraseñas (Bloque 35.2A)

> **Alcance**: exclusivamente base de datos y seguridad. La migración se **prepara** pero **NO se
> aplica** a la base conectada. No se modificó frontend, Edge Functions, usuarios, contraseñas ni
> RLS de otras tablas. No se ejecutó Git.

---

## 1. Revisión previa (solo lectura)

| Comprobación | Resultado |
|--------------|-----------|
| Tabla previa de contraseñas/lifecycle/credenciales | **No existe** |
| `handle_updated_at()` | **Existe** → se reutiliza (no se duplica infraestructura) |
| `has_platform_permission`, `is_platform_superadmin`, `is_platform_user_active` | **Existen** |
| Helpers de autorización de usuarios | **`can_view_platform_user(uuid)`** y **`can_manage_platform_user(uuid)`** (modelo de permisos existente; sin nombres de usuario) |
| Permisos de plataforma | `users.view_all`, `users.manage_all` existen |
| Triggers en `auth.users` | **Ninguno** |
| RLS de `profiles` (analogía) | SELECT propio (`auth.uid()=id`) + SELECT admin (`can_view_platform_user`) |
| Relación `auth.users` ↔ `profiles` | `profiles.id` referencia la identidad; el ciclo de vida se ancla a `auth.users` (no a `profiles`) |
| Mecanismo de auditoría general | **No hay** tabla de auditoría general; se usan `created_at/updated_at` |

**No se duplicó** ningún helper: la autorización de administradores reutiliza
`can_view_platform_user`.

---

## 2. Tabla nueva

`public.user_password_lifecycle` — metadatos del ciclo de vida. **Sin** contraseñas, valores
reversibles ni hashes duplicados de Auth.

| Columna | Tipo | Notas |
|---------|------|-------|
| `user_id` | `uuid` PK → `auth.users(id) ON DELETE CASCADE` | ancla en Auth |
| `must_change_password` | `boolean NOT NULL DEFAULT false` | ausencia de fila = legacy (no obliga) |
| `initial_password_generated_at` | `timestamptz` | cuándo se generó la contraseña inicial |
| `password_changed_at` | `timestamptz NULL` | cuándo se confirmó (en servidor) el cambio |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | `updated_at` vía `handle_updated_at()` |

SQL completo: `src/db/migrations/20261028_01_user_password_lifecycle.sql`.

---

## 3. RLS

- RLS **activado**. Sin acceso `anon`.
- `authenticated`: **solo `SELECT`** (se revoca INSERT/UPDATE/DELETE).
  - `user_password_lifecycle_select_self`: `auth.uid() = user_id` (el titular).
  - `user_password_lifecycle_select_admin`: `public.can_view_platform_user(user_id)`
    (administradores autorizados por el modelo existente).
- **Sin políticas** de INSERT/UPDATE/DELETE ⇒ esas operaciones quedan **bloqueadas** para
  `authenticated`.
- `service_role`: `SELECT, INSERT, UPDATE, DELETE`.
- **Sin recursividad**: las funciones de autorización no leen esta tabla.
- **Sin nombres de usuario** como criterio.

---

## 4. Operaciones privilegiadas diseñadas (solo `service_role`)

1. `public.initialize_password_lifecycle(p_user_id uuid)` — **idempotente**
   (`ON CONFLICT (user_id) DO NOTHING`), fija `must_change_password = true` e
   `initial_password_generated_at = now()`. **No sobrescribe** un estado existente. Exige
   `auth.role() = 'service_role'`.
2. `public.mark_password_changed(p_user_id uuid)` — confirmación **del servidor**, idempotente.

Ambas: `SECURITY DEFINER`, `SET search_path TO ''`, `EXECUTE` **revocado** de `PUBLIC`, `anon` y
`authenticated` y concedido **solo** a `service_role`.

---

## 5. Mecanismo seguro de confirmación (y el BLOQUEO documentado)

**Requisito**: no crear una RPC que permita al titular poner `must_change_password = false`; no
confiar en el navegador ni únicamente en `auth.uid()`.

**Alternativas evaluadas**:

| Alternativa | Veredicto |
|-------------|-----------|
| RPC del titular `confirm_change()` | **Descartada**: permitiría omitir el cambio obligatorio. |
| Trigger sobre `auth.users` (detectar cambio de `encrypted_password`) | **No fiable**: GoTrue actualiza la contraseña como servicio de Auth; dentro del trigger **no se distingue** de forma segura un cambio propio de un cambio administrativo/recuperación. Riesgo de marcar `false` indebidamente. |
| Comparar `auth.users.updated_at` (antes o después, desde el titular) | **DESCARTADA (corrección 35.2A.1)**: NO es específica de un cambio de contraseña. |
| Trigger sobre `auth.users.updated_at` | **Descartada**: mismo motivo de especificidad. |
| **Confirmación por operación privilegiada del servidor (solo `service_role`)** | **ELEGIDA**. |

**Diseño elegido (corregido)**: el cambio de contraseña es **mediado por el servidor** (Edge Function,
subbloque 35.2B). Tras completar con **éxito** la actualización en Supabase Auth, el servidor invoca
`mark_password_changed(user_id)` con `service_role`. La función:

- **No** inspecciona `auth.users.updated_at` ni ninguna otra columna de Auth.
- Exige `auth.role() = 'service_role'` → es **inalcanzable desde el navegador**.
- Exige que exista fila y que tenga `initial_password_generated_at` (hubo generación inicial).
- Es **idempotente** (si `must_change_password = false`, no hace nada).
- Fija `must_change_password = false` y `password_changed_at = now()`.

> **BLOQUEO documentado**: no existe un camino *exclusivamente de base de datos* que pruebe, sin el
> servidor, que el titular cambió su contraseña (limitación del patrón GoTrue). Por eso la
> confirmación **depende de la operación real y exitosa del servidor en Auth** y **no** se expone
> ninguna RPC de confirmación al cliente. El cambio obligatorio **no** puede completarse solo con
> frontend.

**Por qué es seguro aunque la función no "verifique" Auth por sí misma**: la especificidad que antes
se intentaba obtener de `updated_at` se sustituye por **la frontera de privilegio**. Solo un llamante
`service_role` puede ejecutar la función, y el único código que la invoca es la Edge Function, **en la
misma secuencia** en que ella misma acaba de actualizar la contraseña (paso D→E→F). Un navegador no
puede imitar esa operación ni alcanzar la función.

---

## 6. Pruebas definidas (no destructivas; NO ejecutadas contra datos reales)

Plan (a ejecutar tras aplicar la migración en un entorno de prueba o mediante fixtures temporales
eliminados al final):
- Estructura y PK; FK a `auth.users` con `ON DELETE CASCADE`.
- RLS activado; `SELECT` del titular; `SELECT` de administrador autorizado.
- `SELECT` **no** autorizado denegado.
- INSERT/UPDATE/DELETE directos por `authenticated` **bloqueados**.
- `initialize_password_lifecycle` privilegiada e **idempotente** (segunda ejecución no cambia nada).
- `mark_password_changed` **rechaza** si la ejecuta cualquier rol distinto de `service_role`
  (incluido `authenticated` con JWT del propio usuario).
- `mark_password_changed` **rechaza** si no existe fila o si `initial_password_generated_at` es NULL.
- `mark_password_changed` es **idempotente** (segunda ejecución no altera `password_changed_at`).
- `mark_password_changed` **no** consulta `auth.users` (sin dependencia de `updated_at`).
- Compatibilidad: los usuarios existentes (sin fila) no ven cambio obligatorio.

**Privilegios de ejecución (revisión, punto 9)**: ambas funciones son `SECURITY DEFINER` con
`search_path = ''`; se revoca `EXECUTE` de `PUBLIC`, `anon` y `authenticated` y se concede **solo** a
`service_role`. La tabla concede a `authenticated` **únicamente `SELECT`**. Verificado que los
helpers de autorización (`can_view_platform_user`) siguen siendo compatibles con las políticas.

---

## 6.bis Secuencia obligatoria de la futura Edge Function (Bloque 35.2B)

La Edge Function `create-sitecorp-user` (y cualquier flujo de cambio/reset) deberá ejecutar en este
orden exacto:

| Paso | Acción | Regla de seguridad |
|------|--------|--------------------|
| A | **Validar la sesión** del usuario (token del llamante). | `auth.getUser(token)`; sin token válido, 401. |
| B | **Obtener el `user_id`** desde la **identidad autenticada y verificada** (no desde el cuerpo). | El `user_id` confiable es el del token verificado. |
| C | **Validar la nueva contraseña** (reglas de fortaleza/longitud). | Del servidor, no solo del móvil. |
| D | **Actualizar la contraseña** en Supabase Auth (`auth.updateUser`/Admin API según el flujo). | Único paso que toca credenciales. |
| E | **Confirmar que Auth completó** la operación. | Se continúa **solo** si Auth responde sin error. |
| F | **Actualizar `user_password_lifecycle`** invocando `mark_password_changed(user_id)` con `service_role`. | Idempotente. |
| G | **Devolver el resultado** al cliente. | Nunca devolver secretos ni la contraseña. |

En el **alta** de usuario, el equivalente es: generar la contraseña aleatoria, crear el usuario en
Auth, y llamar `initialize_password_lifecycle(user_id)` (`must_change_password = true`).

## 6.ter Fallos parciales entre D y F

- **Auth falla (D/E)**: **no** se llama a `mark_password_changed`; la contraseña no cambió y el
  estado permanece `true`. Se informa el error al usuario (comportamiento de `Account.tsx`).
- **Auth tiene éxito pero F falla** (red/servidor): la contraseña **ya cambió**, pero la tabla aún
  dice `true`. La función es **idempotente** ⇒ el servidor **reintenta** `mark_password_changed`
  (mismo `user_id`) y, si persiste el fallo, se **reconcilia en el siguiente acceso** reintentando la
  confirmación. Nunca se marca `false` sin el éxito de Auth; nunca se deja en `false` por una
  operación arbitraria del navegador (el navegador no puede invocar la función).
- **Nunca** se ejecuta F antes de E: la confirmación sigue siempre a la operación real de Auth.

---

## 7. Compatibilidad

- **No** se modifican usuarios ni contraseñas existentes.
- **No** se crean filas para los usuarios actuales: **ausencia de fila = legacy**.
- **No** se cambian permisos ni otras tablas de negocio.

---

## 8. Pasos para aplicar la migración (cuando se autorice)

1. Aplicar `src/db/migrations/20261028_01_user_password_lifecycle.sql` (transacción `BEGIN/COMMIT`).
2. Verificar: tabla + RLS + revocaciones + funciones `service_role`.
3. **No** hay que poblar nada: la ausencia de fila es el estado legacy.
4. Solo **después**, implementar el subbloque 35.2B (Edge Function + UI).

## 9. Reversión

```
DROP FUNCTION IF EXISTS public.mark_password_changed(uuid);
DROP FUNCTION IF EXISTS public.initialize_password_lifecycle(uuid);
DROP TABLE IF EXISTS public.user_password_lifecycle;
```
Aditiva y sin dependencias: revertir no afecta a usuarios, contraseñas ni negocio. Si ya hubiera
datos en uso, respaldar antes.

## 10. Confirmaciones
- **NO se aplicó** la migración a la base conectada (solo consultas de lectura).
- **No se modificó** frontend, Edge Functions, usuarios, contraseñas ni RLS de otras tablas.
- **No se ejecutó Git.**
