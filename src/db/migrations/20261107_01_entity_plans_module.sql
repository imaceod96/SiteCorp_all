-- ============================================================================
-- Migración: Módulo de Planes por Entidad e Historial de Cambios (SiteCorp)
-- Fecha: 2026-11-07
-- Descripción:
--   1. Tabla entity_plans (configuración actual activa de paquetes por entidad).
--   2. Tabla entity_plan_history (registro cronológico inmutable de cambios).
--   3. Función RPC transaccional save_entity_plan (atómica con validaciones).
--   4. Índices, restricciones y políticas RLS.
--   5. Asignación inicial no destructiva para Cuentas SiteCorp existentes.
-- ============================================================================

-- 1. TABLA: entity_plans
CREATE TABLE IF NOT EXISTS public.entity_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
  
  -- Paquete 1: Básico (obligatorio, siempre activo)
  package_basic BOOLEAN NOT NULL DEFAULT true,
  
  -- Paquete 2: Prenómina (opcional)
  package_prenomina BOOLEAN NOT NULL DEFAULT false,
  
  -- Paquete 3: Capacitación y SST (opcional, comercialmente indivisible)
  package_training_sst BOOLEAN NOT NULL DEFAULT false,
  
  -- Combinación calculada de los paquetes habilitados
  -- Valores permitidos: 'BASIC', 'BASIC_PRENOMINA', 'BASIC_TRAINING_SST', 'BASIC_FULL'
  plan_combination VARCHAR(50) NOT NULL DEFAULT 'BASIC',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  CONSTRAINT uq_entity_plans_entity UNIQUE (entity_id),
  CONSTRAINT chk_package_basic_always_true CHECK (package_basic = true),
  CONSTRAINT chk_valid_plan_combination CHECK (
    plan_combination IN ('BASIC', 'BASIC_PRENOMINA', 'BASIC_TRAINING_SST', 'BASIC_FULL')
  )
);

-- 2. TABLA: entity_plan_history
CREATE TABLE IF NOT EXISTS public.entity_plan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.entity_plans(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  
  -- Tipo de operación
  operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('CREACION', 'AMPLIACION', 'REDUCCION')),
  
  -- Combinaciones anterior y nueva
  previous_combination VARCHAR(50) NULL,
  new_combination VARCHAR(50) NOT NULL,
  
  -- Instantáneas JSON de paquetes
  previous_packages JSONB NULL,
  new_packages JSONB NOT NULL,
  
  -- Listas explícitas de paquetes agregados y retirados
  added_packages TEXT[] NOT NULL DEFAULT '{}',
  removed_packages TEXT[] NOT NULL DEFAULT '{}',
  
  -- Motivo u observación opcional
  reason TEXT NULL,
  
  -- Auditoría del responsable
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_email TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. ÍNDICES DE RENDIMIENTO
CREATE INDEX IF NOT EXISTS idx_entity_plans_entity_id ON public.entity_plans(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_plans_client_id ON public.entity_plans(company_client_id);
CREATE INDEX IF NOT EXISTS idx_entity_plan_history_entity_id ON public.entity_plan_history(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_plan_history_plan_id ON public.entity_plan_history(plan_id);
CREATE INDEX IF NOT EXISTS idx_entity_plan_history_created_at ON public.entity_plan_history(created_at DESC);

-- 4. PRIVILEGIOS Y SEGURIDAD A NIVEL DE FILA (RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.entity_plans,
  public.entity_plan_history
TO authenticated, service_role;

ALTER TABLE public.entity_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_plan_history ENABLE ROW LEVEL SECURITY;

-- Lectura entity_plans:
-- Todos los usuarios autenticados con acceso a la plataforma pueden consultar el plan de una entidad
DROP POLICY IF EXISTS "entity_plans_select_policy" ON public.entity_plans;
CREATE POLICY "entity_plans_select_policy" ON public.entity_plans
  FOR SELECT TO authenticated, service_role
  USING (true);

-- Modificación entity_plans:
-- Modificación restringida (las actualizaciones habituales se gestionan vía RPC SECURITY DEFINER)
DROP POLICY IF EXISTS "entity_plans_write_policy" ON public.entity_plans;
CREATE POLICY "entity_plans_write_policy" ON public.entity_plans
  FOR ALL TO authenticated, service_role
  USING (
    public.is_platform_user()
  )
  WITH CHECK (
    public.is_platform_user()
  );

-- Lectura entity_plan_history:
DROP POLICY IF EXISTS "entity_plan_history_select_policy" ON public.entity_plan_history;
CREATE POLICY "entity_plan_history_select_policy" ON public.entity_plan_history
  FOR SELECT TO authenticated, service_role
  USING (true);

-- Modificación entity_plan_history:
DROP POLICY IF EXISTS "entity_plan_history_write_policy" ON public.entity_plan_history;
CREATE POLICY "entity_plan_history_write_policy" ON public.entity_plan_history
  FOR ALL TO authenticated, service_role
  USING (
    public.is_platform_user()
  )
  WITH CHECK (
    public.is_platform_user()
  );

-- 5. FUNCIÓN RPC TRANSACCIONAL: save_entity_plan
-- Ejecuta en una transacción atómica la validación, actualización y registro en historial
CREATE OR REPLACE FUNCTION public.save_entity_plan(
  p_entity_id UUID,
  p_package_prenomina BOOLEAN,
  p_package_training_sst BOOLEAN,
  p_reason TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entity RECORD;
  v_existing_plan RECORD;
  v_new_combination VARCHAR(50);
  v_old_combination VARCHAR(50);
  v_op_type VARCHAR(20);
  v_added TEXT[] := '{}';
  v_removed TEXT[] := '{}';
  v_plan_id UUID;
  v_user_email TEXT := NULL;
  v_acting_user_id UUID;
  v_result JSONB;
BEGIN
  -- 1. Identificar el usuario actor
  v_acting_user_id := COALESCE(p_user_id, auth.uid());
  IF v_acting_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_acting_user_id;
  END IF;

  -- 2. Validar existencia de la entidad (§3.3)
  SELECT id, company_client_id, is_sitecorp_account, name
  INTO v_entity
  FROM public.organization_entities
  WHERE id = p_entity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Error: la entidad seleccionada no existe. Debes crearla antes de asignarle un plan.';
  END IF;

  -- 3. Validar que la entidad sea Cuenta SiteCorp (§3.1, §3.3)
  IF v_entity.is_sitecorp_account IS NOT TRUE THEN
    RAISE EXCEPTION 'Error: esta entidad no está registrada como cuenta SiteCorp. No es posible asignarle un plan.';
  END IF;

  -- 4. Determinar la combinación calculada (§5)
  IF p_package_prenomina = true AND p_package_training_sst = true THEN
    v_new_combination := 'BASIC_FULL';
  ELSIF p_package_prenomina = true AND p_package_training_sst = false THEN
    v_new_combination := 'BASIC_PRENOMINA';
  ELSIF p_package_prenomina = false AND p_package_training_sst = true THEN
    v_new_combination := 'BASIC_TRAINING_SST';
  ELSE
    v_new_combination := 'BASIC';
  END IF;

  -- 5. Buscar plan existente bloqueando la fila para actualización atómica
  SELECT * INTO v_existing_plan
  FROM public.entity_plans
  WHERE entity_id = p_entity_id
  FOR UPDATE;

  IF FOUND THEN
    v_plan_id := v_existing_plan.id;
    v_old_combination := v_existing_plan.plan_combination;

    -- Si no hay cambios reales en los paquetes habilitados, no realizar nada ni generar historial (§10.4)
    IF v_existing_plan.package_prenomina = p_package_prenomina AND
       v_existing_plan.package_training_sst = p_package_training_sst THEN
      SELECT to_jsonb(p) INTO v_result FROM public.entity_plans p WHERE p.id = v_plan_id;
      RETURN v_result;
    END IF;

    -- Calcular paquetes añadidos y retirados
    IF (NOT v_existing_plan.package_prenomina) AND p_package_prenomina THEN
      v_added := array_append(v_added, 'Prenómina');
    END IF;
    IF v_existing_plan.package_prenomina AND (NOT p_package_prenomina) THEN
      v_removed := array_append(v_removed, 'Prenómina');
    END IF;

    IF (NOT v_existing_plan.package_training_sst) AND p_package_training_sst THEN
      v_added := array_append(v_added, 'Capacitación y SST');
    END IF;
    IF v_existing_plan.package_training_sst AND (NOT p_package_training_sst) THEN
      v_removed := array_append(v_removed, 'Capacitación y SST');
    END IF;

    -- Clasificar tipo de operación
    IF cardinality(v_removed) > 0 AND cardinality(v_added) = 0 THEN
      v_op_type := 'REDUCCION';
    ELSIF cardinality(v_added) > 0 AND cardinality(v_removed) = 0 THEN
      v_op_type := 'AMPLIACION';
    ELSE
      v_op_type := 'AMPLIACION';
    END IF;

    -- Actualizar plan existente
    UPDATE public.entity_plans
    SET
      package_basic = true,
      package_prenomina = p_package_prenomina,
      package_training_sst = p_package_training_sst,
      plan_combination = v_new_combination,
      updated_at = now(),
      updated_by = v_acting_user_id
    WHERE id = v_plan_id;

    -- Registrar evento en historial
    INSERT INTO public.entity_plan_history (
      plan_id,
      entity_id,
      operation_type,
      previous_combination,
      new_combination,
      previous_packages,
      new_packages,
      added_packages,
      removed_packages,
      reason,
      changed_by,
      changed_by_email,
      created_at
    ) VALUES (
      v_plan_id,
      p_entity_id,
      v_op_type,
      v_old_combination,
      v_new_combination,
      jsonb_build_object(
        'basic', v_existing_plan.package_basic,
        'prenomina', v_existing_plan.package_prenomina,
        'training_sst', v_existing_plan.package_training_sst
      ),
      jsonb_build_object(
        'basic', true,
        'prenomina', p_package_prenomina,
        'training_sst', p_package_training_sst
      ),
      v_added,
      v_removed,
      p_reason,
      v_acting_user_id,
      v_user_email,
      now()
    );

  ELSE
    -- Alta inicial del plan (§10.1)
    v_op_type := 'CREACION';
    
    IF p_package_prenomina THEN
      v_added := array_append(v_added, 'Prenómina');
    END IF;
    IF p_package_training_sst THEN
      v_added := array_append(v_added, 'Capacitación y SST');
    END IF;

    INSERT INTO public.entity_plans (
      entity_id,
      company_client_id,
      package_basic,
      package_prenomina,
      package_training_sst,
      plan_combination,
      created_at,
      updated_at,
      created_by,
      updated_by
    ) VALUES (
      p_entity_id,
      v_entity.company_client_id,
      true,
      p_package_prenomina,
      p_package_training_sst,
      v_new_combination,
      now(),
      now(),
      v_acting_user_id,
      v_acting_user_id
    )
    RETURNING id INTO v_plan_id;

    -- Registro inicial en historial
    INSERT INTO public.entity_plan_history (
      plan_id,
      entity_id,
      operation_type,
      previous_combination,
      new_combination,
      previous_packages,
      new_packages,
      added_packages,
      removed_packages,
      reason,
      changed_by,
      changed_by_email,
      created_at
    ) VALUES (
      v_plan_id,
      p_entity_id,
      'CREACION',
      NULL,
      v_new_combination,
      NULL,
      jsonb_build_object(
        'basic', true,
        'prenomina', p_package_prenomina,
        'training_sst', p_package_training_sst
      ),
      v_added,
      '{}',
      COALESCE(p_reason, 'Asignación de plan inicial de la entidad'),
      v_acting_user_id,
      v_user_email,
      now()
    );
  END IF;

  SELECT to_jsonb(p) INTO v_result FROM public.entity_plans p WHERE p.id = v_plan_id;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_entity_plan(UUID, BOOLEAN, BOOLEAN, TEXT, UUID) TO authenticated, service_role;

-- 6. MIGRACIÓN INICIAL SEGURA PARA CUENTAS EXISTENTES
-- Asigna el plan completo ('BASIC_FULL') a todas las entidades existentes con is_sitecorp_account = true
-- que aún no tengan un registro en entity_plans, garantizando cero disrupción en producción.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oe.id, oe.company_client_id, oe.name
    FROM public.organization_entities oe
    WHERE oe.is_sitecorp_account = true
      AND NOT EXISTS (SELECT 1 FROM public.entity_plans ep WHERE ep.entity_id = oe.id)
  LOOP
    PERFORM public.save_entity_plan(
      r.id,
      true, -- prenomina activa por defecto para entidades existentes
      true, -- capacitacion y sst activos por defecto para entidades existentes
      'Plan inicial automático por migración de sistema',
      NULL
    );
  END LOOP;
END $$;
