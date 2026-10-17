/**
 * Bloque 27 — Contratos compartidos de las acciones laborales.
 *
 * Los diálogos de acciones laborales (cambio de contrato, cambio de puesto y baja)
 * pertenecen al módulo Personas, pero la página de vencimientos contractuales
 * (módulo Contratos) necesita abrirlos con los datos del trabajador afectado.
 *
 * Para que Contratos no dependa de la presentación de Personas —lo que cerraría un
 * ciclo— los contratos viven aquí, en la capa compartida, y el punto de composición
 * (`src/App.tsx`) inyecta los componentes reales en la página.
 *
 * No contienen reglas de negocio: sólo la forma de los datos que la página ya calcula
 * (situación vigente del trabajador y contrato vigente) y las props de los diálogos
 * que se inyectan.
 */

/** Importe salarial vigente (forma mínima compartida: importe y moneda). */
export interface WorkerSituationSalary {
  amount: number
  currency_code: string
  effective_from?: string | null
}

/** Situación vigente del trabajador (puesto, cargo, área, grupo y salario). */
export interface WorkerCurrentSituation {
  positionId: string | null
  positionName: string | null
  positionCode: string | null
  jobName: string | null
  areaName: string | null
  groupSequence: number | null
  salary: WorkerSituationSalary | null
  startDate: string | null
  /**
   * Asignación afectada (`p_target_assignment_id`) cuando el trabajador tiene DOS
   * contratos vigentes (pluriempleo). Con un solo contrato viaja `null`/ausente y la
   * llamada a la RPC es EXACTAMENTE la actual.
   */
  targetAssignmentId?: string | null
}

/** Contrato vigente del trabajador (resumen usado por el flujo de cambio de contrato). */
export interface CurrentContractInfo {
  id: string
  typeName: string | null
  typeCode: string | null
  startDate: string
  endDate: string | null
  /**
   * Contrato afectado (`p_target_contract_id`) cuando el trabajador tiene DOS contratos
   * vigentes (pluriempleo). Con un solo contrato viaja `null`/ausente.
   */
  targetContractId?: string | null
}

/** Props del diálogo de cambio de contrato (inyectado desde el punto de composición). */
export interface ChangeContractDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workerId: string
  entityId: string
  current: CurrentContractInfo
  /** Contexto derivado del puesto vigente (para el resumen contractual) */
  workerName?: string
  workerIdentification?: string | null
  /** Puesto vigente (no cambia en este flujo) usado para validar la escala aplicable */
  positionId?: string | null
  positionName?: string | null
  jobName?: string | null
  areaName?: string | null
  salaryGroupSequence?: number | null
  baseSalaryAmount?: number | null
  baseSalaryCurrency?: string | null
  onSuccess: () => void
}

/** Props del diálogo de baja laboral (inyectado desde el punto de composición). */
export interface SeparateWorkerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workerId: string
  current: WorkerCurrentSituation
  onSuccess: () => void
}
