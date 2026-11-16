-- =============================================================================
-- SCRIPT MANUAL DE CORRECCIÓN DE DATOS DE QA (`supabase/scripts/qa_data_fixes.sql`)
-- =============================================================================
-- USO EXCLUSIVO MANUAL EN CONSOLA SQL DE SUPABASE PARA ENTORNOS DE QA/PRUEBAS.
-- No forma parte de las migraciones automáticas (`supabase/migrations/`) para
-- evitar que las migraciones de esquema dependan de UUIDs de usuarios o filas
-- específicas de una entidad de pruebas (p. ej. "Empresa QA Ficticia").
-- =============================================================================

BEGIN;

-- 1. Reparar notificaciones de capacitación inicial existentes que provienen
--    de un cambio de cargo (trabajadores con más de una asignación en su período
--    laboral actual) para que figuren con trigger_type = 'CAMBIO_CARGO'.
UPDATE public.training_initial_notifications tin
SET
  trigger_type = 'CAMBIO_CARGO',
  hire_date = COALESCE(w.hire_date, tin.hire_date),
  updated_at = now()
FROM public.workers w
WHERE w.id = tin.worker_id
  AND EXISTS (
    SELECT 1
    FROM public.worker_position_assignments wpa_prev
    WHERE wpa_prev.worker_id = tin.worker_id
      AND wpa_prev.id <> COALESCE(tin.assignment_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND wpa_prev.start_date >= COALESCE(w.employment_start_date, w.hire_date)
      AND wpa_prev.start_date < COALESCE(
        (SELECT wpa_cur.start_date FROM public.worker_position_assignments wpa_cur WHERE wpa_cur.id = tin.assignment_id),
        public.cuba_current_date() + 1
      )
  );

-- 2. Encolar trabajos de generación documental para todos los registros
--    existentes que aún no tienen documento completado en `worker_documents`.
SELECT public.backfill_missing_document_generation_jobs();

-- 3. Aplicar transiciones y bajas programadas cuya fecha efectiva ya llegó
--    en la zona horaria de negocio (America/Havana).
SELECT public.apply_due_scheduled_separations(NULL, NULL);

COMMIT;

-- =============================================================================
-- 4. CONSULTAS MANUALES COMENTADAS — INSPECCIÓN Y LIMPIEZA DE PRUEBAS QA (Ronda 4b)
-- =============================================================================
-- Descomentar únicamente al ejecutar manualmente en consola SQL de pruebas sobre
-- "Empresa QA Ficticia". No ejecutar de forma automática en migraciones.
--
-- -- 4a. Inspeccionar trabajadores con incorporación futura (hire_date > hoy en Cuba)
-- -- SELECT w.id, w.code, w.first_name, w.first_surname, w.hire_date
-- -- FROM public.workers w
-- -- JOIN public.organization_entities oe ON oe.id = w.organization_entity_id
-- -- WHERE oe.name = 'Empresa QA Ficticia'
-- --   AND w.hire_date > public.cuba_current_date();
--
-- -- 4b. Eliminar entradas de prenóminas BORRADOR pertenecientes a incorporaciones futuras
-- -- DELETE FROM public.prenomina_worker_entries e
-- -- USING public.prenomina_periods p, public.workers w, public.organization_entities oe
-- -- WHERE p.id = e.period_id
-- --   AND w.id = e.worker_id
-- --   AND oe.id = p.organization_entity_id
-- --   AND oe.name = 'Empresa QA Ficticia'
-- --   AND p.status = 'BORRADOR'
-- --   AND w.hire_date > public.cuba_current_date();
--
-- -- 4c. Inspeccionar posibles devengos/movimientos de vacaciones creados por error antes de la incorporación
-- -- SELECT m.id, w.code, w.first_name, w.hire_date, m.movement_type, m.amount, m.effective_date
-- -- FROM public.worker_vacation_movements m
-- -- JOIN public.workers w ON w.id = m.worker_id
-- -- JOIN public.organization_entities oe ON oe.id = w.organization_entity_id
-- -- WHERE oe.name = 'Empresa QA Ficticia'
-- --   AND w.hire_date > public.cuba_current_date();
--
-- -- 4d. Refrescar períodos BORRADOR de Empresa QA Ficticia con las reglas vigentes
-- -- SELECT p.id, p.period_year, p.period_month, public.prenomina_refresh_workers(p.id)
-- -- FROM public.prenomina_periods p
-- -- JOIN public.organization_entities oe ON oe.id = p.organization_entity_id
-- -- WHERE oe.name = 'Empresa QA Ficticia'
-- --   AND p.status = 'BORRADOR';
--
-- -- 4e. Corregir accidente con fecha futura "Corte en mano con cuchilla QA" (05/12/2026) en Empresa QA Ficticia
-- --     (el trigger trg_validate_sst_accident_incident exige occurred_at <= public.cuba_current_date())
-- -- SELECT ai.id, ai.occurred_at, ai.description
-- -- FROM public.sst_accidents_incidents ai
-- -- JOIN public.organization_entities oe ON oe.id = ai.organization_entity_id
-- -- WHERE oe.name = 'Empresa QA Ficticia'
-- --   AND ai.description ILIKE '%Corte en mano con cuchilla QA%'
-- --   AND ai.occurred_at = DATE '2026-12-05';
-- --
-- -- UPDATE public.sst_accidents_incidents ai
-- -- SET occurred_at = public.cuba_current_date(),
-- --     updated_at = now()
-- -- FROM public.organization_entities oe
-- -- WHERE oe.id = ai.organization_entity_id
-- --   AND oe.name = 'Empresa QA Ficticia'
-- --   AND ai.description ILIKE '%Corte en mano con cuchilla QA%'
-- --   AND ai.occurred_at = DATE '2026-12-05';
--
-- -- 4f. Corregir aptitud médica de Laura Tester (próximo chequeo 10/01/2026 <= evaluación) en Empresa QA Ficticia
-- --     (el trigger trg_validate_sst_health_aptitude exige next_review_date > evaluation_date)
-- -- SELECT ha.id, ha.worker_name_snapshot, ha.evaluation_date, ha.next_review_date, ha.aptitude_status
-- -- FROM public.sst_worker_health_aptitude ha
-- -- JOIN public.organization_entities oe ON oe.id = ha.organization_entity_id
-- -- LEFT JOIN public.workers w ON w.id = ha.worker_id
-- -- WHERE oe.name = 'Empresa QA Ficticia'
-- --   AND (
-- --     ha.worker_name_snapshot ILIKE '%Laura Tester%'
-- --     OR trim(concat_ws(' ', w.first_name, w.first_surname)) ILIKE '%Laura Tester%'
-- --   )
-- --   AND ha.next_review_date = DATE '2026-01-10';
-- --
-- -- UPDATE public.sst_worker_health_aptitude ha
-- -- SET next_review_date = (ha.evaluation_date + INTERVAL '1 year')::date,
-- --     updated_at = now()
-- -- FROM public.organization_entities oe
-- -- WHERE oe.id = ha.organization_entity_id
-- --   AND oe.name = 'Empresa QA Ficticia'
-- --   AND (
-- --     ha.worker_name_snapshot ILIKE '%Laura Tester%'
-- --     OR EXISTS (
-- --       SELECT 1
-- --       FROM public.workers w
-- --       WHERE w.id = ha.worker_id
-- --         AND trim(concat_ws(' ', w.first_name, w.first_surname)) ILIKE '%Laura Tester%'
-- --     )
-- --   )
-- --   AND ha.next_review_date = DATE '2026-01-10';
