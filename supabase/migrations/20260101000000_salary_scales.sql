-- Migration: Salary Scales / Salary Groups
-- Version: 20260101000000
-- Phase 5

-- ============================================================
-- SALARY SCALES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.salary_scales (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('PRESUPUESTADA_GLOBAL', 'EMPRESARIAL_ENTITY')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  organization_entity_id uuid REFERENCES public.organization_entities(id) ON DELETE SET NULL,
  regime_id text REFERENCES public.entity_regimes(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  currency_code text NOT NULL DEFAULT 'CUP',
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT chk_presupuestada_global CHECK (
    (scope_type = 'PRESUPUESTADA_GLOBAL' AND tenant_id IS NULL AND organization_entity_id IS NULL)
    OR scope_type != 'PRESUPUESTADA_GLOBAL'
  ),
  CONSTRAINT chk_empresarial_entity CHECK (
    (scope_type = 'EMPRESARIAL_ENTITY' AND tenant_id IS NOT NULL AND organization_entity_id IS NOT NULL)
    OR scope_type != 'EMPRESARIAL_ENTITY'
  )
);

-- One active global PRESUPUESTADA scale
CREATE UNIQUE INDEX IF NOT EXISTS salary_scales_presupuestada_global_unique 
ON public.salary_scales (scope_type, regime_id) 
WHERE scope_type = 'PRESUPUESTADA_GLOBAL' AND is_active = true;

-- One active Empresarial scale per entity
CREATE UNIQUE INDEX IF NOT EXISTS salary_scales_empresarial_entity_unique 
ON public.salary_scales (organization_entity_id) 
WHERE scope_type = 'EMPRESARIAL_ENTITY' AND is_active = true;

ALTER TABLE public.salary_scales ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.salary_scales TO service_role;
GRANT SELECT ON TABLE public.salary_scales TO authenticated;

DROP POLICY IF EXISTS "salary_scales_select" ON public.salary_scales;
CREATE POLICY "salary_scales_select" ON public.salary_scales FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "salary_scales_manage" ON public.salary_scales;
CREATE POLICY "salary_scales_manage" ON public.salary_scales FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "salary_scales_update" ON public.salary_scales;
CREATE POLICY "salary_scales_update" ON public.salary_scales FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "salary_scales_delete" ON public.salary_scales;
CREATE POLICY "salary_scales_delete" ON public.salary_scales FOR DELETE TO authenticated USING (true);

-- ============================================================
-- SALARY GROUPS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.salary_groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  salary_scale_id uuid NOT NULL REFERENCES public.salary_scales(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  description text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS salary_groups_scale_sequence_unique 
ON public.salary_groups (salary_scale_id, sequence_number);

ALTER TABLE public.salary_groups ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.salary_groups TO service_role;
GRANT SELECT ON TABLE public.salary_groups TO authenticated;

DROP POLICY IF EXISTS "salary_groups_select" ON public.salary_groups;
CREATE POLICY "salary_groups_select" ON public.salary_groups FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "salary_groups_manage" ON public.salary_groups;
CREATE POLICY "salary_groups_manage" ON public.salary_groups FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "salary_groups_update" ON public.salary_groups;
CREATE POLICY "salary_groups_update" ON public.salary_groups FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "salary_groups_delete" ON public.salary_groups;
CREATE POLICY "salary_groups_delete" ON public.salary_groups FOR DELETE TO authenticated USING (true);

-- ============================================================
-- SALARY GROUP VALUES (history)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.salary_group_values (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  salary_group_id uuid NOT NULL REFERENCES public.salary_groups(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'CUP',
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS salary_group_values_active_unique 
ON public.salary_group_values (salary_group_id) 
WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS salary_group_values_effective_unique 
ON public.salary_group_values (salary_group_id, effective_from);

ALTER TABLE public.salary_group_values ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.salary_group_values TO service_role;
GRANT SELECT ON TABLE public.salary_group_values TO authenticated;

DROP POLICY IF EXISTS "salary_group_values_select" ON public.salary_group_values;
CREATE POLICY "salary_group_values_select" ON public.salary_group_values FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "salary_group_values_manage" ON public.salary_group_values;
CREATE POLICY "salary_group_values_manage" ON public.salary_group_values FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "salary_group_values_update" ON public.salary_group_values;
CREATE POLICY "salary_group_values_update" ON public.salary_group_values FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "salary_group_values_delete" ON public.salary_group_values;
CREATE POLICY "salary_group_values_delete" ON public.salary_group_values FOR DELETE TO authenticated USING (true);

-- ============================================================
-- FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_salary_scale_for_entity(entity_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  scale_id uuid;
  entity_regime_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  SELECT regime_id INTO entity_regime_id
  FROM public.organization_entities
  WHERE id = entity_id AND is_active = true AND is_sitecorp_account = false;

  IF NOT FOUND THEN RETURN NULL; END IF;

  IF entity_regime_id = (SELECT id FROM public.entity_regimes WHERE name = 'PRESUPUESTADA' LIMIT 1) THEN
    SELECT id INTO scale_id FROM public.salary_scales
    WHERE scope_type = 'PRESUPUESTADA_GLOBAL' AND regime_id = entity_regime_id AND is_active = true LIMIT 1;
  ELSE
    SELECT id INTO scale_id FROM public.salary_scales
    WHERE scope_type = 'EMPRESARIAL_ENTITY' AND organization_entity_id = entity_id AND is_active = true LIMIT 1;
  END IF;

  RETURN scale_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_salary_value(
  entity_id uuid, salary_group_id uuid, effective_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (amount numeric(12,2), currency_code text, effective_from date, effective_to date)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE scale_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  scale_id := public.resolve_salary_scale_for_entity(entity_id);
  IF scale_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.salary_groups WHERE id = salary_group_id AND salary_scale_id = scale_id) THEN RETURN; END IF;
  RETURN QUERY
  SELECT svg.amount, svg.currency_code, svg.effective_from, svg.effective_to
  FROM public.salary_group_values svg
  WHERE svg.salary_group_id = salary_group_id AND svg.is_active = true
    AND svg.effective_from <= effective_date AND (svg.effective_to IS NULL OR svg.effective_to >= effective_date)
  ORDER BY svg.effective_from DESC LIMIT 1;
END;
$$;