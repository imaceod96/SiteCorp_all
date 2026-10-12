import { fetchPersonCatalogs, type CatalogOption } from "@/lib/catalogs"
import {
  fetchCandidateEmploymentLink,
  fetchCandidateExpediente,
  fetchCandidateExpedienteRelated,
  fetchCandidateLicenseIds,
  fetchCandidateVerificationDocuments,
  fetchDocumentTypes,
  type VerificationDocumentRow,
} from "../infrastructure/candidate-expediente.repository"
import {
  fetchEducationLevels,
  fetchGenders,
  fetchMaritalStatuses,
  fetchSkinColorsCatalog,
  fetchLicenseCategories,
} from "../infrastructure/people.repository"
import { fetchEntityPermission } from "../infrastructure/staffing.repository"
import type {
  CandidateExpediente,
  CandidateExpedienteRelated,
  CatalogRow,
  DocumentTypeOption,
  EmploymentLink,
} from "../domain/entities"

/**
 * Personas — Casos de uso de lectura del expediente del CANDIDATO (aplicación).
 *
 * La ficha, el formulario y la vista de candidatos piden aquí lo que necesitan y reciben
 * los datos YA compuestos: ninguna pantalla del expediente compone consultas.
 *
 * Permisos: se leen igual que antes (`can_access_entity`) y SIN propagar fallos, que es lo
 * que ya hacían las dos pantallas: la comprobación solo decide qué se puede ver o editar, y
 * la autoridad real sigue siendo RLS y las RPC.
 *
 * Catálogos: se leen con la tolerancia que ya tenían en la ficha (un catálogo que falla no
 * vacía la pantalla) y con la severidad que ya tenían en el formulario (sin ellos no se
 * puede guardar, así que su error se propaga).
 */

/** Lectura auxiliar tolerante: un fallo se avisa por consola y no vacía la ficha. */
async function optional<T>(read: () => Promise<T[]>, fallback: T[] = []): Promise<T[]> {
  try {
    return await read()
  } catch (error) {
    console.warn("[people] lectura auxiliar no disponible", error)
    return fallback
  }
}

export interface CandidateExpedientePermissions {
  canView: boolean
  canManage: boolean
  /** Permiso para contratar: el botón de alta solo se muestra con él. */
  canManageWorkers: boolean
}

export interface CandidateExpedienteCatalogs {
  genders: CatalogRow[]
  maritalStatuses: CatalogRow[]
  educationLevels: CatalogRow[]
  skinColors: CatalogOption[]
  licenseCategories: CatalogOption[]
  documentTypes: DocumentTypeOption[]
}

export interface CandidateExpedienteView {
  permissions: CandidateExpedientePermissions
  /** Ficha del candidato; `null` cuando no hay permiso de lectura o no existe. */
  candidate: CandidateExpediente | null
  /** Trabajador creado al contratar: define si la persona está en Trabajadores o en Reingresos. */
  linkedWorker: EmploymentLink | null
  drivingLicenseIds: string[]
  catalogs: CandidateExpedienteCatalogs
  related: CandidateExpedienteRelated
}

const emptyRelated = (): CandidateExpedienteRelated => ({
  documents: [],
  workExperiences: [],
  formations: [],
  notes: [],
  additionalInfo: [],
})

/** Datos de referencia de la ficha (catálogos + tipos de documento), tolerantes. */
export async function loadCandidateExpedienteReferenceData(): Promise<
  Omit<CandidateExpedienteCatalogs, "documentTypes"> & { documentTypes: DocumentTypeOption[] }
> {
  const [genders, maritalStatuses, educationLevels, skinColors, licenseCategories, documentTypes] =
    await Promise.all([
      optional<CatalogRow>(fetchGenders),
      optional<CatalogRow>(fetchMaritalStatuses),
      optional<CatalogRow>(fetchEducationLevels),
      optional<CatalogOption>(fetchSkinColorsCatalog),
      optional<CatalogOption>(fetchLicenseCategories),
      optional<DocumentTypeOption>(fetchDocumentTypes),
    ])

  return { genders, maritalStatuses, educationLevels, skinColors, licenseCategories, documentTypes }
}

/** Datos accesorios del expediente (documentos, experiencia, formación, notas e información). */
export async function loadCandidateExpedienteRelated(
  candidateId: string
): Promise<CandidateExpedienteRelated> {
  try {
    return await fetchCandidateExpedienteRelated(candidateId)
  } catch (error) {
    console.warn("[people] no se pudieron leer los datos accesorios del expediente", error)
    return emptyRelated()
  }
}

/**
 * Ficha completa del candidato: permisos, datos de la persona, licencias, vínculo con su
 * trabajador y datos accesorios. La ficha NO cambia de vista: si el vínculo está vigente la
 * persona aparece en Trabajadores y si está finalizado, en Reingresos (vistas excluyentes).
 */
export async function loadCandidateExpedienteView(input: {
  entityId: string
  candidateId: string
}): Promise<CandidateExpedienteView> {
  const [canView, canManage, canManageWorkers] = await Promise.all([
    fetchEntityPermission(input.entityId, "candidates.view"),
    fetchEntityPermission(input.entityId, "candidates.manage"),
    fetchEntityPermission(input.entityId, "workers.manage"),
  ])

  const permissions: CandidateExpedientePermissions = { canView, canManage, canManageWorkers }

  if (!canView) {
    return {
      permissions,
      candidate: null,
      linkedWorker: null,
      drivingLicenseIds: [],
      catalogs: {
        genders: [],
        maritalStatuses: [],
        educationLevels: [],
        skinColors: [],
        licenseCategories: [],
        documentTypes: [],
      },
      related: emptyRelated(),
    }
  }

  const candidate = await fetchCandidateExpediente(input.entityId, input.candidateId)

  const [licenseIds, link, related, reference] = await Promise.all([
    optional<string>(() => fetchCandidateLicenseIds(input.candidateId)),
    candidate.worker_id ? fetchCandidateEmploymentLink(candidate.worker_id) : Promise.resolve(null),
    loadCandidateExpedienteRelated(input.candidateId),
    loadCandidateExpedienteReferenceData(),
  ])

  return {
    permissions,
    candidate,
    linkedWorker: link,
    drivingLicenseIds: licenseIds,
    catalogs: reference,
    related,
  }
}

export interface CandidateFormCatalogs {
  genders: CatalogRow[]
  maritalStatuses: CatalogRow[]
  educationLevels: CatalogRow[]
  skinColors: CatalogOption[]
  licenseCategories: CatalogOption[]
}

/** Catálogos del formulario del candidato: sin ellos no se puede guardar, así que fallan fuerte. */
export async function loadCandidateFormCatalogs(): Promise<CandidateFormCatalogs> {
  const [genders, maritalStatuses, educationLevels, personCatalogs] = await Promise.all([
    fetchGenders(),
    fetchMaritalStatuses(),
    fetchEducationLevels(),
    fetchPersonCatalogs(),
  ])

  return {
    genders,
    maritalStatuses,
    educationLevels,
    skinColors: personCatalogs.skinColors,
    licenseCategories: personCatalogs.licenseCategories,
  }
}

export interface CandidateFormView {
  canManage: boolean
  candidate: CandidateExpediente | null
  drivingLicenseIds: string[]
  /** Documentos verificadores ya registrados: reconstruyen el estado de sus casillas. */
  verificationDocuments: {
    preEmployment: VerificationDocumentRow | null
    criminalRecord: VerificationDocumentRow | null
  }
}

/**
 * Datos que necesita el formulario de edición del candidato: permiso de edición, la ficha
 * y el estado real de sus documentos verificadores. El permiso se devuelve para que la
 * pantalla muestre su mensaje ("No tiene permiso para editar este candidato"), igual que
 * antes.
 */
export async function loadCandidateFormData(input: {
  entityId: string
  candidateId: string
}): Promise<CandidateFormView> {
  const canManage = await fetchEntityPermission(input.entityId, "candidates.manage")

  if (!canManage) {
    return {
      canManage,
      candidate: null,
      drivingLicenseIds: [],
      verificationDocuments: { preEmployment: null, criminalRecord: null },
    }
  }

  const candidate = await fetchCandidateExpediente(input.entityId, input.candidateId)

  const [licenseIds, verificationDocuments] = await Promise.all([
    optional<string>(() => fetchCandidateLicenseIds(input.candidateId)),
    fetchCandidateVerificationDocuments(input.candidateId),
  ])

  return { canManage, candidate, drivingLicenseIds: licenseIds, verificationDocuments }
}
