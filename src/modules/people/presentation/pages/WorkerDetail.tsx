import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { invalidateContractAlertData } from "@/modules/contracts/presentation/hooks/use-contract-alerts"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import {
  ArrowLeft,
  Pencil,
  User,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Briefcase,
  UserCheck,
  FileText,
  ArrowRightLeft,
  UserMinus,
  UserPlus,
  FileSignature,
  AlertTriangle,
  Wallet,
} from "lucide-react"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { SiteCorpTabsList, SiteCorpTabTrigger } from "@/components/ui/sitecorp-tabs"
import WorkerVacationsTab from "@/modules/vacations-licenses/vacations/presentation/components/WorkerVacationsTab"
import WorkerMedicalCertificatesTab from "@/modules/vacations-licenses/medical-certificates/presentation/components/WorkerMedicalCertificatesTab"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import { toRomanNumeral } from "@/utils/roman-numerals"
import { CUBA_PROVINCES_FULL, MUNICIPIOS_BY_PROVINCE_FULL } from "@/data/cuba-locations-full"
import { WorkerForm } from "@/modules/people/presentation/components/WorkerForm"
import { WorkerDocumentsTab } from "@/components/workers/WorkerDocumentsTab"
import {
  drivingLicenseLabels,
  loadWorkerExpedienteView,
  registerWorkerExpedienteContract,
  saveWorkerExpedienteLicenseIds,
  saveWorkerExpedientePersonalData,
  validatePersonProfileFields,
  validateWorkerContractInput,
  ageRange,
  calculateAge,
  calculateTenure,
  type CatalogOption,
  type CatalogRow,
  type WorkerEmploymentMovement,
  type WorkerExpediente as WorkerDetail,
  type WorkerExpedienteInput,
} from "@/modules/people"
import { DrivingLicenseSelector } from "@/modules/people/presentation/components/DrivingLicenseSelector"
import { AcademicDegreeCheckboxes } from "@/modules/people/presentation/components/AcademicDegreeCheckboxes"
import {
  academicCategoryLabel,
  formatAcademicAmount,
  loadAcademicCategoryPayment,
  type AcademicCategoryPaymentResolution,
} from "@/modules/organization-structure"
import ChangePositionDialog, {
  type WorkerCurrentSituation,
} from "@/components/workers/ChangePositionDialog"
import SeparateWorkerDialog from "@/components/workers/SeparateWorkerDialog"
import ReincorporateWorkerDialog from "@/components/workers/ReincorporateWorkerDialog"
import { RepresentativeSelect } from "@/modules/representatives/presentation/components/RepresentativeSelect"
import {
  NO_WORK_INFO_LABEL,
  fetchPositionScheduleSegments,
  formatBreak,
  formatJornada,
  formatScheduleByDay,
  formatScheduleSummary,
  type PositionScheduleSegment,
} from "@/modules/organization-structure"
import ChangeContractDialog, {
  type CurrentContractInfo,
} from "@/components/workers/ChangeContractDialog"
import { ContractFormalizationAlerts } from "@/components/contracts/ContractFormalizationAlerts"
import {
  ContractRetributionFields,
  ContractSignatureFields,
} from "@/components/contracts/ContractConditionsFields"
import { ContractFormalizationSummary } from "@/components/contracts/ContractFormalizationSummary"
import { ContractRetributionSummary } from "@/components/contracts/ContractRetributionSummary"
import { CurrentContractSummary } from "@/components/contracts/CurrentContractSummary"
import { ContractualTimeline } from "@/components/contracts/ContractualTimeline"
import { AddendumDetailDialog } from "@/components/addendums/AddendumDetailDialog"
import type { RepresentativePositionRow } from "@/modules/representatives"
import { SelectItem } from "@/components/ui/select"
import {
  fetchSalaryValuesForGroups,
  salaryForGroup,
  formatSalary,
  type SalaryValue,
} from "@/modules/organization-structure"
import {
  ADDENDUM_STATUS_BADGE,
  ADDENDUM_STATUS_LABELS,
  CONTRACT_ALERT_META,
  EMPTY_FORMALIZATION_PENDING,
  SALARY_CHANGE_TYPE_LABELS,
  addendumReasonLabel,
  buildComponentsPayload,
  deadlineLabel,
  fetchComponentsByContract,
  fetchPaymentMethods,
  fetchWorkerAddendums,
  fetchWorkerContractAlert,
  fetchWorkerContractualConditions,
  fetchWorkerSalaryHistory,
  formatConditionDate,
  formatContractDate,
  formatContractMoney,
  hasInvalidComponent,
  isAddendumPending,
  type CompensationComponentDraft,
  type ContractAddendum,
  type ContractAlertRow,
  type ContractCompensationComponent,
  type ContractFormalizationPending,
  type PaymentMethodOption,
  type WorkerContractualConditions,
  type WorkerSalaryHistoryEntry,
} from "@/modules/contracts"
import { ContractAddendumsSection } from "@/components/addendums/ContractAddendumsSection"

/**
 * La ficha laboral se describe con el modelo del dominio Personas (`WorkerExpediente`,
 * importado como `WorkerDetail` para conservar el nombre que ya usaba la aplicación): la
 * persona con su trayectoria (asignaciones y contratos) y el vocabulario de las columnas.
 */
type Catalog = CatalogRow

const WorkerDetail = () => {
  const { entityId, workerId } = useParams<{ entityId: string; workerId: string }>()
  const navigate = useNavigate()

  const [worker, setWorker] = React.useState<WorkerDetail | null>(null)
  const [genders, setGenders] = React.useState<Catalog[]>([])
  const [maritalStatuses, setMaritalStatuses] = React.useState<Catalog[]>([])
  const [educationLevels, setEducationLevels] = React.useState<Catalog[]>([])
  const [skinColors, setSkinColors] = React.useState<Catalog[]>([])
  // Fase 11A.4: licencias de conducción (catálogo global + selección del trabajador)
  const [licenseCategories, setLicenseCategories] = React.useState<CatalogOption[]>([])
  const [licenseIds, setLicenseIds] = React.useState<string[]>([])
  const [applicableScaleId, setApplicableScaleId] = React.useState<string | null>(null)
    const [applicableScaleName, setApplicableScaleName] = React.useState<string | null>(null)
    const [salaryValuesByGroup, setSalaryValuesByGroup] = React.useState<Record<string, SalaryValue | null>>({})
    // Antigüedad del trabajador (calculada desde hire_date)
    const [tenure, setTenure] = React.useState<{ years: number; months: number; totalMonths: number; humanDescription: string } | null>(null)
    // Pago por antigüedad aplicable
    const [tenurePayment, setTenurePayment] = React.useState<{ amount: number; from_months: number; to_months: number | null } | null>(null)
    // Pago por categoría académica (Máster / Doctor) resuelto por la función central
    const [academicPayment, setAcademicPayment] =
      React.useState<AcademicCategoryPaymentResolution | null>(null)
    const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canManage, setCanManage] = React.useState(false)
  const [editDialogOpen, setEditDialogOpen] = React.useState(false)
  const [contractTypes, setContractTypes] = React.useState<{ id: string; name: string; code: string }[]>([])
  const [contractDialogOpen, setContractDialogOpen] = React.useState(false)
  const [changePositionOpen, setChangePositionOpen] = React.useState(false)
  const [separateOpen, setSeparateOpen] = React.useState(false)
  const [reincorporateOpen, setReincorporateOpen] = React.useState(false)
  const [changeContractOpen, setChangeContractOpen] = React.useState(false)
  const [movements, setMovements] = React.useState<WorkerEmploymentMovement[]>([])
  const [salaryHistory, setSalaryHistory] = React.useState<WorkerSalaryHistoryEntry[]>([])
  // Fase 11A.6: anexos al contrato y condiciones contractuales formalizadas vigentes
  const [addendums, setAddendums] = React.useState<ContractAddendum[]>([])
  const [contractualConditions, setContractualConditions] =
    React.useState<WorkerContractualConditions | null>(null)
  // Centro de contratación: detalle de un anexo abierto desde la timeline
  const [timelineAddendumId, setTimelineAddendumId] = React.useState<string | null>(null)
  const [timelineDetailOpen, setTimelineDetailOpen] = React.useState(false)
  const queryClient = useQueryClient()
  // Vacaciones (Fase 18): permisos internos efectivos de la entidad.
  const { has: hasEntityPermission } = useEntityPermissions(entityId)
  const canViewVacations = hasEntityPermission(["vacations.view", "vacations.manage"])
  const canManageVacations = hasEntityPermission(["vacations.manage"])
  // Certificados médicos (Fase 19)
  const canViewMedicalCerts = hasEntityPermission(["medical_certificates.view", "medical_certificates.manage"])
  const canManageMedicalCerts = hasEntityPermission(["medical_certificates.manage"])
  const [contractAlert, setContractAlert] = React.useState<ContractAlertRow | null>(null)
  // Fase 11A.3: horario habitual del puesto vigente (no se copia al trabajador)
  const [positionSegments, setPositionSegments] = React.useState<PositionScheduleSegment[]>([])
  const [contractForm, setContractForm] = React.useState<{
    contractTypeId: string
    startDate: string
    endDate: string
    representativeAssignmentId: string | null
    // Fase 11A.5: condiciones formalizadas del contrato
    signatureDate: string
    signaturePlace: string
    paymentMethodId: string
    paymentSchedule: string
    components: CompensationComponentDraft[]
  }>({
    contractTypeId: "",
    startDate: "",
    endDate: "",
    representativeAssignmentId: null,
    signatureDate: "",
    signaturePlace: "",
    paymentMethodId: "",
    paymentSchedule: "",
    components: [],
  })
  // Fase 11A.5: catálogo de formas de pago, checklist y conceptos por contrato
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodOption[]>([])
  const [representatives, setRepresentatives] = React.useState<RepresentativePositionRow[]>([])
  const [formalizationPending, setFormalizationPending] =
    React.useState<ContractFormalizationPending | null>(null)
  const [componentsByContract, setComponentsByContract] = React.useState<
    Record<string, ContractCompensationComponent[]>
  >({})
  const [contractSubmitting, setContractSubmitting] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const currentAssignment = React.useMemo(() => {
    if (!worker?.assignments) return null
    return worker.assignments.find(a => a.is_current && !a.end_date) || null
  }, [worker])

  const currentContract = React.useMemo(() => {
    if (!worker?.contracts) return null
    return worker.contracts.find(c => c.is_current) || null
  }, [worker])

  const sortedAssignments = React.useMemo(() => {
    if (!worker?.assignments) return []
    return [...worker.assignments].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
  }, [worker])

  const sortedContracts = React.useMemo(() => {
    if (!worker?.contracts) return []
    return [...worker.contracts].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
  }, [worker])

  const lastAssignment = sortedAssignments[0] ?? null
  // Para un trabajador inactivo mostramos su ÚLTIMA situación laboral (assignment histórico más reciente).
  const position = currentAssignment?.position ?? lastAssignment?.position ?? null
  const job = position?.job
  const group = job?.salary_group
  const isInactive = worker?.employment_status !== "active"

  const [editForm, setEditForm] = React.useState<Partial<WorkerDetail>>({})

  // Etiquetas (A, B, C…) de las licencias del trabajador, en el orden del catálogo global.
  const workerLicenseLabels = React.useMemo(
    () => drivingLicenseLabels(licenseIds, licenseCategories),
    [licenseIds, licenseCategories]
  )

  const loadWorker = React.useCallback(async () => {
    if (!entityId || !workerId) {
      setError("Parámetros inválidos")
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Permisos, ficha laboral con su trayectoria, catálogos, licencias de conducción,
      // bitácora de movimientos y escala salarial: todo lo resuelve el caso de uso del
      // dominio Personas. La pantalla ya no compone ninguna consulta.
      const view = await loadWorkerExpedienteView({ entityId, workerId })

      if (!view.permissions.canView && !view.permissions.canManage) {
        setError("No tiene permiso para ver este trabajador")
        return
      }
      setCanManage(view.permissions.canManage)

      const mappedWorker = view.worker
      if (!mappedWorker) return
      setWorker(mappedWorker)
            
                  // Antigüedad desde la fecha canónica de incorporación laboral
                  // (employment_start_date; fallback histórico a hire_date).
                  const t = calculateTenure(
                    mappedWorker.employment_start_date || mappedWorker.hire_date
                  )
                  setTenure(t)
            
                  // Pago por antigüedad aplicable, resuelto en el servidor (caso de uso).
                  setTenurePayment(view.tenurePayment)

                  // Pago por categoría académica (Máster / Doctor). Se resuelve con la
                  // única fuente de verdad del servidor: Doctor tiene prioridad y los
                  // importes nunca se suman. Sin fallback entre regímenes.
                  try {
                    setAcademicPayment(await loadAcademicCategoryPayment(entityId, workerId))
                  } catch (academicErr) {
                    console.error("Error resolving academic category payment:", academicErr)
                    setAcademicPayment(null)
                  }
            
                  // Fase 11A.3: horario habitual del puesto vigente (o del último puesto si está inactivo)
      const requestedPositionId =
        mappedWorker.assignments?.find((a) => a.is_current && !a.end_date)?.position_id ||
        [...(mappedWorker.assignments || [])].sort((a, b) =>
          a.start_date < b.start_date ? 1 : -1
        )[0]?.position_id ||
        null

      if (requestedPositionId) {
        try {
          setPositionSegments(await fetchPositionScheduleSegments(requestedPositionId))
        } catch (segmentsErr) {
          console.error("Error loading position schedule segments:", segmentsErr)
          setPositionSegments([])
        }
      } else {
        setPositionSegments([])
      }

      // Catálogos y licencias de conducción: vienen del caso de uso del expediente.
      setGenders(view.catalogs.genders as Catalog[])
      setMaritalStatuses(view.catalogs.maritalStatuses as Catalog[])
      setEducationLevels(view.catalogs.educationLevels as Catalog[])
      setSkinColors(view.skinColors)
      setLicenseCategories(view.licenseCategories)
      setLicenseIds(view.drivingLicenseIds)
      setContractTypes(view.catalogs.contractTypes)

      // Fase 11A.5: catálogo de formas de pago y conceptos retributivos por contrato.
      // Los conceptos son históricos: cada contrato conserva los suyos.
      try {
        setPaymentMethods(await fetchPaymentMethods())
      } catch (paymentErr) {
        console.error("Error loading payment methods:", paymentErr)
        setPaymentMethods([])
      }
      try {
        setComponentsByContract(
          await fetchComponentsByContract(
            ((mappedWorker.contracts || []) as { id: string }[]).map((c) => c.id)
          )
        )
      } catch (componentsErr) {
        console.error("Error loading contract compensation components:", componentsErr)
        setComponentsByContract({})
      }

      // Bitácora de movimientos laborales (bajas, reincorporaciones, cambios de puesto),
      // con el nombre de su autor resuelto por el caso de uso.
      setMovements(view.movements)

      // Escala aplicable y salario de referencia (derivado del assignment actual).
      // Se calcula a partir de los datos recién cargados (locales), NO del estado
      // `worker`, que aún no se ha actualizado en este punto del mismo ciclo async.
      setApplicableScaleId(view.applicableScaleId)
      setApplicableScaleName(view.applicableScaleName)

      const localAssignments = mappedWorker.assignments || []
      const localCurrentAssignment =
        localAssignments.find((a) => a.is_current && !a.end_date) || null
      // Si el trabajador está inactivo no hay assignment actual: usamos su última
      // situación laboral (assignment histórico más reciente) para el salario de referencia.
      const localLastAssignment = localAssignments
        .slice()
        .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0] || null
      const localGroup =
        localCurrentAssignment?.position?.job?.salary_group ||
        localLastAssignment?.position?.job?.salary_group ||
        null

      if (localGroup?.id) {
        setSalaryValuesByGroup(await fetchSalaryValuesForGroups([localGroup.id]))
      } else {
        setSalaryValuesByGroup({})
      }

      // Fase 12: vencimiento del contrato vigente. Se resuelve en el servidor para
      // compartir el mismo cálculo (fechas y días) que la vista de Alertas.
      try {
        setContractAlert(await fetchWorkerContractAlert(entityId, workerId))
      } catch (alertErr) {
        console.error("Error loading contract alert:", alertErr)
        setContractAlert(null)
      }

      // Fase 11A: histórico salarial (evolución económica: nunca se recalcula).
      try {
        setSalaryHistory(await fetchWorkerSalaryHistory(workerId))
      } catch (historyErr) {
        console.error("Error loading salary history:", historyErr)
        setSalaryHistory([])
      }

      // Fase 11A.6: anexos al contrato y condiciones formalizadas vigentes
      // (contrato original + anexos formalizados en orden efectivo).
      try {
        setAddendums(await fetchWorkerAddendums(workerId))
      } catch (addendumErr) {
        console.error("Error loading contract addendums:", addendumErr)
        setAddendums([])
      }
      try {
        setContractualConditions(await fetchWorkerContractualConditions(workerId))
      } catch (conditionsErr) {
        console.error("Error loading contractual conditions:", conditionsErr)
        setContractualConditions(null)
      }
    } catch (err) {
      console.error("Error loading worker:", err)
      setError(err instanceof Error ? err.message : "Error al cargar el trabajador")
    } finally {
      setLoading(false)
    }
  }, [entityId, workerId])

  React.useEffect(() => {
    loadWorker()
  }, [loadWorker])

  const handleEditSave = async () => {
    if (!worker) return
    // Integridad contractual: al editar un trabajador (incluidos los históricos)
    // deben completarse los datos personales indispensables para el contrato. Las reglas
    // y sus mensajes son los del dominio Personas, compartidos con el alta de trabajadores.
    const profileError = validatePersonProfileFields({
      birth_date: editForm.birth_date ?? "",
      profession_or_trade: editForm.profession_or_trade ?? "",
      address: editForm.address ?? "",
      province: editForm.province ?? "",
      municipality: editForm.municipality ?? "",
    })
    if (profileError) {
      setError(profileError)
      return
    }

    const personalData: WorkerExpedienteInput = {
      first_name: editForm.first_name ?? "",
      first_surname: editForm.first_surname ?? "",
      second_surname: editForm.second_surname || null,
      identification: editForm.identification ?? "",
      birth_date: editForm.birth_date || null,
      gender_id: editForm.gender_id || null,
      marital_status_id: editForm.marital_status_id || null,
      education_level_id: editForm.education_level_id || null,
      specialty: editForm.specialty || null,
      has_masters_degree: !!editForm.has_masters_degree,
      has_doctorate_degree: !!editForm.has_doctorate_degree,
      profession_or_trade: editForm.profession_or_trade || null,
      skin_color_id: editForm.skin_color_id || null,
      address: editForm.address || null,
      province: editForm.province || null,
      municipality: editForm.municipality || null,
      phone: editForm.phone || null,
      email: editForm.email || null,
    }

    try {
      await saveWorkerExpedientePersonalData(worker.id, personalData)
    } catch (updateErr) {
      setError(updateErr instanceof Error ? updateErr.message : "Error al guardar el trabajador")
      return
    }

    // Editar el trabajador nunca modifica al candidato: son registros independientes.
    try {
      await saveWorkerExpedienteLicenseIds(worker.id, licenseIds)
    } catch (licenseErr) {
      setError(
        licenseErr instanceof Error
          ? `Trabajador guardado, pero no se pudieron guardar las licencias: ${licenseErr.message}`
          : "Trabajador guardado, pero no se pudieron guardar las licencias"
      )
      return
    }

    setEditDialogOpen(false)
    loadWorker()
  }

  const handleRegisterContract = async () => {
    if (!worker) return
    setActionError(null)

    const selectedType = contractTypes.find(t => t.id === contractForm.contractTypeId)
    const start = contractForm.startDate || worker.hire_date

    // Condiciones del contrato: reglas y mensajes del dominio Personas.
    const contractError = validateWorkerContractInput({
      contractTypeId: contractForm.contractTypeId,
      startDate: start,
      hireDate: worker.hire_date,
      isDetermined: selectedType?.code === "DETERMINADO",
      endDate: contractForm.endDate,
      signatureDate: contractForm.signatureDate,
      signaturePlace: contractForm.signaturePlace,
      paymentMethodId: contractForm.paymentMethodId,
      hasInvalidComponents: hasInvalidComponent(contractForm.components),
      blocking: (formalizationPending || EMPTY_FORMALIZATION_PENDING).blocking,
      representativeAssignmentId: contractForm.representativeAssignmentId,
    })
    if (contractError) {
      setActionError(contractError)
      return
    }

    setContractSubmitting(true)
    try {
      // Registro del contrato y generación de su documento (§13/§14): caso de uso del
      // expediente. El documento nunca interrumpe la operación.
      await registerWorkerExpedienteContract({
        workerId: worker.id,
        contractTypeId: contractForm.contractTypeId,
        startDate: start,
        endDate: selectedType?.code === "DETERMINADO" ? contractForm.endDate || null : null,
        representativeAssignmentId: contractForm.representativeAssignmentId,
        signatureDate: contractForm.signatureDate,
        signaturePlace: contractForm.signaturePlace.trim(),
        paymentMethodId: contractForm.paymentMethodId,
        compensationComponents: buildComponentsPayload(contractForm.components),
        paymentScheduleText: contractForm.paymentSchedule.trim() || null,
      })

      // El contrato vigente cambió: recalcular alertas de vencimiento.
      invalidateContractAlertData(queryClient)
      setContractDialogOpen(false)
      setContractForm({
        contractTypeId: "",
        startDate: "",
        endDate: "",
        representativeAssignmentId: null,
        signatureDate: "",
        signaturePlace: "",
        paymentMethodId: "",
        paymentSchedule: "",
        components: [],
      })
      loadWorker()
    } catch (err) {
      console.error("Error registering contract:", err)
      const msg = err instanceof Error ? err.message : ""
      let friendly = "Error al registrar el contrato"
      if (/Datos pendientes/i.test(msg)) {
        friendly = msg
      } else if (/concepto retributivo|n[uú]mero v[aá]lido|negativo/i.test(msg)) {
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
      setActionError(friendly)
    } finally {
      setContractSubmitting(false)
    }
  }

  const fullName = (w: WorkerDetail) =>
    [w.first_name, w.first_surname, w.second_surname].filter(Boolean).join(" ")

  const salary = salaryForGroup(applicableScaleId, group, salaryValuesByGroup)

  // Condiciones FORMALIZADAS vigentes (contrato original + anexos formalizados en orden)
  const formalizedConditions = contractualConditions?.formalized ?? null

  // Anexos pendientes de formalizar (todavía NO forman parte de las condiciones formalizadas)
  const pendingContractAddendums = React.useMemo(
    () => addendums.filter((row) => isAddendumPending(row.status)),
    [addendums]
  )

  // El snapshot contractual es histórico: puede diferir del salario operativo actual.
  const contractSalaryDiffers =
    currentContract?.salary_snapshot_status === "CAPTURED" &&
    currentContract.salary_amount !== null &&
    salary !== null &&
    Number(currentContract.salary_amount) !== salary.amount

  // Fase 12: alerta de vencimiento del contrato vigente (categorías derivadas).
  const contractAlertTone =
    contractAlert?.alert_state === "OVERDUE" || contractAlert?.alert_state === "DUE_TODAY"
      ? "danger"
      : contractAlert?.alert_state === "NO_END_DATE"
        ? "warning"
        : "info"

  const showContractAlert =
    !isInactive &&
    !!contractAlert &&
    (contractAlert.alert_state === "NO_END_DATE" ||
      (contractAlert.days_remaining !== null && contractAlert.days_remaining <= 30))

  const lastBaja = React.useMemo(
    () => movements.find((m) => m.movement_type === "BAJA") || null,
    [movements]
  )

  // Fase 11A.3: jornada, descanso y horario resueltos desde el puesto
  const jornadaPuesto = position
    ? formatJornada({
        daily_hours: position.daily_hours,
        weekly_hours: position.weekly_hours,
        monthly_hours: position.monthly_hours,
      })
    : null
  const descansoPuesto = position ? formatBreak(position.break_minutes) : null
  const positionScheduleByDay = React.useMemo(
    () => formatScheduleByDay(positionSegments),
    [positionSegments]
  )

  const currentContractInfo: CurrentContractInfo | null = React.useMemo(() => {
    if (!currentContract) return null
    return {
      id: currentContract.id,
      typeName: currentContract.contract_type?.name ?? null,
      typeCode: currentContract.contract_type?.code ?? null,
      startDate: currentContract.start_date,
      endDate: currentContract.end_date,
    }
  }, [currentContract])

  const currentSituation: WorkerCurrentSituation = React.useMemo(
    () => ({
      positionId: position?.id ?? currentAssignment?.position_id ?? null,
      positionName: position?.name ?? null,
      positionCode: position?.code ?? null,
      jobName: job?.name ?? null,
      areaName: job?.area?.name ?? null,
      groupSequence: group?.sequence_number ?? null,
      salary: salary ?? null,
      startDate: currentAssignment?.start_date ?? null,
    }),
    [position, currentAssignment, job, group, salary]
  )

  const incompleteFields = React.useMemo(() => {
    if (!worker) return [] as string[]
    const fields: string[] = []
    if (!worker.birth_date) fields.push("fecha de nacimiento")
    if (!worker.gender_id) fields.push("sexo")
    if (!worker.marital_status_id) fields.push("estado civil")
    if (!worker.skin_color_id) fields.push("color de piel")
    if (!worker.address) fields.push("dirección")
    if (!worker.employment_start_date) fields.push("fecha de incorporación")
    return fields
  }, [worker])

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Detalles del trabajador" description="Cargando..." />
        <SiteCorpAlert type="info">Cargando...</SiteCorpAlert>
      </div>
    )
  }

  if (error || !worker) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Detalles del trabajador" />
        <SiteCorpAlert type="danger" title="Error">
          {error || "Trabajador no encontrado"}
        </SiteCorpAlert>
        <SiteCorpButton variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver
        </SiteCorpButton>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Detalles del trabajador"
        actions={
          <SiteCorpButton variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </SiteCorpButton>
        }
      />

      {incompleteFields.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-sitecorp-warning/40 bg-sitecorp-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-sitecorp-warning" />
          <div>
            <p className="text-sm font-semibold text-sitecorp-warning">Información incompleta</p>
            <p className="text-sm text-ink">
              Faltan estos datos: {incompleteFields.join(", ")}. Completa la ficha desde «Editar».
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="resumen" className="w-full">
        <SiteCorpTabsList className="mb-4">
          <SiteCorpTabTrigger value="resumen">Resumen</SiteCorpTabTrigger>
          <SiteCorpTabTrigger value="contratacion">
            Contratación
            {pendingContractAddendums.length > 0 && (
              <span className="ml-2 rounded-full bg-sitecorp-warning/10 px-2 py-0.5 text-xs font-semibold text-sitecorp-warning">
                {pendingContractAddendums.length}
              </span>
            )}
          </SiteCorpTabTrigger>
          <SiteCorpTabTrigger value="documentos">Documentos</SiteCorpTabTrigger>
          {canViewVacations && <SiteCorpTabTrigger value="vacaciones">Vacaciones</SiteCorpTabTrigger>}
          {canViewMedicalCerts && <SiteCorpTabTrigger value="medical-certificates">Certificados médicos</SiteCorpTabTrigger>}
        </SiteCorpTabsList>

        <TabsContent value="resumen" className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Datos personales */}
        <SiteCorpCard>
          <div className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">Datos personales</h3>
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setEditForm(worker)
                    setEditDialogOpen(true)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
                  aria-label="Editar trabajador"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Nombre completo</dt>
                <dd className="text-sm font-medium text-ink">{fullName(worker)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Código</dt>
                <dd className="text-sm font-mono text-ink">{worker.code}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Carné de identidad</dt>
                <dd className="text-sm text-ink">{worker.identification}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Fecha de nacimiento</dt>
                <dd className="text-sm text-ink">{worker.birth_date || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Sexo</dt>
                <dd className="text-sm text-ink">
                  {worker.gender_id
                    ? genders.find(g => g.id === worker.gender_id)?.name
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Estado civil</dt>
                <dd className="text-sm text-ink">
                  {worker.marital_status_id
                    ? maritalStatuses.find(m => m.id === worker.marital_status_id)?.name
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Nivel educacional</dt>
                <dd className="text-sm text-ink">
                  {worker.education_level_id
                    ? educationLevels.find(e => e.id === worker.education_level_id)?.name
                    : "—"}
                </dd>
              </div>
              {worker.specialty && (
                <div>
                  <dt className="text-xs text-muted-foreground">Especialidad</dt>
                  <dd className="text-sm text-ink">{worker.specialty}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Formación académica adicional</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {worker.has_masters_degree || worker.has_doctorate_degree ? (
                    <>
                      {worker.has_masters_degree && (
                        <span className="inline-flex items-center rounded-full border border-sitecorp-primary/30 bg-sitecorp-primary/5 px-2.5 py-1 text-xs font-semibold text-sitecorp-primary">
                          Máster
                        </span>
                      )}
                      {worker.has_doctorate_degree && (
                        <span className="inline-flex items-center rounded-full border border-sitecorp-primary/30 bg-sitecorp-primary/5 px-2.5 py-1 text-xs font-semibold text-sitecorp-primary">
                          Doctor
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-ink">Ninguna</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Color de piel</dt>
                <dd className="text-sm text-ink">
                  {worker.skin_color_id
                    ? skinColors.find(s => s.id === worker.skin_color_id)?.name || "No especificado"
                    : "No especificado"}
                </dd>
              </div>
            </dl>

            {worker.address && (
              <div className="mt-4">
                <dt className="text-xs text-muted-foreground">Dirección</dt>
                <dd className="text-sm text-ink">{worker.address}</dd>
                {worker.province && worker.municipality && (
                  <dd className="text-xs text-muted-foreground">
                    {worker.municipality}, {worker.province}
                  </dd>
                )}
              </div>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {worker.phone && (
                <div>
                  <dt className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> Teléfono
                  </dt>
                  <dd className="text-sm text-ink">{worker.phone}</dd>
                </div>
              )}
              {worker.email && (
                <div>
                  <dt className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" /> Email
                  </dt>
                  <dd className="text-sm text-ink">{worker.email}</dd>
                </div>
              )}
            </div>
          </div>
        </SiteCorpCard>

        {/* Fase 11A.4: información profesional de la persona (no del cargo ni del puesto) */}
        <SiteCorpCard>
          <div className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">Información profesional</h3>
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setEditForm(worker)
                    setEditDialogOpen(true)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
                  aria-label="Editar información profesional"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Profesión u oficio</dt>
                <dd className="text-sm font-medium text-ink">
                  {worker.profession_or_trade || "No especificado"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Licencias de conducción</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {workerLicenseLabels.length === 0 ? (
                    <span className="text-sm text-ink">Sin licencia</span>
                  ) : (
                    workerLicenseLabels.map((label) => (
                      <span
                        key={label}
                        className="inline-flex items-center rounded-full border border-sitecorp-primary/30 bg-sitecorp-primary/5 px-2.5 py-1 text-xs font-semibold text-sitecorp-primary"
                      >
                        {label}
                      </span>
                    ))
                  )}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-xs text-muted-foreground">
              Estos datos pertenecen a la persona y se inicializaron desde el candidato al
              contratar. No dependen del cargo, del puesto ni del contrato.
            </p>
          </div>
        </SiteCorpCard>

        {/* Datos laborales */}
        <SiteCorpCard>
          <div className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-ink">Datos laborales</h3>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  {!isInactive && currentAssignment && (
                    <>
                      <SiteCorpButton
                        type="button"
                        variant="outline"
                        onClick={() => setChangePositionOpen(true)}
                      >
                        <ArrowRightLeft className="mr-2 h-4 w-4" /> Cambiar de puesto
                      </SiteCorpButton>
                      <SiteCorpButton
                        type="button"
                        variant="outline"
                        onClick={() => setSeparateOpen(true)}
                      >
                        <UserMinus className="mr-2 h-4 w-4" /> Dar de baja
                      </SiteCorpButton>
                    </>
                  )}
                  {isInactive && (
                    <SiteCorpButton type="button" onClick={() => setReincorporateOpen(true)}>
                      <UserPlus className="mr-2 h-4 w-4" /> Reincorporar
                    </SiteCorpButton>
                  )}
                </div>
              )}
            </div>

            <dl className="grid gap-4">
              <div>
                <dt className="text-xs text-muted-foreground">Estado laboral</dt>
                <dd>
                  <SiteCorpStatusBadge status={worker.employment_status === "active" ? "success" : "neutral"}>
                    {worker.employment_status === "active" ? "Activo" : "Inactivo"}
                  </SiteCorpStatusBadge>
                </dd>
              </div>
              <div>
                              <dt className="text-xs text-muted-foreground">Fecha de incorporación</dt>
                              <dd className="text-sm text-ink">{worker.hire_date}</dd>
                            </div>
              
                            <div>
                              <dt className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="h-3 w-3" /> Antigüedad
                              </dt>
                              <dd className="text-sm font-medium text-ink">
                                {tenure ? tenure.humanDescription : "No disponible"}
                              </dd>
                              {tenurePayment && tenurePayment.amount !== null ? (
                                <dd className="text-xs text-muted-foreground">
                                  Pago por antigüedad: {tenurePayment.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} CUP
                                </dd>
                              ) : tenure ? (
                                <dd className="text-xs text-muted-foreground italic">
                                  Pago por antigüedad: No configurado
                                </dd>
                              ) : null}
                            </div>

                            {academicPayment && (
                              <div>
                                <dt className="text-xs text-muted-foreground">
                                  Pago por categoría académica
                                </dt>
                                <dd className="text-sm text-ink">
                                  {academicCategoryLabel(academicPayment.category)}
                                </dd>
                                <dd className="text-xs text-muted-foreground">
                                  {academicPayment.category === null
                                    ? "Importe: 0.00 CUP"
                                    : academicPayment.configured
                                      ? `Importe: ${formatAcademicAmount(academicPayment.amount)}`
                                      : "Importe: No configurado"}
                                </dd>
                              </div>
                            )}
              
                            {position ? (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {isInactive ? "Último puesto" : "Puesto actual"}
                    </dt>
                    <dd className="text-sm font-medium text-ink">{position.name}</dd>
                    <dd className="text-xs text-muted-foreground">{position.code}</dd>
                  </div>
                  {job && (
                    <>
                      <div>
                        <dt className="text-xs text-muted-foreground">Cargo</dt>
                        <dd className="text-sm text-ink">{job.name}</dd>
                      </div>
                      {job.area && (
                        <div>
                          <dt className="text-xs text-muted-foreground">Área</dt>
                          <dd className="text-sm text-ink">{job.area.name}</dd>
                        </div>
                      )}
                      {group && (
                        <div>
                          <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
                          <dd className="text-sm text-ink">
                            Grupo {toRomanNumeral(group.sequence_number)}
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt className="text-xs text-muted-foreground">Escala salarial</dt>
                        <dd className="text-sm text-ink">
                          {applicableScaleName || (
                            <span className="italic text-muted-foreground">
                              Sin escala configurada
                            </span>
                          )}
                        </dd>
                      </div>
                      {salary ? (
                        <div>
                          <dt className="text-xs text-muted-foreground">Salario base</dt>
                          <dd className="text-sm font-medium text-ink">{formatSalary(salary)}</dd>
                        </div>
                      ) : (
                        <div>
                          <dt className="text-xs text-muted-foreground">Salario base</dt>
                          <dd className="text-sm text-muted-foreground italic">
                            Salario no configurado
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Retribución total contractual
                        </dt>
                        <dd className="text-sm font-medium text-ink">
                          {formalizedConditions?.total_compensation != null ? (
                            formatContractMoney(
                              formalizedConditions.total_compensation,
                              formalizedConditions.currency_code || salary?.currency_code || "CUP"
                            )
                          ) : (
                            <span className="italic text-muted-foreground">
                              Sin contrato formalizado
                            </span>
                          )}
                        </dd>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div>
                  <dt className="text-xs text-muted-foreground">Puesto actual</dt>
                  <dd className="text-sm text-muted-foreground">— Sin asignación —</dd>
                </div>

              )}
            </dl>

            {/* Información laboral del puesto (Fase 11A.3): se resuelve desde el
                puesto vigente, nunca se copia al trabajador. */}
            {position && (
              <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Información laboral del puesto
                </p>
                <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Lugar de trabajo</dt>
                    <dd className="text-sm text-ink">
                      {position.work_location || NO_WORK_INFO_LABEL}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Jornada</dt>
                    <dd className="text-sm text-ink">{jornadaPuesto || NO_WORK_INFO_LABEL}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Descanso</dt>
                    <dd className="text-sm text-ink">{descansoPuesto || NO_WORK_INFO_LABEL}</dd>
                  </div>
                  <div className="sm:col-span-3">
                    <dt className="text-xs text-muted-foreground">Horario habitual</dt>
                    <dd className="text-sm text-ink">
                      {positionScheduleByDay.length === 0 ? (
                        NO_WORK_INFO_LABEL
                      ) : (
                        <ul className="space-y-0.5">
                          {positionScheduleByDay.map((row) => (
                            <li key={row.day}>
                              <span className="font-medium">{row.day}</span>{" "}
                              <span className="text-muted-foreground">{row.ranges}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                  {position.schedule_notes && (
                    <div className="sm:col-span-3">
                      <dt className="text-xs text-muted-foreground">Observaciones del horario</dt>
                      <dd className="text-sm text-ink">{position.schedule_notes}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

          </div>
        </SiteCorpCard>
      </div>

      {/* Información de baja (trabajador inactivo) */}
      {isInactive && (
        <SiteCorpCard>
          <div className="p-6">
            <h3 className="mb-4 text-lg font-semibold text-ink">Información de baja</h3>
            {lastBaja ? (
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Fecha</dt>
                  <dd className="text-sm font-medium text-ink">{lastBaja.effective_date}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Motivo</dt>
                  <dd className="text-sm font-medium text-ink">
                    {lastBaja.separation_reason?.name || lastBaja.reason || "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Observaciones</dt>
                  <dd className="text-sm text-ink">{lastBaja.notes || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Registrado por</dt>
                  <dd className="text-sm text-ink">{lastBaja.authorName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Registrado el</dt>
                  <dd className="text-sm text-ink">
                    {new Date(lastBaja.created_at).toLocaleString("es-CU")}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sin información de baja registrada.
              </p>
            )}
          </div>
        </SiteCorpCard>
      )}

      {/* Historial laboral */}
      <SiteCorpCard>
        <div className="p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">Trayectoria laboral</h3>
          {sortedAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {sortedAssignments.map((a) => (
                <li key={a.id} className="relative">
                  <span
                    className={`absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-background ${
                      a.is_current && !a.end_date ? "bg-sitecorp-success" : "bg-muted-foreground/50"
                    }`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {a.position?.name || "Puesto"}
                    </span>
                    {a.position?.code && (
                      <span className="text-xs text-muted-foreground">{a.position.code}</span>
                    )}
                    {a.is_current && !a.end_date && (
                      <SiteCorpStatusBadge status="success">Actual</SiteCorpStatusBadge>
                    )}
                  </div>
                  {a.position?.job && (
                    <p className="text-xs text-muted-foreground">
                      {a.position.job.name}
                      {a.position.job.area?.name ? ` · ${a.position.job.area.name}` : ""}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Desde {a.start_date}
                    {a.end_date ? ` hasta ${a.end_date}` : " · en curso"}
                  </p>
                </li>
              ))}
            </ol>
          )}

        </div>
      </SiteCorpCard>

        </TabsContent>

        <TabsContent value="contratacion" className="space-y-6">
          {/* Alerta de vencimiento contractual (Fase 12) */}
          {showContractAlert && contractAlert && (
            <div
              className={'rounded-xl border p-3 ' + (
                contractAlertTone === 'danger'
                  ? 'border-sitecorp-danger/30 bg-sitecorp-danger/5'
                  : contractAlertTone === 'warning'
                    ? 'border-sitecorp-warning/30 bg-sitecorp-warning/5'
                    : 'border-sitecorp-primary/30 bg-sitecorp-primary/5'
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
                <SiteCorpStatusBadge
                  status={
                    contractAlert.alert_state === 'NO_END_DATE'
                      ? 'warning'
                      : CONTRACT_ALERT_META[contractAlert.alert_state].badge
                  }
                >
                  {contractAlert.alert_state === 'NO_END_DATE'
                    ? 'Requiere corrección'
                    : CONTRACT_ALERT_META[contractAlert.alert_state].label}
                </SiteCorpStatusBadge>
                <span className="text-sm font-medium text-ink">
                  {contractAlert.alert_state === 'NO_END_DATE'
                    ? 'Contrato determinado sin fecha de finalización'
                    : deadlineLabel(contractAlert.days_remaining, contractAlert.contract_end_date)}
                </span>
              </div>
            </div>
          )}

          {/* Contrato vigente con condiciones formalizadas (§8) */}
          <CurrentContractSummary
            hasContract={!!currentContract}
            isInactive={isInactive}
            contractTypeName={currentContract?.contract_type?.name ?? null}
            contractStartDate={currentContract?.start_date ?? null}
            contractEndDate={currentContract?.end_date ?? null}
            representativeName={currentContract?.representative_name_snapshot ?? null}
            representativePosition={currentContract?.representative_position_snapshot ?? null}
            formalized={formalizedConditions}
            currentSalaryAmount={salary?.amount ?? null}
            currentSalaryCurrency={salary?.currency_code ?? null}
            alert={contractAlert}
            canManage={canManage}
            onRegisterContract={() => {
              setActionError(null)
              setContractForm({
                contractTypeId: "",
                startDate: worker.hire_date || "",
                endDate: "",
                representativeAssignmentId: null,
                signatureDate: "",
                signaturePlace: "",
                paymentMethodId: "",
                paymentSchedule: "",
                components: [],
              })
              setFormalizationPending(null)
              setContractDialogOpen(true)
            }}
            onChangeContract={() => setChangeContractOpen(true)}
            onSeparate={() => setSeparateOpen(true)}
          />

          {/* Fase 11A.6: contratos y anexos al contrato (§51) */}
          <ContractAddendumsSection
            workerId={worker.id}
            entityId={entityId as string}
            canManage={canManage}
            addendums={addendums}
            contracts={sortedContracts.map((c) => ({
              id: c.id,
              typeName: c.contract_type?.name ?? null,
              startDate: c.start_date,
              endDate: c.end_date,
              isCurrent: !!c.is_current,
            }))}
            conditions={contractualConditions}
            operational={{
              jobName: job?.name ?? null,
              positionName: position?.name ?? null,
              groupSequence: group?.sequence_number ?? null,
              salaryAmount: salary?.amount ?? null,
              salaryCurrency: salary?.currency_code ?? null,
            }}
            paymentMethods={paymentMethods}
            onChanged={loadWorker}
          />

          {/* Histórico contractual cronológico (§9/§10) */}
          <ContractualTimeline
            contracts={sortedContracts.map((c) => ({
              id: c.id,
              typeName: c.contract_type?.name ?? null,
              startDate: c.start_date,
              endDate: c.end_date,
              isCurrent: !!c.is_current,
            }))}
            addendums={addendums}
            onOpenAddendum={(id) => {
              setTimelineAddendumId(id)
              setTimelineDetailOpen(true)
            }}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Salario operativo actual (derivado, nunca almacenado en el trabajador) */}
            <SiteCorpCard
              title="Salario actual"
              description="Derivado del puesto, cargo y escala salarial vigentes"
            >
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
                  <dd className="text-sm text-ink">
                    {group ? `Grupo ${toRomanNumeral(group.sequence_number)}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Wallet className="h-3 w-3" /> Importe vigente
                  </dt>
                  <dd className="text-sm font-medium text-ink">
                    {salary ? formatSalary(salary) : "Sin salario configurado"}
                  </dd>
                  {salary?.effective_from && (
                    <p className="text-xs text-muted-foreground">
                      Vigente desde {formatContractDate(salary.effective_from)}
                    </p>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Cargo</dt>
                  <dd className="text-sm text-ink">{job?.name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Puesto</dt>
                  <dd className="text-sm text-ink">
                    {isInactive ? "Último puesto: " : ""}
                    {position?.name || "—"}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Se resuelve dinámicamente desde el valor vigente de la escala aplicable a la fecha
                actual. No se almacena como salario del trabajador.
              </p>
            </SiteCorpCard>

            {/* Snapshot contractual histórico */}
            <SiteCorpCard
              title="Salario del contrato"
              description="Snapshot histórico registrado al crear el contrato vigente"
            >
              {!currentContract ? (
                <p className="text-sm text-muted-foreground">
                  Sin contrato vigente registrado para este trabajador.
                </p>
              ) : currentContract.salary_snapshot_status === "CAPTURED" &&
                currentContract.salary_amount !== null ? (
                <>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Importe del contrato</dt>
                      <dd className="text-sm font-medium text-ink">
                        {formatSalary({
                          amount: Number(currentContract.salary_amount),
                          currency_code: currentContract.salary_currency_code || "",
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Fecha de vigencia</dt>
                      <dd className="text-sm text-ink">
                        {formatContractDate(currentContract.salary_effective_date)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Tipo de contrato</dt>
                      <dd className="text-sm text-ink">
                        {currentContract.contract_type?.name || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Inicio del contrato</dt>
                      <dd className="text-sm text-ink">
                        {formatContractDate(currentContract.start_date)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {contractSalaryDiffers
                      ? "El contrato conserva el importe histórico con el que se firmó: las modificaciones posteriores de la escala no lo sobrescriben."
                      : "Coincide con el salario actual vigente."}
                  </p>

                  {/* Fase 11A.5: retribución formalizada (salario de escala + conceptos + total) */}
                  <ContractRetributionSummary
                    className="mt-3 bg-background"
                    title="Retribución formalizada en este contrato"
                    salaryAmount={currentContract.salary_amount}
                    salaryCurrencyCode={currentContract.salary_currency_code}
                    salarySnapshotStatus={currentContract.salary_snapshot_status}
                    salaryEffectiveDate={currentContract.salary_effective_date}
                    totalCompensationSnapshot={currentContract.total_compensation_snapshot}
                    components={componentsByContract[currentContract.id] || []}
                    capturedAt={currentContract.conditions_captured_at}
                    salaryGroupSequence={currentContract.salary_group?.sequence_number ?? null}
                  />
                </>
              ) : (
                <SiteCorpAlert type="warning" title="Salario del contrato no reconstruible">
                  No fue posible determinar de forma fiable el importe salarial correspondiente al
                  momento del contrato. No se ha registrado ningún valor inventado.
                </SiteCorpAlert>
              )}
            </SiteCorpCard>
          </div>

          {/* Historial salarial */}
          <SiteCorpCard
            title="Historial salarial"
            description="Evolución registrada del salario del trabajador (histórico: no se recalcula)"
          >
            {salaryHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin histórico salarial registrado para este trabajador.
              </p>
            ) : (
              <ol className="relative space-y-4 border-l border-border pl-5">
                {salaryHistory.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span
                      className={`absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-background ${
                        entry.previous_amount === null
                          ? "bg-sitecorp-success"
                          : "bg-sitecorp-primary"
                      }`}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {formatContractDate(entry.effective_date)}
                      </span>
                      <SiteCorpStatusBadge status="neutral">
                        {SALARY_CHANGE_TYPE_LABELS[entry.change_type] || entry.change_type}
                      </SiteCorpStatusBadge>
                      {entry.group_sequence_number !== null && (
                        <span className="text-xs text-muted-foreground">
                          Grupo {toRomanNumeral(entry.group_sequence_number)}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-ink">
                      {entry.previous_amount === null ? (
                        <>
                          Salario inicial:{" "}
                          <span className="font-medium">
                            {formatSalary({
                              amount: Number(entry.new_amount),
                              currency_code: entry.currency_code,
                            })}
                          </span>
                        </>
                      ) : (
                        <>
                          {formatSalary({
                            amount: Number(entry.previous_amount),
                            currency_code: entry.currency_code,
                          })}{" "}
                          →{" "}
                          <span className="font-medium">
                            {formatSalary({
                              amount: Number(entry.new_amount),
                              currency_code: entry.currency_code,
                            })}
                          </span>
                        </>
                      )}
                    </p>
                    {entry.notes && (
                      <p className="text-xs text-muted-foreground">{entry.notes}</p>
                    )}
                    {entry.addendums.map((addendum) => (
                      <p
                        key={addendum.id}
                        className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span>
                          Anexo al contrato
                          {addendum.addendum_number ? ` Nº ${addendum.addendum_number}` : ""}
                        </span>
                        <SiteCorpStatusBadge
                          status={ADDENDUM_STATUS_BADGE[addendum.status] || "neutral"}
                        >
                          {ADDENDUM_STATUS_LABELS[addendum.status] || addendum.status}
                        </SiteCorpStatusBadge>
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
            )}
          </SiteCorpCard>

        </TabsContent>

        <TabsContent value="documentos" className="space-y-6">
          <SiteCorpCard>
            <WorkerDocumentsTab workerId={worker.id} canManage={canManage} />
          </SiteCorpCard>
        </TabsContent>

        {canViewVacations && (
          <TabsContent value="vacaciones" className="space-y-6">
            <WorkerVacationsTab
              workerId={worker.id}
              entityId={entityId as string}
              workerName={fullName(worker)}
              canManage={canManageVacations}
            />
          </TabsContent>
        )}

        {canViewMedicalCerts && (
          <TabsContent value="medical-certificates" className="space-y-6">
            <WorkerMedicalCertificatesTab
              workerId={worker.id}
              entityId={entityId as string}
              canManage={canManageMedicalCerts}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Diálogo de edición */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
            <DialogTitle>Editar trabajador</DialogTitle>
            <DialogDescription>Modifica los datos personales y laborales del trabajador.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleEditSave()
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <SiteCorpInput
                  value={editForm.first_name || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Primer apellido</Label>
                <SiteCorpInput
                  value={editForm.first_surname || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, first_surname: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Segundo apellido</Label>
                <SiteCorpInput
                  value={editForm.second_surname || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, second_surname: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Carné de identidad</Label>
                <SiteCorpInput
                  value={editForm.identification || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, identification: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Fecha de nacimiento</Label>
                <SiteCorpInput
                  type="date"
                  value={editForm.birth_date || ""}
                  onChange={(e) => setEditForm(f => ({ ...f, birth_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Sexo</Label>
                <SiteCorpSelect
                  value={editForm.gender_id || ""}
                  onValueChange={(v) => setEditForm(f => ({ ...f, gender_id: v }))}
                >
                  <option value="">Seleccionar</option>
                  {genders.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </SiteCorpSelect>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Estado civil</Label>
                <SiteCorpSelect
                  value={editForm.marital_status_id || ""}
                  onValueChange={(v) => setEditForm(f => ({ ...f, marital_status_id: v }))}
                >
                  <option value="">Seleccionar</option>
                  {maritalStatuses.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-2">
                <Label>Nivel educacional</Label>
                <SiteCorpSelect
                  value={editForm.education_level_id || ""}
                  onValueChange={(v) => setEditForm(f => ({ ...f, education_level_id: v }))}
                >
                  <option value="">Seleccionar</option>
                  {educationLevels.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </SiteCorpSelect>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Especialidad</Label>
              <SiteCorpInput
                value={editForm.specialty || ""}
                onChange={(e) => setEditForm(f => ({ ...f, specialty: e.target.value }))}
              />
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
                hasMastersDegree={!!editForm.has_masters_degree}
                hasDoctorateDegree={!!editForm.has_doctorate_degree}
                onMastersChange={(checked) =>
                  setEditForm((f) => ({ ...f, has_masters_degree: checked }))
                }
                onDoctorateChange={(checked) =>
                  setEditForm((f) => ({ ...f, has_doctorate_degree: checked }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Color de piel</Label>
              <SiteCorpSelect
                value={editForm.skin_color_id || ""}
                onValueChange={(v) => setEditForm(f => ({ ...f, skin_color_id: v }))}
              >
                <option value="">Seleccionar</option>
                {skinColors.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </SiteCorpSelect>
            </div>

            {/* Fase 11A.4: información profesional de la persona */}
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium text-ink">Información profesional</p>
            </div>

            <div className="space-y-2">
              <Label>Profesión u oficio *</Label>
              <SiteCorpInput
                value={editForm.profession_or_trade || ""}
                onChange={(e) => setEditForm(f => ({ ...f, profession_or_trade: e.target.value }))}
                placeholder="Ej.: Chofer profesional"
                required
              />
            </div>

            <DrivingLicenseSelector
              categories={licenseCategories}
              value={licenseIds}
              onChange={setLicenseIds}
            />

            <div className="space-y-2">
              <Label>Dirección particular *</Label>
              <SiteCorpInput
                value={editForm.address || ""}
                onChange={(e) => setEditForm(f => ({ ...f, address: e.target.value }))}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Provincia *</Label>
                <SiteCorpSelect
                  value={editForm.province || ""}
                  onValueChange={(v) => setEditForm(f => ({ ...f, province: v, municipality: "" }))}
                >
                  <option value="">Seleccionar provincia</option>
                  {CUBA_PROVINCES_FULL.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-2">
                <Label>Municipio *</Label>
                <SiteCorpSelect
                  value={editForm.municipality || ""}
                  onValueChange={(v) => setEditForm(f => ({ ...f, municipality: v }))}
                  disabled={!editForm.province}
                >
                  <option value="">Seleccionar municipio</option>
                  {(MUNICIPIOS_BY_PROVINCE_FULL[editForm.province || ""] || []).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </SiteCorpSelect>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Teléfono</Label>
              <SiteCorpInput
                value={editForm.phone || ""}
                onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <SiteCorpInput
                type="email"
                value={editForm.email || ""}
                onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>

            </div>

            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              <SiteCorpButton variant="outline" type="button" onClick={() => setEditDialogOpen(false)}>
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit">Guardar cambios</SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo de registro de contrato */}
      <Dialog open={contractDialogOpen} onOpenChange={setContractDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Registrar contrato</DialogTitle>
            <DialogDescription>
              Registra un contrato de trabajo para el puesto actual del trabajador, con sus
              condiciones formalizadas (firma, forma de pago, representante y retribución).
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleRegisterContract()
            }}
            className="space-y-4"
          >
            {actionError && <SiteCorpAlert type="danger">{actionError}</SiteCorpAlert>}

            <div className="space-y-2">
              <Label>Tipo de contrato *</Label>
              <SiteCorpSelect
                value={contractForm.contractTypeId}
                onValueChange={(v) => setContractForm(f => ({ ...f, contractTypeId: v }))}
              >
                <option value="">Seleccionar tipo</option>
                {contractTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </SiteCorpSelect>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Inicio del contrato</Label>
                <SiteCorpInput
                  type="date"
                  value={contractForm.startDate}
                  onChange={(e) => setContractForm(f => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Fin del contrato
                  {contractTypes.find(t => t.id === contractForm.contractTypeId)?.code === "DETERMINADO"
                    ? " *"
                    : ""}
                </Label>
                <SiteCorpInput
                  type="date"
                  value={contractForm.endDate}
                  onChange={(e) => setContractForm(f => ({ ...f, endDate: e.target.value }))}
                  disabled={
                    contractTypes.find(t => t.id === contractForm.contractTypeId)?.code !== "DETERMINADO"
                  }
                />
              </div>
            </div>

            {/* Fase 11A.5/11A.7: condiciones formalizadas del contrato */}
            <ContractSignatureFields
              signatureDate={contractForm.signatureDate}
              onSignatureDateChange={(value) =>
                setContractForm((f) => ({ ...f, signatureDate: value }))
              }
              signaturePlace={contractForm.signaturePlace}
              onSignaturePlaceChange={(value) =>
                setContractForm((f) => ({ ...f, signaturePlace: value }))
              }
              paymentMethodId={contractForm.paymentMethodId}
              onPaymentMethodIdChange={(value) =>
                setContractForm((f) => ({ ...f, paymentMethodId: value }))
              }
              paymentMethods={paymentMethods}
              paymentSchedule={contractForm.paymentSchedule}
              onPaymentScheduleChange={(value) =>
                setContractForm((f) => ({ ...f, paymentSchedule: value }))
              }
            />

            <ContractFormalizationAlerts
              entityId={entityId || ""}
              positionId={position?.id ?? null}
              signatureDate={contractForm.signatureDate || null}
              signaturePlace={contractForm.signaturePlace || null}
              paymentMethodId={contractForm.paymentMethodId || null}
              representativeAssignmentId={contractForm.representativeAssignmentId}
              canManage={canManage}
              onPendingChange={setFormalizationPending}
            />

            <RepresentativeSelect
              entityId={entityId || ""}
              onDate={contractForm.signatureDate}
              value={contractForm.representativeAssignmentId}
              onChange={(assignmentId) =>
                setContractForm((f) => ({ ...f, representativeAssignmentId: assignmentId }))
              }
              canManage={canManage}
              label="Representante que suscribe el contrato *"
              dateHint={`Representante vigente en la fecha de firma (${formatConditionDate(
                contractForm.signatureDate
              )}).`}
              onOptionsChange={setRepresentatives}
            />

            <ContractRetributionFields
              components={contractForm.components}
              onComponentsChange={(next) => setContractForm((f) => ({ ...f, components: next }))}
              baseSalaryAmount={salary?.amount ?? null}
              baseSalaryCurrency={salary?.currency_code ?? null}
              salaryGroupSequence={group?.sequence_number ?? null}
              disabled={!position}
            />

            <ContractFormalizationSummary
              workerName={fullName(worker)}
              personIdentification={worker.identification}
              positionName={position?.name || ""}
              jobName={job?.name || null}
              areaName={job?.area?.name || null}
              contractTypeName={
                contractTypes.find((t) => t.id === contractForm.contractTypeId)?.name || null
              }
              startDate={contractForm.startDate || worker.hire_date}
              endDate={
                contractTypes.find((t) => t.id === contractForm.contractTypeId)?.code ===
                "DETERMINADO"
                  ? contractForm.endDate || null
                  : null
              }
              signatureDate={contractForm.signatureDate}
              signaturePlace={contractForm.signaturePlace}
              paymentMethodName={
                paymentMethods.find((m) => m.id === contractForm.paymentMethodId)?.name || null
              }
              representativeName={
                representatives.find(
                  (row) => row.assignment_id === contractForm.representativeAssignmentId
                )?.person_name || null
              }
              representativeTitle={
                representatives.find(
                  (row) => row.assignment_id === contractForm.representativeAssignmentId
                )?.title || null
              }
              baseSalaryAmount={salary?.amount ?? null}
              baseSalaryCurrency={salary?.currency_code ?? null}
              salaryGroupSequence={group?.sequence_number ?? null}
              components={contractForm.components}
            />

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                variant="outline"
                type="button"
                onClick={() => setContractDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                type="submit"
                disabled={
                  contractSubmitting ||
                  !contractForm.representativeAssignmentId ||
                  !contractForm.signatureDate ||
                  !contractForm.signaturePlace.trim() ||
                  !contractForm.paymentMethodId ||
                  hasInvalidComponent(contractForm.components) ||
                  (formalizationPending || EMPTY_FORMALIZATION_PENDING).blocking.length > 0
                }
              >
                {contractSubmitting ? "Registrando..." : "Registrar contrato"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo de cambio de puesto */}
      <ChangePositionDialog
        open={changePositionOpen}
        onOpenChange={setChangePositionOpen}
        workerId={worker.id}
        entityId={entityId as string}
        current={currentSituation}
        onSuccess={loadWorker}
      />

      {/* Diálogo de baja */}
      <SeparateWorkerDialog
        open={separateOpen}
        onOpenChange={setSeparateOpen}
        workerId={worker.id}
        current={currentSituation}
        onSuccess={loadWorker}
      />

      {/* Diálogo de reincorporación */}
      <ReincorporateWorkerDialog
        open={reincorporateOpen}
        onOpenChange={setReincorporateOpen}
        workerId={worker.id}
        entityId={entityId as string}
        onSuccess={loadWorker}
      />

      {/* Diálogo de cambio de contrato */}
      {currentContractInfo && (
        <ChangeContractDialog
          open={changeContractOpen}
          onOpenChange={setChangeContractOpen}
          workerId={worker.id}
          entityId={entityId as string}
          current={currentContractInfo}
          workerName={fullName(worker)}
          workerIdentification={worker.identification}
          positionId={position?.id ?? null}
          positionName={position?.name ?? null}
          jobName={job?.name ?? null}
          areaName={job?.area?.name ?? null}
          salaryGroupSequence={group?.sequence_number ?? null}
          baseSalaryAmount={salary?.amount ?? null}
          baseSalaryCurrency={salary?.currency_code ?? null}
          onSuccess={loadWorker}
        />
      )}

      {/* Detalle del anexo abierto desde el histórico contractual */}
      <AddendumDetailDialog
        open={timelineDetailOpen}
        onOpenChange={setTimelineDetailOpen}
        addendum={addendums.find((row) => row.id === timelineAddendumId) || null}
        entityId={entityId as string}
        canManage={canManage}
        onChanged={loadWorker}
      />
    </div>
  )
}

export default WorkerDetail

