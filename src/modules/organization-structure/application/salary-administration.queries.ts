import { loadEntityPermission, loadPlatformPermission } from "@/modules/access-control"
import { resolveApplicableScaleId } from "../infrastructure/salary.repository"
import {
  rpcResolveSalaryValue,
  selectCurrentSalaryGroupValue,
  selectEntityEmpresarialScale,
  selectGlobalPresupuestadaScale,
  selectSalaryGroupValueHistory,
  selectSalaryScaleById,
  selectScaleGroupsWithValues,
} from "../infrastructure/salary-administration.repository"
import type {
  SalaryGroupValue,
  SalaryScale,
  SalaryScaleWithGroups,
} from "../domain/entities"

/**
 * Estructura organizativa — Caso de uso de consulta de escalas salariales (aplicación).
 *
 * La escala aplicable a una entidad la decide el backend según su régimen: presupuestada →
 * escala presupuestada global; empresarial → escala empresarial de ESA entidad, sin fallback.
 * Los importes nunca se leen "a mano": se resuelven por vigencia temporal.
 */

/** Escala aplicable a la entidad (o null si no hay ninguna configurada). */
export async function loadSalaryScaleForEntity(
  entityId: string
): Promise<SalaryScale | null> {
  const scaleId = await resolveApplicableScaleId(entityId)
  if (!scaleId) return null
  return selectSalaryScaleById(scaleId)
}

/** Escala con sus grupos activos y el importe vigente de cada uno. */
export async function loadSalaryScaleWithGroups(
  scaleId: string
): Promise<SalaryScaleWithGroups> {
  return selectScaleGroupsWithValues(scaleId)
}

/** Escala presupuestada global de SiteCorp. */
export async function loadGlobalPresupuestadaScale(): Promise<SalaryScale> {
  return selectGlobalPresupuestadaScale()
}

/** Escala empresarial de la entidad. */
export async function loadEntityEmpresarialScale(entityId: string): Promise<SalaryScale> {
  return selectEntityEmpresarialScale(entityId)
}

/** Histórico completo de importes de un grupo, del más reciente al más antiguo. */
export async function loadSalaryGroupValueHistory(
  groupId: string
): Promise<SalaryGroupValue[]> {
  return selectSalaryGroupValueHistory(groupId)
}

/** Importe marcado como vigente del grupo. */
export async function loadCurrentSalaryGroupValue(
  groupId: string
): Promise<SalaryGroupValue | null> {
  return selectCurrentSalaryGroupValue(groupId)
}

/** Importe del grupo aplicable a la entidad en una fecha (resolución por vigencia). */
export async function resolveSalaryValueForGroup(
  entityId: string,
  groupId: string,
  effectiveDate: string
): Promise<SalaryGroupValue | null> {
  return rpcResolveSalaryValue(entityId, groupId, effectiveDate)
}

/**
 * Permisos salariales: basta un permiso de plataforma (que ya incluye al superadministrador)
 * o el permiso interno de la entidad. Ambos se preguntan al dominio de control de acceso,
 * que es el único que conoce las dos familias de permisos.
 */
export async function canViewSalary(entityId?: string): Promise<boolean> {
  if (await loadPlatformPermission("salary.view")) return true
  if (entityId) return loadEntityPermission(entityId, "salary.view")
  return false
}

export async function canManageSalary(entityId?: string): Promise<boolean> {
  if (await loadPlatformPermission("salary.manage")) return true
  if (entityId) return loadEntityPermission(entityId, "salary.manage")
  return false
}

/**
 * Verifica si el usuario puede CREAR una escala empresarial para una entidad específica.
 *
 * A diferencia de `canManageSalary`, esta función NO acepta permisos de plataforma "sólos":
 * la política RLS `can_create_salary_scale` requiere que el usuario tenga el permiso
 * organizativo `salary.manage` en la entidad, a menos que sea superadmin global.
 *
 * La política RLS en la base de datos ya verifica `is_platform_superadmin()` internamente,
 * así que aquí solo verificamos el permiso organizativo, y la RLS se encargará del superadmin.
 */
export async function canCreateEntityEmpresarialScale(entityId: string): Promise<boolean> {
  // Primero verificamos permiso organizativo
  const hasEntityPermission = await loadEntityPermission(entityId, "salary.manage")
  if (hasEntityPermission) return true
  
  // Si no tiene permiso organizativo, la política RLS en Supabase
  // verificará is_platform_superadmin() internamente si el usuario es superadmin
  return false
}

/** Gestionar la escala presupuestada global es un permiso de plataforma. */
export async function canManageGlobalSalary(): Promise<boolean> {
  return loadPlatformPermission("salary.manage")
}
