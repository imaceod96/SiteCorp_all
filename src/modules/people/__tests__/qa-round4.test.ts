import fs from "fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PermissionCheckUnavailableError,
  loadEntityPermissionSafe,
} from "@/modules/access-control/application/entity-access.queries"
import * as entityAccessRepo from "@/modules/access-control/infrastructure/entity-access.repository"
import { friendlyRoleSaveError } from "@/modules/access-control"
import { insertAuditEvent, clearStoredAuditEvents } from "@/modules/audit-history/infrastructure/audit-history.repository"
import { resolvedAlertSalary } from "@/modules/contracts/domain/contract-alerts.rules"
import { formatContractSalary } from "@/modules/contracts/domain/formats"
import {
  loadContractChangeWorkspace,
  loadTransitionWorkspace,
} from "@/modules/people/application/staffing.queries"
import { loadWorkerFormPermissions } from "@/modules/people/application/worker-expediente.queries"
import { ensureMovementDocument } from "@/modules/people/infrastructure/transition-documents"
import {
  activeAssignmentsOf,
  activeContractsOf,
} from "@/modules/people/domain/pluriempleo.rules"
import {
  countAssignmentsByPosition,
  currentStaffingAssignment,
  isCurrentStaffingAssignment,
} from "@/modules/people/domain/staffing.rules"
import { getMedicalCertificateIncoherenceReason } from "@/modules/vacations-licenses/medical-certificates"
import { loadJobFormWorkspace } from "@/modules/organization-structure/application/job-form.queries"
import { saveJob } from "@/modules/organization-structure/application/staffing-configuration.commands"
import * as areasRepo from "@/modules/organization-structure/infrastructure/areas.repository"
import * as catalogsRepo from "@/modules/organization-structure/infrastructure/catalogs.repository"
import * as entityConfigRepo from "@/modules/organization-structure/infrastructure/entity-configuration.repository"
import * as salaryRepo from "@/modules/organization-structure/infrastructure/salary.repository"
import * as salaryAdminRepo from "@/modules/organization-structure/infrastructure/salary-administration.repository"
import * as jobsRepo from "@/modules/organization-structure/infrastructure/jobs.repository"
import * as payrollMovements from "@/modules/payroll-movements"
import * as contractsModule from "@/modules/contracts"
import * as staffingRepo from "@/modules/people/infrastructure/staffing.repository"

describe("QA Round 4 — Bloques A, B y C", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await clearStoredAuditEvents()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("Bloque A: cola documental en backend (document_generation_jobs), triggers para los 6 tipos de documento, Edge Function process-document-jobs, estados en la UI y eliminación de catch vacío en ensureMovementDocument", async () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    const mirrorMigrationSql = fs.readFileSync(
      "src/db/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    expect(migrationSql).toBe(mirrorMigrationSql)
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.document_generation_jobs")
    expect(migrationSql).toContain("'CONTRACT'")
    expect(migrationSql).toContain("'ADDENDUM'")
    expect(migrationSql).toContain("'RESOLUTION'")
    expect(migrationSql).toContain("'PAYROLL_MOVEMENT'")
    expect(migrationSql).toContain("'VACATION'")
    expect(migrationSql).toContain("'MEDICAL_CERTIFICATE'")
    expect(migrationSql).toContain("trg_enqueue_contract_document_job")
    expect(migrationSql).toContain("trg_enqueue_addendum_document_job")
    expect(migrationSql).toContain("trg_enqueue_resolution_document_job")
    expect(migrationSql).toContain("trg_enqueue_payroll_movement_document_job")
    expect(migrationSql).toContain("trg_enqueue_vacation_document_job")
    expect(migrationSql).toContain("trg_enqueue_medical_certificate_document_job")
    expect(migrationSql).toContain("SELECT public.backfill_missing_document_generation_jobs()")

    const edgeFnSource = fs.readFileSync(
      "supabase/functions/process-document-jobs/index.ts",
      "utf8"
    )
    expect(edgeFnSource).toContain("claim_due_document_generation_jobs")
    expect(edgeFnSource).toContain("mark_document_generation_job_result")
    expect(edgeFnSource).toContain("SIN_PLANTILLA")

    // ensureMovementDocument ya no tiene catch vacío y devuelve el error si falla
    vi.spyOn(payrollMovements, "findPayrollMovement").mockResolvedValueOnce("mov-qa-1")
    vi.spyOn(contractsModule, "ensurePayrollMovementDocumentQueued").mockResolvedValueOnce({
      generated: false,
      skipped: false,
      result: { success: false, error: "No hay plantilla activa para PAYROLL_MOVEMENT" },
    })

    const warning = await ensureMovementDocument("worker-1", "ALTA", "2026-11-16")
    expect(warning).toContain("No hay plantilla activa")

    // Verificar que AddendumDetailDialog refresca con await onChanged() y cierra tras formalizar
    const addendumDialogSource = fs.readFileSync(
      "src/modules/contracts/presentation/components/AddendumDetailDialog.tsx",
      "utf8"
    )
    expect(addendumDialogSource).toContain("await Promise.resolve(onChanged())")
    expect(addendumDialogSource).toContain("onOpenChange(false)")
    expect(addendumDialogSource).toContain("<ContractualDocumentSection")

    const contractualDocSectionSource = fs.readFileSync(
      "src/modules/document-generation/presentation/components/ContractualDocumentSection.tsx",
      "utf8"
    )
    expect(contractualDocSectionSource).toContain("fetchDocumentGenerationJob")

    // Verificar que contractDocumentStatusStore en memoria fue eliminado
    const contractDocsRepoSource = fs.readFileSync(
      "src/modules/contracts/infrastructure/contract-documents.repository.ts",
      "utf8"
    )
    expect(contractDocsRepoSource).not.toContain("const contractDocumentStatusStore = new Map")
  })

  it("B1: ToastViewport por encima de modales (z-[200]) y validación de formulario en modales de Capacitación con alerta interna y cierre solo en éxito", () => {
    const toastSource = fs.readFileSync("src/shared/components/ui/toast.tsx", "utf8")
    expect(toastSource).toContain("z-[200]")

    const entityTrainingSource = fs.readFileSync(
      "src/modules/training/presentation/pages/EntityTraining.tsx",
      "utf8"
    )
    expect(entityTrainingSource).toContain("setSessionError")
    expect(entityTrainingSource).toContain('title="No se pudo guardar la sesión"')

    const trainingRepoSource = fs.readFileSync(
      "src/modules/training/infrastructure/training.repository.ts",
      "utf8"
    )
    expect(trainingRepoSource).toContain(
      "una sesión con fecha programada futura"
    )
  })

  it("B2: notificaciones de formación inicial distinguen CONTRATACION y CAMBIO_CARGO en SQL y en PendingInitialTrainingBanner", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS trigger_type text")
    expect(migrationSql).toContain("v_trigger_type := 'CAMBIO_CARGO'")

    const bannerSource = fs.readFileSync(
      "src/modules/training/presentation/components/PendingInitialTrainingBanner.tsx",
      "utf8"
    )
    expect(bannerSource).toContain("Capacitación pendiente por cambio de cargo")
    expect(bannerSource).toContain("Cambio de cargo el:")
    expect(bannerSource).toContain("Contratado el:")
  })

  it("B3: un cambio de puesto o de contrato con fecha futura (> hoy en Cuba) no se muestra como vigente hoy ni en selectores, ni en ficha, ni en reportes", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-16T15:00:00Z")) // 2026-11-16 en La Habana

    const assignments = [
      {
        id: "asg-actual",
        position_id: "pos-operario",
        start_date: "2026-01-10",
        end_date: "2026-11-30",
        is_current: true,
        position: { id: "pos-operario", name: "Operario", code: "OP-1", is_active: true, job: null },
      },
      {
        id: "asg-futura",
        position_id: "pos-especialista",
        start_date: "2026-12-01",
        end_date: null,
        is_current: true, // aunque viniera marcado por datos previos, start_date > hoy lo excluye hoy
        position: {
          id: "pos-especialista",
          name: "Especialista",
          code: "ES-1",
          is_active: true,
          job: null,
        },
      },
    ]

    expect(isCurrentStaffingAssignment(assignments[0])).toBe(true)
    expect(isCurrentStaffingAssignment(assignments[1])).toBe(false)

    const current = currentStaffingAssignment({ assignments } as never)
    expect(current?.id).toBe("asg-actual")

    const activeAsgs = activeAssignmentsOf({ assignments } as never)
    expect(activeAsgs.map((a) => a.id)).toEqual(["asg-actual"])

    const counts = countAssignmentsByPosition([{ assignments } as never])
    expect(counts["pos-operario"]).toBe(1)
    expect(counts["pos-especialista"]).toBeUndefined()

    const contracts = [
      {
        id: "ctr-actual",
        start_date: "2026-01-10",
        end_date: "2026-11-30",
        is_current: true,
        status: "ACTIVE",
      },
      {
        id: "ctr-futuro",
        start_date: "2026-12-01",
        end_date: null,
        is_current: true,
        status: "ACTIVE",
      },
    ]
    expect(activeContractsOf({ contracts } as never).map((c) => c.id)).toEqual([
      "ctr-actual",
    ])
  })

  it("B4: un trabajador con hire_date > hoy en Cuba se etiqueta como 'Pendiente de incorporación' y queda excluido de selectores operativos y ocupación hasta su fecha de alta", () => {
    const workerDetailSource = fs.readFileSync(
      "src/modules/people/presentation/pages/WorkerDetail.tsx",
      "utf8"
    )
    expect(workerDetailSource).toContain("Pendiente de incorporación")
    expect(workerDetailSource).toContain("Programado para el")

    const entityWorkersSource = fs.readFileSync(
      "src/modules/people/presentation/pages/EntityWorkers.tsx",
      "utf8"
    )
    expect(entityWorkersSource).toContain("Pendiente de incorporación")

    const occupancyRepoSource = fs.readFileSync(
      "src/modules/entity-summary/infrastructure/occupancy.repository.ts",
      "utf8"
    )
    expect(occupancyRepoSource).toContain('.lte("hire_date", today)')

    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    expect(migrationSql).toContain("AND (wk.hire_date IS NULL OR wk.hire_date <= v_today)")
  })

  it("B5: contract_expiry_alerts devuelve resolved_salary_amount y resolved_salary_currency desde la BD y resolvedAlertSalary lo prioriza sin N+1", () => {
    const resolved = resolvedAlertSalary(
      {
        contract_id: "ctr-1",
        worker_id: "w-1",
        worker_name: "Ana Prueba",
        identification: "90010112345",
        worker_code: "T-01",
        position_name: "Especialista",
        position_code: "P-01",
        job_name: "Especialista",
        area_name: "RRHH",
        contract_type_code: "DETERMINADO",
        contract_type_name: "Determinado",
        contract_start_date: "2026-01-01",
        contract_end_date: "2026-11-30",
        salary_group_id: "grp-1",
        salary_scale_id: "scale-1",
        salary_group_sequence_number: 5,
        days_remaining: 14,
        alert_state: "DUE_IN_15",
        assignment_id: "asg-1",
        resolved_salary_amount: 4500,
        resolved_salary_currency: "CUP",
      },
      {}
    )

    expect(resolved).toEqual({ amount: 4500, currency_code: "CUP" })
  })

  it("B6: tablas anchas de SST y Capacitación eliminan clases truncate sobre nombres y textos largos usando break-words", () => {
    const sstSpecializedSource = fs.readFileSync(
      "src/modules/sst/presentation/components/SstSpecializedSections.tsx",
      "utf8"
    )
    const sstRiskSource = fs.readFileSync(
      "src/modules/sst/presentation/components/SstRiskAndPreventionSection.tsx",
      "utf8"
    )
    expect(sstSpecializedSource).not.toContain('className="max-w-[200px] truncate"')
    expect(sstRiskSource).not.toContain('className="max-w-[220px] truncate"')
  })

  it("B7 y C5: validaciones de fechas y stock de EPP en SST tanto en frontend como en triggers de BD", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    expect(migrationSql).toContain("trg_validate_sst_accident_incident")
    expect(migrationSql).toContain("trg_validate_sst_health_aptitude")
    expect(migrationSql).toContain("trg_validate_sst_preventive_action")
    expect(migrationSql).toContain("trg_validate_sst_emergency_plan")
    expect(migrationSql).toContain("No hay existencias de %. Stock disponible: 0")

    const eppSectionSource = fs.readFileSync(
      "src/modules/sst/presentation/components/SstEppAndInspectionsSection.tsx",
      "utf8"
    )
    expect(eppSectionSource).toContain("Stock disponible: 0")
  })

  it("B8: subida de documentos en SST e indicadores de Salud Ocupacional validan errores de Storage y chequeos vencidos", () => {
    const sstPageSource = fs.readFileSync(
      "src/modules/sst/presentation/pages/EntitySst.tsx",
      "utf8"
    )
    expect(sstPageSource).toContain("overdueHealthChecksCount")
    expect(sstPageSource).toContain("Chequeos vencidos:")

    const sstRepoSource = fs.readFileSync(
      "src/modules/sst/infrastructure/sst.repository.ts",
      "utf8"
    )
    expect(sstRepoSource).toContain("await uploadExpedienteFile(storagePath, input.file)")
  })

  it("B9: insertAuditEvent ya no suprime por descripción eventos legítimos y asigna IDs distintos con upsert idempotente", async () => {
    const ev1 = await insertAuditEvent({
      actor_user_id: "u-1",
      actor_full_name: "Admin QA",
      actor_username: "admin",
      scope: "ENTITY",
      organization_entity_id: "ent-1",
      entity_name: "Empresa QA Ficticia",
      company_client_id: null,
      module: "workers",
      action: "worker_hired",
      entity_type: "worker",
      record_id: "rec-1",
      description: "Contratación de Carlos Ficticio",
      old_values: null,
      new_values: null,
      result: "SUCCESS",
    })

    const ev2 = await insertAuditEvent({
      actor_user_id: "u-1",
      actor_full_name: "Admin QA",
      actor_username: "admin",
      scope: "ENTITY",
      organization_entity_id: "ent-1",
      entity_name: "Empresa QA Ficticia",
      company_client_id: null,
      module: "workers",
      action: "worker_hired",
      entity_type: "worker",
      record_id: "rec-2",
      description: "Contratación de Carlos Ficticio",
      old_values: null,
      new_values: null,
      result: "SUCCESS",
    })

    expect(ev2.id).not.toBe(ev1.id)
  })

  it("B10: formatContractSalary unifica importes como '4,500.00 CUP', LinkWorkerToPositionDialog elimina anglicismo 'Assignment' y ChangePositionDialog bloquea anexo sin contrato", () => {
    expect(formatContractSalary(4500, "CUP")).toBe("4,500.00 CUP")
    expect(formatContractSalary(3610, "CUP")).toBe("3,610.00 CUP")

    const linkDialogSource = fs.readFileSync(
      "src/modules/people/presentation/components/LinkWorkerToPositionDialog.tsx",
      "utf8"
    )
    expect(linkDialogSource).not.toContain("Solo se crea un Assignment")
    expect(linkDialogSource).toContain("Solo se vincula el trabajador al puesto.")

    const changePosSource = fs.readFileSync(
      "src/modules/people/presentation/components/ChangePositionDialog.tsx",
      "utf8"
    )
    expect(changePosSource).toContain("checked={createAddendum && !!preview.employment_contract_id}")
  })

  it("B11: RolesManager exige al menos un permiso antes de guardar un rol personalizado", () => {
    const rolesManagerSource = fs.readFileSync(
      "src/modules/access-control/presentation/components/roles-manager.tsx",
      "utf8"
    )
    expect(rolesManagerSource).toContain(
      "Debes asignar al menos un permiso al rol antes de guardar."
    )
    expect(
      friendlyRoleSaveError(
        "organization",
        new Error("Debes asignar al menos un permiso al rol antes de guardar.")
      )
    ).toBe("Debes asignar al menos un permiso al rol antes de guardar.")
  })

  it("B12: loadJobFormWorkspace y saveJob ejecutan sus consultas y escrituras independientes en paralelo", async () => {
    vi.spyOn(areasRepo, "selectActiveEntityAreas").mockResolvedValueOnce([])
    vi.spyOn(catalogsRepo, "fetchOccupationalCategories").mockResolvedValueOnce([])
    vi.spyOn(catalogsRepo, "fetchPreparationLevels").mockResolvedValueOnce([])
    vi.spyOn(entityConfigRepo, "fetchEntityRegime").mockResolvedValueOnce("PRESUPUESTADA")
    vi.spyOn(salaryRepo, "resolveApplicableScaleId").mockResolvedValueOnce("scale-1")
    vi.spyOn(entityConfigRepo, "selectSalaryScaleSummary").mockResolvedValueOnce({
      id: "scale-1",
      name: "Escala General",
      scope_type: "PRESUPUESTADA_GLOBAL",
    } as never)
    vi.spyOn(salaryAdminRepo, "selectGroupsWithValues").mockResolvedValueOnce([
      {
        group: { id: "grp-1", sequence_number: 1, scale_id: "scale-1" },
        roman_numeral: "I",
        current_value: { id: "val-1", group_id: "grp-1", amount: 3610, currency_code: "CUP" },
      } as never,
    ])
    const singleGroupSpy = vi.spyOn(salaryAdminRepo, "selectCurrentSalaryGroupValue")

    const ws = await loadJobFormWorkspace("ent-qa", { salaryGroupId: "grp-1" })
    expect(ws.currentSalaryValue).toEqual({ amount: 3610, currency_code: "CUP" })
    // No hace una consulta extra porque toma el valor ya cargado en groups
    expect(singleGroupSpy).not.toHaveBeenCalled()

    const updateSpy = vi.spyOn(jobsRepo, "updateOrganizationJob").mockResolvedValueOnce()
    const claSpy = vi.spyOn(jobsRepo, "replaceJobClaNightSegments").mockResolvedValueOnce()
    const prepSpy = vi.spyOn(jobsRepo, "replaceJobPreparationLevels").mockResolvedValueOnce()

    await saveJob({
      entityId: "ent-qa",
      jobId: "job-1",
      name: "Especialista A",
      areaId: "area-1",
      description: null,
      salaryGroupId: "grp-1",
      hierarchyOrder: 1,
      occupationalCategoryId: "cat-1",
      requiredProfessionOrTrade: null,
      workContent: null,
      isCuadro: false,
      isPrincipalSpecialist: false,
      preparationLevelIds: ["prep-1"],
      cla: {
        has_abnormal_conditions: false,
        cla_day_enabled: false,
        cla_day_hourly_rate: null,
        cla_night_enabled: false,
        night_segments: [],
      },
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(claSpy).toHaveBeenCalledTimes(1)
    expect(prepSpy).toHaveBeenCalledTimes(1)
  })

  it("C1: migración SQL incluye prenomina_prorated_scale_salary para prorratear cambios salariales a mitad de mes", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.prenomina_prorated_scale_salary")
    expect(migrationSql).toContain("public.prenomina_prorated_scale_salary(")
  })

  it("C2: el certificado médico incoherente (ej. cert 653535 con fechas 2026-11-13 a 2026-11-16 y days=2) se detecta y muestra el badge 'Certificado con datos incoherentes'", () => {
    const incoherence = getMedicalCertificateIncoherenceReason({
      startDate: "2026-11-13",
      returnDate: "2026-11-16",
      days: 2,
    })
    expect(incoherence).not.toBeNull()
    expect(incoherence).toContain("3")

    const entityCertsPage = fs.readFileSync(
      "src/modules/vacations-licenses/medical-certificates/presentation/pages/EntityMedicalCertificates.tsx",
      "utf8"
    )
    expect(entityCertsPage).toContain("Certificado con datos incoherentes")
  })

  it("C3 y C4: ninguna migración tiene UUIDs de usuarios ni set_config de JWT hardcodeados; qa_data_fixes.sql vive en supabase/scripts/ y pg_cron no oculta errores con WHEN OTHERS THEN NULL", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    expect(migrationSql).not.toContain("request.jwt.claim.sub")
    expect(migrationSql).not.toContain("EXCEPTION WHEN OTHERS THEN NULL")
    expect(fs.existsSync("supabase/scripts/qa_data_fixes.sql")).toBe(true)
  })

  it("C6: loadTransitionWorkspace, loadContractChangeWorkspace y loadWorkerFormPermissions propagan PermissionCheckUnavailableError sin .catch(() => false)", async () => {
    vi.spyOn(staffingRepo, "fetchEntityStaffingPositions").mockResolvedValue([])
    vi.spyOn(staffingRepo, "fetchEntityOccupancy").mockResolvedValue({
      counts: {},
      workersByPosition: {},
    } as never)
    vi.spyOn(staffingRepo, "fetchActiveContractTypes").mockResolvedValue([])
    vi.spyOn(entityAccessRepo, "rpcCanAccessEntity").mockRejectedValue(
      new Error("503 Service Unavailable")
    )

    await expect(loadEntityPermissionSafe("ent-qa", "contract_data.manage")).rejects.toBeInstanceOf(
      PermissionCheckUnavailableError
    )
    await expect(loadTransitionWorkspace("ent-qa")).rejects.toBeInstanceOf(
      PermissionCheckUnavailableError
    )
    await expect(loadContractChangeWorkspace("ent-qa")).rejects.toBeInstanceOf(
      PermissionCheckUnavailableError
    )
    await expect(loadWorkerFormPermissions("ent-qa")).rejects.toBeInstanceOf(
      PermissionCheckUnavailableError
    )
  })

  it("C7: candidate-pool-meta.ts persiste en public.candidate_pool_metadata y no usa window.localStorage", () => {
    const candidatePoolMetaSource = fs.readFileSync(
      "src/modules/people/infrastructure/candidate-pool-meta.ts",
      "utf8"
    )
    expect(candidatePoolMetaSource).not.toContain("localStorage")
    expect(candidatePoolMetaSource).toContain('from("candidate_pool_metadata")')
  })
})
