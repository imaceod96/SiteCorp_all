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
| Comparar solo `auth.users.updated_at` desde una RPC del titular | **Insuficiente**: `updated_at` cambia por otras razones; el titular podría dispararlo sin cambiar la contraseña. |
| **Operación privilegiada del servidor + corroboración en BD** | **Elegida**. |

**Diseño elegido**: el cambio de contraseña será **mediado por el servidor** (Edge Function) en un
subbloque posterior (35.2B). Tras confirmar GoTrue la actualización, el servidor invoca
`mark_password_changed(user_id)` con `service_role`. Como refuerzo **verificable en base de datos**,
la función **rechaza** confirmar si `auth.users.updated_at` **no es posterior** a
`initial_password_generated_at` (es decir, exige que el registro de Auth se haya actualizado tras la
generación inicial). No se confía en ninguna afirmación del navegador.

> **BLOQUEO documentado**: con la infraestructura actual **no existe** un camino *exclusivamente de
> base de datos* que pruebe, sin intervención del servidor, que el titular cambió su contraseña
> (limitación del patrón GoTrue). Por eso **no se implementa ninguna RPC de confirmación accesible al
> cliente**; la confirmación queda ligada al servidor. Este es el motivo por el que el cambio
> obligatorio **no** puede completarse solo con frontend.

**Riesgo residual**: `auth.users.updated_at` también cambia por otras operaciones de Auth. Al estar
la función restringida a `service_role` (que solo la invoca tras el cambio real), el riesgo es
acotado; se documenta para el subbloque de endurecimiento.

---

## 6. Pruebas definidas (no destructivas; NO ejecutadas contra datos reales)

Plan (a ejecutar tras aplicar la migración en un entorno de prueba o mediante fixtures temporales
eliminados al final):
- Estructura y PK; FK a `auth.users` con `ON DELETE CASCADE`.
- RLS activado; `SELECT` del titular; `SELECT` de administrador autorizado.
- `SELECT` **no** autorizado denegado.
- INSERT/UPDATE/DELETE directos por `authenticated` **bloqueados**.
- `initialize_password_lifecycle` privilegiada e **idempotente** (segunda ejecución no cambia nada).
- `mark_password_changed` rechaza si `auth.users.updated_at <= initial_password_generated_at`.
- Compatibilidad: los usuarios existentes (sin fila) no ven cambio obligatorio.

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
