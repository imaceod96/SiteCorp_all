import type { JobClaConfig, JobClaDraft, OrganizationArea } from "./entities"

/**
 * Cargos — reglas puras del formulario.
 *
 * El cargo es el dueño de la clasificación laboral (categoría ocupacional —obligatoria para
 * los cargos nuevos—, niveles de preparación) y de la retribución (grupo salarial de la
 * escala aplicable a la entidad). Las Condiciones Laborales Anormales (CLA) también
 * pertenecen al CARGO, nunca al trabajador ni a la Prenómina.
 *
 * Estas funciones sólo deciden: no escriben ni consultan. Los requisitos duros siguen
 * impuestos por los triggers y las RPC del backend.
 */

/**
 * Valida la CLA del Cargo y devuelve el primer mensaje de error, o null.
 * Nunca se guarda una configuración de CLA incompleta.
 */
export function validateJobCla(cla: JobClaDraft): string | null {
  if (!cla.hasAbnormalConditions) return null

  if (cla.dayEnabled) {
    const rate = parseFloat(cla.dayRate)
    if (cla.dayRate.trim() === "" || isNaN(rate) || rate < 0) {
      return "Indica una tarifa horaria válida (≥ 0) para el pago diurno de CLA"
    }
  }

  if (cla.nightEnabled) {
    if (!cla.night1.start || !cla.night1.end) {
      return "Tramo nocturno 1: indica hora de inicio y hora de fin"
    }
    const rate1 = parseFloat(cla.night1.rate)
    if (cla.night1.rate.trim() === "" || isNaN(rate1) || rate1 < 0) {
      return "Tramo nocturno 1: indica una tarifa horaria válida (≥ 0)"
    }
    if (!cla.night2.start || !cla.night2.end) {
      return "Tramo nocturno 2: indica hora de inicio y hora de fin"
    }
    const rate2 = parseFloat(cla.night2.rate)
    if (cla.night2.rate.trim() === "" || isNaN(rate2) || rate2 < 0) {
      return "Tramo nocturno 2: indica una tarifa horaria válida (≥ 0)"
    }
  }

  return null
}

/** Valida el formulario del cargo y devuelve el primer mensaje de error, o null. */
export function validateJobInput(input: {
  name: string
  areaId: string
  categoryId: string
  salaryGroupId: string
  areas: OrganizationArea[]
  entityId: string
  cla: JobClaDraft
}): string | null {
  if (!input.name) return "El nombre es obligatorio"
  if (!input.areaId) return "El área es obligatoria"
  // Integridad contractual: la categoría ocupacional alimenta el contrato, por lo que debe
  // completarse también al editar cargos históricos incompletos.
  if (!input.categoryId) return "La categoría ocupacional es obligatoria"
  if (!input.salaryGroupId) return "El grupo salarial es obligatorio"

  const claError = validateJobCla(input.cla)
  if (claError) return claError

  // El área del cargo debe pertenecer a la misma entidad de la estructura.
  const area = input.areas.find((a) => a.id === input.areaId)
  if (!area || area.organization_entity_id !== input.entityId) {
    return "El área seleccionada no pertenece a esta entidad"
  }

  return null
}

/**
 * CLA del formulario resuelto a lo que se escribe en el cargo: la tarifa diurna y los dos
 * tramos nocturnos sólo existen cuando su modalidad está activada (sin datos huérfanos).
 */
export function parseJobCla(draft: JobClaDraft): JobClaConfig {
  const dayEnabled = draft.hasAbnormalConditions && draft.dayEnabled
  const nightEnabled = draft.hasAbnormalConditions && draft.nightEnabled

  return {
    has_abnormal_conditions: draft.hasAbnormalConditions,
    cla_day_enabled: dayEnabled,
    cla_day_hourly_rate: dayEnabled ? parseFloat(draft.dayRate) : null,
    cla_night_enabled: nightEnabled,
    night_segments: nightEnabled
      ? [
          {
            segment_order: 1,
            start_time: draft.night1.start,
            end_time: draft.night1.end,
            hourly_rate: parseFloat(draft.night1.rate),
          },
          {
            segment_order: 2,
            start_time: draft.night2.start,
            end_time: draft.night2.end,
            hourly_rate: parseFloat(draft.night2.rate),
          },
        ]
      : [],
  }
}

/** Mensaje de error del guardado del cargo. */
export function jobSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Error al guardar el cargo"
  if (message.includes("categoría ocupacional")) {
    return "La categoría ocupacional es obligatoria para los cargos nuevos."
  }
  return message
}
