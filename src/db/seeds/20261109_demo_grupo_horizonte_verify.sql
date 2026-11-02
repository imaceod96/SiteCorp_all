-- ============================================================================
-- SITECORP · AUDITORÍA Y VERIFICACIÓN INTEGRAL DEL ENTORNO DEMO
-- Cliente demostrativo: «Grupo Empresarial Horizonte»
-- Archivo: src/db/seeds/20261109_demo_grupo_horizonte_verify.sql
-- ============================================================================
-- PROPÓSITO
--   Script de SOLO LECTURA (100 % SELECT, sin efectos secundarios) que verifica:
--     - Bloque 0: Evidencia en catálogo de las migraciones `20261108_01` y `20261108_02`
--                 (columnas, firma de función RPC, restricción CHECK y trigger).
--     - Bloque 1: Cuadro de mando de los 58 indicadores del entorno DEMO
--                 «Grupo Empresarial Horizonte» contra las metas aprobadas.
--     - Bloque 2: Desglose de plantilla (áreas, cargos, puestos, plazas aprobadas,
--                 ocupadas, vacantes, activos, inactivos y candidatos) en las 13 entidades.
--     - Bloque 3: Auditoría de integridad referencial funcional (10 verificaciones de
--                 puestos, contratos, áreas, capacitación, SST y vacaciones: 0 errores esperados).
-- ============================================================================

-- ============================================================================
-- BLOQUE 0 · VERIFICACIÓN DE MIGRACIONES 20261108_01 Y 20261108_02 EN CATÁLOGO
-- ============================================================================
SELECT
  1 AS orden,
  '20261108_01_remove_area_job_position_code.sql' AS migracion,
  'Columnas `code` eliminadas en organization_areas, organization_jobs y organization_positions' AS componente_verificado,
  (
    SELECT count(*)::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('organization_areas', 'organization_jobs', 'organization_positions')
      AND column_name = 'code'
  ) AS valor_actual,
  '0' AS valor_esperado,
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('organization_areas', 'organization_jobs', 'organization_positions')
        AND column_name = 'code'
    ) THEN 'OK'
    ELSE 'PENDIENTE'
  END AS estado

UNION ALL

SELECT
  2,
  '20261108_01_remove_area_job_position_code.sql',
  'Función RPC public.save_position_with_schedule (13 parámetros, sin p_code, cuerpo validado)',
  COALESCE((
    SELECT p.pronargs::text || ' params | ' ||
           CASE WHEN p.prosrc NOT ILIKE '%p_code%' AND p.prosrc ILIKE '%p_authorized_quantity%'
                THEN 'cuerpo_sin_p_code_con_validaciones'
                ELSE 'cuerpo_incompleto' END
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'save_position_with_schedule'
    ORDER BY p.pronargs ASC
    LIMIT 1
  ), 'NO_EXISTE'),
  '13 params | cuerpo_sin_p_code_con_validaciones',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'save_position_with_schedule'
        AND p.pronargs = 13
        AND p.prosrc NOT ILIKE '%p_code%'
        AND p.prosrc ILIKE '%p_authorized_quantity%'
    ) THEN 'OK'
    ELSE 'PENDIENTE'
  END

UNION ALL

SELECT
  3,
  '20261108_02_fix_area_hierarchy_order.sql',
  'Función public.enforce_organization_area_hierarchy_order() (definición y control jerárquico)',
  COALESCE((
    SELECT CASE WHEN p.prosrc ILIKE '%v_parent_order > NEW.hierarchy_order%'
                THEN 'control_jerarquico_activo'
                ELSE 'cuerpo_sin_regla_jerarquica' END
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_organization_area_hierarchy_order'
    LIMIT 1
  ), 'NO_EXISTE'),
  'control_jerarquico_activo',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'enforce_organization_area_hierarchy_order'
        AND p.prosrc ILIKE '%v_parent_order > NEW.hierarchy_order%'
    ) THEN 'OK'
    ELSE 'PENDIENTE'
  END

UNION ALL

SELECT
  4,
  '20261108_02_fix_area_hierarchy_order.sql',
  'Trigger trg_organization_areas_hierarchy_order (BEFORE INSERT/UPDATE en parent_area_id, hierarchy_order)',
  COALESCE((
    SELECT tg.tgname || ' -> ' || p.proname
    FROM pg_trigger tg
    JOIN pg_class t ON t.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE n.nspname = 'public'
      AND t.relname = 'organization_areas'
      AND tg.tgname = 'trg_organization_areas_hierarchy_order'
      AND NOT tg.tgisinternal
  ), 'NO_EXISTE'),
  'trg_organization_areas_hierarchy_order -> enforce_organization_area_hierarchy_order',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_trigger tg
      JOIN pg_class t ON t.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE n.nspname = 'public'
        AND t.relname = 'organization_areas'
        AND tg.tgname = 'trg_organization_areas_hierarchy_order'
        AND NOT tg.tgisinternal
        AND p.proname = 'enforce_organization_area_hierarchy_order'
    ) THEN 'OK'
    ELSE 'PENDIENTE'
  END
ORDER BY orden;

-- ============================================================================
-- BLOQUE 1 · CUADRO DE MANDO CONSOLIDADO DE INDICADORES DEL CLIENTE DEMO
-- ============================================================================
WITH demo_client AS (
  SELECT id AS client_id
  FROM public.company_clients
  WHERE lower(btrim(name)) = lower('Grupo Empresarial Horizonte')
  ORDER BY created_at DESC
  LIMIT 1
),
demo_entities AS (
  SELECT e.id, e.entity_type, e.name, e.code, e.account_code, e.parent_id
  FROM public.organization_entities e
  JOIN demo_client dc ON dc.client_id = e.company_client_id
),
metrics AS (
  -- 1. Estructura empresarial
  SELECT 1 AS ord, '1. Estructura' AS modulo, 'Cliente propietario («Grupo Empresarial Horizonte»)' AS indicador,
         (SELECT count(*) FROM demo_client)::text AS actual, '1' AS esperado
  UNION ALL
  SELECT 2, '1. Estructura', 'Total entidades organizativas (1 OSDE + 4 Empresas + 8 UEB)',
         (SELECT count(*) FROM demo_entities)::text, '13'
  UNION ALL
  SELECT 3, '1. Estructura', 'Grupos empresariales (business_group)',
         (SELECT count(*) FROM demo_entities WHERE entity_type = 'business_group')::text, '1'
  UNION ALL
  SELECT 4, '1. Estructura', 'Empresas subordinadas (company)',
         (SELECT count(*) FROM demo_entities WHERE entity_type = 'company')::text, '4'
  UNION ALL
  SELECT 5, '1. Estructura', 'Unidades Empresariales de Base (ueb)',
         (SELECT count(*) FROM demo_entities WHERE entity_type = 'ueb')::text, '8'
  UNION ALL
  SELECT 6, '1. Estructura', 'Planes comerciales activos BASIC_FULL (entity_plans)',
         (SELECT count(*) FROM public.entity_plans ep JOIN demo_entities de ON de.id = ep.entity_id WHERE ep.plan_combination = 'BASIC_FULL')::text, '13'
  UNION ALL
  SELECT 7, '1. Estructura', 'Cargos de representantes formales (organization_representative_positions)',
         (SELECT count(*) FROM public.organization_representative_positions rp JOIN demo_entities de ON de.id = rp.organization_entity_id)::text, '26'
  UNION ALL
  SELECT 8, '1. Estructura', 'Asignaciones vigentes de representantes (effective_to IS NULL)',
         (SELECT count(*) FROM public.organization_representative_assignments ra JOIN demo_entities de ON de.id = ra.organization_entity_id WHERE ra.effective_to IS NULL)::text, '26'

  -- 2. Plantilla de áreas, cargos y puestos
  UNION ALL
  SELECT 9, '2. Plantilla', 'Áreas organizativas activas (organization_areas)',
         (SELECT count(*) FROM public.organization_areas a JOIN demo_entities de ON de.id = a.organization_entity_id WHERE a.is_active = true)::text, '46'
  UNION ALL
  SELECT 10, '2. Plantilla', 'Violaciones de jerarquía en áreas (parent.hierarchy_order > child.hierarchy_order)',
         (SELECT count(*)
          FROM public.organization_areas c
          JOIN public.organization_areas p ON p.id = c.parent_area_id
          JOIN demo_entities de ON de.id = c.organization_entity_id
          WHERE p.hierarchy_order > c.hierarchy_order)::text, '0'
  UNION ALL
  SELECT 11, '2. Plantilla', 'Cargos configurados (organization_jobs)',
         (SELECT count(*) FROM public.organization_jobs j JOIN demo_entities de ON de.id = j.organization_entity_id WHERE j.is_active = true)::text, '85'
  UNION ALL
  SELECT 12, '2. Plantilla', 'Cargos de Especialista Principal (is_principal_specialist = true)',
         (SELECT count(*) FROM public.organization_jobs j JOIN demo_entities de ON de.id = j.organization_entity_id WHERE j.is_principal_specialist = true)::text, '8'
  UNION ALL
  SELECT 13, '2. Plantilla', 'Puestos de trabajo configurados (organization_positions)',
         (SELECT count(*) FROM public.organization_positions p JOIN demo_entities de ON de.id = p.organization_entity_id WHERE p.is_active = true)::text, '111'
  UNION ALL
  SELECT 14, '2. Plantilla', 'Total plazas aprobadas (SUM(authorized_quantity))',
         COALESCE((SELECT sum(p.authorized_quantity) FROM public.organization_positions p JOIN demo_entities de ON de.id = p.organization_entity_id WHERE p.is_active = true), 0)::text, '200'
  UNION ALL
  SELECT 15, '2. Plantilla', 'Total plazas ocupadas vigentes (asignaciones activas)',
         (SELECT count(*)
          FROM public.worker_position_assignments wpa
          JOIN public.workers w ON w.id = wpa.worker_id
          JOIN demo_client dc ON dc.client_id = w.company_client_id
          WHERE w.employment_status = 'active'
            AND wpa.is_current = true
            AND wpa.end_date IS NULL)::text, '165'
  UNION ALL
  SELECT 16, '2. Plantilla', 'Total plazas vacantes disponibles (aprobadas - ocupadas)',
         (
           COALESCE((SELECT sum(p.authorized_quantity) FROM public.organization_positions p JOIN demo_entities de ON de.id = p.organization_entity_id WHERE p.is_active = true), 0)
           -
           (SELECT count(*)
            FROM public.worker_position_assignments wpa
            JOIN public.workers w ON w.id = wpa.worker_id
            JOIN demo_client dc ON dc.client_id = w.company_client_id
            WHERE w.employment_status = 'active'
              AND wpa.is_current = true
              AND wpa.end_date IS NULL)
         )::text, '35'

  -- 3. Escala salarial, antigüedad, categoría académica y CLA
  UNION ALL
  SELECT 17, '3. Retribución', 'Escalas salariales empresariales activas (salary_scales)',
         (SELECT count(*) FROM public.salary_scales s JOIN demo_entities de ON de.id = s.organization_entity_id WHERE s.is_active = true)::text, '13'
  UNION ALL
  SELECT 18, '3. Retribución', 'Grupos salariales configurados (13 escalas × 24 grupos I–XXIV)',
         (SELECT count(*) FROM public.salary_groups sg JOIN public.salary_scales s ON s.id = sg.salary_scale_id JOIN demo_entities de ON de.id = s.organization_entity_id)::text, '312'
  UNION ALL
  SELECT 19, '3. Retribución', 'Rango salarial vigente Grupo I a Grupo XXIV (CUP)',
         COALESCE((
           SELECT min(sgv.amount)::int::text || ' - ' || max(sgv.amount)::int::text
           FROM public.salary_group_values sgv
           JOIN public.salary_groups sg ON sg.id = sgv.salary_group_id
           JOIN public.salary_scales s ON s.id = sg.salary_scale_id
           JOIN demo_entities de ON de.id = s.organization_entity_id
           WHERE sgv.is_active = true
         ), 'N/A'), '2800 - 16200'
  UNION ALL
  SELECT 20, '3. Retribución', 'Tramos de antigüedad (tenure_payment_scales: 4 × 13 entidades)',
         (SELECT count(*) FROM public.tenure_payment_scales t JOIN demo_entities de ON de.id = t.organization_entity_id WHERE t.is_active = true)::text, '52'
  UNION ALL
  SELECT 21, '3. Retribución', 'Pagos por categoría académica MASTER y DOCTOR (academic_category_payments)',
         (SELECT count(*) FROM public.academic_category_payments a JOIN demo_entities de ON de.id = a.organization_entity_id WHERE a.is_active = true)::text, '26'

  -- 4. Personas, contratación, resoluciones, anexos y movimientos
  UNION ALL
  SELECT 22, '4. Personas', 'Trabajadores activos (workers.employment_status = ''active'')',
         (SELECT count(*) FROM public.workers w JOIN demo_client dc ON dc.client_id = w.company_client_id WHERE w.employment_status = 'active')::text, '165'
  UNION ALL
  SELECT 23, '4. Personas', 'Expedientes inactivos disponibles para Reingreso (employment_status = ''inactive'')',
         (SELECT count(*) FROM public.workers w JOIN demo_client dc ON dc.client_id = w.company_client_id WHERE w.employment_status = 'inactive')::text, '8'
  UNION ALL
  SELECT 24, '4. Personas', 'Candidatos activos en bolsa de selección (candidates con worker_id IS NULL)',
         (SELECT count(*) FROM public.candidates c JOIN demo_client dc ON dc.client_id = c.company_client_id WHERE c.worker_id IS NULL)::text, '14'
  UNION ALL
  SELECT 25, '4. Personas', 'Trabajadores activos con 1 reingreso previo (2 períodos laborales)',
         (SELECT count(*) FROM (
            SELECT w.id
            FROM public.workers w
            JOIN demo_client dc ON dc.client_id = w.company_client_id
            JOIN public.worker_employment_movements m ON m.worker_id = w.id
            WHERE w.employment_status = 'active'
              AND m.movement_type = 'REINCORPORACION'
            GROUP BY w.id
            HAVING count(*) = 1
          ) t)::text, '6'
  UNION ALL
  SELECT 26, '4. Personas', 'Trabajadores activos con doble reingreso previo (3 períodos laborales)',
         (SELECT count(*) FROM (
            SELECT w.id
            FROM public.workers w
            JOIN demo_client dc ON dc.client_id = w.company_client_id
            JOIN public.worker_employment_movements m ON m.worker_id = w.id
            WHERE w.employment_status = 'active'
              AND m.movement_type = 'REINCORPORACION'
            GROUP BY w.id
            HAVING count(*) = 2
          ) t)::text, '2'
  UNION ALL
  SELECT 27, '4. Personas', 'Trabajadores promovidos / reubicados (CAMBIO_PUESTO + suplemento)',
         (SELECT count(DISTINCT m.worker_id)
          FROM public.worker_employment_movements m
          JOIN public.workers w ON w.id = m.worker_id
          JOIN demo_client dc ON dc.client_id = w.company_client_id
          WHERE m.movement_type = 'CAMBIO_PUESTO')::text, '10'
  UNION ALL
  SELECT 28, '4. Personas', 'Contratos laborales vigentes (employment_contracts.is_current = true)',
         (SELECT count(*) FROM public.employment_contracts ec JOIN demo_client dc ON dc.client_id = ec.company_client_id WHERE ec.is_current = true)::text, '157'
  UNION ALL
  SELECT 29, '4. Personas', 'Resoluciones de nombramiento vigentes (worker_resolutions.status = ''GENERATED'')',
         (SELECT count(*) FROM public.worker_resolutions wr JOIN demo_client dc ON dc.client_id = wr.company_client_id WHERE wr.status = 'GENERATED')::text, '8'
  UNION ALL
  SELECT 30, '4. Personas', 'Suplementos / anexos contractuales formalizados (contract_addendums)',
         (SELECT count(*) FROM public.contract_addendums ca JOIN demo_client dc ON dc.client_id = ca.company_client_id WHERE ca.status = 'FORMALIZED')::text, '10'
  UNION ALL
  SELECT 31, '4. Personas', 'Contratos determinados próximos a vencer (<= 45 días)',
         (SELECT count(*)
          FROM public.employment_contracts ec
          JOIN demo_client dc ON dc.client_id = ec.company_client_id
          WHERE ec.is_current = true
            AND ec.end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + 45))::text, '12'

  -- 5. Vacaciones y certificados médicos
  UNION ALL
  SELECT 32, '5. Vacaciones', 'Cuentas vacacionales activas con saldo inicial (INITIAL_BALANCE)',
         (SELECT count(DISTINCT wvm.worker_id)
          FROM public.worker_vacation_movements wvm
          JOIN demo_client dc ON dc.client_id = wvm.company_client_id
          WHERE wvm.movement_type = 'INITIAL_BALANCE')::text, '165'
  UNION ALL
  SELECT 33, '5. Vacaciones', 'Períodos vacacionales disfrutados (worker_vacations.status = ''TAKEN'')',
         (SELECT count(*) FROM public.worker_vacations wv JOIN demo_client dc ON dc.client_id = wv.company_client_id WHERE wv.status = 'TAKEN')::text, '48'
  UNION ALL
  SELECT 34, '5. Vacaciones', 'Períodos vacacionales programados sin deducción en ledger (status = ''SCHEDULED'')',
         (SELECT count(*) FROM public.worker_vacations wv JOIN demo_client dc ON dc.client_id = wv.company_client_id WHERE wv.status = 'SCHEDULED')::text, '29'
  UNION ALL
  SELECT 35, '5. Vacaciones', 'Períodos vacacionales cancelados con reversión justificada (status = ''CANCELLED'')',
         (SELECT count(*) FROM public.worker_vacations wv JOIN demo_client dc ON dc.client_id = wv.company_client_id WHERE wv.status = 'CANCELLED')::text, '8'
  UNION ALL
  SELECT 36, '5. Vacaciones', 'Total períodos vacacionales registrados (worker_vacations: 48 + 29 + 8)',
         (SELECT count(*) FROM public.worker_vacations wv JOIN demo_client dc ON dc.client_id = wv.company_client_id)::text, '85'
  UNION ALL
  SELECT 37, '5. Vacaciones', 'Movimientos de consumo vacacional en ledger (VACATION_USAGE: 48 tomadas + 8 antes de cancelar)',
         (SELECT count(*)
          FROM public.worker_vacation_movements wvm
          JOIN demo_client dc ON dc.client_id = wvm.company_client_id
          WHERE wvm.movement_type = 'VACATION_USAGE')::text, '56'
  UNION ALL
  SELECT 38, '5. Vacaciones', 'Movimientos de reversión por cancelación formal (REVERSAL: restituye saldo a las 8 canceladas)',
         (SELECT count(*)
          FROM public.worker_vacation_movements wvm
          JOIN demo_client dc ON dc.client_id = wvm.company_client_id
          WHERE wvm.movement_type = 'REVERSAL')::text, '8'
  UNION ALL
  SELECT 39, '5. Vacaciones', 'Certificados médicos registrados (worker_medical_certificates con soporte PDF)',
         (SELECT count(*) FROM public.worker_medical_certificates mc JOIN demo_client dc ON dc.client_id = mc.company_client_id)::text, '34'

  -- 6. Prenómina
  UNION ALL
  SELECT 40, '6. Prenómina', 'Períodos de prenómina (13 CERRADA Oct 2026 + 13 BORRADOR Nov 2026)',
         (SELECT count(*) FROM public.prenomina_periods pp JOIN demo_client dc ON dc.client_id = pp.company_client_id)::text, '26'
  UNION ALL
  SELECT 41, '6. Prenómina', 'Entradas de trabajadores en prenómina (165 × 2 períodos)',
         (SELECT count(*)
          FROM public.prenomina_worker_entries pwe
          JOIN public.prenomina_periods pp ON pp.id = pwe.period_id
          JOIN demo_client dc ON dc.client_id = pp.company_client_id)::text, '330'

  -- 7. Capacitación
  UNION ALL
  SELECT 42, '7. Capacitación', 'Carpetas de capacitación por área (training_folders)',
         (SELECT count(*) FROM public.training_folders tf JOIN demo_entities de ON de.id = tf.organization_entity_id)::text, '46'
  UNION ALL
  SELECT 43, '7. Capacitación', 'Temas de capacitación (training_topics)',
         (SELECT count(*) FROM public.training_topics tt JOIN demo_entities de ON de.id = tt.organization_entity_id)::text, '32'
  UNION ALL
  SELECT 44, '7. Capacitación', 'Documentos didácticos en temas (training_topic_documents)',
         (SELECT count(*) FROM public.training_topic_documents ttd JOIN demo_entities de ON de.id = ttd.organization_entity_id)::text, '45'
  UNION ALL
  SELECT 45, '7. Capacitación', 'Sesiones formativas (training_sessions: 42 REALIZADA, 20 PROGRAMADA, 6 NO_REALIZADA)',
         (SELECT count(*) FROM public.training_sessions ts JOIN demo_entities de ON de.id = ts.organization_entity_id)::text, '68'
  UNION ALL
  SELECT 46, '7. Capacitación', 'Participaciones en historial formativo (worker_training_records >= 380)',
         (SELECT count(*) FROM public.worker_training_records wtr JOIN demo_entities de ON de.id = wtr.organization_entity_id)::text, '404'
  UNION ALL
  SELECT 47, '7. Capacitación', 'Notificaciones de capacitación inicial en contrataciones recientes (Total)',
         (SELECT count(*)
          FROM public.training_initial_notifications tin
          JOIN demo_entities de ON de.id = tin.organization_entity_id
          WHERE tin.hire_date >= (CURRENT_DATE - 75))::text, '14'
  UNION ALL
  SELECT 48, '7. Capacitación', 'Notificaciones de inducción reciente completadas con registro formal (COMPLETADA)',
         (SELECT count(*)
          FROM public.training_initial_notifications tin
          JOIN demo_entities de ON de.id = tin.organization_entity_id
          WHERE tin.hire_date >= (CURRENT_DATE - 75)
            AND tin.status = 'COMPLETADA'
            AND tin.completed_record_id IS NOT NULL)::text, '5'
  UNION ALL
  SELECT 49, '7. Capacitación', 'Notificaciones pendientes activas en bandeja de inducción inicial (PENDIENTE)',
         (SELECT count(*)
          FROM public.training_initial_notifications tin
          JOIN demo_entities de ON de.id = tin.organization_entity_id
          WHERE tin.status = 'PENDIENTE')::text, '9'

  -- 8. Seguridad y Salud en el Trabajo (SST)
  UNION ALL
  SELECT 50, '8. SST', 'Evaluaciones de riesgos laborales (sst_risk_assessments)',
         (SELECT count(*) FROM public.sst_risk_assessments r JOIN demo_entities de ON de.id = r.organization_entity_id)::text, '28'
  UNION ALL
  SELECT 51, '8. SST', 'Acciones preventivas y correctivas (sst_preventive_actions)',
         (SELECT count(*) FROM public.sst_preventive_actions pa JOIN demo_entities de ON de.id = pa.organization_entity_id)::text, '36'
  UNION ALL
  SELECT 52, '8. SST', 'Catálogo de equipos de protección personal (sst_epp_catalog)',
         (SELECT count(*) FROM public.sst_epp_catalog ec JOIN demo_entities de ON de.id = ec.organization_entity_id)::text, '15'
  UNION ALL
  SELECT 53, '8. SST', 'Requisitos de EPP por cargo (sst_job_epp_requirements)',
         (SELECT count(*) FROM public.sst_job_epp_requirements jer JOIN demo_entities de ON de.id = jer.organization_entity_id)::text, '40'
  UNION ALL
  SELECT 54, '8. SST', 'Entregas individuales de EPP (sst_worker_epp_deliveries)',
         (SELECT count(*) FROM public.sst_worker_epp_deliveries ed JOIN demo_entities de ON de.id = ed.organization_entity_id)::text, '190'
  UNION ALL
  SELECT 55, '8. SST', 'Inspecciones de seguridad (sst_inspections)',
         (SELECT count(*) FROM public.sst_inspections i JOIN demo_entities de ON de.id = i.organization_entity_id)::text, '18'
  UNION ALL
  SELECT 56, '8. SST', 'Hallazgos de inspección (sst_inspection_findings)',
         (SELECT count(*) FROM public.sst_inspection_findings f JOIN demo_entities de ON de.id = f.organization_entity_id)::text, '42'
  UNION ALL
  SELECT 57, '8. SST', 'Evaluaciones de aptitud ocupacional (sst_worker_health_aptitude)',
         (SELECT count(*) FROM public.sst_worker_health_aptitude ha JOIN demo_entities de ON de.id = ha.organization_entity_id)::text, '140'
  UNION ALL
  SELECT 58, '8. SST', 'Accidentes/incidentes (9) + Planes emergencia (10) + Comité (12) + PTS (16)',
         (
           (SELECT count(*) FROM public.sst_accidents_incidents ai JOIN demo_entities de ON de.id = ai.organization_entity_id)::text || ' / ' ||
           (SELECT count(*) FROM public.sst_emergency_plans ep JOIN demo_entities de ON de.id = ep.organization_entity_id)::text || ' / ' ||
           (SELECT count(*) FROM public.sst_committee_records cr JOIN demo_entities de ON de.id = cr.organization_entity_id)::text || ' / ' ||
           (SELECT count(*) FROM public.sst_safe_work_procedures swp JOIN demo_entities de ON de.id = swp.organization_entity_id)::text
         ), '9 / 10 / 12 / 16'
)
SELECT
  ord AS "#",
  modulo AS "Módulo",
  indicador AS "Indicador Verificado",
  actual AS "Valor en BD",
  esperado AS "Objetivo Diseño",
  CASE
    WHEN actual = esperado THEN 'OK'
    ELSE 'REVISAR'
  END AS "Estado"
FROM metrics
ORDER BY ord;

-- ============================================================================
-- BLOQUE 2 · DESGLOSE DE PLANTILLA Y FUERZA LABORAL POR ENTIDAD (13 ENTIDADES)
-- ============================================================================
WITH demo_client AS (
  SELECT id AS client_id
  FROM public.company_clients
  WHERE lower(btrim(name)) = lower('Grupo Empresarial Horizonte')
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  e.code AS "Código Entidad",
  e.account_code AS "Código Cuenta",
  e.entity_type AS "Tipo",
  e.name AS "Nombre de la Entidad",
  (SELECT count(*) FROM public.organization_areas a WHERE a.organization_entity_id = e.id AND a.is_active = true) AS "Áreas",
  (SELECT count(*) FROM public.organization_jobs j WHERE j.organization_entity_id = e.id AND j.is_active = true) AS "Cargos",
  (SELECT count(*) FROM public.organization_positions p WHERE p.organization_entity_id = e.id AND p.is_active = true) AS "Puestos",
  COALESCE((SELECT sum(p.authorized_quantity) FROM public.organization_positions p WHERE p.organization_entity_id = e.id AND p.is_active = true), 0) AS "Plazas Aprobadas",
  (
    SELECT count(*)
    FROM public.worker_position_assignments wpa
    JOIN public.workers w ON w.id = wpa.worker_id
    WHERE w.organization_entity_id = e.id
      AND w.employment_status = 'active'
      AND wpa.is_current = true
      AND wpa.end_date IS NULL
  ) AS "Plazas Ocupadas",
  COALESCE((SELECT sum(p.authorized_quantity) FROM public.organization_positions p WHERE p.organization_entity_id = e.id AND p.is_active = true), 0)
  -
  (
    SELECT count(*)
    FROM public.worker_position_assignments wpa
    JOIN public.workers w ON w.id = wpa.worker_id
    WHERE w.organization_entity_id = e.id
      AND w.employment_status = 'active'
      AND wpa.is_current = true
      AND wpa.end_date IS NULL
  ) AS "Plazas Vacantes",
  (SELECT count(*) FROM public.workers w WHERE w.organization_entity_id = e.id AND w.employment_status = 'active') AS "Trab. Activos",
  (SELECT count(*) FROM public.workers w WHERE w.organization_entity_id = e.id AND w.employment_status = 'inactive') AS "Inactivos (Reingreso)",
  (SELECT count(*) FROM public.candidates c WHERE c.organization_entity_id = e.id AND c.worker_id IS NULL) AS "Candidatos"
FROM public.organization_entities e
JOIN demo_client dc ON dc.client_id = e.company_client_id
ORDER BY
  CASE e.entity_type
    WHEN 'business_group' THEN 1
    WHEN 'company' THEN 2
    ELSE 3
  END,
  e.code;

-- ============================================================================
-- BLOQUE 3 · AUDITORÍA DE INTEGRIDAD REFERENCIAL Y COHERENCIA FUNCIONAL (0 ERRORES)
-- ============================================================================
WITH demo_client AS (
  SELECT id AS client_id
  FROM public.company_clients
  WHERE lower(btrim(name)) = lower('Grupo Empresarial Horizonte')
  ORDER BY created_at DESC
  LIMIT 1
),
demo_entities AS (
  SELECT e.id
  FROM public.organization_entities e
  JOIN demo_client dc ON dc.client_id = e.company_client_id
)
SELECT
  'Puestos con sobreocupación (ocupadas > authorized_quantity)' AS regla_integridad,
  count(*) AS inconsistencias_detectadas
FROM (
  SELECT p.id
  FROM public.organization_positions p
  JOIN demo_entities de ON de.id = p.organization_entity_id
  LEFT JOIN public.worker_position_assignments wpa
    ON wpa.position_id = p.id
   AND wpa.is_current = true
   AND wpa.end_date IS NULL
  GROUP BY p.id, p.authorized_quantity
  HAVING count(wpa.id) > p.authorized_quantity
) q1

UNION ALL

SELECT
  'Trabajadores activos sin asignación vigente única en worker_position_assignments',
  count(*)
FROM (
  SELECT w.id
  FROM public.workers w
  JOIN demo_client dc ON dc.client_id = w.company_client_id
  LEFT JOIN public.worker_position_assignments wpa
    ON wpa.worker_id = w.id
   AND wpa.is_current = true
   AND wpa.end_date IS NULL
  WHERE w.employment_status = 'active'
  GROUP BY w.id
  HAVING count(wpa.id) <> 1
) q2

UNION ALL

SELECT
  'Trabajadores activos sin formalización vigente (ni Contrato activo ni Resolución GENERATED)',
  count(*)
FROM public.workers w
JOIN demo_client dc ON dc.client_id = w.company_client_id
WHERE w.employment_status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.employment_contracts ec
    WHERE ec.worker_id = w.id AND ec.is_current = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.worker_resolutions wr
    WHERE wr.worker_id = w.id AND wr.status = 'GENERATED'
  )

UNION ALL

SELECT
  'Trabajadores con Contrato vigente y Resolución vigente simultáneamente (exclusión mutua)',
  count(*)
FROM public.workers w
JOIN demo_client dc ON dc.client_id = w.company_client_id
WHERE w.employment_status = 'active'
  AND EXISTS (
    SELECT 1 FROM public.employment_contracts ec
    WHERE ec.worker_id = w.id AND ec.is_current = true
  )
  AND EXISTS (
    SELECT 1 FROM public.worker_resolutions wr
    WHERE wr.worker_id = w.id AND wr.status = 'GENERATED'
  )

UNION ALL

SELECT
  'Trabajadores inactivos con asignación o contrato que siga marcado como vigente',
  count(*)
FROM public.workers w
JOIN demo_client dc ON dc.client_id = w.company_client_id
WHERE w.employment_status = 'inactive'
  AND (
    EXISTS (SELECT 1 FROM public.worker_position_assignments wpa WHERE wpa.worker_id = w.id AND wpa.is_current = true)
    OR
    EXISTS (SELECT 1 FROM public.employment_contracts ec WHERE ec.worker_id = w.id AND ec.is_current = true)
  )

UNION ALL

SELECT
  'Áreas subordinadas cuyo orden jerárquico sea menor que el de su área padre',
  count(*)
FROM public.organization_areas child
JOIN public.organization_areas parent ON parent.id = child.parent_area_id
JOIN demo_entities de ON de.id = child.organization_entity_id
WHERE parent.hierarchy_order > child.hierarchy_order

UNION ALL

SELECT
  'Carpetas y temas de capacitación con discordancia de entidad o área respecto a su carpeta matriz',
  count(*)
FROM public.training_topics tt
JOIN public.training_folders tf ON tf.id = tt.folder_id
JOIN demo_entities de ON de.id = tt.organization_entity_id
WHERE tt.organization_entity_id <> tf.organization_entity_id
   OR tt.area_id <> tf.area_id

UNION ALL

SELECT
  'Participaciones formativas (worker_training_records) con discordancia de entidad respecto al trabajador',
  count(*)
FROM public.worker_training_records wtr
JOIN public.workers w ON w.id = wtr.worker_id
JOIN demo_entities de ON de.id = wtr.organization_entity_id
WHERE wtr.organization_entity_id <> w.organization_entity_id

UNION ALL

SELECT
  'Registros de SST (entregas de EPP y aptitud médica) con discordancia de entidad respecto al trabajador',
  count(*)
FROM (
  SELECT ed.id
  FROM public.sst_worker_epp_deliveries ed
  JOIN public.workers w ON w.id = ed.worker_id
  JOIN demo_entities de ON de.id = ed.organization_entity_id
  WHERE ed.organization_entity_id <> w.organization_entity_id
  UNION ALL
  SELECT ha.id
  FROM public.sst_worker_health_aptitude ha
  JOIN public.workers w ON w.id = ha.worker_id
  JOIN demo_entities de ON de.id = ha.organization_entity_id
  WHERE ha.organization_entity_id <> w.organization_entity_id
) q_sst

UNION ALL

SELECT
  'Movimientos vacacionales (worker_vacation_movements) con discordancia de trabajador o entidad en asignación',
  count(*)
FROM public.worker_vacation_movements wvm
JOIN public.worker_position_assignments wpa ON wpa.id = wvm.assignment_id
JOIN demo_entities de ON de.id = wvm.organization_entity_id
WHERE wvm.worker_id <> wpa.worker_id;
