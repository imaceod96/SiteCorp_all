# 10 — Endurecimiento del cambio obligatorio de contraseña (Bloque 35.2C.2)

> **Solo lectura / preparación.** No se aplicaron migraciones ni se desplegaron Edge Functions.
> No se modificaron usuarios, contraseñas ni datos. No se ejecutó Git.

---

## 1. Superficies auditadas (cifras reales)

| Superficie | Cobertura |
|---|---|
| Tablas `public` con RLS y políticas a `authenticated` | **79** → cubiertas por `20261028_02` (política restrictiva) |
| Objetos Storage (`storage.objects`, 4 buckets privados) | cubiertos por `20261028_03` (preparado) |
| Funciones expuestas por PostgREST | **368** = **157 `SECURITY DEFINER`** + **211 invoker** |
| Edge Functions que aceptan JWT | **5** (todas gated salvo `change-initial-password`, que es la vía legítima) |

**Observación clave:** las funciones **`SECURITY INVOKER`** (211) se ejecutan como `authenticated`
y **respetan RLS** ⇒ quedan gobernadas por la política restrictiva de tablas (`20261028_02`).
El hueco real son las **157 `SECURITY DEFINER`**, cuyo propietario (`postgres`) **elude RLS**.

## 2. RPC sensibles identificadas (clasificación de las 157)

| Clase | Patrón | ¿Gate? |
|---|---|---|
| Autorización/consulta de permisos | `can_*`, `is_platform_*`, `has_*_permission` | **NO** (deben seguir respondiendo; bloquearlas rompería identidad/permisos) |
| Lectura de contexto/cálculo | `resolve_*`, `*_context`, `*_preview`, `*_summary`, `*_impact`, `*_alerts`, `*_checklist`, `validate_*`, `get_*_document_data` | **SÍ** (exponen datos de negocio) |
| Escritura de negocio | `create_*`, `save_*`, `register_*`, `change_*`, `complete_*`, `apply_*`, `hire_*`, `link_*`, `set_*`, `update_*`, `delete_*`, `adjust_*`, `cancel_*`, `reincorporate_*`, `migration_*`, `prenomina_*`, `formalize_*`, `recompute_*` | **SÍ** |
| Documentos/Storage | `begin_*_generation`, `*_storage_object_entity` | **SÍ** |

Total a gatear: **≈140** funciones (las ~17 de autorización se conservan).

## 3. Mecanismo propuesto (no implementado por límite de alcance)

No existe forma **centralizada** de bloquear funciones `SECURITY DEFINER` sin editarlas: las
políticas RLS no se aplican a su propietario. La única vía es añadir una comprobación dentro de
cada función. Se propone:

1. Helper `public.assert_password_change_allowed()` (SECURITY DEFINER, `search_path=''`):
   `IF public.current_user_must_change_password() THEN RAISE EXCEPTION ...`.
2. Preponer `PERFORM public.assert_password_change_allowed();` al cuerpo de cada función de la
   lista (excepto autorización), recreándolas con `CREATE OR REPLACE` desde `pg_get_functiondef`.
3. Hacerlo **por lotes, con verificación de dependencias y pruebas**, en bloques separados
   (≈140 funciones ⇒ **supera el límite de 20 archivos** por el volumen y el riesgo).

**BLOQUEO documentado:** el cierre de las 157 `SECURITY DEFINER` no cabe en este bloque; se
detiene y se documenta como pendiente. **No se declara protección completa.**

## 4. Storage

Buckets privados (`public = false`): `avatars`, `documents`, `document-templates`,
`worker_documents`. Lecturas vía URL firmada; escrituras por políticas por entidad.
`20261028_03` añade una política **restrictiva** a `storage.objects` para `authenticated`
(`NOT current_user_must_change_password()`). No afecta a `service_role` ni al cambio de contraseña.
Caveat: `storage.objects` pertenece a `supabase_storage_admin` (verificar privilegios al aplicar).

## 5. Edge Functions

- **Gated (barrera de servidor):** `create-sitecorp-user`, `create-platform-admin`,
  `delete-workspace`, `analyze-document-template`, `generate-document-batch-zip`.
- **Vía legítima (accesible a propósito):** `change-initial-password`.

## 6. Recuperación ante fallo Auth OK + `mark_password_changed` fallido

- **No** se declara éxito (`needs_retry`), el requisito sigue `true` (nunca `false` sin confirmación).
- `change-initial-password` es **idempotente**: si el ciclo ya está `false`, responde éxito **sin**
  volver a tocar la contraseña (evita repetir el cambio). Si sigue `true`, reintenta D→G.
- La confirmación proviene de una operación **verificada del servidor** (`auth.admin.updateUserById`
  + `mark_password_changed` con `service_role`); **nunca** de datos del navegador.
- **No existe reconciliación automática** (job/trigger): la recuperación es el **reintento** del
  propio flujo. Documentado explícitamente.

## 7. Invitaciones y reset administrativo

- `create-platform-admin` usa `auth.admin.inviteUserByEmail` (invitación por email): **no** crea
  fila de ciclo de vida ⇒ el usuario **no** queda obligado al cambio inicial (establece su
  contraseña por el enlace de invitación). **Decisión de negocio pendiente** (¿debe pasar por el
  ciclo?).
- **No existe** flujo de reset administrativo.
- **Prohibido**: reutilizar `initialize_password_lifecycle` para **reactivar** un registro
  existente (su `ON CONFLICT DO NOTHING` no lo hace). Si se necesita reactivación, debe crearse
  una operación privilegiada específica (`reactivate_password_change_requirement`), con permisos
  mínimos y auditoría — **no implementada** (fuera de alcance, requiere autorización).

## 8. Estado

Capa de **tablas** y **Storage**: diseñadas y preparadas (no aplicadas). Capa de **funciones
`SECURITY DEFINER`**: **pendiente** por límite de alcance. Resultado global: **PARCIAL**.
