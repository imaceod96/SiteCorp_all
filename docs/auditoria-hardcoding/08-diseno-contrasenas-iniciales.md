# 08 — Diseño: sistema de contraseñas iniciales aleatorias

> **Bloque 35.2 — SOLO DISEÑO Y PLANIFICACIÓN.** No se modificó código, base de datos, RLS, RPC,
> usuarios ni contraseñas. Única escritura: este documento en `docs/auditoria-hardcoding/`.
>
> Se realizaron consultas **de solo lectura** mínimas sobre el esquema conectado para comprobar la
> inexistencia de una tabla equivalente. No se modificó ningún registro.

---

## 1. Diagnóstico del sistema actual

### 1.1 Flujos existentes identificados
| Flujo | Dónde vive | Estado |
|-------|-----------|--------|
| Inicio de sesión | `Login.tsx` → `signIn` → `authentication.commands.ts` → `signInWithPassword` (Supabase Auth) | Funcional |
| Resolución de identidad | `AuthProvider.tsx` → `loadAuthenticatedIdentity` (`authentication.queries.ts`) | Funcional |
| Enrutado por nivel | `App.tsx` (`AppRoutes`): sin sesión → `/login`; de plataforma → `/admin/*`; de cliente → resto | Funcional |
| Cambio de contraseña propio | `Account.tsx` → `changePassword` → `updateOwnPassword` (`supabase.auth.updateUser`) | Funcional |
| Alta de usuario de plataforma | `PlatformUsers.tsx` → `createPlatformUser` → `invokeCreatePlatformUser` → **Edge Function** `create-sitecorp-user` | Funcional (**usa contraseña fija**) |
| Alta de usuario de cliente (invitación) | `entity-access.commands.ts` `inviteToEntity` → tabla de invitaciones | Funcional |
| Recuperación por correo | **NO EXISTE** (no hay `resetPasswordForEmail`, ni ruta `/reset-password`) | **Ausente** |

### 1.2 Hallazgo que motiva el bloque
- `supabase/functions/create-sitecorp-user/index.ts:145`:
  `const password = (body.password ?? "temp1234!").trim()` → **fallback a contraseña fija**.
- `PlatformUsers.tsx:45,84,128,364` y `:117`: el formulario envía `password` con valor por defecto
  `"temp1234!"`.
- **Conclusión**: la contraseña inicial es **fija, conocida y reutilizada**. Debe sustituirse por una
  **aleatoria por usuario**, generada en servidor.

### 1.3 Infraestructura relevante
- El alta de usuarios **ya pasa por una Edge Function** (el cliente no tiene `service_role`): es el
  lugar correcto para generar la contraseña (servidor).
- La escritura del perfil la hace la propia Edge Function (`profiles.upsert`) y la asignación de rol
  (`platform_user_roles.insert`), ambas con `adminClient` (service role).
- `updateOwnPassword` ya usa `supabase.auth.updateUser({ password })`.
- `loadAuthenticatedIdentity` es la **única** secuencia de carga de identidad y el lugar natural para
  incorporar la lectura del estado de contraseña.

---

## 2. Flujo propuesto de creación (con contraseña aleatoria)

1. El administrador abre el alta en `PlatformUsers` **sin campo de contraseña** (se elimina).
2. El cliente invoca la Edge Function `create-sitecorp-user` **sin `password`**.
3. La Edge Function (servidor, `service_role`):
   a. Verifica el token del llamante y sus privilegios (ya lo hace).
   b. Valida nombre, usuario, email y rol.
   c. **Genera la contraseña inicial aleatoria** (ver §3).
   d. Crea el usuario con `adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata })`.
   e. Inserta/actualiza el perfil (`profiles`) y asigna el rol (`platform_user_roles`) — como hoy.
   f. **Registra el estado inicial** en `user_password_lifecycle` (`must_change_password = true`,
      `initial_password_generated_at = now()`), mediante RPC `service_role` o inserción directa.
   g. Devuelve **una sola vez** la contraseña en la respuesta (ver §4).
4. El cliente muestra la contraseña **una única vez** y avisa de que no podrá recuperarse.
5. En el primer inicio de sesión, el sistema **exige** el cambio (ver §7).

**Consistencia**: si falla (e) o (f) tras crear el usuario en Auth, se elimina el usuario recién
creado (`auth.admin.deleteUser`) — patrón de rollback **ya usado** por la Edge Function actual.

---

## 3. Método de generación aleatoria (servidor)

- **Entorno**: exclusivamente la Edge Function (Deno). **Nunca** el frontend.
- **Fuente**: Web Crypto (`crypto.getRandomValues`). **Prohibido `Math.random()`**.
- **Alfabeto**: subconjunto sin caracteres ambiguos (p. ej. sin `0/O`, `1/l/I`), tamaño ~58–64.
- **Longitud**: **20 caracteres** → entropía ≈ `20 · log2(58) ≈ 117 bits` (ampliamente superior a
  cualquier umbral razonable).
- **Sin sesgo de módulo**: usar **rechazo** (descartar valores por encima del mayor múltiplo del
  alfabeto) en lugar de `% length`.
- **Sin valores por defecto**: si el llamante envía `password`, **se ignora** (o se rechaza); no hay
  fallback ni reutilización.
- **Ejemplo de diseño** (no implementado):
  - `constalphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%"`;
  - tomar 20 bytes aleatorios, aplicar rechazo y mapear al alfabeto.
- Complemento opcional: verificar contra una lista de contraseñas comunes (no necesaria por la
  entropía, pero puede endurecerse).

---

## 4. Método de entrega de la contraseña

**Opción recomendada (A) — Mostrar una sola vez al administrador:**
- La Edge Function devuelve la contraseña en el cuerpo **únicamente en la respuesta de creación**.
- `PlatformUsers` la muestra en un diálogo modal **no persistente**, con aviso explícito:
  *"Esta contraseña se muestra una sola vez. No podrá recuperarse; el usuario deberá cambiarla al
  entrar."*
- **Nunca** se envía a `console.log`, `localStorage`, `sessionStorage`, analytics ni al estado
  global persistente. Se limpia del estado React al cerrar el modal.

**Opción (B) — Invitación de Supabase Auth (sin contraseña conocida):**
- `auth.admin.inviteUserByEmail(email)`; el usuario fija su contraseña desde el enlace.
- **Ventaja**: nadie conoce la credencial. **Inconveniente**: depende del canal de correo y de una
  ruta de callback (hoy **no existe** flujo de recuperación/recovery).
- **Recomendación**: adoptar (A) en el corto plazo (cumple el requisito de contraseña aleatoria y
  cambio obligatorio) y **evaluar (B)** como evolución cuando exista un flujo de correo/recovery
  verificado. No enviar la contraseña por correo sin evaluar el canal (§7).

---

## 5. Tabla existente o nueva propuesta

### 5.1 Verificación (solo lectura)
- **No existe** ninguna tabla de contraseñas, ciclo de vida ni credenciales en `public`
  (consulta a `information_schema` sin resultados para `%password%`, `%lifecycle%`, `%credential%`).
- `profiles` **no** tiene columnas de ciclo de vida: `id, username, full_name, avatar_url,
  is_active, created_at, updated_at`.
- ⇒ **Se propone tabla nueva `user_password_lifecycle`.** Supabase Auth sigue siendo el único
  responsable del almacenamiento/verificación de credenciales.

### 5.2 Diseño propuesto (NO crear todavía)
```
public.user_password_lifecycle
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
  must_change_password boolean NOT NULL DEFAULT true
  initial_password_generated_at timestamptz
  password_changed_at timestamptz NULL
  created_at timestamptz NOT NULL DEFAULT now()
  updated_at timestamptz NOT NULL DEFAULT now()
```
- **Sin**: contraseña en texto plano, valor reversible, copia del hash de Auth, secretos de
  recuperación.
- `PK = user_id` (referencia a `auth.users`; nunca a `profiles` para no acoplar la vida de la cuenta).
- Trigger `updated_at` reutilizando el patrón `handle_updated_at()` existente.
- Datos de auditoría: `created_at`/`updated_at`; opcional `initial_password_generated_by` (quién la
  emitió).

---

## 6. Diseño de RLS

Principios: **la lectura es de metadatos; la escritura de estado sensible es solo del servidor.**

- **RLS habilitado** en `user_password_lifecycle`.
- **Grants**: `SELECT` a `authenticated`; **no** `INSERT/UPDATE/DELETE` a `authenticated`. Full a
  `service_role`. (Las mutaciones van por RPC `SECURITY DEFINER`.)
- **Policies SELECT**:
  - El propio usuario: `auth.uid() = user_id`.
  - Administración de plataforma autorizada (`has_platform_permission('users.view_all')` o
    superadmin): lectura de todas las filas (solo metadatos).
- **Sin policy de UPDATE/DELETE directa** para `authenticated`: un usuario **no puede** desactivar
  arbitrariamente `must_change_password` ni tocar el estado de otro.
- **Mutaciones por RPC `SECURITY DEFINER`** (no escribir RLS todavía):
  - `mark_password_changed()` — sin parámetros; exige `auth.uid()`; pone
    `must_change_password = false` y `password_changed_at = now()` **solo** para el propio usuario.
  - `initialize_password_lifecycle(p_user_id uuid)` — solo `service_role`, invocada por la Edge
    Function al crear el usuario.
- **Sin escalada de privilegios**: la tabla no concede ningún permiso; `must_change_password` es un
  estado de cuenta, **no** un permiso.
- **No introducir accesos privilegiados desde el navegador**: el cliente nunca usa `service_role`.

---

## 7. Flujo de primer inicio de sesión y cambio obligatorio

### 7.1 Detección
- `loadAuthenticatedIdentity` (o su resultado) incluye `mustChangePassword` leído de
  `user_password_lifecycle` (lectura tolerante: ausencia de fila ⇒ `false`, no bloquea a nadie).
- `AuthContext` expone `mustChangePassword`.

### 7.2 Bloqueo en el cliente (Fase 1)
- En `AppRoutes`, **antes** de los layouts de negocio: si `user && mustChangePassword`, renderizar
  **solo** la pantalla `ChangeInitialPasswordGate` (cambiar contraseña, cerrar sesión). **No** se
  montan los layouts de `/admin`, `/entity/*` ni los de cliente.

### 7.3 Advertencia de seguridad (importante)
- **No basta** con una redirección del frontend: una sesión con contraseña temporal podría llamar a
  RPC/API directamente. La redirección es **UX**, no frontera de seguridad.
- **Diseño recomendado (Fase 2, opcional y sin ejecutar RLS aún)**: un helper SQL
  `public.password_current_required()` que devuelve `false` si el llamante tiene
  `must_change_password = true`, y usarlo como **guardia explícita** en las RPC sensibles y/o en
  policies, **tras** diseñar y validar el mecanismo. Requiere su propio bloque de seguridad y
  pruebas de aislamiento; **no** se modifica RLS en este bloque.
- Mientras no exista la Fase 2, documentar el riesgo residual (ventana entre login y cambio).

---

## 8. Mecanismo de cambio de contraseña y actualización de estado

Orden estricto (no marcar como completado antes de confirmar Auth):

1. Validar la nueva contraseña en cliente y servidor (`passwordChangeError` existente).
2. `supabase.auth.updateUser({ password })` → **esperar** confirmación.
3. Si Auth confirma: invocar la RPC `mark_password_changed()`.
4. Si la RPC confirma: `must_change_password = false`, `password_changed_at = now()`.
5. Redirigir al acceso normal.

**Regla de oro**: `must_change_password` pasa a `false` **solo** tras la confirmación de Auth.

### 8.1 Manejo de fallos parciales
- Si Auth actualiza pero `mark_password_changed()` falla: **reintentar la RPC** (idempotente) y, si
  sigue fallando, **reconciliar en el siguiente login** (la contraseña ya no es la inicial; el
  sistema puede ofrecer "Reintentar"). Nunca dejar `false` sin Auth confirmado.
- Si Auth falla: no se toca la tabla; se informa el error (comportamiento actual de `Account.tsx`).
- La RPC `mark_password_changed()` es **idempotente** (fijar `false` y `now()` dos veces es inocuo).

---

## 9. Tratamiento de recuperación de contraseña

- **Estado actual**: **no existe** flujo de recuperación por correo ni restablecimiento
  administrativo de contraseña. Es una **carencia a cubrir**, no una funcionalidad existente.
- **Eventos que activan/desactivan `must_change_password`** (diseño):
  | Evento | `must_change_password` | Notas |
  |--------|------------------------|-------|
  | Alta de usuario (nueva) | `true` | contraseña aleatoria generada |
  | Cambio voluntario del propio usuario | `false` | tras confirmar Auth |
  | Restablecimiento **administrativo** (contraseña temporal nueva) | `true` | el admin genera otra aleatoria |
  | Recuperación por correo (si se implementa) | `true` | al fijar contraseña por enlace de recovery |
  | Usuarios existentes / creados antes | **sin cambios** | sin fila ⇒ no se les fuerza |
- **Evitar inconsistencias**: cualquiera de estos flujos debe actualizar la tabla en el servidor
  (RPC) y no depender de que el frontend "vea" el evento. **No asumir** que el cliente observa todos
  los cambios de Auth (p. ej. un cambio hecho por otro dispositivo o por un admin).
- Cuando se implemente recovery (`resetPasswordForEmail` + ruta `/reset-password`), deberá
  registrarse el `PASSWORD_RECOVERY` y marcar `true` hasta que el usuario fije la nueva contraseña.

---

## 10. Seguridad (resumen de garantías)
- El usuario **no** puede desactivar `must_change_password` por sí mismo (sin policy de UPDATE; solo
  RPC que exige `auth.uid()` y ser el titular).
- Un administrador **no** puede leer contraseñas (no están en la tabla).
- Un usuario **no** puede modificar el estado de otro (`auth.uid() = user_id`).
- Solo operaciones del servidor (RPC `SECURITY DEFINER` / `service_role`) actualizan estados
  sensibles.
- La tabla **no** concede permisos: sin escalada de privilegios.
- Se respetan los roles/permisos existentes (`users.view_all`, `users.manage_all`, superadmin).

---

## 11. Compatibilidad
- **Preservar**: usuarios existentes, contraseñas actuales, roles, permisos, autenticación,
  aislamiento por cliente/entidad.
- **No** imponer cambio a todos los usuarios existentes: sin fila en `user_password_lifecycle` ⇒
  `mustChangePassword = false`.
- **Cuentas creadas antes con `temp1234!`**: tratamiento específico (decisión de negocio) —
  candidato a **remediación dirigida** (marcar `must_change_password = true` solo para esas cuentas
  conocidas, p. ej. la cuenta `admin` detectada en el Bloque 35.1), no un cambio masivo. Debe
  coordinarse con el saneamiento de HC-048.

---

## 12. Archivos afectados (previsión)
**Código (frontend):**
- `src/contexts/AuthProvider.tsx` (exponer `mustChangePassword`).
- `src/contexts/AuthContext.ts` (tipo del contexto).
- `src/App.tsx` (guardia `ChangeInitialPasswordGate`).
- `src/modules/access-control/application/authentication.queries.ts` (leer lifecycle).
- `src/modules/access-control/application/authentication.commands.ts` (marcar cambio).
- `src/modules/access-control/infrastructure/authentication.repository.ts` (RPC).
- `src/modules/access-control/infrastructure/user-profiles.repository.ts` (lectura lifecycle).
- `src/modules/access-control/presentation/pages/PlatformUsers.tsx` (quitar contraseña; mostrar una vez).
- `src/modules/access-control/infrastructure/platform-users.repository.ts` (quitar `password` del body).
- `src/modules/access-control/domain/entities.ts` (tipos).
- Nueva página/componente `ChangeInitialPasswordGate`.
- `src/modules/access-control/index.ts` (exports).

**Servidor:**
- `supabase/functions/create-sitecorp-user/index.ts` (generación + registro + entrega).

**Base de datos (diseño; no ejecutar):** tabla `user_password_lifecycle`, RLS, RPC
`mark_password_changed`, `initialize_password_lifecycle`.

---

## 13. Plan de implementación por subbloques (≤20 archivos cada uno)

**Subbloque 35.2-A — Esquema y seguridad (FASE B)**
- Crear `user_password_lifecycle` + RLS + RPC (`mark_password_changed`,
  `initialize_password_lifecycle`) + grants. Pruebas de que `authenticated` no puede escribir
  directamente. Sin tocar código de aplicación.

**Subbloque 35.2-B — Generación y entrega (FASE D)**
- Edge Function: generar contraseña (Crypto), sin fallback, registrar estado, devolver una vez.
- `PlatformUsers` + repositorio: quitar el campo de contraseña y mostrar el modal de entrega única.

**Subbloque 35.2-C — Cambio obligatorio (FASE D)**
- `AuthProvider`/`AuthContext`/`App.tsx` + `ChangeInitialPasswordGate` + RPC de marcado;
  `Account.tsx` ajustado para el flujo gate.

**Subbloque 35.2-D — Endurecimiento servidor (FASE B, opcional)**
- Guardia `password_current_required()` en RPC sensibles/RLS. Bloque de seguridad propio con
  validación de aislamiento, **previo diseño y revisión**.

**Subbloque 35.2-E — Compatibilidad y remediación**
- Tratamiento de usuarios existentes y cuentas con `temp1234!` (coordinado con HC-048).

---

## 14. Pruebas necesarias
- **Vitest**: reglas puras (generación/validación de contraseña en su capa; `passwordChangeError`);
  contratos de repositorio (posición del body sin `password`; RPC `mark_password_changed`).
- **Playwright (estático)**: que `PlatformUsers` ya no contiene `temp1234!`; que la Edge Function no
  tiene fallback; que existe la guardia de primer login; que la tabla/RPC están referenciadas.
- **Integración/manual**: alta de usuario → modal una vez → login → gate → cambio → acceso normal;
  reintento de `mark_password_changed`; verificación de que `authenticated` no puede
  `INSERT/UPDATE` la tabla; aislamiento por cliente/entidad (no regresión).
- **Seguridad**: sin `Math.random`, sin logs de contraseña, sin almacenamiento en el navegador.

---

## 15. Estrategia de despliegue
1. Desplegar **Subbloque A** (tabla + RLS + RPC) — aditivo y compatible (no afecta a nadie sin fila).
2. Desplegar **Subbloque B** (Edge Function + UI).
3. Desplegar **Subbloque C** (cambio obligatorio).
4. (Opcional) **Subbloque D/D** y **E** con autorización expresa.
- Orden que evita estados inconsistentes: **siempre el esquema antes que el código** que lo usa.

## 16. Estrategia de reversión
- **A**: la tabla es aditiva; revertir = `DROP` de la tabla/RPC (sin impacto si nadie la usa).
- **B/C**: cambios de código reversibles por commit; la eliminación del campo de contraseña no rompe
  usuarios existentes.
- Nunca borrar `user_password_lifecycle` con datos en uso sin respaldo.

---

## 17. Confirmaciones
- **No se modificó código, base de datos, RLS, RPC, usuarios ni contraseñas.** Las consultas fueron
  de solo lectura (existencia de tablas/columnas).
- **No se desplegaron Edge Functions** ni se ejecutó **Git**.
- Este documento es exclusivamente **diseño/planificación**; no inicia ninguna migración.
