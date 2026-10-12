-- ============================================================================
-- SiteCorp · FASE 2/3 — 08. FUNCIONES Y RPC: MOTOR DE REESCRITURA + PREVISUALIZACIÓN
--
-- ESTE FICHERO NO MODIFICA NINGÚN OBJETO DE LA APLICACIÓN.
--   · Solo crea objetos auxiliares en `phase2_migration` (esquema técnico no expuesto).
--   · Lee las definiciones reales con pg_get_functiondef() y genera, para cada función
--     afectada, la definición nueva propuesta, dejándola en una tabla de PREVISUALIZACIÓN
--     para revisión humana.
--   · La aplicación de esas definiciones va en el fichero 11 (transacción aparte y
--     explícitamente guarded). Así la previsualización se puede ejecutar, revisar y
--     volver a ejecutar sin ningún riesgo.
--
-- POR QUÉ NO ESTÁN LOS 56 CUERPOS ESCRITOS A MANO
--   Datos verificados del catálogo real (2026-10-27):
--     · 56 funciones afectadas · 174.602 bytes de cuerpo · 56 SECURITY DEFINER
--     · 9 en lenguaje SQL · 9 con parámetro o columna de salida legacy
--   Transcribir a mano 174 KB de código SECURITY DEFINER que gobierna el aislamiento
--   multiempresa introduciría fallos silenciosos. Por eso la reescritura es
--   DETERMINISTA y AUDITABLE: se aplica una tabla de sustitución explícita a las
--   ZONAS DE CÓDIGO del texto real, dejando intactas TODAS las cadenas literales,
--   los comentarios y los identificadores entrecomillados. Nada se inventa.
--
-- CÓMO SE GARANTIZA QUE NO SE ROMPE NADA
--   1. La CABECERA de la función (nombre, firma, tipos, LANGUAGE, SECURITY DEFINER,
--      SET search_path, volatilidad) se copia VERBATIM; solo se cambia el nombre de la
--      función cuando corresponde. → ninguna firma cambia, ningún parámetro ni columna
--      de salida se renombra, CREATE OR REPLACE conserva OID, propietario y ACL.
--   2. Los SEGMENTOS PRESERVADOS (literales '…', dollar-quotes $…$, identificadores
--      "…", comentarios -- y /* */) se extraen y se recomponen idénticos; el preview
--      COMPARA su lista antes/después y marca bloqueada la función si difiere.
--   3. Los TOKENS LEGACY que queden en el CUERPO reescrito se listan y bloquean la
--      función (semáforo). Nada pasa al fichero 11 sin revisión.
--      La cabecera NO se evalúa con el semáforo porque conserva a propósito los
--      nombres de parámetro y de columna de salida (decisión nº 2): en su lugar se
--      comprueba que solo cambia el nombre de la función (Control 1).
--
-- DECISIONES APROBADAS QUE ESTE FICHERO RESPETA
--   nº 1  tenant_permissions → company_client_permissions ............ grupo TABLA
--   nº 2  claves JSON 'tenant_id' / 'tenant_name' ................... dentro de literales
--         → el lexer NO toca literales, así que se conservan automáticamente.
--   nº 3  `app.workspace_deletion` .................................. literal conservado.
--   nº 4  códigos de permiso ('tenants.delete', 'tenant_roles.manage', patrón de
--         catálogo) ................................................. literales conservados.
--   nº 5  índices/restricciones solo si no hay dependencias por nombre → el índice
--         `workers_tenant_code_unique` NO se renombra y su literal '%…%' se conserva.
--
-- EJEMPLO REAL DE APLICACIÓN DE LAS REGLAS (can_use_tenant_permission, verificado):
--   antes:  FROM public.tenant_memberships tm
--           JOIN public.tenant_user_roles tur ON tur.tenant_membership_id = tm.id
--           AND tm.tenant_id = target_tenant_id
--   después:FROM public.company_client_memberships tm
--           JOIN public.company_client_user_roles tur ON tur.company_client_membership_id = tm.id
--           AND tm.company_client_id = target_tenant_id      ← parámetro PRESERVADO
--   y `'organizations.manage_all'` (código de permiso) queda intacto.
--
-- ORDEN: ejecutar DESPUÉS de 02, 03 y 04 (para que la nomenclatura física exista) y
--        ANTES del fichero 11.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PARTE 0 — TABLA DE SUSTITUCIÓN (explícita, por grupos y desactivable)
-- ============================================================================
CREATE TABLE IF NOT EXISTS phase2_migration.substitution_map (
  id         serial PRIMARY KEY,
  group_code text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  old_token  text NOT NULL,
  new_token  text NOT NULL,
  UNIQUE (group_code, old_token)
);

DELETE FROM phase2_migration.substitution_map;

INSERT INTO phase2_migration.substitution_map (group_code, enabled, old_token, new_token) VALUES
  -- GRUPO 1 · TABLAS (decisión nº 1 incluida)
  ('TABLA', true, 'tenant_memberships',       'company_client_memberships'),
  ('TABLA', true, 'tenant_roles',             'company_client_roles'),
  ('TABLA', true, 'tenant_role_permissions',  'company_client_role_permissions'),
  ('TABLA', true, 'tenant_user_roles',        'company_client_user_roles'),
  ('TABLA', true, 'tenant_invitations',       'company_client_invitations'),
  ('TABLA', true, 'tenant_permissions',       'company_client_permissions'),
  ('TABLA', true, 'tenants',                  'company_clients'),
  -- GRUPO 2 · COLUMNAS
  ('COLUMNA', true, 'tenant_membership_id',   'company_client_membership_id'),
  ('COLUMNA', true, 'tenant_permission_id',   'company_client_permission_id'),
  ('COLUMNA', true, 'tenant_role_id',         'company_client_role_id'),
  ('COLUMNA', true, 'tenant_id',              'company_client_id'),
  -- GRUPO 3 · FUNCIONES/RPC (coordinado con la aplicación; ver informe §7)
  ('FUNCION', true, 'protect_system_tenant_role_permissions',      'protect_system_company_client_role_permissions'),
  ('FUNCION', true, 'grant_tenant_permission_to_system_roles',     'grant_company_client_permission_to_system_roles'),
  ('FUNCION', true, 'organization_entity_parent_is_tenant_safe',   'organization_entity_parent_is_company_client_safe'),
  ('FUNCION', true, 'tenant_invitation_entity_same_tenant',        'company_client_invitation_entity_same_company_client'),
  ('FUNCION', true, 'candidates_tenant_entity_same_tenant',        'candidates_entity_same_company_client'),
  ('FUNCION', true, 'protect_system_tenant_role',                  'protect_system_company_client_role'),
  ('FUNCION', true, 'can_use_tenant_permission',                   'can_use_company_client_permission'),
  ('FUNCION', true, 'can_list_tenant_memberships',                 'can_list_company_client_memberships'),
  ('FUNCION', true, 'tenant_invitation_role_entity',               'company_client_invitation_role_entity'),
  ('FUNCION', true, 'entity_user_access_same_tenant',              'entity_user_access_same_company_client'),
  ('FUNCION', true, 'accept_tenant_invitation',                    'accept_company_client_invitation'),
  ('FUNCION', true, 'workspace_deletion_summary',                  'company_client_deletion_summary'),
  ('FUNCION', true, 'workspace_deletion_target',                   'company_client_deletion_target'),
  ('FUNCION', true, 'can_invite_to_tenant',                        'can_invite_to_company_client'),
  ('FUNCION', true, 'has_tenant_permission',                       'has_company_client_permission'),
  ('FUNCION', true, 'create_workspace',                            'create_company_client'),
  ('FUNCION', true, 'delete_workspace',                            'delete_company_client'),
  ('FUNCION', true, 'save_tenant_role',                            'save_company_client_role');

-- Tokens que el SEMÁFORO busca en zona de código. Incluye los nombres de las
-- funciones del grupo 3: si decides NO renombrar funciones, debes poner también a
-- false esas filas de `enabled` en el grupo FUNCION y ampliar/ajustar esta lista.
CREATE TABLE IF NOT EXISTS phase2_migration.legacy_tokens (
  token text PRIMARY KEY
);

DELETE FROM phase2_migration.legacy_tokens;

INSERT INTO phase2_migration.legacy_tokens (token) VALUES
  ('tenants'), ('tenant_memberships'), ('tenant_roles'), ('tenant_role_permissions'),
  ('tenant_user_roles'), ('tenant_invitations'), ('tenant_permissions'),
  ('tenant_id'), ('tenant_membership_id'), ('tenant_role_id'), ('tenant_permission_id'),
  ('create_workspace'), ('delete_workspace'), ('workspace_deletion_summary'),
  ('workspace_deletion_target'), ('has_tenant_permission'), ('can_use_tenant_permission'),
  ('can_list_tenant_memberships'), ('can_invite_to_tenant'), ('accept_tenant_invitation'),
  ('save_tenant_role'), ('protect_system_tenant_role'),
  ('protect_system_tenant_role_permissions'), ('grant_tenant_permission_to_system_roles'),
  ('tenant_invitation_role_entity'), ('tenant_invitation_entity_same_tenant'),
  ('entity_user_access_same_tenant'), ('candidates_tenant_entity_same_tenant'),
  ('organization_entity_parent_is_tenant_safe');

-- ============================================================================
-- PARTE 1 — MOTOR DE REESCRITURA (lexer + sustitución + utilidades)
-- ============================================================================

-- 1.1 Lexer: divide un texto en tramos de CÓDIGO y tramos PRESERVADOS.
CREATE OR REPLACE FUNCTION phase2_migration.split_segments(p_text text)
RETURNS TABLE (ord integer, is_code boolean, seg text)
LANGUAGE plpgsql
STABLE
AS $lexer$
DECLARE
  t       text    := p_text;
  v_len   integer := length(p_text);
  v_i     integer := 1;
  v_start integer := 1;
  v_j     integer;
  v_k     integer;
  v_rm    text[];
  v_delim text;
  v_ord   integer := 0;
BEGIN
  WHILE v_i <= v_len LOOP

    -- literal ' ... '  (escape: '')
    IF substr(t, v_i, 1) = '''' THEN
      v_j := v_i + 1;
      LOOP
        v_k := strpos(substr(t, v_j), '''');
        IF v_k = 0 THEN
          RAISE EXCEPTION 'Lexer: literal simple sin cerrar desde la posición %', v_i;
        END IF;
        v_j := v_j + v_k - 1;
        IF substr(t, v_j + 1, 1) = '''' THEN
          v_j := v_j + 2;
        ELSE
          EXIT;
        END IF;
      END LOOP;

    -- identificador entrecomillado " ... "  (escape: "")
    ELSIF substr(t, v_i, 1) = '"' THEN
      v_j := v_i + 1;
      LOOP
        v_k := strpos(substr(t, v_j), '"');
        IF v_k = 0 THEN
          RAISE EXCEPTION 'Lexer: entrecomillado sin cerrar desde la posición %', v_i;
        END IF;
        v_j := v_j + v_k - 1;
        IF substr(t, v_j + 1, 1) = '"' THEN
          v_j := v_j + 2;
        ELSE
          EXIT;
        END IF;
      END LOOP;

    -- dollar-quote $tag$ ... $tag$  (el tag sigue las reglas de identificador)
    ELSIF substr(t, v_i, 1) = '$' THEN
      v_rm := regexp_match(substr(t, v_i), '^\$([A-Za-z_][A-Za-z_0-9]*)?\$');
      IF v_rm IS NULL THEN
        v_i := v_i + 1;
        CONTINUE;
      END IF;
      v_delim := '$' || coalesce(v_rm[1], '') || '$';
      v_k := strpos(substr(t, v_i + length(v_delim)), v_delim);
      IF v_k = 0 THEN
        RAISE EXCEPTION 'Lexer: dollar-quote % sin cerrar desde la posición %', v_delim, v_i;
      END IF;
      v_j := v_i + 2 * length(v_delim) + v_k - 2;

    -- comentario de bloque /* ... */
    ELSIF substr(t, v_i, 2) = '/*' THEN
      v_k := strpos(substr(t, v_i), '*/');
      IF v_k = 0 THEN
        RAISE EXCEPTION 'Lexer: comentario /* sin cerrar desde la posición %', v_i;
      END IF;
      v_j := v_i + v_k + 1;

    -- comentario de línea -- ...
    ELSIF substr(t, v_i, 2) = '--' THEN
      v_k := strpos(substr(t, v_i), chr(10));
      IF v_k = 0 THEN
        v_j := v_len;
      ELSE
        v_j := v_i + v_k - 1;
      END IF;

    ELSE
      v_i := v_i + 1;
      CONTINUE;
    END IF;

    IF v_i > v_start THEN
      v_ord := v_ord + 1;
      RETURN QUERY SELECT v_ord, true, substr(t, v_start, v_i - v_start);
    END IF;

    v_ord := v_ord + 1;
    RETURN QUERY SELECT v_ord, false, substr(t, v_i, v_j - v_i + 1);

    v_i := v_j + 1;
    v_start := v_i;
  END LOOP;

  IF v_len >= v_start THEN
    v_ord := v_ord + 1;
    RETURN QUERY SELECT v_ord, true, substr(t, v_start);
  END IF;

  RETURN;
END;
$lexer$;

-- 1.2 Sustitución sobre CÓDIGO: tokens completos (\m … \M), token más largo primero.
CREATE OR REPLACE FUNCTION phase2_migration.apply_map(p_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $map$
DECLARE
  m record;
  v text := p_code;
BEGIN
  IF v IS NULL OR v = '' THEN
    RETURN v;
  END IF;

  FOR m IN
    SELECT old_token, new_token
    FROM phase2_migration.substitution_map
    WHERE enabled
    ORDER BY length(old_token) DESC, old_token
  LOOP
    v := regexp_replace(v, '\m' || m.old_token || '\M', m.new_token, 'g');
  END LOOP;

  RETURN v;
END;
$map$;

-- 1.3 Reescritura completa de un texto (código reescrito, resto intacto).
CREATE OR REPLACE FUNCTION phase2_migration.rewrite_identifiers(p_text text)
RETURNS text
LANGUAGE sql
STABLE
AS $rw$
  SELECT coalesce(string_agg(
           CASE WHEN s.is_code THEN phase2_migration.apply_map(s.seg) ELSE s.seg END,
           '' ORDER BY s.ord), '')
  FROM phase2_migration.split_segments(p_text) s
$rw$;

-- 1.4 Detección de tokens legacy en ZONA DE CÓDIGO (semáforo).
CREATE OR REPLACE FUNCTION phase2_migration.legacy_in_code(p_text text)
RETURNS text
LANGUAGE sql
STABLE
AS $lc$
  SELECT coalesce(string_agg(DISTINCT t.token, ', '), '')
  FROM phase2_migration.split_segments(p_text) s
  CROSS JOIN phase2_migration.legacy_tokens t
  WHERE s.is_code
    AND s.seg ~ ('\m' || t.token || '\M')
$lc$;

-- 1.5 Lista de segmentos PRESERVADOS, como ARRAY (comparación exacta, sin separador
--     artificial que pudiera colisionar con el contenido de un literal).
CREATE OR REPLACE FUNCTION phase2_migration.preserved_segments(p_text text)
RETURNS text[]
LANGUAGE sql
STABLE
AS $ps$
  SELECT coalesce(array_agg(s.seg ORDER BY s.ord), ARRAY[]::text[])
  FROM phase2_migration.split_segments(p_text) s
  WHERE NOT s.is_code
$ps$;

-- 1.6 Segmentos preservados que mencionan nomenclatura legacy (revisión manual).
CREATE OR REPLACE FUNCTION phase2_migration.preserved_legacy_report(p_text text)
RETURNS text
LANGUAGE sql
STABLE
AS $pr$
  SELECT coalesce(string_agg(DISTINCT btrim(s.seg), ' | '), '')
  FROM phase2_migration.split_segments(p_text) s
  WHERE NOT s.is_code
    AND s.seg ~ 'tenant'
$pr$;

-- 1.7 Separación CABECERA / CUERPO / COLA de una definición de función.
--     La cabecera (nombre, firma, tipos, LANGUAGE, SECURITY, search_path) NO se toca.
CREATE OR REPLACE FUNCTION phase2_migration.split_functiondef(
  p_def  text,
  OUT p_head text,
  OUT p_body text,
  OUT p_tail text
)
RETURNS record
LANGUAGE plpgsql
STABLE
AS $sp$
DECLARE
  v_pos   integer;
  v_rm    text[];
  v_delim text;
  v_pieces text[];
  v_n     integer;
  v_last  integer := 0;
  v_i     integer;
BEGIN
  v_pos := strpos(p_def, '$');
  IF v_pos = 0 THEN
    RAISE EXCEPTION 'Definición sin dollar-quote: no se puede separar la cabecera';
  END IF;

  v_rm := regexp_match(substr(p_def, v_pos), '^\$([A-Za-z_][A-Za-z_0-9]*)?\$');
  IF v_rm IS NULL THEN
    RAISE EXCEPTION 'El primer $ de la definición no abre un dollar-quote';
  END IF;

  v_delim := '$' || coalesce(v_rm[1], '') || '$';

  -- Cabecera = todo hasta el cierre del delimitador de apertura
  p_head := substr(p_def, 1, v_pos - 1 + length(v_delim));

  -- Cuerpo = entre el PRIMER delimitador y el ÚLTIMO (así un $tag$ anidado dentro
  -- del cuerpo forma parte del cuerpo, como debe ser).
  v_pieces := string_to_array(p_def, v_delim);
  v_n := array_length(v_pieces, 1);
  FOR v_i IN 1 .. (v_n - 1) LOOP
    v_last := v_last + length(v_pieces[v_i]) + length(v_delim);
  END LOOP;
  v_last := v_last - length(v_delim) + 1;   -- posición del último delimitador

  p_body := substr(p_def, length(p_head) + 1, v_last - (length(p_head) + 1));
  p_tail := substr(p_def, v_last);

  RETURN;
END;
$sp$;

-- ============================================================================
-- PARTE 2 — PREVISUALIZACIÓN (no aplica nada)
-- ============================================================================
CREATE TABLE IF NOT EXISTS phase2_migration.function_rewrite_preview (
  id                 bigserial PRIMARY KEY,
  function_oid       oid NOT NULL UNIQUE,
  function_name      text NOT NULL,
  target_name        text NOT NULL,
  identity_arguments text NOT NULL,
  result_type        text NOT NULL,
  old_definition     text NOT NULL,
  new_definition     text NOT NULL,
  signature_ok       boolean NOT NULL,
  literals_ok        boolean NOT NULL,
  remaining_legacy   text,
  blocked            boolean NOT NULL,
  notes              text,
  built_at           timestamptz NOT NULL DEFAULT now()
);

DELETE FROM phase2_migration.function_rewrite_preview;

DO $$
DECLARE
  r            record;
  v_target     text;
  v_old_head   text;
  v_old_body   text;
  v_old_tail   text;
  v_new_head   text;
  v_new_body   text;
  v_new_def    text;
  v_sig_ok     boolean;
  v_lit_ok     boolean;
  v_remaining  text;
  v_notes      text;
  v_head_check text;
  v_error      text;
  v_quoted     text;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           pg_get_function_result(p.oid)             AS result_type,
           pg_get_functiondef(p.oid)                 AS definition,
           p.prosrc                                  AS prosrc,
           (SELECT string_agg(a, ', ') FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%') AS legacy_params
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (p.prosrc ~ '(tenants|tenant_id|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id)'
           OR p.prosrc ~ '\m(create_workspace|delete_workspace|workspace_deletion_summary|workspace_deletion_target)\M'
           OR EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%'))
    ORDER BY p.proname, 3
  LOOP
    v_target := coalesce(
      (SELECT m.new_token FROM phase2_migration.substitution_map m
        WHERE m.enabled AND m.group_code = 'FUNCION' AND m.old_token = r.proname),
      r.proname);

    v_notes := '';
    IF r.legacy_params IS NOT NULL THEN
      v_notes := v_notes ||
        'Firma con nombre legacy PRESERVADO (compatibilidad, decisión nº 2): ' ||
        r.legacy_params || '¶';
    END IF;

    v_error := NULL;
    BEGIN
      SELECT sp.p_head, sp.p_body, sp.p_tail
        INTO v_old_head, v_old_body, v_old_tail
      FROM phase2_migration.split_functiondef(r.definition) sp;
    EXCEPTION WHEN others THEN
      v_error := SQLERRM;
    END;

    IF v_error IS NOT NULL THEN
      INSERT INTO phase2_migration.function_rewrite_preview
        (function_oid, function_name, target_name, identity_arguments, result_type,
         old_definition, new_definition, signature_ok, literals_ok, remaining_legacy,
         blocked, notes)
      VALUES (r.oid, r.proname, v_target, r.identity_arguments, r.result_type,
              r.definition, '', false, false, NULL, true,
              'BLOQUEADA (cabecera/cuerpo): ' || v_error || ' ¶' || v_notes);
      CONTINUE;
    END IF;

    -- Cabecera: verbatim salvo el NOMBRE de la función (la firma no se toca)
    v_new_head := replace(v_old_head,
                          'FUNCTION public.' || r.proname || '(',
                          'FUNCTION public.' || v_target || '(');

    -- Cuerpo: sustitución de identificadores en zona de código
    v_new_body := phase2_migration.rewrite_identifiers(v_old_body);

    v_new_def := v_new_head || v_new_body || v_old_tail;

    -- Control 1 (CORREGIDO): la cabecera se copia VERBATIM y solo cambia el NOMBRE
    -- de la función. Por tanto NO se puede exigir que la cabecera esté libre de
    -- nomenclatura legacy: hay firmas que la CONSERVAN a propósito (decisión nº 2).
    --   Evidencia real: `list_entity_user_access` declara las columnas de salida
    --   `tenant_membership_id` y `tenant_role_id`; `can_use_tenant_permission`
    --   declara el parámetro `target_tenant_id`. Se comprueba lo que de verdad
    --   importa: que NADA de la cabecera cambie salvo ese nombre.
    v_head_check := regexp_replace(v_new_head, '\m' || v_target || '\M', '@@NOMBRE@@', 'g');
    v_sig_ok := (
      v_head_check = regexp_replace(v_old_head, '\m' || r.proname || '\M', '@@NOMBRE@@', 'g')
    );

    -- Control 2: los segmentos preservados (literales, comentarios, comillas) deben
    -- ser EXACTAMENTE los mismos, en el mismo orden y con el mismo contenido.
    v_lit_ok := (phase2_migration.preserved_segments(r.definition)
                 = phase2_migration.preserved_segments(v_new_def));

    -- Control 3 (CORREGIDO): no debe quedar ningún token legacy en la zona de código
    -- REESCRITA, que es el CUERPO. La cabecera queda fuera porque conserva
    -- deliberadamente los nombres de parámetro y de columna de salida (decisión
    -- nº 2); incluirla marcaba `list_entity_user_access` como bloqueada y habría
    -- impedido arrancar el fichero 11 (guardia de 0 bloqueadas).
    v_remaining := phase2_migration.legacy_in_code(v_new_body);

    -- Control 4: un identificador ENTRECOMILLADO ("tenant_id") es zona preservada y
    -- por tanto no lo reescribe el motor; si contuviera nomenclatura legacy sería un
    -- fallo silencioso en runtime, así que BLOQUEA la función.
    -- Evidencia del catálogo (2026-10-27): los 56 cuerpos no contienen NI UNA comilla
    -- doble, de modo que este control debe salir vacío; existe como red de seguridad.
    v_quoted := (
      SELECT coalesce(string_agg(s.seg, ' | '), '')
      FROM phase2_migration.split_segments(r.definition) s
      WHERE NOT s.is_code
        AND left(s.seg, 1) = '"'
        AND s.seg ~ 'tenant'
    );

    IF v_quoted <> '' THEN
      v_remaining := concat_ws(', ', nullif(v_remaining, ''),
                               'IDENTIFICADOR ENTRECOMILLADO SIN SUSTITUIR: ' || v_quoted);
    END IF;

    IF v_target <> r.proname THEN
      v_notes := v_notes || 'Renombrado de función (coordinado con la aplicación) ¶';
    END IF;
    IF NOT v_sig_ok THEN
      v_notes := v_notes || 'ATENCIÓN: la cabecera cambió más allá del nombre de la función ¶';
    END IF;
    IF NOT v_lit_ok THEN
      v_notes := v_notes || 'ATENCIÓN: han cambiado segmentos preservados ¶';
    END IF;
    IF v_remaining <> '' THEN
      v_notes := v_notes || 'ATENCIÓN: quedan tokens legacy en el cuerpo ¶';
    END IF;

    INSERT INTO phase2_migration.function_rewrite_preview
      (function_oid, function_name, target_name, identity_arguments, result_type,
       old_definition, new_definition, signature_ok, literals_ok, remaining_legacy,
       blocked, notes)
    VALUES (r.oid, r.proname, v_target, r.identity_arguments, r.result_type,
            r.definition, v_new_def, v_sig_ok, v_lit_ok, nullif(v_remaining, ''),
            NOT (v_sig_ok AND v_lit_ok AND v_remaining = ''), v_notes);
  END LOOP;
END $$;

-- ============================================================================
-- PARTE 3 — VERIFICACIÓN DE LA PREVISUALIZACIÓN (solo lectura)
-- ============================================================================

-- 3.1 Semáforo. ESPERADO: 0 bloqueadas. Mientras haya bloqueadas, el fichero 11
--     se niega a ejecutarse.
SELECT count(*)                              AS funciones_previstas,
       count(*) FILTER (WHERE blocked)       AS bloqueadas,
       count(*) FILTER (WHERE NOT signature_ok) AS cabecera_con_problema,
       count(*) FILTER (WHERE NOT literals_ok)  AS literales_modificados,
       count(DISTINCT target_name) FILTER (WHERE target_name <> function_name) AS funciones_renombradas
FROM phase2_migration.function_rewrite_preview;

-- 3.2 Detalle de las bloqueadas (debe estar vacío).
SELECT function_name, identity_arguments, remaining_legacy, notes
FROM phase2_migration.function_rewrite_preview
WHERE blocked
ORDER BY function_name;

-- 3.3 REVISIÓN MANUAL OBLIGATORIA: qué funciones van a cambiar de nombre y cuáles
--     conservan su firma con nombres legacy.
SELECT function_name AS nombre_actual, target_name AS nombre_definitivo, identity_arguments
FROM phase2_migration.function_rewrite_preview
WHERE target_name <> function_name
ORDER BY 1, 3;

-- 3.4 REVISIÓN MANUAL: literales/comentarios que siguen mencionando nomenclatura
--     legacy. TODOS deben ser legítimos conforme a las decisiones nº 2, 3 y 4
--     (claves JSON, ajuste de sesión, códigos de permiso, mensajes de error).
--     ESPERADO: solo esos casos; ningún fragmento de SQL dinámico.
SELECT p.function_name,
       phase2_migration.preserved_legacy_report(p.new_definition) AS segmentos_preservados_con_legacy
FROM phase2_migration.function_rewrite_preview p
WHERE phase2_migration.preserved_legacy_report(p.new_definition) <> ''
ORDER BY 1;

-- 3.5 COMPROBACIÓN DEL LEXER sobre el catálogo: la reconstrucción (cabecera + cuerpo
--     reescrito + cola) debe conservar EXACTAMENTE los segmentos preservados del
--     original. Cualquier fila aquí es un fallo del motor y BLOQUEA la fase.
--     ESPERADO: 0 filas.
SELECT p.function_name
FROM phase2_migration.function_rewrite_preview p
WHERE NOT p.literals_ok;

-- 3.6 Tamaño de la previsualización (auditoría del volumen reescrito).
SELECT count(*) AS funciones,
       sum(length(old_definition)) AS bytes_antes,
       sum(length(new_definition)) AS bytes_despues
FROM phase2_migration.function_rewrite_preview;

COMMIT;

-- ============================================================================
-- QUÉ HACER DESPUÉS
--   1. Revisar 3.2 (vacío), 3.3, 3.4 (literales legítimos) y 3.6.
--   2. Si se quiere ver el texto concreto de una función:
--        SELECT old_definition, new_definition
--        FROM phase2_migration.function_rewrite_preview
--        WHERE function_name = 'can_use_tenant_permission';
--   3. Si se decide NO renombrar funciones en esta ventana:
--        UPDATE phase2_migration.substitution_map SET enabled = false
--         WHERE group_code = 'FUNCION';
--        DELETE FROM phase2_migration.legacy_tokens
--         WHERE token IN ('create_workspace','delete_workspace','workspace_deletion_summary',
--                         'workspace_deletion_target','has_tenant_permission',
--                         'can_use_tenant_permission','can_list_tenant_memberships',
--                         'can_invite_to_tenant','accept_tenant_invitation','save_tenant_role',
--                         'protect_system_tenant_role','protect_system_tenant_role_permissions',
--                         'grant_tenant_permission_to_system_roles',
--                         'tenant_invitation_role_entity','tenant_invitation_entity_same_tenant',
--                         'entity_user_access_same_tenant','candidates_tenant_entity_same_tenant',
--                         'organization_entity_parent_is_tenant_safe');
--      y volver a ejecutar este fichero (las llamadas entre funciones quedarán también
--      con el nombre antiguo, de forma coherente).
--   4. Pasar al fichero 11 en la MISMA ventana que el despliegue de la aplicación.
-- ============================================================================
