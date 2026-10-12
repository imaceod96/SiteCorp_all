import * as React from "react"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { supabase } from "@/lib/supabase"
import { columnName } from "@/integrations/supabase/schema-target"
import { useNavigate } from "react-router-dom"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis } from "@/components/ui/pagination"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Users, Edit3, Plus, Upload, Eye } from "lucide-react"
import { SelectItem } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  fetchPersonCatalogs,
  saveCandidateDrivingLicenseIds,
  type CatalogOption,
} from "@/lib/catalogs"
import { FilterBuilder } from "@/components/filters/filter-builder"
import { useEntityFilters, type EntityFilterDefinition } from "@/lib/entity-filters"
import { DrivingLicenseSelector } from "@/components/person/DrivingLicenseSelector"
import { AcademicDegreeCheckboxes } from "@/components/person/AcademicDegreeCheckboxes"
import { isValidIdentification, IDENTIFICATION_ERROR_MESSAGE } from "@/utils/ci"

interface Candidate {
  id: string
  tenant_id: string
  organization_entity_id: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  birth_date: string | null
  gender_id: string | null
  marital_status_id: string | null
  phone: string | null
  email: string | null
  address: string | null
  municipality: string | null
  province: string | null
  education_level_id: string | null
  specialty: string | null
  skin_color_id: string | null
  profession_or_trade: string | null
  has_masters_degree: boolean | null
  has_doctorate_degree: boolean | null
  political_affiliation: string | null
  is_retired_or_rehired: boolean | null
  has_disciplinary_measures: boolean | null
  status: "active" | "archived"
  created_at: string
  updated_at: string
}

interface Gender {
  id: string
  name: string
}

interface MaritalStatus {
  id: string
  name: string
}

interface EducationLevel {
  id: string
  name: string
}

interface Province {
  id: string
  name: string
}

interface Municipality {
  id: string
  name: string
}

interface CandidateFormData {
  first_name: string
  first_surname: string
  second_surname: string
  identification: string
  birth_date: string
  gender_id: string
  marital_status_id: string
  phone: string
  email: string
  address: string
  municipality: string
  province: string
  education_level_id: string
  specialty: string
  has_masters_degree: boolean
  has_doctorate_degree: boolean
  profession_or_trade: string
  skin_color_id: string
  driving_license_ids: string[]
  political_affiliation: string
    is_retired_or_rehired: string
    has_disciplinary_measures: boolean
    has_pre_employment_check: boolean
    has_criminal_record_check: boolean
    pre_employment_check_file: File | null
    criminal_record_check_file: File | null
  }

const emptyFormData: CandidateFormData = {
  first_name: "",
  first_surname: "",
  second_surname: "",
  identification: "",
  birth_date: "",
  gender_id: "",
  marital_status_id: "",
  phone: "",
  email: "",
  address: "",
  municipality: "",
  province: "",
  education_level_id: "",
  specialty: "",
  has_masters_degree: false,
  has_doctorate_degree: false,
  profession_or_trade: "",
  skin_color_id: "",
  driving_license_ids: [],
  political_affiliation: "",
    is_retired_or_rehired: "",
    has_disciplinary_measures: false,
    has_pre_employment_check: false,
    has_criminal_record_check: false,
    pre_employment_check_file: null,
    criminal_record_check_file: null,
  }

const CUBA_PROVINCES = [
  "Pinar del Río", "Artemisa", "La Habana", "Mayabeque", "Matanzas",
  "Cienfuegos", "Villa Clara", "Sancti Spíritus", "Ciego de Ávila",
  "Camagüey", "Las Tunas", "Holguín", "Granma", "Santiago de Cuba",
  "Guantánamo", "Isla de la Juventud",
]

const MUNICIPIOS_BY_PROVINCE: Record<string, string[]> = {
  "Pinar del Río": ["Pinar del Río", "San Luis", "Sandino", "Consolación del Sur", "Guane", "Mantua", "Viñales", "La Palma", "Los Palacios", "San Juan y Martínez", "San Cristóbal"],
  "Artemisa": ["Artemisa", "Bauta", "Caimito", "Guanajay", "Güines", "Mariel", "San Antonio de los Baños", "San José de las Lajas"],
  "La Habana": ["La Habana Vieja", "Centro Habana", "Plaza de la Revolución", "Cerro", "Marianao", "10 de Octubre", "La Lisa", "Playa", "Miramar", "Regla", "Guanabacoa", "San Miguel del Padrón", "Diez de Octubre", "Boyeros", "Cotorro", "San José de las Lajas"],
  "Mayabeque": ["San José de las Lajas", "Güines", "Batabanó", "Bejucal", "San Nicolás de Bari", "Santa Cruz del Norte", "Nueva Paz", "San Nicolás", "Madruga", "Melena del Sur", "Quivicán"],
  "Matanzas": ["Matanzas", "Cárdenas", "Colón", "Jagüey Grande", "Jovellanos", "Pedro Betancourt", "Unión de Reyes", "Calimete", "Corralillo", "Guaguasi", "Limonar", "Perico", "Martí"],
  "Cienfuegos": ["Cienfuegos", "Abreus", "Aguada de Pasajeros", "Cumanayagua", "Lajas", "Palmira", "Rodas", "Cumanayagua"],
  "Villa Clara": ["Santa Clara", "Camajuaní", "Caibarién", "Placetas", "Sagua la Grande", "Manicaragua", "Remedios", "Cifuentes", "Santo Domingo", "Zulueta"],
  "Sancti Spíritus": ["Sancti Spíritus", "Trinidad", "Fomento", "Yaguajay", "Zaza del Medio", "Jatibonico", "La Sierpe", "Taguasco", "Tuinicú"],
  "Ciego de Ávila": ["Ciego de Ávila", "Morón", "Baraguá", "Chambas", "Majagua", "Ciro Redondo", "Venezuela", "Florencia"],
  "Camagüey": ["Camagüey", "Nuevitas", "Florida", "Sierra de Cubitas", "Esmeralda", "Vertientes", "Jimaguayú", "Najasa", "Santa Cruz del Sur", "Sibanicú", "Guáimaro"],
  "Las Tunas": ["Las Tunas", "Manatí", "Puerto Padre", "Colombia", "Jesús Menéndez", "Jobabo", "Amancio", "Cauto Cristo"],
  "Holguín": ["Holguín", "Banes", "Frank País", "Mayarí", "Antilla", "Báguanos", "Cacocum", "Cueto", "Gibara", "Rafael Freyre", "Río Cauto", "Sagua de Tánamo"],
  "Granma": ["Bayamo", "Manzanillo", "Jiguaní", "Buey Arriba", "Campechuela", "Cauto Cristo", "Guisa", "Jiguaní", "Niquero", "Pilón", "Yara"],
  "Santiago de Cuba": ["Santiago de Cuba", "Contramaestre", "Guamá", "Mella", "Palma Soriano", "San Luis", "Siboney", "Tercer Frente", "Segundo Frente", "Baconao"],
  "Guantánamo": ["Guantánamo", "Baracoa", "Caimanera", "El Salvador", "Maisí", "Manuel Tames", "Niceto Pérez", "San Antonio del Sur", "Yateras"],
  "Isla de la Juventud": ["Nueva Gerona", "Santa Fe"],
}

const POLITICAL_AFFILIATIONS = [
  { id: "pcc", name: "PCC" },
  { id: "ujc", name: "UJC" },
  { id: "none", name: "Ninguna" },
]

const RETIRED_REHIRED_OPTIONS = [
  { id: "yes", name: "Sí" },
  { id: "no", name: "No" },
]

// Orden visual exacto exigido para el catálogo de Nivel educacional.
const EDUCATION_LEVEL_ORDER = [
  "Primaria",
  "Secundaria",
  "Obrero Calificado",
  "Media",
  "Técnico Medio",
  "Superior",
]

// Niveles que requieren Especialidad.
const SPECIALTY_EDUCATION_LEVELS = ["Obrero Calificado", "Técnico Medio", "Superior"]

// Convert dd/mm/aaaa display format to ISO yyyy-mm-dd for storage
const convertDisplayDateToISO = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  if (match) {
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    }
    return null
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return null
}

const EntityCandidates = () => {
  const { currentEntity } = useCurrentEntity()
  const entityId = currentEntity?.id

  const [candidates, setCandidates] = React.useState<Candidate[]>([])
  const [genders, setGenders] = React.useState<Gender[]>([])
  const [maritalStatuses, setMaritalStatuses] = React.useState<MaritalStatus[]>([])
  const [educationLevels, setEducationLevels] = React.useState<EducationLevel[]>([])
  const [skinColors, setSkinColors] = React.useState<CatalogOption[]>([])
  const [licenseCategories, setLicenseCategories] = React.useState<CatalogOption[]>([])
  const [provinces, setProvinces] = React.useState<Province[]>([])
  const [municipalities, setMunicipalities] = React.useState<Municipality[]>([])

  const [searchTerm, setSearchTerm] = React.useState("")
  const [candidatesWithLicense, setCandidatesWithLicense] = React.useState<Set<string>>(new Set())

  const [page, setPage] = React.useState(1)
  const [rowsPerPage, setRowsPerPage] = React.useState(10)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Form state
  const [formOpen, setFormOpen] = React.useState(false)
  const [formData, setFormData] = React.useState<CandidateFormData>(emptyFormData)
  const [formSubmitting, setFormSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [formSuccess, setFormSuccess] = React.useState(false)

  // Disciplinary measures dialog
    const [disciplinaryDialogOpen, setDisciplinaryDialogOpen] = React.useState(false)
    const [disciplinaryDocument, setDisciplinaryDocument] = React.useState<File | null>(null)
    const [disciplinaryUploading, setDisciplinaryUploading] = React.useState(false)
        const [disciplinaryDocumentName, setDisciplinaryDocumentName] = React.useState<string | null>(null)

  // Fetch reference data
  React.useEffect(() => {
    const fetchReferenceData = async () => {
      try {
        const [personCatalogs, gendersData, maritalStatusesData, educationLevelsData] = await Promise.all([
          // Catálogos globales de la persona (color de piel y licencias de conducción)
          fetchPersonCatalogs(),
          supabase.from("genders").select("id, name").order("name"),
          supabase.from("marital_statuses").select("id, name").order("name"),
          supabase.from("education_levels").select("id, name").order("name")
        ])

        if (gendersData.error) throw gendersData.error
        if (maritalStatusesData.error) throw maritalStatusesData.error
        if (educationLevelsData.error) throw educationLevelsData.error

        setGenders(gendersData.data || [])
        setMaritalStatuses(maritalStatusesData.data || [])
        setEducationLevels(educationLevelsData.data || [])
        setSkinColors(personCatalogs.skinColors)
        setLicenseCategories(personCatalogs.licenseCategories)

        // Set provinces from Cuba list
        setProvinces(CUBA_PROVINCES.map(name => ({ id: name, name })))
      } catch (err) {
        console.error("Error fetching reference data:", err)
        setError("Error al cargar datos de referencia")
      }
    }

    if (entityId) {
      fetchReferenceData()
    }
  }, [entityId])

  // Fetch candidates
  React.useEffect(() => {
    const fetchCandidates = async () => {
      if (!entityId) {
        setCandidates([])
        setCandidatesWithLicense(new Set())
        return
      }

      setLoading(true)
      setError(null)

      try {
        // Se cargan los candidatos de la entidad y se filtran en el cliente con el
        // constructor de filtros común (filtros acumulativos). La búsqueda textual
        // también se resuelve aquí para que filtros + búsqueda sean consistentes.
        const { data, error } = await supabase
          .from("candidates")
          .select("*")
          .eq("organization_entity_id", entityId)
          .order("created_at", { ascending: false })

        if (error) throw error
        const rows = (data as Candidate[]) || []
        setCandidates(rows)

        // Licencia de conducción (criterio booleano): qué candidatos tienen al
        // menos una categoría de licencia registrada.
        const ids = rows.map((c) => c.id)
        if (ids.length > 0) {
          const { data: licenses } = await supabase
            .from("candidate_driving_license_categories")
            .select("candidate_id")
            .in("candidate_id", ids)
          const set = new Set<string>()
          ;((licenses as { candidate_id: string }[] | null) || []).forEach((l) => set.add(l.candidate_id))
          setCandidatesWithLicense(set)
        } else {
          setCandidatesWithLicense(new Set())
        }
      } catch (err) {
        console.error("Error fetching candidates:", err)
        setError("Error al cargar los candidatos")
        setCandidates([])
        setCandidatesWithLicense(new Set())
      } finally {
        setLoading(false)
      }
    }

    if (entityId) {
      fetchCandidates()
    }
  }, [entityId])

  // ---------- Filtros (constructor común, criterios reales de Candidato) ----------
  const filterDefinitions = React.useMemo<EntityFilterDefinition[]>(
    () => [
      {
        key: "gender",
        label: "Sexo",
        type: "select",
        options: genders.map((g) => ({ value: g.id, label: g.name })),
        getValue: (c: Candidate) => c.gender_id,
      },
      {
        key: "marital",
        label: "Estado civil",
        type: "select",
        options: maritalStatuses.map((m) => ({ value: m.id, label: m.name })),
        getValue: (c: Candidate) => c.marital_status_id,
      },
      {
        key: "skin",
        label: "Color de piel",
        type: "select",
        options: skinColors.map((s) => ({ value: s.id, label: s.name })),
        getValue: (c: Candidate) => c.skin_color_id,
      },
      {
        key: "education",
        label: "Nivel educacional",
        type: "select",
        options: educationLevels.map((e) => ({ value: e.id, label: e.name })),
        getValue: (c: Candidate) => c.education_level_id,
      },
      { key: "specialty", label: "Especialidad", type: "text", placeholder: "Especialidad", getValue: (c: Candidate) => c.specialty },
      { key: "profession", label: "Profesión u oficio", type: "text", placeholder: "Profesión u oficio", getValue: (c: Candidate) => c.profession_or_trade },
      { key: "province", label: "Provincia", type: "text", placeholder: "Provincia", getValue: (c: Candidate) => c.province },
      { key: "municipality", label: "Municipio", type: "text", placeholder: "Municipio", getValue: (c: Candidate) => c.municipality },
      { key: "license", label: "Licencia de conducción", type: "boolean", getValue: (c: Candidate) => candidatesWithLicense.has(c.id) },
      { key: "masters", label: "Máster", type: "boolean", getValue: (c: Candidate) => c.has_masters_degree },
      { key: "doctorate", label: "Doctorado", type: "boolean", getValue: (c: Candidate) => c.has_doctorate_degree },
      {
        key: "status",
        label: "Estado",
        type: "select",
        options: [
          { value: "active", label: "Activo" },
          { value: "archived", label: "Archivado" },
        ],
        getValue: (c: Candidate) => c.status,
      },
    ],
    [genders, maritalStatuses, educationLevels, skinColors, candidatesWithLicense]
  )

  const filters = useEntityFilters(candidates, filterDefinitions)

  const searchedCandidates = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return filters.result
    return filters.result.filter((c) =>
      [c.first_name, c.first_surname, c.second_surname, c.identification]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    )
  }, [filters.result, searchTerm])

  React.useEffect(() => {
    setPage(1)
  }, [searchTerm, filters.active])

  const totalPages = Math.ceil(searchedCandidates.length / rowsPerPage)

  const pagedCandidates = React.useMemo(() => {
    const from = (page - 1) * rowsPerPage
    return searchedCandidates.slice(from, from + rowsPerPage)
  }, [searchedCandidates, page, rowsPerPage])

  // Form handlers
      const handleFormChange = (field: keyof CandidateFormData, value: string | boolean | File | null) => {
            setFormData(prev => ({ ...prev, [field]: value }))
          }
  
      // Al cambiar el Nivel educacional: si el nuevo nivel no requiere especialidad,
      // se limpia el valor para que se guarde como NULL.
      const handleEducationLevelChange = (value: string) => {
        const levelId = value === "__placeholder__" ? "" : value
        const level = educationLevels.find(l => l.id === levelId)
        const needsSpecialty = SPECIALTY_EDUCATION_LEVELS.includes(level?.name || "")
        setFormData(prev => ({
          ...prev,
          education_level_id: levelId,
          specialty: needsSpecialty ? prev.specialty : "",
        }))
      }
  
      const requiresSpecialty = SPECIALTY_EDUCATION_LEVELS.includes(
        educationLevels.find(l => l.id === formData.education_level_id)?.name || ""
      )
  
      // Navigation
      const navigate = useNavigate()

  // DNI autocomplete for birth date (Cuban DNI format: first 6 digits = aammdd)
  const handleIdentificationChange = (value: string) => {
    // Se conserva el valor tal cual: la validación exige exactamente 11 dígitos.
    setFormData(prev => ({ ...prev, identification: value }))

    // Auto-fill birth date from first 6 digits (aammdd) and display as dd/mm/yyyy
    const cleaned = value.replace(/\D/g, "")
    if (cleaned.length >= 6) {
      const yearStr = cleaned.substring(0, 2)
      const monthStr = cleaned.substring(2, 4)
      const dayStr = cleaned.substring(4, 6)
  
        const year = parseInt(yearStr, 10)
        const month = parseInt(monthStr, 10)
        const day = parseInt(dayStr, 10)
  
        if (year >= 0 && year <= 99 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const fullYear = year >= 50 ? 1900 + year : 2000 + year
          const formatted = `${dayStr}/${monthStr}/${fullYear}`
          setFormData(prev => ({ ...prev, birth_date: formatted }))
        }
      }
    }

  // Province change - reset municipality
  const handleProvinceChange = (province: string) => {
    setFormData(prev => ({ ...prev, province, municipality: "" }))
    setMunicipalities([])

    if (province && MUNICIPIOS_BY_PROVINCE[province]) {
      setMunicipalities(MUNICIPIOS_BY_PROVINCE[province].map(name => ({ id: name, name })))
    }
  }

  // Disciplinary measures: el archivo se conserva en memoria y se sube DESPUÉS de
    // crear el candidato, bajo la ruta `candidates/{candidateId}/…`. Así el objeto de
    // Storage queda inequívocamente ligado a la entidad del candidato y la política de
    // Storage puede autorizarlo por permiso (candidates.view / candidates.manage).
    const handleDisciplinaryUpload = async () => {
      if (!disciplinaryDocument) return
  
      setDisciplinaryUploading(true)
      try {
        setDisciplinaryDocumentName(disciplinaryDocument.name)
        setDisciplinaryDialogOpen(false)
        setFormSuccess(true)
        setTimeout(() => setFormSuccess(false), 3000)
      } finally {
              setDisciplinaryUploading(false)
            }
          }
      
        // Sube un documento de verificación del candidato (Chequeo Preempleo / Antecedentes
        // Penales) al Storage privado y lo registra en candidate_documents. Se invoca DESPUÉS
        // de crear el candidato, cuando ya existe candidate_id (nunca un documento huérfano).
        const uploadCandidateVerificationDocument = async (
          candidateId: string,
          documentTypeId: string,
          file: File,
          description: string
        ) => {
          const fileExt = file.name.split(".").pop() || "pdf"
          const storagePath = `candidates/${candidateId}/${documentTypeId}_${Date.now()}.${fileExt}`
      
          const { error: uploadError } = await supabase.storage
            .from("documents")
            .upload(storagePath, file)
          if (uploadError) throw uploadError
      
          const { error: docError } = await supabase
            .from("candidate_documents")
            .insert({
              candidate_id: candidateId,
              document_type_id: documentTypeId,
              original_file_name: file.name,
              storage_path: storagePath,
              mime_type: file.type,
              file_size: file.size,
              description,
              uploaded_by: (await supabase.auth.getUser()).data.user?.id,
            })
          if (docError) throw docError
        }
      
        const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (!formData.first_name.trim()) {
      setFormError("El nombre es obligatorio")
      return
    }
    if (!formData.first_surname.trim()) {
      setFormError("El primer apellido es obligatorio")
      return
    }
    if (!formData.identification.trim()) {
      setFormError("La identificación es obligatoria")
      return
    }
    if (!isValidIdentification(formData.identification)) {
      setFormError(IDENTIFICATION_ERROR_MESSAGE)
      return
    }
    // Integridad contractual: datos personales indispensables para formalizar
    // correctamente un contrato laboral.
    if (!formData.birth_date.trim()) {
      setFormError("La fecha de nacimiento es obligatoria")
      return
    }
    if (!formData.profession_or_trade.trim()) {
      setFormError("La profesión u oficio es obligatoria")
      return
    }
    if (!formData.address.trim()) {
      setFormError("La dirección particular es obligatoria")
      return
    }
    if (!formData.province.trim()) {
      setFormError("La provincia es obligatoria")
      return
    }
    if (!formData.municipality.trim()) {
      setFormError("El municipio es obligatorio")
      return
    }

    // Validar especialidad para niveles que la requieren
        if (formData.education_level_id) {
          const educationLevel = educationLevels.find(level => level.id === formData.education_level_id)
          const requiresSpecialty = ["Obrero Calificado", "Técnico Medio", "Superior"].includes(educationLevel?.name || "")
          if (requiresSpecialty && !formData.specialty.trim()) {
                      setFormError(`La especialidad es obligatoria para ${educationLevel?.name}`)
                      return
                    }
                  }
          
              // Chequeo Preempleo / Antecedentes Penales: el documento es obligatorio mientras
              // el checkbox esté activado para un nuevo registro.
              if (formData.has_pre_employment_check && !formData.pre_employment_check_file) {
                setFormError("Debe seleccionar el documento de Chequeo Preempleo")
                return
              }
              if (formData.has_criminal_record_check && !formData.criminal_record_check_file) {
                setFormError("Debe seleccionar el documento de Antecedentes Penales")
                return
              }
          
              // Validar formato de email si se proporciona
    if (formData.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(formData.email.trim())) {
        setFormError("El formato del email no es válido")
        return
      }
    }

    // Validar y convertir fecha de nacimiento si se proporciona
    let birthDateISO: string | null = null
    if (formData.birth_date.trim()) {
      birthDateISO = convertDisplayDateToISO(formData.birth_date)
      if (!birthDateISO) {
        setFormError("El formato de la fecha de nacimiento no es válido (dd/mm/aaaa)")
        return
      }
    }

    setFormSubmitting(true)
    setFormError(null)

    try {
      // UNICIDAD DE PERSONAS (§27–§33): una misma persona (por Número de
      // Identificación) no puede duplicarse entre Candidatos, Trabajadores y
      // Reingresos del mismo workspace. La comprobación se resuelve en el backend
      // (misma autoridad que RLS) y también está protegida por constraints/triggers.
      const identificationToCheck = formData.identification.trim()
      const { data: personStatus, error: checkError } = await supabase.rpc(
        "person_identification_status",
        { p_entity_id: entityId, p_identification: identificationToCheck }
      )
      if (checkError) throw checkError

      const existingPerson = (personStatus || {}) as { worker_id?: string | null; worker_status?: string | null; candidate_count?: number | null }
      if (existingPerson.worker_id) {
        setFormError(
          existingPerson.worker_status === "active"
            ? "Esta persona ya está registrada como trabajador. Solo puede actualizar su información."
            : "Esta persona ya existe y actualmente se encuentra en Reingresos. Debe utilizar el expediente existente."
        )
        setFormSubmitting(false)
        return
      }
      if ((existingPerson.candidate_count ?? 0) > 0) {
        setFormError(
          "Ya existe una persona con este número de identificación. Solo puede actualizar su información."
        )
        setFormSubmitting(false)
        return
      }

      const newCandidate = {
              [columnName("clientId")]: currentEntity?.tenant_id,
              organization_entity_id: entityId,
              first_name: formData.first_name.trim(),
              first_surname: formData.first_surname.trim(),
              second_surname: formData.second_surname.trim() || null,
              identification: formData.identification.trim(),
              birth_date: birthDateISO,
              gender_id: formData.gender_id || null,
              marital_status_id: formData.marital_status_id || null,
              phone: formData.phone.trim() || null,
              email: formData.email.trim() || null,
              address: formData.address.trim() || null,
              municipality: formData.municipality.trim() || null,
              province: formData.province.trim() || null,
              education_level_id: formData.education_level_id || null,
                            specialty: requiresSpecialty ? (formData.specialty.trim() || null) : null,
                            has_masters_degree: formData.has_masters_degree,
                            has_doctorate_degree: formData.has_doctorate_degree,
                            profession_or_trade: formData.profession_or_trade.trim() || null,
              skin_color_id: formData.skin_color_id || null,
              political_affiliation: formData.political_affiliation || null,
              is_retired_or_rehired: formData.is_retired_or_rehired === "yes",
              has_disciplinary_measures: formData.has_disciplinary_measures,
              status: "active" as const,
            }

      const { data: candidateData, error: insertError } = await supabase
              .from("candidates")
              .insert(newCandidate)
              .select("id")
              .single()
      
            if (insertError) throw insertError
      
            // Licencias de conducción de la persona (relación 0..N) — reemplazo atómico
            if (candidateData?.id) {
              await saveCandidateDrivingLicenseIds(candidateData.id, formData.driving_license_ids)
            }
      
            // If there's a disciplinary document selected, upload it under the
                        // candidate's own folder and register it in candidate_documents
                        if (disciplinaryDocument && candidateData?.id) {
                          try {
                            const fileExt = disciplinaryDocument.name.split(".").pop() || "pdf"
                            const storagePath = `candidates/${candidateData.id}/disciplinary_${Date.now()}.${fileExt}`
            
                            const { error: uploadError } = await supabase.storage
                              .from("documents")
                              .upload(storagePath, disciplinaryDocument)
            
                            if (uploadError) throw uploadError
            
                            const { error: docError } = await supabase
                              .from("candidate_documents")
                              .insert({
                                candidate_id: candidateData.id,
                                document_type_id: "DISCIPLINARY_DOCUMENT",
                                original_file_name: disciplinaryDocument.name,
                                storage_path: storagePath,
                                mime_type: disciplinaryDocument.type,
                                file_size: disciplinaryDocument.size,
                                description: "Documento disciplinario subido durante la creación del candidato",
                                uploaded_by: (await supabase.auth.getUser()).data.user?.id,
                              })
            
                            if (docError) throw docError
                          } catch (docError) {
                                                      console.error("Error saving disciplinary document reference:", docError)
                                                      // Don't throw, the candidate was created successfully
                                                    }
                                                  }
                                
                                      // Chequeo Preempleo / Antecedentes Penales: se suben tras crear el candidato,
                                      // cuando candidate_id ya existe, y se registran en candidate_documents.
                                      if (candidateData?.id) {
                                        if (formData.has_pre_employment_check && formData.pre_employment_check_file) {
                                          try {
                                            await uploadCandidateVerificationDocument(
                                              candidateData.id,
                                              "PRE_EMPLOYMENT_CHECK",
                                              formData.pre_employment_check_file,
                                              "Chequeo Preempleo"
                                            )
                                          } catch (verificationError) {
                                            console.error("Error saving pre-employment check document:", verificationError)
                                          }
                                        }
                                        if (formData.has_criminal_record_check && formData.criminal_record_check_file) {
                                          try {
                                            await uploadCandidateVerificationDocument(
                                              candidateData.id,
                                              "CRIMINAL_RECORD",
                                              formData.criminal_record_check_file,
                                              "Antecedentes Penales"
                                            )
                                          } catch (verificationError) {
                                            console.error("Error saving criminal record document:", verificationError)
                                          }
                                        }
                                      }
                                
                                      // Reset form and close
            setFormData(emptyFormData)
            setDisciplinaryDocument(null)
                        setDisciplinaryDocumentName(null)
            setFormSuccess(true)
            setFormOpen(false)
      
            // Refresh candidates list
            setTimeout(() => setFormSuccess(false), 3000)
    } catch (err) {
      console.error("Error creating candidate:", err)
      setFormError("Error al guardar el candidato. Inténtalo de nuevo.")
    } finally {
      setFormSubmitting(false)
    }
  }

  const handleFormCancel = () => {
    setFormData(emptyFormData)
    setFormError(null)
    setFormOpen(false)
  }

  if (!entityId) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Candidatos"
          description="Gestión de candidatos y procesos de selección"
        />
        <SiteCorpAlert type="info">
          Seleccione una entidad para ver sus candidatos
        </SiteCorpAlert>
      </div>
    )
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
  }

  const handleRowsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setRowsPerPage(parseInt(e.target.value))
    setPage(1)
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Candidatos"
          description="Gestión de candidatos y procesos de selección"
        />
        <SiteCorpLoading rows={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Candidatos"
          description="Gestión de candidatos y procesos de selección"
        />
        <SiteCorpAlert type="danger">{error}</SiteCorpAlert>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <SiteCorpPageHeader
          title="Candidatos"
          description={`Listado de candidatos para ${currentEntity?.name}`}
        />
        <SiteCorpButton onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo candidato
        </SiteCorpButton>
      </div>

      {/* Success alert */}
      {formSuccess && (
        <SiteCorpAlert type="success">
          Candidato creado exitosamente
        </SiteCorpAlert>
      )}

      {/* Búsqueda + filtros acumulativos */}
      <SiteCorpCard>
        <div className="space-y-4">
          <div className="max-w-md">
            <SiteCorpInput
              type="text"
              placeholder="Buscar por nombre, apellidos o identificación"
              value={searchTerm}
              onChange={handleSearchChange}
            />
          </div>
          <FilterBuilder
            definitions={filters.definitions}
            active={filters.active}
            available={filters.available}
            onAdd={filters.add}
            onRemove={filters.remove}
            onSetValues={filters.setValues}
            onClear={filters.clear}
            resultCount={searchedCandidates.length}
            totalCount={candidates.length}
          />
        </div>
      </SiteCorpCard>

      {/* Candidates Table */}
      {pagedCandidates.length === 0 ? (
        <SiteCorpCard>
          <SiteCorpAlert type="info">
            No se encontraron candidatos con los criterios especificados
          </SiteCorpAlert>
        </SiteCorpCard>
      ) : (
        <>
          <SiteCorpCard>
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Nombre</TableHead>
                    <TableHead className="w-20">Primer apellido</TableHead>
                    <TableHead className="w-20">Segundo apellido</TableHead>
                    <TableHead className="w-20">Identificación</TableHead>
                    <TableHead className="w-16">Sexo</TableHead>
                    <TableHead className="w-20">Nivel educacional</TableHead>
                    <TableHead className="w-20">Especialidad</TableHead>
                    <TableHead className="w-16">Teléfono</TableHead>
                    <TableHead className="w-16">Estado</TableHead>
                    <TableHead className="w-20">Fecha registro</TableHead>
                    <TableHead className="w-16">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedCandidates.map((candidate) => (
                    <TableRow key={candidate.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sitecorp-primary/10">
                            <Users className="h-4 w-4 text-sitecorp-primary" />
                          </div>
                          <div>
                            <button
                              className="text-left hover:underline"
                              onClick={() => navigate(`/entity/${entityId}/candidates/${candidate.id}`)}
                            >
                              <p className="text-sm font-medium text-ink cursor-pointer">
                                {candidate.first_name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {candidate.first_surname} {candidate.second_surname || ""}
                              </p>
                            </button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{candidate.first_surname}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{candidate.second_surname || "-"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium text-ink">{candidate.identification}</p>
                      </TableCell>
                      <TableCell>
                        {candidate.gender_id ? (
                          <p className="text-sm text-muted-foreground">
                            {genders.find(g => g.id === candidate.gender_id)?.name || "Desconocido"}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">-</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {candidate.education_level_id ? (
                          <p className="text-sm text-muted-foreground">
                            {educationLevels.find(e => e.id === candidate.education_level_id)?.name || "Desconocido"}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">-</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{candidate.specialty || "-"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{candidate.phone || "-"}</p>
                      </TableCell>
                      <TableCell>
                        <SiteCorpStatusBadge
                          status={candidate.status === "active" ? "success" : "neutral"}
                        >
                          {candidate.status === "active" ? "Activo" : "Archivado"}
                        </SiteCorpStatusBadge>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">
                          {new Date(candidate.created_at).toLocaleDateString("es-ES")}
                        </p>
                      </TableCell>
                      <TableCell className="flex items-center gap-2">
                        <SiteCorpButton
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/entity/${entityId}/candidates/${candidate.id}`)}
                        >
                          <Eye className="mr-1 h-3 w-3" /> Ver
                        </SiteCorpButton>
                        <SiteCorpButton
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/entity/${entityId}/candidates/${candidate.id}/edit`)}
                        >
                          <Edit3 className="mr-1 h-3 w-3" />
                        </SiteCorpButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SiteCorpCard>

          {/* Pagination */}
          <div className="flex justify-center mt-6">
            <Pagination>
              <PaginationContent>
                {totalPages > 0 && (
                  <>
                    <PaginationPrevious
                      onClick={() => handlePageChange(Math.max(1, page - 1))}
                    />
                    {page > 3 && (
                      <>
                        <PaginationItem>
                          <PaginationLink
                            isActive={false}
                            onClick={() => handlePageChange(1)}
                          >
                            1
                          </PaginationLink>
                        </PaginationItem>
                        <PaginationEllipsis />
                      </>
                    )}
                    {page > 2 && (
                      <PaginationItem>
                        <PaginationLink
                          isActive={false}
                          onClick={() => handlePageChange(page - 1)}
                        >
                          {page - 1}
                        </PaginationLink>
                      </PaginationItem>
                    )}
                    <PaginationItem>
                      <PaginationLink
                        isActive={true}
                        onClick={() => handlePageChange(page)}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                    {page < totalPages - 1 && (
                      <PaginationItem>
                        <PaginationLink
                          isActive={false}
                          onClick={() => handlePageChange(page + 1)}
                        >
                          {page + 1}
                        </PaginationLink>
                      </PaginationItem>
                    )}
                    {page < totalPages - 2 && (
                      <>
                        <PaginationEllipsis />
                        <PaginationItem>
                          <PaginationLink
                            isActive={false}
                            onClick={() => handlePageChange(totalPages)}
                          >
                            {totalPages}
                          </PaginationLink>
                        </PaginationItem>
                      </>
                    )}
                    <PaginationNext
                      onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                    />
                  </>
                )}
              </PaginationContent>
            </Pagination>
          </div>

          {/* Info bar */}
          <div className="flex justify-between items-center mt-4 text-sm text-muted-foreground">
            <p>
              Mostrando {pagedCandidates.length} de {searchedCandidates.length} candidatos
            </p>
            <div className="flex items-center gap-4">
              <label>
                Filas por página:
                <select
                  value={rowsPerPage}
                  onChange={handleRowsPerPageChange}
                  className="ml-2 SiteCorpInput"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
          </div>
        </>
      )}

      {/* New Candidate Dialog */}
      <Dialog open={formOpen} onOpenChange={(open) => {
        if (!open) handleFormCancel()
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo candidato</DialogTitle>
            <DialogDescription>
              Complete los datos del candidato. Los campos marcados con * son obligatorios.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleFormSubmit} className="space-y-6">
            {/* Section 1: Identificación */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-ink border-b pb-2">Identificación</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nombre *</Label>
                  <SiteCorpInput
                    type="text"
                    placeholder="Nombre"
                    value={formData.first_name}
                    onChange={(e) => handleFormChange("first_name", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Primer apellido *</Label>
                  <SiteCorpInput
                    type="text"
                    placeholder="Primer apellido"
                    value={formData.first_surname}
                    onChange={(e) => handleFormChange("first_surname", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Segundo apellido</Label>
                  <SiteCorpInput
                    type="text"
                    placeholder="Segundo apellido"
                    value={formData.second_surname}
                    onChange={(e) => handleFormChange("second_surname", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                                  <Label>Identificación *</Label>
                                  <SiteCorpInput
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="11 dígitos"
                                    value={formData.identification}
                                    onChange={(e) => handleIdentificationChange(e.target.value)}
                                    required
                                  />
                                </div>
                <div className="space-y-1.5">
                                  <Label>Fecha de nacimiento (dd/mm/aaaa) *</Label>
                                  <SiteCorpInput
                                    type="text"
                                    placeholder="dd/mm/aaaa"
                                    value={formData.birth_date}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, "").substring(0, 8)
                                      let formatted = val
                                      if (val.length > 4) formatted = `${val.substring(0, 2)}/${val.substring(2, 4)}/${val.substring(4, 8)}`
                                      else if (val.length > 2) formatted = `${val.substring(0, 2)}/${val.substring(2)}`
                                      handleFormChange("birth_date", formatted)
                                    }}
                                    required
                                  />
                                </div>
                <div className="space-y-1.5">
                                  <Label>Sexo</Label>
                                  <SiteCorpSelect
                                    value={formData.gender_id || undefined}
                                    onValueChange={(value) => handleFormChange("gender_id", value === "__placeholder__" ? "" : value)}
                                  >
                                    <SelectItem value="__placeholder__">Seleccionar...</SelectItem>
                                    {genders.map(gender => (
                                      <SelectItem key={gender.id} value={gender.id}>
                                        {gender.name}
                                      </SelectItem>
                                    ))}
                                  </SiteCorpSelect>
                                </div>
              </div>
            </div>

            {/* Section 2: Datos personales */}
                        <div className="space-y-4">
                          <h3 className="text-sm font-semibold text-ink border-b pb-2">Datos personales</h3>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label>Estado civil</Label>
                              <SiteCorpSelect
                                value={formData.marital_status_id || undefined}
                                onValueChange={(value) => handleFormChange("marital_status_id", value === "__placeholder__" ? "" : value)}
                              >
                                <SelectItem value="__placeholder__">Seleccionar...</SelectItem>
                                {maritalStatuses.map(status => (
                                  <SelectItem key={status.id} value={status.id}>
                                    {status.name}
                                  </SelectItem>
                                ))}
                              </SiteCorpSelect>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Afiliación política</Label>
                              <SiteCorpSelect
                                value={formData.political_affiliation || undefined}
                                onValueChange={(value) => handleFormChange("political_affiliation", value === "__placeholder__" ? "" : value)}
                              >
                                <SelectItem value="__placeholder__">Seleccionar...</SelectItem>
                                {POLITICAL_AFFILIATIONS.map(aff => (
                                  <SelectItem key={aff.id} value={aff.id}>
                                    {aff.name}
                                  </SelectItem>
                                ))}
                              </SiteCorpSelect>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Retirado o Recontratado</Label>
                              <SiteCorpSelect
                                value={formData.is_retired_or_rehired || undefined}
                                onValueChange={(value) => handleFormChange("is_retired_or_rehired", value === "__placeholder__" ? "" : value)}
                              >
                                <SelectItem value="__placeholder__">Seleccionar...</SelectItem>
                                {RETIRED_REHIRED_OPTIONS.map(opt => (
                                  <SelectItem key={opt.id} value={opt.id}>
                                    {opt.name}
                                  </SelectItem>
                                ))}
                              </SiteCorpSelect>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Color de piel</Label>
                              <SiteCorpSelect
                                value={formData.skin_color_id || undefined}
                                onValueChange={(value) => handleFormChange("skin_color_id", value === "__placeholder__" ? "" : value)}
                              >
                                <SelectItem value="__placeholder__">Seleccionar...</SelectItem>
                                {skinColors.map(color => (
                                  <SelectItem key={color.id} value={color.id}>
                                    {color.name}
                                  </SelectItem>
                                ))}
                              </SiteCorpSelect>
                            </div>
                          </div>
                        </div>

            {/* Formación y profesión (propias de la persona) */}
                                    <div className="space-y-4">
                                      <h3 className="text-sm font-semibold text-ink border-b pb-2">Formación y profesión</h3>
                                      <div className="space-y-1.5">
                                        <Label>Nivel educacional</Label>
                                        <SiteCorpSelect
                                          value={formData.education_level_id || undefined}
                                          onValueChange={handleEducationLevelChange}
                                        >
                                          <SelectItem value="__placeholder__">Seleccionar...</SelectItem>
                                          {EDUCATION_LEVEL_ORDER
                                            .map(name => educationLevels.find(level => level.name === name))
                                            .filter((level): level is EducationLevel => Boolean(level))
                                            .map(level => (
                                              <SelectItem key={level.id} value={level.id}>
                                                {level.name}
                                              </SelectItem>
                                            ))}
                                        </SiteCorpSelect>
                                      </div>
                                      {requiresSpecialty && (
                                        <div className="space-y-1.5">
                                          <Label>Especialidad *</Label>
                                          <SiteCorpInput
                                            type="text"
                                            placeholder="Especialidad"
                                            value={formData.specialty}
                                            onChange={(e) => handleFormChange("specialty", e.target.value)}
                                            required
                                          />
                                        </div>
                                      )}

                                      {/* Formación académica adicional: indicadores independientes (no excluyentes) */}
                                      <div className="space-y-3 border-t pt-4">
                                        <div>
                                          <p className="text-sm font-medium text-ink">
                                            Formación académica adicional
                                          </p>
                                          <p className="text-xs text-muted-foreground">
                                            Marque los estudios de postgrado obtenidos. Puede marcar ambos.
                                          </p>
                                        </div>
                                        <AcademicDegreeCheckboxes
                                          hasMastersDegree={formData.has_masters_degree}
                                          hasDoctorateDegree={formData.has_doctorate_degree}
                                          onMastersChange={(checked) =>
                                            handleFormChange("has_masters_degree", checked)
                                          }
                                          onDoctorateChange={(checked) =>
                                            handleFormChange("has_doctorate_degree", checked)
                                          }
                                          disabled={formSubmitting}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <Label>Profesión u oficio *</Label>
                                        <SiteCorpInput
                                          type="text"
                                          placeholder="Ej.: Chofer profesional, Albañil, Técnico en redes"
                                          value={formData.profession_or_trade}
                                          onChange={(e) => handleFormChange("profession_or_trade", e.target.value)}
                                          required
                                        />
                                        <p className="text-xs text-muted-foreground">
                                          Dato indispensable para el contrato. Es propio de la persona.
                                        </p>
                                      </div>
                                      <DrivingLicenseSelector
                                        categories={licenseCategories}
                                        value={formData.driving_license_ids}
                                        onChange={(licenseIds) => setFormData(prev => ({ ...prev, driving_license_ids: licenseIds }))}
                                        hint="Puede seleccionar varias categorías o ninguna."
                                      />
                                    </div>

            {/* Section 3: Contacto y dirección */}
                        <div className="space-y-4">
                          <h3 className="text-sm font-semibold text-ink border-b pb-2">Contacto y dirección</h3>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label>Teléfono</Label>
                              <SiteCorpInput
                                type="tel"
                                placeholder="+51 999 999 999"
                                value={formData.phone}
                                onChange={(e) => handleFormChange("phone", e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Email</Label>
                              <SiteCorpInput
                                type="email"
                                placeholder="correo@ejemplo.com"
                                value={formData.email}
                                onChange={(e) => handleFormChange("email", e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                              <Label>Dirección particular *</Label>
                              <Textarea
                                placeholder="Dirección completa"
                                value={formData.address}
                                onChange={(e) => handleFormChange("address", e.target.value)}
                                rows={2}
                                required
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Provincia *</Label>
                              <SiteCorpSelect
                                value={formData.province || undefined}
                                onValueChange={(value) => handleProvinceChange(value === "__placeholder__" ? "" : value)}
                              >
                                <SelectItem value="__placeholder__">Seleccionar...</SelectItem>
                                {provinces.map(province => (
                                  <SelectItem key={province.id} value={province.id}>
                                    {province.name}
                                  </SelectItem>
                                ))}
                              </SiteCorpSelect>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Municipio *</Label>
                              <SiteCorpSelect
                                value={formData.municipality || undefined}
                                onValueChange={(value) => handleFormChange("municipality", value === "__placeholder__" ? "" : value)}
                                disabled={!formData.province}
                              >
                                <SelectItem value="__placeholder__">Seleccionar...</SelectItem>
                                {municipalities.map(muni => (
                                  <SelectItem key={muni.id} value={muni.id}>
                                    {muni.name}
                                  </SelectItem>
                                ))}
                              </SiteCorpSelect>
                            </div>
                          </div>
                        </div>

            {/* Section 5: Verificaciones y medidas disciplinarias */}
                                    <div className="space-y-4">
                                      <h3 className="text-sm font-semibold text-ink border-b pb-2">Verificaciones y medidas disciplinarias</h3>
            
                                      {/* Chequeo Preempleo */}
                                      <div className="space-y-2">
                                        <label className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={formData.has_pre_employment_check}
                                            onChange={(e) => handleFormChange("has_pre_employment_check", e.target.checked)}
                                            className="rounded border-gray-300"
                                          />
                                          <span className="text-sm font-medium text-ink">Chequeo Preempleo</span>
                                        </label>
                                        {formData.has_pre_employment_check && (
                                          <div className="space-y-2 pl-6">
                                            <Label>Documento de Chequeo Preempleo *</Label>
                                            <input
                                              type="file"
                                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                              onChange={(e) => handleFormChange("pre_employment_check_file", e.target.files?.[0] || null)}
                                              className="block w-full text-sm text-muted-foreground"
                                            />
                                            {formData.pre_employment_check_file && (
                                              <p className="text-xs text-muted-foreground">{formData.pre_employment_check_file.name}</p>
                                            )}
                                          </div>
                                        )}
                                      </div>
            
                                      {/* Antecedentes Penales */}
                                      <div className="space-y-2">
                                        <label className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={formData.has_criminal_record_check}
                                            onChange={(e) => handleFormChange("has_criminal_record_check", e.target.checked)}
                                            className="rounded border-gray-300"
                                          />
                                          <span className="text-sm font-medium text-ink">Antecedentes Penales</span>
                                        </label>
                                        {formData.has_criminal_record_check && (
                                          <div className="space-y-2 pl-6">
                                            <Label>Documento de Antecedentes Penales *</Label>
                                            <input
                                              type="file"
                                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                              onChange={(e) => handleFormChange("criminal_record_check_file", e.target.files?.[0] || null)}
                                              className="block w-full text-sm text-muted-foreground"
                                            />
                                            {formData.criminal_record_check_file && (
                                              <p className="text-xs text-muted-foreground">{formData.criminal_record_check_file.name}</p>
                                            )}
                                          </div>
                                        )}
                                      </div>
            
                                      {/* Medida disciplinaria */}
                                      <div className="space-y-2 border-t pt-4">
                                        <label className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={formData.has_disciplinary_measures}
                                            onChange={(e) => handleFormChange("has_disciplinary_measures", e.target.checked)}
                                            className="rounded border-gray-300"
                                          />
                                          <span className="text-sm text-ink">Sí, tiene medidas disciplinarias</span>
                                        </label>
                                        {formData.has_disciplinary_measures && (
                                          <SiteCorpButton
                                            type="button"
                                            variant="outline"
                                            onClick={() => setDisciplinaryDialogOpen(true)}
                                            className="mt-2"
                                          >
                                            <Upload className="mr-2 h-4 w-4" />
                                            Subir documento disciplinario
                                          </SiteCorpButton>
                                        )}
                                      </div>
                                    </div>
            
                        {/* Form error */}
                        {formError && (
                          <SiteCorpAlert type="danger">{formError}</SiteCorpAlert>
                        )}

            {/* Disciplinary measures dialog */}
            <Dialog open={disciplinaryDialogOpen} onOpenChange={(open) => {
              if (!open) setDisciplinaryDialogOpen(false)
            }}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Subir documento disciplinario</DialogTitle>
                </DialogHeader>
                <DialogContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Seleccione el documento disciplinario (PDF, JPG, PNG)
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setDisciplinaryDocument(e.target.files[0])
                      }
                    }}
                    className="SiteCorpInput block w-full"
                  />
                  {disciplinaryDocument && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Archivo seleccionado: {disciplinaryDocument.name}
                    </p>
                  )}
                </DialogContent>
                <DialogFooter>
                  <SiteCorpButton
                    type="button"
                    variant="outline"
                    onClick={handleFormCancel}
                  >
                    Cancelar
                  </SiteCorpButton>
                  <SiteCorpButton
                    type="button"
                    onClick={handleDisciplinaryUpload}
                    disabled={disciplinaryUploading || !disciplinaryDocument}
                  >
                    {disciplinaryUploading ? "Subiendo..." : "Subir documento"}
                  </SiteCorpButton>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Form footer */}
            <DialogFooter className="gap-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={handleFormCancel}
                disabled={formSubmitting}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                type="submit"
                disabled={formSubmitting}
              >
                {formSubmitting ? "Guardando..." : "Guardar candidato"}
              </SiteCorpButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default EntityCandidates
