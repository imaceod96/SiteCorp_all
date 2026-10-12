/**
 * Mensajes de la formalización contractual automática (copy de presentación).
 *
 * La automatización en sí —validar la plantilla ANTES de aplicar el cambio y generar el
 * documento después, sin duplicados— vive en el contexto de contratos
 * (`@/domains/contracts`), que es quien habla con el motor documental.
 */

/** Mensaje claro cuando la contratación no puede completarse por falta de plantilla. */
export const missingContractTemplateMessage = (contractTypeName: string | null): string => {
  const type = contractTypeName ? `«${contractTypeName}»` : "este tipo de contrato"
  return `No se puede completar la contratación.\n\nNo existe una plantilla activa para ${type}. Configura la plantilla documental antes de continuar.`
}

/** Mensaje claro cuando el cambio contractual no puede completarse por falta de plantilla de anexo. */
export const MISSING_ADDENDUM_TEMPLATE_MESSAGE =
  "No se puede completar el cambio contractual.\n\nNo existe una plantilla activa de anexo. Configúrela antes de continuar."
