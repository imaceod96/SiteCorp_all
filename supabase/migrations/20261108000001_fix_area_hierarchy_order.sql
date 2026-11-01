-- =============================================================================
-- Migración: Corrección de jerarquía y orden en Áreas (organization_areas)
-- Objetivo:
-- 1. Limpiar relaciones parent_area_id erróneas donde un área de orden menor
--    quedó accidentalmente como hija de un área de orden mayor (ej. Área Orden 1
--    dependiendo de Área Orden 2).
-- 2. Impedir en base de datos que un área tenga como área superior (parent_area_id)
--    un área con hierarchy_order mayor que el suyo.
-- =============================================================================

BEGIN;

-- 1. Limpiar cualquier área cuyo padre actual tenga un orden (hierarchy_order) mayor
UPDATE public.organization_areas AS child
SET parent_area_id = NULL,
    updated_at = NOW()
FROM public.organization_areas AS parent
WHERE child.parent_area_id = parent.id
  AND child.hierarchy_order > 0
  AND parent.hierarchy_order > child.hierarchy_order;

-- 2. Función y trigger para validar que nunca un área de orden mayor esté por encima de una de orden menor
CREATE OR REPLACE FUNCTION public.enforce_organization_area_hierarchy_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_order integer;
BEGIN
  IF NEW.parent_area_id IS NOT NULL THEN
    IF NEW.parent_area_id = NEW.id THEN
      RAISE EXCEPTION 'Un área no puede depender de sí misma.';
    END IF;

    SELECT hierarchy_order
      INTO v_parent_order
      FROM public.organization_areas
     WHERE id = NEW.parent_area_id;

    IF v_parent_order IS NOT NULL
       AND NEW.hierarchy_order > 0
       AND v_parent_order > NEW.hierarchy_order THEN
      RAISE EXCEPTION 'Un área de orden % no puede depender de un área superior de orden mayor (%).',
        NEW.hierarchy_order, v_parent_order;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_areas_hierarchy_order ON public.organization_areas;

CREATE TRIGGER trg_organization_areas_hierarchy_order
BEFORE INSERT OR UPDATE OF parent_area_id, hierarchy_order
ON public.organization_areas
FOR EACH ROW
EXECUTE FUNCTION public.enforce_organization_area_hierarchy_order();

COMMIT;
