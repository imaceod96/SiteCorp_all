import type { ReactNode } from "react"

/**
 * Fase 11A.6 — Puerto de presentación del selector de representante (§52/§63/§79).
 *
 * Los diálogos de anexos pertenecen al contexto CONTRATOS y muestran el representante
 * que suscribe el anexo, pero NO pueden depender del contexto REPRESENTANTES: eso
 * cerraría un ciclo (Representantes → Control de acceso → Generación documental →
 * Estructura → Personas → Contratos).
 *
 * Aquí se declara el contrato mínimo que los diálogos necesitan del selector (los
 * mismos datos que ya recibe el selector real) y quien compone la ficha del
 * trabajador —Personas, que ya consume el selector— inyecta la implementación.
 * Así el selector, sus opciones y sus validaciones siguen siendo exactamente los
 * mismos, sin duplicar el componente ni su carga de representantes vigentes.
 */
export interface RepresentativeSelectSlot {
  entityId: string
  /** Fecha contractual usada para resolver el representante vigente */
  onDate: string
  value: string | null
  onChange: (assignmentId: string | null) => void
  canManage: boolean
  label: string
  /** Texto de apoyo que documenta la fecha contractual utilizada */
  dateHint?: string
}

export type RepresentativeSelectSlotRenderer = (slot: RepresentativeSelectSlot) => ReactNode
