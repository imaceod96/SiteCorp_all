import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { invalidateContractAlertData } from "@/modules/contracts/presentation/hooks/use-contract-alerts"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { Label } from "@/components/ui/label"
import { toRomanNumeral } from "@/utils/roman-numerals"
import { ciToBirthDate, isValidIdentification, IDENTIFICATION_ERROR_MESSAGE } from "@/utils/ci"
import { CUBA_PROVINCES_FULL, MUNICIPIOS_BY_PROVINCE_FULL } from "@/data/cuba-locations-full"
import { RepresentativeSelect } from "@/modules/representatives/presentation/components/RepresentativeSelect"
import type { RepresentativePositionRow } from "@/modules/representatives"
import { PositionWorkInfoReadOnly } from "@/modules/organization-structure/presentation/components/PositionWorkInfoReadOnly"
import { ContractFormalizationAlerts } from "@/components/contracts/ContractFormalizationAlerts"
import {
  ContractRetributionFields,
  ContractSignatureFields,
} from "@/components/contracts/ContractConditionsFields"
import { ContractFormalizationSummary } from "@/components/contracts/ContractFormalizationSummary"
import {
  EMPTY_FORMALIZATION_PENDING,
  buildComponentsPayload,
  fetchPaymentMethods,
  formatConditionDate,
  hasInvalidComponent,
  type CompensationComponentDraft,
  type ContractFormalizationPending,
  type PaymentMethodOption,
} from "@/modules/contracts"
import type { PositionScheduleSegment } from "@/modules/organization-structure"
import { DrivingLicenseSelector } from "@/modules/people/presentation/components/DrivingLicenseSelector"
import { AcademicDegreeCheckboxes } from "@/modules/people/presentation/components/AcademicDegreeCheckboxes"
import {
  candidateRequiresSpecialty,
  checkWorkerIdentification,
  createWorkerExpediente,
  fetchPersonCatalogs,
  loadWorkerExpedienteLicenseIds,
  loadWorkerFormPermissions,
  loadWorkerReferenceCatalogs,
  saveWorkerExpedienteLicenseIds,
  saveWorkerExpedientePersonalData,
  validateWorkerPersonalData,
  validateWorkerRegistrationInput,
  type CatalogOption,
  type NewWorkerInput,
  type WorkerExpedienteInput,
} from "@/modules/people"

export interface WorkerPositionOption {
  id: string
  name: string
  code: string
  is_active: boolean
  occupied: boolean
  authorized_quantity: number
  currentAssignments: number
  // Fase 11A.3: información laboral del puesto (solo lectura)
  work_location?: string | null
  daily_hours?: number | null
  weekly_hours?: number | null
  monthly_hours?: number | null
  break_minutes?: number | null
  schedule_notes?: string | null
  schedule_segments?: PositionScheduleSegment[]
  job: {
    id: string
    name: string
    area: { id: string; name: string } | null
    salary_group: { id: string; salary_scale_id: string; sequence_number: number } | null
  } | null
}

export interface WorkerEditingData {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  birth_date: string | null
  gender_id: string | null
  marital_status_id: string | null
  education_level_id: string | null
  specialty: string | null
  // Formación académica adicional (indicadores independientes, no excluyentes)
  has_masters_degree: boolean
  has_doctorate_degree: boolean
  profession_or_trade: string | null
  skin_color_id: string | null
  address: string | null
  province: string | null
  municipality: string | null
  phone: string | null
  email: string | null
  hire_date: string
  employment_status: string
}

interface SalaryValue {
  amount: number
  currency_code: string
}

interface WorkerFormProps {
  entityId: string
  positions: WorkerPositionOption[]
  applicableScaleId: string | null
  salaryValuesByGroup: Record<string, SalaryValue | null>
  editingWorker?: WorkerEditingData | null
  onSuccess: () => void
  onCancel: () => void
}

type Catalog = CatalogOption

interface ContractType {
  id: string
  name: string
  code: string
}

interface WorkerFormState {
  first_name: string
  first_surname: string
  second_surname: string
  identification: string
  birth_date: string
  gender_id: string
  marital_status_id: string
  education_level_id: string
  specialty: string
  has_masters_degree: boolean
  has_doctorate_degree: boolean
  profession_or_trade: string
  skin_color_id: string
  address: string
  province: string
  municipality: string
  phone: string
  email: string
  hire_date: string
  has_pre_employment_check: boolean
  has_criminal_record_check: boolean
  pre_employment_check_file: File | null
  criminal_record_check_file: File | null
}

const emptyForm: WorkerFormState = {
  first_name: "",
  first_surname: "",
  second_surname: "",
  identification: "",
  birth_date: "",
  gender_id: "",
  marital_status_id: "",
  education_level_id: "",
  specialty: "",
  has_masters_degree: false,
  has_doctorate_degree: false,
  profession_or_trade: "",
  skin_color_id: "",
  address: "",
  province: "",
  municipality: "",
  phone: "",
  email: "",
  hire_date: "",
  has_pre_employment_check: false,
  has_criminal_record_check: false,
  pre_employment_check_file: null,
  criminal_record_check_file: null,
}

const formatSalary = (value: SalaryValue) =>
  `${value.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} ${value.currency_code}`

export const WorkerForm: React.FC<WorkerFormProps> = ({
  entityId,
  positions,
  applicableScaleId,
  salaryValuesByGroup,
  editingWorker,
  onSuccess,
  onCancel,
}) => {
  const isEditing = !!editingWorker

  const [form, setForm] = React.useState<WorkerFormState>(() =>
    editingWorker
      ? {
          first_name: editingWorker.first_name || "",
          first_surname: editingWorker.first_surname || "",
          second_surname: editingWorker.second_surname || "",
          identification: editingWorker.identification || "",
          birth_date: editingWorker.birth_date || "",
          gender_id: editingWorker.gender_id || "",
          marital_status_id: editingWorker.marital_status_id || "",
          education_level_id: editingWorker.education_level_id || "",
          specialty: editingWorker.specialty || "",
          has_masters_degree: editingWorker.has_masters_degree || false,
          has_doctorate_degree: editingWorker.has_doctorate_degree || false,
          profession_or_trade: editingWorker.profession_or_trade || "",
          skin_color_id: editingWorker.skin_color_id || "",
          address: editingWorker.address || "",
          province: editingWorker.province || "",
          municipality: editingWorker.municipality || "",
          phone: editingWorker.phone || "",
          email: editingWorker.email || "",
          hire_date: editingWorker.hire_date || "",
          has_pre_employment_check: false,
          has_criminal_record_check: false,
          pre_employment_check_file: null,
          criminal_record_check_file: null,
        }
      : {
          first_name: "",
          first_surname: "",
          second_surname: "",
          identification: "",
          birth_date: "",
          gender_id: "",
          marital_status_id: "",
          education_level_id: "",
          specialty: "",
          has_masters_degree: false,
          has_doctorate_degree: false,
          profession_or_trade: "",
          skin_color_id: "",
          address: "",
          province: "",
          municipality: "",
          phone: "",
          email: "",
          hire_date: "",
          has_pre_employment_check: false,
          has_criminal_record_check: false,
          pre_employment_check_file: null,
          criminal_record_check_file: null,
        }
  )
  const [positionId, setPositionId] = React.useState<string>("")
  const [genders, setGenders] = React.useState<Catalog[]>([])
  const [maritalStatuses, setMaritalStatuses] = React.useState<Catalog[]>([])
  const [educationLevels, setEducationLevels] = React.useState<Catalog[]>([])
  const [skinColors, setSkinColors] = React.useState<Catalog[]>([])
  // Fase 11A.4: licencias de conducción (catálogo global + selección de la persona)
  const [licenseCategories, setLicenseCategories] = React.useState<Catalog[]>([])
  const [licenseIds, setLicenseIds] = React.useState<string[]>([])
  const [contractTypes, setContractTypes] = React.useState<ContractType[]>([])
  const [contractTypeId, setContractTypeId] = React.useState<string>("")
  const [contractStartDate, setContractStartDate] = React.useState<string>("")
  const [contractEndDate, setContractEndDate] = React.useState<string>("")
  const [representativeAssignmentId, setRepresentativeAssignmentId] = React.useState<string | null>(
    null
  )
  // Fase 11A.5: condiciones formalizadas del contrato (solo al crear trabajador)
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodOption[]>([])
  const [signatureDate, setSignatureDate] = React.useState<string>("")
  const [signaturePlace, setSignaturePlace] = React.useState<string>("")
  const [paymentMethodId, setPaymentMethodId] = React.useState<string>("")
  const [paymentSchedule, setPaymentSchedule] = React.useState<string>("")
  const [components, setComponents] = React.useState<CompensationComponentDraft[]>([])
  const [representatives, setRepresentatives] = React.useState<RepresentativePositionRow[]>([])
  const [pending, setPending] = React.useState<ContractFormalizationPending | null>(null)
  const [canManageOrganization, setCanManageOrganization] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const queryClient = useQueryClient()

  React.useEffect(() => {
    const load = async () => {
      const [personCatalogs, catalogs] = await Promise.all([
        // Catálogos globales de la persona: mismo origen que utiliza el candidato
        fetchPersonCatalogs(),
        // Catálogos de la ficha laboral: los resuelve el dominio Personas
        loadWorkerReferenceCatalogs(),
      ])
      setGenders(catalogs.genders as Catalog[])
      setMaritalStatuses(catalogs.maritalStatuses as Catalog[])
      setEducationLevels(catalogs.educationLevels as Catalog[])
      setContractTypes(catalogs.contractTypes as ContractType[])
      setSkinColors(personCatalogs.skinColors)
      setLicenseCategories(personCatalogs.licenseCategories)
      // Fase 11A.5: catálogo global de formas de pago
      try {
        setPaymentMethods(await fetchPaymentMethods())
      } catch (paymentErr) {
        console.error("Error loading payment methods:", paymentErr)
      }
    }
    load().catch(err => {
      console.error("Error loading catalogs:", err)
      setFormError("No se pudieron cargar los catálogos.")
    })
  }, [])

  // Fase 11A.4: licencias del trabajador (solo en edición; se copian del candidato al contratar)
  React.useEffect(() => {
    if (!editingWorker?.id) return
    let active = true
    loadWorkerExpedienteLicenseIds(editingWorker.id)
      .then((ids) => {
        if (active) setLicenseIds(ids)
      })
      .catch((err) => console.error("Error loading worker driving licenses:", err))
    return () => {
      active = false
    }
  }, [editingWorker?.id])

  React.useEffect(() => {
    if (!entityId) return
    loadWorkerFormPermissions(entityId).then(({ canManageContractData }) =>
      setCanManageOrganization(canManageContractData)
    )
  }, [entityId])

  const municipalities = React.useMemo(
    () => (form.province && MUNICIPIOS_BY_PROVINCE_FULL[form.province]) || [],
    [form.province]
  )

  // Solo puestos ACTIVOS con plazas disponibles (currentAssignments < authorized_quantity)
    const vacantPositions = React.useMemo(
      () => positions.filter(p => p.is_active && p.currentAssignments < p.authorized_quantity),
      [positions]
    )

  const selectedPosition = React.useMemo(
    () => positions.find(p => p.id === positionId) || null,
    [positions, positionId]
  )

  const selectedContractType = React.useMemo(
    () => contractTypes.find(t => t.id === contractTypeId) || null,
    [contractTypes, contractTypeId]
  )

  // La lógica contractual se basa en el código estable del catálogo global, no en el texto visible.
  const isDeterminedContract = selectedContractType?.code === "DETERMINADO"

  // Fase 11A.5: fecha efectiva de inicio del contrato y bloqueo de formalización
  const effectiveContractStart = contractStartDate || form.hire_date
  const formalizationBlocked = (pending || EMPTY_FORMALIZATION_PENDING).blocking.length > 0

  // Información derivada de solo lectura: Área / Cargo / Grupo / Salario referencia
  const derivedInfo = React.useMemo(() => {
    if (!selectedPosition) return null
    const job = selectedPosition.job
    const group = job?.salary_group

    let salary: SalaryValue | null = null
    if (applicableScaleId && group && group.salary_scale_id === applicableScaleId) {
      salary = salaryValuesByGroup[group.id] || null
    }

    return {
      areaLabel: job?.area?.name || "N/A",
      jobLabel: job?.name || "N/A",
      groupLabel: group ? `Grupo ${toRomanNumeral(group.sequence_number)}` : "N/A",
      salaryLabel: salary ? formatSalary(salary) : null,
      // Fase 11A.5: salario de escala derivado (snapshot del contrato se calcula en backend)
      groupSequence: group?.sequence_number ?? null,
      salaryAmount: salary?.amount ?? null,
      salaryCurrency: salary?.currency_code ?? null,
    }
  }, [selectedPosition, applicableScaleId, salaryValuesByGroup])

  const setField = (field: keyof WorkerFormState, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const requiresSpecialty = React.useMemo(() => {
    const selected = educationLevels.find(l => l.id === form.education_level_id)
    // Niveles que exigen especialidad: regla compartida del dominio Personas.
    return candidateRequiresSpecialty(selected?.name)
  }, [form.education_level_id, educationLevels])

  const handleIdentificationChange = (value: string) => {
    // Se conserva el valor tal cual: la validación exige exactamente 11 dígitos
    // (0-9) y nunca se convierte a número (preserva ceros iniciales).
    setForm(prev => {
      const derived = ciToBirthDate(value)
      return { ...prev, identification: value, birth_date: derived || prev.birth_date }
    })
  }

  const handleProvinceChange = (province: string) =>
    setForm(prev => ({ ...prev, province, municipality: "" }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId) return

    setFormError(null)

    // Datos personales y laborales: las reglas son del dominio Personas y los mensajes son
    // los de siempre. El formato del carné lo aporta el kernel compartido.
    const selectedEducationLevel = educationLevels.find(l => l.id === form.education_level_id)
    const personalError = validateWorkerPersonalData(
      {
        first_name: form.first_name,
        first_surname: form.first_surname,
        identification: form.identification,
        birth_date: form.birth_date,
        profession_or_trade: form.profession_or_trade,
        address: form.address,
        province: form.province,
        municipality: form.municipality,
        education_level_id: form.education_level_id,
        education_level_name: selectedEducationLevel?.name || "",
        specialty: form.specialty,
        hire_date: form.hire_date,
      },
      isValidIdentification(form.identification) ? null : IDENTIFICATION_ERROR_MESSAGE
    )
    if (personalError) {
      setFormError(personalError)
      return
    }

    // Alta de un trabajador nuevo: puesto disponible y condiciones formalizadas del contrato.
    if (!isEditing) {
      const registrationError = validateWorkerRegistrationInput({
        positionId,
        positionAvailable: vacantPositions.some(p => p.id === positionId),
        contractTypeId,
        isDetermined: isDeterminedContract,
        contractStartDate: effectiveContractStart,
        contractEndDate,
        signatureDate,
        signaturePlace,
        paymentMethodId,
        hasInvalidComponents: hasInvalidComponent(components),
        blocking: (pending || EMPTY_FORMALIZATION_PENDING).blocking,
        representativeAssignmentId,
      })
      if (registrationError) {
        setFormError(registrationError)
        return
      }
    }

    // UNICIDAD DE PERSONAS (§27–§33): un trabajador NUEVO no puede duplicar a una persona ya
    // existente (Candidato, Trabajador o Reingreso) por Número de Identificación. La
    // comprobación la resuelve el backend y el mensaje lo aporta el dominio.
    if (!isEditing) {
      try {
        const identificationConflict = await checkWorkerIdentification(entityId, form.identification)
        if (identificationConflict) {
          setFormError(identificationConflict)
          return
        }
      } catch (checkError) {
        console.error("Error checking person identification:", checkError)
        setFormError("No se pudo verificar la unicidad de la identificación.")
        return
      }
    }

    setSubmitting(true)

    try {
      if (isEditing) {
        // Edición: solo datos personales/laborales. El cambio de puesto será
        // un Movimiento de personal en una fase futura (no se toca aquí).
        const personalData: WorkerExpedienteInput = {
          first_name: form.first_name.trim(),
          first_surname: form.first_surname.trim(),
          second_surname: form.second_surname.trim() || null,
          identification: form.identification.trim(),
          birth_date: form.birth_date || null,
          gender_id: form.gender_id || null,
          marital_status_id: form.marital_status_id || null,
          education_level_id: form.education_level_id || null,
          specialty: form.specialty.trim() || null,
          has_masters_degree: form.has_masters_degree,
          has_doctorate_degree: form.has_doctorate_degree,
          profession_or_trade: form.profession_or_trade.trim() || null,
          skin_color_id: form.skin_color_id || null,
          address: form.address.trim() || null,
          province: form.province || null,
          municipality: form.municipality || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          hire_date: form.hire_date,
        }

        await saveWorkerExpedientePersonalData(editingWorker!.id, personalData)
        // Reemplazo exacto de licencias (RPC transaccional)
        await saveWorkerExpedienteLicenseIds(editingWorker!.id, licenseIds)

        onSuccess()
      } else {
        // Alta con puesto, contrato, licencias y documentos verificadores: una sola
        // operación del dominio Personas (la identidad de la persona no se duplica).
        const newWorker: NewWorkerInput = {
          entityId,
          person: {
            first_name: form.first_name.trim(),
            first_surname: form.first_surname.trim(),
            second_surname: form.second_surname.trim(),
            identification: form.identification.trim(),
            birth_date: form.birth_date,
            gender_id: form.gender_id,
            marital_status_id: form.marital_status_id,
            education_level_id: form.education_level_id,
            specialty: form.specialty.trim(),
            has_masters_degree: form.has_masters_degree,
            has_doctorate_degree: form.has_doctorate_degree,
            profession_or_trade: form.profession_or_trade.trim(),
            skin_color_id: form.skin_color_id,
            address: form.address.trim(),
            province: form.province,
            municipality: form.municipality,
            phone: form.phone.trim(),
            email: form.email.trim(),
          },
          positionId,
          hireDate: form.hire_date,
          contractTypeId: contractTypeId || null,
          contractStartDate: effectiveContractStart || null,
          contractEndDate: isDeterminedContract ? contractEndDate || null : null,
          representativeAssignmentId,
          drivingLicenseCategoryIds: licenseIds,
          signatureDate,
          signaturePlace: signaturePlace.trim(),
          paymentMethodId,
          compensationComponents: buildComponentsPayload(components),
          paymentScheduleText: paymentSchedule.trim() || null,
        }

        await createWorkerExpediente({
          ...newWorker,
          hasPreEmploymentCheck: form.has_pre_employment_check,
          preEmploymentCheckFile: form.pre_employment_check_file,
          hasCriminalRecordCheck: form.has_criminal_record_check,
          criminalRecordCheckFile: form.criminal_record_check_file,
        })

        invalidateContractAlertData(queryClient)
        onSuccess()
      }
    } catch (err) {
      console.error("Error saving worker:", err)
      const msg = err instanceof Error ? err.message : ""
      let friendly = "Error al guardar el trabajador"
      if (/concepto retributivo|n[uú]mero v[aá]lido|negativo/i.test(msg)) {
        friendly =
          "Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)"
      } else if (/escala salarial/i.test(msg)) {
        friendly =
          "No existe una escala salarial aplicable configurada para esta entidad. Complete la configuración salarial antes de formalizar el contrato."
      } else if (/representante/i.test(msg)) {
        friendly = "No hay representantes configurados para la fecha de firma seleccionada."
      } else if (msg) {
        friendly = msg
      }
      setFormError(friendly)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && <SiteCorpAlert type="danger">{formError}</SiteCorpAlert>}

      {/* Datos personales */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="worker-name">Nombre *</Label>
          <SiteCorpInput
            id="worker-name"
            value={form.first_name}
            onChange={(e) => setField("first_name", e.target.value)}
            placeholder="Ej.: Juan"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-surname1">Primer apellido *</Label>
          <SiteCorpInput
            id="worker-surname1"
            value={form.first_surname}
            onChange={(e) => setField("first_surname", e.target.value)}
            placeholder="Ej.: Pérez"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-surname2">Segundo apellido</Label>
          <SiteCorpInput
            id="worker-surname2"
            value={form.second_surname}
            onChange={(e) => setField("second_surname", e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="worker-ci">Carné de identidad *</Label>
          <SiteCorpInput
            id="worker-ci"
            value={form.identification}
            onChange={(e) => handleIdentificationChange(e.target.value)}
            placeholder="11 dígitos"
            inputMode="numeric"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-birth">Fecha de nacimiento *</Label>
          <SiteCorpInput
            id="worker-birth"
            type="date"
            value={form.birth_date}
            onChange={(e) => setField("birth_date", e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">Se autocompleta desde el CI.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-gender">Sexo</Label>
          <SiteCorpSelect value={form.gender_id} onValueChange={(v) => setField("gender_id", v)}>
            <option value="">Seleccionar</option>
            {genders.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </SiteCorpSelect>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="worker-marital">Estado civil</Label>
          <SiteCorpSelect value={form.marital_status_id} onValueChange={(v) => setField("marital_status_id", v)}>
            <option value="">Seleccionar</option>
            {maritalStatuses.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </SiteCorpSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-education">Nivel educacional</Label>
          <SiteCorpSelect value={form.education_level_id} onValueChange={(v) => setField("education_level_id", v)}>
            <option value="">Seleccionar</option>
            {educationLevels.map((e2) => (
              <option key={e2.id} value={e2.id}>{e2.name}</option>
            ))}
          </SiteCorpSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-specialty">
            Especialidad
            {requiresSpecialty && <span className="text-sitecorp-danger"> *</span>}
          </Label>
          {(requiresSpecialty || form.specialty) && (
            <SiteCorpInput
              id="worker-specialty"
              value={form.specialty}
              onChange={(e) => setField("specialty", e.target.value)}
              placeholder={requiresSpecialty ? "Obligatorio para este nivel educacional" : "Opcional"}
            />
          )}
        </div>
      </div>

      {/* Formación académica adicional: indicadores independientes (no excluyentes) */}
      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium text-ink">Formación académica adicional</p>
          <p className="text-xs text-muted-foreground">
            Marque los estudios de postgrado obtenidos. Puede marcar ambos.
          </p>
        </div>
        <AcademicDegreeCheckboxes
          hasMastersDegree={form.has_masters_degree}
          hasDoctorateDegree={form.has_doctorate_degree}
          onMastersChange={(checked) =>
            setForm((prev) => ({ ...prev, has_masters_degree: checked }))
          }
          onDoctorateChange={(checked) =>
            setForm((prev) => ({ ...prev, has_doctorate_degree: checked }))
          }
          disabled={submitting}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="worker-skincolor">Color de piel</Label>
        <SiteCorpSelect value={form.skin_color_id} onValueChange={(v) => setField("skin_color_id", v)}>
          <option value="">Seleccionar</option>
          {skinColors.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </SiteCorpSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="worker-address">Dirección particular *</Label>
        <SiteCorpInput
          id="worker-address"
          value={form.address}
          onChange={(e) => setField("address", e.target.value)}
          placeholder="Calle, número, etc."
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="worker-province">Provincia *</Label>
          <SiteCorpSelect value={form.province} onValueChange={handleProvinceChange}>
            <option value="">Seleccionar provincia</option>
            {CUBA_PROVINCES_FULL.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </SiteCorpSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-municipality">Municipio *</Label>
          <SiteCorpSelect
            value={form.municipality}
            onValueChange={(v) => setField("municipality", v)}
            disabled={!form.province}
          >
            <option value="">Seleccionar municipio</option>
            {municipalities.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </SiteCorpSelect>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="worker-phone">Teléfono</Label>
          <SiteCorpInput
            id="worker-phone"
            value={form.phone}
            onChange={(e) => setField("phone", e.target.value)}
            placeholder="Opcional"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-email">Email</Label>
          <SiteCorpInput
            id="worker-email"
            type="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </div>

      {/* Información profesional (propia de la persona) */}
      <div className="border-t border-border pt-4">
        <p className="mb-3 text-sm font-medium text-ink">Información profesional</p>
        <div className="space-y-2">
          <Label htmlFor="worker-profession">Profesión u oficio *</Label>
          <SiteCorpInput
            id="worker-profession"
            value={form.profession_or_trade}
            onChange={(e) => setField("profession_or_trade", e.target.value)}
            placeholder="Ej.: Chofer profesional"
            required
          />
          <p className="text-xs text-muted-foreground">
            Profesión real de la persona. No sustituye la profesión requerida del cargo.
          </p>
        </div>

        <div className="mt-4 space-y-2">
                  <Label>Licencias de conducción</Label>
                  <DrivingLicenseSelector
                    categories={licenseCategories}
                    value={licenseIds}
                    onChange={setLicenseIds}
                    disabled={submitting}
                  />
                </div>
        
                {/* Verificaciones de seguridad (Chequeo Preempleo y Antecedentes Penales) */}
                <div className="mt-4 space-y-4">
                  <h3 className="text-sm font-semibold text-ink border-b pb-2">Verificaciones de seguridad</h3>
        
                  {/* Chequeo Preempleo */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.has_pre_employment_check}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, has_pre_employment_check: e.target.checked }))
                          }
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-ink">Chequeo Preempleo</span>
                      </label>
                    </div>
                    {form.has_pre_employment_check && (
                      <div className="space-y-2">
                        <label className="block text-sm font-medium">Documento de Chequeo Preempleo</label>
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null
                            setForm((prev) => ({ ...prev, pre_employment_check_file: file }))
                          }}
                          className="block w-full text-sm text-muted-foreground"
                        />
                        {form.pre_employment_check_file && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {form.pre_employment_check_file.name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
        
                  {/* Antecedentes Penales */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.has_criminal_record_check}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, has_criminal_record_check: e.target.checked }))
                          }
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-ink">Antecedentes Penales</span>
                      </label>
                    </div>
                    {form.has_criminal_record_check && (
                      <div className="space-y-2">
                        <label className="block text-sm font-medium">Documento de Antecedentes Penales</label>
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null
                            setForm((prev) => ({ ...prev, criminal_record_check_file: file }))
                          }}
                          className="block w-full text-sm text-muted-foreground"
                        />
                        {form.criminal_record_check_file && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {form.criminal_record_check_file.name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

      {/* Datos laborales */}
      <div className="border-t border-border pt-4">
        {isEditing ? (
          <SiteCorpAlert type="info">
            El puesto actual de un trabajador no se modifica aquí. Los cambios de puesto se
            realizarán mediante Movimientos de personal en una fase posterior.
          </SiteCorpAlert>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="worker-position">Puesto *</Label>
            <SiteCorpSelect value={positionId} onValueChange={setPositionId}>
              <option value="">Seleccionar puesto vacante</option>
              {vacantPositions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code}){p.job ? ` — ${p.job.name}` : ""}
                </option>
              ))}
            </SiteCorpSelect>
            <p className="text-xs text-muted-foreground">
              Solo puestos activos y vacantes de esta entidad.
            </p>
            {vacantPositions.length === 0 && (
              <p className="text-xs text-sitecorp-danger">
                No hay puestos vacantes disponibles. Configura un puesto antes de añadir un trabajador.
              </p>
            )}
          </div>
        )}

        {derivedInfo && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Información derivada del puesto (solo lectura)
            </p>
            <dl className="grid gap-2 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Área</dt>
                <dd className="text-sm font-medium text-ink">{derivedInfo.areaLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cargo</dt>
                <dd className="text-sm font-medium text-ink">{derivedInfo.jobLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
                <dd className="text-sm font-medium text-ink">{derivedInfo.groupLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Salario de referencia</dt>
                <dd className="text-sm font-medium text-ink">
                  {derivedInfo.salaryLabel ? (
                    derivedInfo.salaryLabel
                  ) : (
                    <span className="text-muted-foreground">
                      {applicableScaleId ? "Salario no configurado" : "Sin escala configurada"}
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            {/* Fase 11A.3: configuración estructural del puesto (solo lectura) */}
            <PositionWorkInfoReadOnly
              className="mt-3"
              workLocation={selectedPosition?.work_location}
              dailyHours={selectedPosition?.daily_hours}
              weeklyHours={selectedPosition?.weekly_hours}
              monthlyHours={selectedPosition?.monthly_hours}
              breakMinutes={selectedPosition?.break_minutes}
              scheduleNotes={selectedPosition?.schedule_notes}
              segments={selectedPosition?.schedule_segments || []}
            />
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="worker-hire">Fecha de incorporación *</Label>
            <SiteCorpInput
              id="worker-hire"
              type="date"
              value={form.hire_date}
              onChange={(e) => setField("hire_date", e.target.value)}
              required
            />
          </div>
          {isEditing && (
            <div className="space-y-2">
              <Label htmlFor="worker-code">Código</Label>
              <SiteCorpInput id="worker-code" value={editingWorker!.code} disabled />
            </div>
          )}
        </div>

        {/* Datos de contratación */}
        {!isEditing && (
          <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
            <p className="mb-3 text-sm font-medium text-ink">Datos de contratación</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="worker-contract-type">Tipo de contrato *</Label>
                <SiteCorpSelect
                  value={contractTypeId}
                  onValueChange={setContractTypeId}
                >
                  <option value="">Seleccionar tipo</option>
                  {contractTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="worker-contract-start">Inicio del contrato</Label>
                <SiteCorpInput
                  id="worker-contract-start"
                  type="date"
                  value={contractStartDate}
                  onChange={(e) => setContractStartDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Si se deja vacío, se usa la fecha de incorporación.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="worker-contract-end">
                  Fin del contrato {isDeterminedContract ? "*" : ""}
                </Label>
                <SiteCorpInput
                  id="worker-contract-end"
                  type="date"
                  value={contractEndDate}
                  onChange={(e) => setContractEndDate(e.target.value)}
                  disabled={!isDeterminedContract}
                />
                <p className="text-xs text-muted-foreground">
                  {isDeterminedContract
                    ? "Obligatorio para contratos por tiempo determinado."
                    : "Solo aplica a contratos por tiempo determinado."}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <ContractSignatureFields
                signatureDate={signatureDate}
                onSignatureDateChange={setSignatureDate}
                signaturePlace={signaturePlace}
                onSignaturePlaceChange={setSignaturePlace}
                paymentMethodId={paymentMethodId}
                onPaymentMethodIdChange={setPaymentMethodId}
                paymentMethods={paymentMethods}
                paymentSchedule={paymentSchedule}
                onPaymentScheduleChange={setPaymentSchedule}
              />

              <ContractFormalizationAlerts
                entityId={entityId}
                positionId={positionId || null}
                signatureDate={signatureDate || null}
                signaturePlace={signaturePlace || null}
                paymentMethodId={paymentMethodId || null}
                representativeAssignmentId={representativeAssignmentId}
                canManage={canManageOrganization}
                onPendingChange={setPending}
              />

              <RepresentativeSelect
                entityId={entityId}
                onDate={signatureDate}
                value={representativeAssignmentId}
                onChange={setRepresentativeAssignmentId}
                canManage={canManageOrganization}
                label="Representante que suscribe el contrato *"
                dateHint={`Representante vigente en la fecha de firma (${formatConditionDate(
                  signatureDate
                )}).`}
                onOptionsChange={setRepresentatives}
              />

              <ContractRetributionFields
                components={components}
                onComponentsChange={setComponents}
                baseSalaryAmount={derivedInfo?.salaryAmount ?? null}
                baseSalaryCurrency={derivedInfo?.salaryCurrency ?? null}
                salaryGroupSequence={derivedInfo?.groupSequence ?? null}
                disabled={!selectedPosition}
              />

              <ContractFormalizationSummary
                title="Resumen de la contratación"
                workerName={[form.first_name, form.first_surname, form.second_surname]
                  .filter(Boolean)
                  .join(" ")}
                personIdentification={form.identification || null}
                positionName={selectedPosition?.name || ""}
                jobName={selectedPosition?.job?.name || null}
                areaName={selectedPosition?.job?.area?.name || null}
                contractTypeName={selectedContractType?.name || null}
                startDate={effectiveContractStart}
                endDate={isDeterminedContract ? contractEndDate || null : null}
                signatureDate={signatureDate}
                signaturePlace={signaturePlace}
                paymentMethodName={
                  paymentMethods.find((method) => method.id === paymentMethodId)?.name || null
                }
                representativeName={
                  representatives.find((row) => row.assignment_id === representativeAssignmentId)
                    ?.person_name || null
                }
                representativeTitle={
                  representatives.find((row) => row.assignment_id === representativeAssignmentId)
                    ?.title || null
                }
                baseSalaryAmount={derivedInfo?.salaryAmount ?? null}
                baseSalaryCurrency={derivedInfo?.salaryCurrency ?? null}
                salaryGroupSequence={derivedInfo?.groupSequence ?? null}
                components={components}
              />
            </div>
          </div>
        )}

        {isEditing && (
          <p className="mt-2 text-xs text-muted-foreground">
            El trabajador se crea con estado Activo; los cambios de estado laboral se gestionarán en fases posteriores.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <SiteCorpButton variant="outline" type="button" onClick={onCancel}>
          Cancelar
        </SiteCorpButton>
        <SiteCorpButton
          type="submit"
          disabled={
            submitting ||
            (!isEditing &&
              (!signatureDate ||
                !signaturePlace.trim() ||
                !paymentMethodId ||
                hasInvalidComponent(components) ||
                (pending || EMPTY_FORMALIZATION_PENDING).blocking.length > 0 ||
                !representativeAssignmentId))
          }
        >
          {submitting
            ? "Guardando..."
            : isEditing
              ? "Guardar cambios"
              : "Crear trabajador"}
        </SiteCorpButton>
      </div>
    </form>
  )
}
