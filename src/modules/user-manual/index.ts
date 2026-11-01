/**
 * Barrel público del módulo de Manual de Usuario de SiteCorp.
 */

export { UserManualPage } from "./presentation/pages/UserManualPage"
export { UserManualPdfService } from "./application/pdf-generator.service"
export {
  MANUAL_METADATA,
  MANUAL_SECTIONS,
  ARCHITECTURE_OVERVIEW,
  ROLES_MATRIX,
  GLOSSARY_TERMS,
  type ManualSection,
} from "./domain/manual-data"
