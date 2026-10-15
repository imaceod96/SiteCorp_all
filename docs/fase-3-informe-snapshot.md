# FASE 3 · Paso 0 — Informe del snapshot de definiciones originales

**Naturaleza:** informe de preparación. **No se ha ejecutado ningún SQL de modificación,
revocación, creación ni cambio de política, no se ha modificado código ni la configuración de
Storage, y no se ha creado ni alterado ningún dato.** Las únicas operaciones realizadas han sido
**consultas de solo lectura** a los catálogos (`pg_proc`, `pg_policy`, `pg_class`, `pg_constraint`,
`pg_trigger`, `information_schema`, `storage.buckets`) y lecturas de código fuente.

Rama: `feat/DDD-migration-backend`. Sin commits, push, merge ni despliegues. Sin Supabase local ni
Docker. No se reabren las fases 1 y 2. `dev`, `schema-target.ts` e `initSchemaTarget()` intactos.

Artefacto generado: **`docs/fase-3-snapshot-originales.sql`**

---

## 1. Qué se ha capturado

Se han obtenido y guardado las definiciones **literales** (no reconstruidas) de todo objeto que
los grupos A–F.2 van a modificar, más el estado de privilegios efectivos necesario para revertir:

| Grupo | Objeto a modificar | Estado hoy | Definición original capturada en el snapshot | Fuente |
|---|---|---|---|---|
| A | `public.protect_system_platform_role_permissions()` | **no existe** (nuevo) | — (reversión = `DROP FUNCTION`) | — |
| A | trigger `platform_role_permissions_protect_system` | **no existe** (nuevo) | — (reversión = `DROP TRIGGER`) | §1.4 confirma 0 triggers previos |
| A | `public.save_platform_role(...)` | existe (oid 18390) | cuerpo completo + `proacl` + `proconfig` | `pg_get_functiondef` |
| A | política `platform_roles_insert` | existe | `WITH CHECK (is_platform_superadmin())`, roles `{authenticated}` | `pg_get_expr` |
| B | política `platform_role_permissions_select` | existe | `USING (is_platform_superadmin() OR has_platform_permission('platform_roles.view'))` | `pg_get_expr` |
| C | `create_worker_medical_certificate` | existe (oid 21071) | cuerpo completo + `proacl` + `proconfig` = NULL | `pg_get_functiondef` |
| C | `update_worker_medical_certificate` | existe (oid 21108) | cuerpo completo **con sus `DEFAULT`** + `proconfig` = NULL | `pg_get_functiondef` |
| C | `get_worker_medical_certificate` | existe (oid 21106) | cuerpo completo + `proconfig` = NULL | `pg_get_functiondef` |
| D | `worker_documents_select / _upload / _update / _delete` | existen | expresión exacta de las 4 políticas, roles `{authenticated}` | `pg_get_expr` |
| E | bucket `avatars` | **no existe** | — (reversión = `DELETE`, solo si está vacío) | §1.6 confirma 3 buckets, ninguno `avatars` |
| E | 5 políticas `avatars_*` | **no existen** | — (reversión = `DROP POLICY`) | §2.E.2 confirma 0 políticas con `avatars` |
| E | `public.profiles` (semántica de `avatar_url`) | existe, **0 filas con avatar** | columnas + políticas de lectura de perfiles | `information_schema` + `pg_policy` |
| F.1 | EXECUTE de 415 funciones + privilegios de tabla de 80 tablas | existen | `proacl` / `relacl` literales + **listas de exclusión** | §3.1–§3.3 |
| F.2 | `proacl` de las funciones internas revocables | existen | `proacl` literal + mapa de llamantes | §3.4 |
| B, E | código DDD de aplicación | existe | rutas, líneas y comportamiento actual | §2.G (reversión por Git) |

---

## 2. Verificación de recuperabilidad objeto por objeto

**Resultado: todas las definiciones originales de la FASE 3 son recuperables. No hay ninguna
definición irrecoverable.**

- **Objetos preexistentes que se modifican** (A: `save_platform_role` y la política; B: la política;
  C: las tres funciones médicas; D: las cuatro políticas de Storage; F.1/F.2: privilegios): su
  definición se ha volcado **verbatim** desde el catálogo (`pg_get_functiondef`, `pg_get_expr`,
  `proacl`, `relacl`, `proconfig`). Todas devolvieron contenido no nulo; `proacl IS NULL` = 0
  funciones (ninguna con ACL por defecto), de modo que no hay privilegio implícito no registrado.
- **Objetos nuevos que no existían** (trigger y función del grupo A, cinco políticas y bucket del
  grupo E): no requieren definición previa; su reversión es un `DROP`/`DELETE`, y se ha verificado
  que **no colisionan con nada existente** (0 triggers en `platform_role_permissions`, 0 políticas
  con `avatars`, 3 buckets sin `avatars`).
- **Los 6 objetos irrecoverables documentados en la FASE 2** (`document_generation_events_select/_insert`
  y las cuatro `candidate_documents_*`) **no forman parte de este plan** y no se tocan: no se repite
  el problema de reversión incompleta.
- **`proconfig`**: se ha registrado que las tres funciones médicas tienen `search_path = NULL` en el
  original; la reversión del grupo C usa `RESET search_path` (no una cadena distinta).
- **`DEFAULT` de argumentos**: el `DEFAULT NULL` de `update_worker_medical_certificate` forma parte de
  su firma y está incluido en el texto original capturado.
- **Datos**: no hay datos que deshacer. `profiles` con `avatar_url` no nulo = **0**; certificados con
  `company_client_id` incoherente = **0**.

---

## 3. Privilegios efectivos incluidos y garantía de no-adición

El snapshot incluye los privilegios **efectivos** (incluidos los heredados de `PUBLIC`) y la
reversión está escrita para **no otorgar ningún privilegio que no existiera**. Cuatro hechos
verificados obligaron a escribirla de forma explícita en lugar de con `GRANT ... ON ALL`:

1. **415 funciones en `public`: 223 de `postgres` (aplicación) y 192 de `supabase_admin`
   (extensiones `btree_gist`, `unaccent`, `pg_trgm`).** Un `REVOKE/GRANT ... ON ALL FUNCTIONS IN
   SCHEMA public` habría modificado objetos gestionados por Supabase. La reversión filtra por
   `proowner = 'postgres'::regrole`.
2. **397 con EXECUTE para `PUBLIC`, 404 para `anon`, 413 para `authenticated`, 415 para
   `service_role`.** Es decir: **18 funciones no tenían `PUBLIC`**, **11 no tenían `anon`** y **2 no
   tenían `authenticated`**. Las tres listas están transcritas en el snapshot (§3.2) y la reversión
   las respeta una a una.
3. **Privilegios de tabla**: el patrón dominante es `arwdDxtm`, pero **26 tablas no tienen entrada
   para `anon`** y **2 tablas** (`employment_contract_types`, `employment_contracts`) tienen
   `authenticated=arwd` **sin `Dxtm`**. La reversión excluye esas tablas del `GRANT` de
   `TRUNCATE, REFERENCES, TRIGGER, MAINTAIN`.
4. **Ninguna tabla de `public` tiene privilegios para `PUBLIC`** (no hay entrada `=` en ningún
   `relacl`) y el esquema `storage` no se toca.

Comprobación de idempotencia incluida en el snapshot: tras la reversión los contadores deben volver
exactamente a **397 / 404 / 413 / 415**.

---

## 4. Correcciones al plan detectadas al construir el snapshot

Cinco hallazgos que modifican el plan de `docs/fase-3-plan-seguridad.md`. **Los tres primeros
afectan directamente a la reversibilidad.**

1. **F.1 estaba sobredimensionado.** El endurecimiento de EXECUTE debe limitarse a las funciones
   propiedad de `postgres` (223) y **excluir las 192 de extensión**. Con el SQL del plan tal cual
   (`ON ALL FUNCTIONS IN SCHEMA public`) se habrían alterado objetos de `supabase_admin` ajenos al
   alcance, y la reversión no habría sido exacta.
2. **El supuesto «todas las funciones tienen EXECUTE para `PUBLIC`» es falso para 18.** En
   consecuencia, el `GRANT EXECUTE ... TO authenticated` en bloque del plan habría **otorgado
   EXECUTE a `prenomina_recalc_entry` y `vacation_post_accrual_internal`**, que hoy son exclusivas de
   `postgres`/`service_role`. Es exactamente el supuesto de «permisos adicionales» que hay que evitar.
3. **`resolve_academic_category_payment_for_flags` sale de la lista F.2 de revocación.** La
   aplicación la invoca directamente (`rpcResolveAcademicCategoryPaymentForFlags` en
   `src/domains/organization-structure/infrastructure/academic-payment.repository.ts`) y además la
   usan `entity_staffing_export` y `prenomina_refresh_workers`. Revocar EXECUTE a `authenticated`
   rompería pantallas reales. La lista F.2 queda en **13 funciones** (no 14). Su hallazgo (no valida
   acceso a la entidad) queda como **decisión de negocio pendiente**, con dos opciones documentadas
   en §6 del snapshot (guarda interna + posible extracción a una función interna sin guarda, al
   estilo de `vacation_post_accrual_internal` / `prenomina_recalc_entry`). Su definición original ya
   está capturada (§2.F.1) para poder revertir cualquiera de las dos opciones.
4. **Existe un precedente arquitectónico idéntico para el grupo A en el ámbito de empresa**:
   `protect_system_company_client_role_permissions()` + trigger
   `company_client_role_permissions_protect_system` (`BEFORE DELETE OR UPDATE`). El trigger de
   plataforma replica ese patrón ya probado, lo que reduce el riesgo de diseño. La única diferencia
   es la válvula de escape (empresa usa `company_client_deletion_target()`; plataforma se apoya en el
   borrado en cascada del catálogo, documentado en §1.5).
5. **`platform_role_permissions` no tenía ningún trigger**, así que el nuevo es el único: sin
   interacciones ni dudas de orden de disparo. Y **el único escritor de la tabla es
   `save_platform_role`** (`has_platform_permission` solo lee), de modo que el trigger cubre el 100%
   de la superficie de escritura, incluidas las llamadas dentro de `SECURITY DEFINER`.

---

## 5. Conclusión: ¿está la reversión completamente cubierta?

**Sí, con tres condiciones explícitas.**

- **Cobertura completa por grupo.** Cada grupo (A, B, C, D, E, F.1, F.2) tiene su bloque de reversión
  en §4 del snapshot, y cada objeto modificado tiene definición original recuperable (§1 y §2). El
  código de aplicación de los grupos B y E se revierte por Git (§2.G); no hay migraciones ni datos
  que deshacer.
- **Condición 1 — aplicar F.1 corregido.** Si se ejecutara el F.1 del plan sin las correcciones 1 y 2,
  la reversión **no** sería completa: habría tocado 192 funciones de extensión y habría añadido
  privilegios a 2 funciones y 2 tablas. Con las correcciones incorporadas al snapshot, la reversión
  es exacta y verificable (397/404/413/415).
- **Condición 2 — la decisión pendiente sobre `resolve_academic_category_payment_for_flags`.** Su
  definición original está capturada, así que cualquier opción es reversible; pero mientras la
  decisión no se tome, el hallazgo permanece **abierto** (no corregido) en la FASE 3.
- **Condición 3 — reversión del bucket `avatars`.** Es un bucket **nuevo**: la reversión lo elimina.
  Se ejecuta **solo si está vacío** (condición incluida en el SQL). Si llegara a contener objetos, la
  reversión los dejaría en un bucket privado sin políticas — no hay copia de esos archivos, y el
  snapshot no puede cubrirlos porque **no existían antes**.

**Riesgos residuales señalados (no bloqueantes):**
- El grupo E es el único que exige aplicar Storage + código de forma coordinada; hasta completarlo, la
  subida/visualización de avatar sigue sin funcionar — **ya no funciona hoy**, así que no hay regresión.
- Tras F.1, una petición **no autenticada** recibirá error de permisos en lugar de una respuesta
  vacía. Verificado que **no existe ninguna política concedida a `anon`** (ni en `public` ni en
  `storage`) y que los tres buckets son privados: no hay superficie anónima legítima.
- El grupo B deja a los usuarios con `platform_roles.view` sin `manage` sin matriz de permisos, lo que
  exige el cambio de UI en el mismo paso lógico.

---

## 6. Estado y siguiente paso

- Snapshot entregado en **`docs/fase-3-snapshot-originales.sql`** (§0 metadatos, §1 estado de partida
  con las consultas de verificación, §2 definiciones literales, §3 privilegios efectivos y
  exclusiones, §4 reversión por grupo, §5 garantía de no-adición, §6 correcciones al plan).
- **Nada se ha ejecutado.** El grupo A sigue sin autorizar.
- Antes de aplicar cualquier grupo habrá que decidir las correcciones 1–3 de §4 de este informe y, si
  se acepta la opción 1 de la corrección 3, incorporar la guarda interna a la lista de cambios del
  grupo correspondiente.
