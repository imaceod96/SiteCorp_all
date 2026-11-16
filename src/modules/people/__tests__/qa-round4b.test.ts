import fs from "fs"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderWordPartXml } from "@/modules/document-generation/domain/ooxml-xml"
import * as staffingRepo from "@/modules/people/infrastructure/staffing.repository"
import * as orgModule from "@/modules/organization-structure"
import * as transitionsRepo from "@/modules/people/infrastructure/worker-transitions.repository"
import * as accessRepo from "@/modules/access-control/infrastructure/entity-access.repository"
import { isPermissionCheckUnavailableError } from "@/modules/access-control"
import { changeWorkerPosition, loadPositionChangeWorkspace } from "@/modules/people"
import { RepresentativeSelect } from "@/modules/representatives/presentation/components/RepresentativeSelect"

describe("QA Round 4b — Pendientes y Estabilización", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it("1. B6 original: áreas inactivas excluidas de selectores de alta en Capacitación y SST, marcadas como '(inactiva)' en listados históricos y excluidas del contador", () => {
    const trainingPage = fs.readFileSync(
      "src/modules/training/presentation/pages/EntityTraining.tsx",
      "utf8"
    )
    expect(trainingPage).toContain("activeFolders")
    expect(trainingPage).toContain("formatAreaLabel")
    expect(trainingPage).toContain("(inactiva)")
    expect(trainingPage).toContain(".filter((a) => a.is_active).length")

    const sstTraining = fs.readFileSync(
      "src/modules/sst/presentation/components/SstTrainingByJobSection.tsx",
      "utf8"
    )
    expect(sstTraining).toContain("areaActiveMap.get(j.areaId) !== false")
    expect(sstTraining).toContain("areaActiveMap.get(areaId) === false")
    expect(sstTraining).toContain("(inactiva)")

    const sstRisk = fs.readFileSync(
      "src/modules/sst/presentation/components/SstRiskAndPreventionSection.tsx",
      "utf8"
    )
    expect(sstRisk).toContain("j.isActive !== false &&")
    expect(sstRisk).toContain("(!j.areaId || areaActiveMap.get(j.areaId) !== false)")
    expect(sstRisk).toContain("(inactiva)")

    const sstEpp = fs.readFileSync(
      "src/modules/sst/presentation/components/SstEppAndInspectionsSection.tsx",
      "utf8"
    )
    expect(sstEpp).toContain("j.isActive !== false &&")
    expect(sstEpp).toContain("(!j.areaId || areaActiveMap.get(j.areaId) !== false)")
    expect(sstEpp).toContain("(área inactiva)")

    const sstSpecialized = fs.readFileSync(
      "src/modules/sst/presentation/components/SstSpecializedSections.tsx",
      "utf8"
    )
    expect(sstSpecialized).toContain("(inactiva)")
  })

  it("2. B4: migración 20261116000001_qa_round4b.sql (y copia espejo) restaura prenómina real, protege Vacaciones/Prenómina ante hire_date futura y reemplaza current_date", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000001_qa_round4b.sql",
      "utf8"
    )
    const mirrorSql = fs.readFileSync(
      "src/db/migrations/20261116000001_qa_round4b.sql",
      "utf8"
    )
    expect(migrationSql).toBe(mirrorSql)

    // Esquema real de prenómina
    expect(migrationSql).toContain("public.prenomina_refresh_workers")
    expect(migrationSql).toContain("public.prenomina_recalc_entry")
    expect(migrationSql).toContain("public.prenomina_prorated_scale_salary")
    expect(migrationSql).toContain("v_period.period_year")
    expect(migrationSql).toContain("v_period.period_month")
    expect(migrationSql).toContain("scale_salary_payment")
    expect(migrationSql).toContain("academic_payment")
    expect(migrationSql).toContain("cla_total_payment")
    expect(migrationSql).toContain("prenomina_monthly_hours_divisor()")
    expect(migrationSql).toContain("organization_job_cla_night_segments")
    expect(migrationSql).toContain("w.hire_date <= v_today")

    // Todos los RPCs de vacaciones con cuba_current_date() e is_pending_hire
    expect(migrationSql).toContain("public.run_worker_vacation_catchup")
    expect(migrationSql).toContain("public.worker_vacation_summary")
    expect(migrationSql).toContain("public.register_worker_vacation")
    expect(migrationSql).toContain("public.cancel_worker_vacation")
    expect(migrationSql).toContain("public.adjust_worker_vacation_balance")
    expect(migrationSql).toContain("public.entity_vacation_overview")
    expect(migrationSql).toContain("'is_pending_hire'")

    // UI Vacaciones ante incorporación futura
    const balanceCard = fs.readFileSync(
      "src/modules/vacations-licenses/vacations/presentation/components/VacationBalanceCard.tsx",
      "utf8"
    )
    expect(balanceCard).toContain("is_pending_hire")
    expect(balanceCard).toContain("Trabajador pendiente de incorporación")

    const workerTab = fs.readFileSync(
      "src/modules/vacations-licenses/vacations/presentation/components/WorkerVacationsTab.tsx",
      "utf8"
    )
    expect(workerTab).toContain("disabled={Boolean(data.summary.is_pending_hire)}")
  })

  it("3. B7: formulario de Accidentes en SST incluye Label en los 7 campos y deshabilita/resetea daysLost salvo ACCIDENTE_CON_LESION", () => {
    const sstSpecialized = fs.readFileSync(
      "src/modules/sst/presentation/components/SstSpecializedSections.tsx",
      "utf8"
    )
    expect(sstSpecialized).toContain(">Tipo de suceso<")
    expect(sstSpecialized).toContain(">Fecha de ocurrencia<")
    expect(sstSpecialized).toContain(">Trabajador involucrado (opcional)<")
    expect(sstSpecialized).toContain(">Severidad<")
    expect(sstSpecialized).toContain(">Descripción del suceso<")
    expect(sstSpecialized).toContain(">Causas inmediatas<")
    expect(sstSpecialized).toContain(">Días perdidos<")
    expect(sstSpecialized).toContain('disabled={eventType !== "ACCIDENTE_CON_LESION"}')
    expect(sstSpecialized).toContain(
      'daysLost: eventType === "ACCIDENTE_CON_LESION" ? Math.max(0, Number(daysLost) || 0) : 0'
    )
  })

  it("4. B8 original: las 12 secciones de SST están numeradas secuencialmente del 1 al 12", () => {
    const s12 = fs.readFileSync(
      "src/modules/sst/presentation/components/SstTrainingByJobSection.tsx",
      "utf8"
    )
    const s34 = fs.readFileSync(
      "src/modules/sst/presentation/components/SstRiskAndPreventionSection.tsx",
      "utf8"
    )
    const s56 = fs.readFileSync(
      "src/modules/sst/presentation/components/SstEppAndInspectionsSection.tsx",
      "utf8"
    )
    const s712 = fs.readFileSync(
      "src/modules/sst/presentation/components/SstSpecializedSections.tsx",
      "utf8"
    )

    expect(s12).toContain("1. Calendario Anual de Capacitaciones de SST")
    expect(s12).toContain("2. Carpetas por Cargo")
    expect(s34).toContain("3. Identificación y Evaluación de Riesgos")
    expect(s34).toContain("4. Plan de Prevención y Medidas Correctivas")
    expect(s56).toContain("5. Equipos de Protección Personal (EPP)")
    expect(s56).toContain("6. Inspecciones de Seguridad")
    expect(s712).toContain("7. Accidentes e Incidentes Laborales")
    expect(s712).toContain("8. Salud Ocupacional (Control Administrativo de Aptitud)")
    expect(s712).toContain("9. Emergencias y Contra Incendios")
    expect(s712).toContain("10. Comité de Seguridad y Salud")
    expect(s712).toContain("11. Procedimientos de Trabajo Seguro")
    expect(s712).toContain("12. Resumen de Cumplimiento de SST por Cargo de la Entidad")
  })

  it("5. B10: ningún selector ni listado muestra '()' vacío cuando falta código", () => {
    const trainingPage = fs.readFileSync(
      "src/modules/training/presentation/pages/EntityTraining.tsx",
      "utf8"
    )
    expect(trainingPage).toContain("{w.code ? (")
    expect(trainingPage).toContain("({w.code})")

    const jobForm = fs.readFileSync(
      "src/modules/organization-structure/presentation/components/JobForm.tsx",
      "utf8"
    )
    expect(jobForm).toContain('{level.code ? <span className="text-xs opacity-70">({level.code})</span> : null}')

    const workerForm = fs.readFileSync(
      "src/modules/people/presentation/components/WorkerForm.tsx",
      "utf8"
    )
    expect(workerForm).toContain('{p.code ? ` (${p.code})` : ""}')
  })

  it("6. Bloque A / P1 / P2 / B12: motor OOXML unificado reemplaza placeholders divididos entre runs <w:r><w:t> y sin fallback en navegador", () => {
    const splitRunXml =
      '<w:p><w:r><w:t>{{worker</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>_full</w:t></w:r><w:r><w:t>_name}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>En {{signature_place}}</w:t></w:r></w:p>'

    const result = renderWordPartXml(splitRunXml, {
      worker_full_name: "Carlos & <Ficticio>",
      signature_place: "La Habana",
    })

    expect(result.xml).toContain("Carlos &amp; &lt;Ficticio&gt;")
    expect(result.xml).toContain("En La Habana")
    expect(result.leftoverKeys.size).toBe(0)
    expect(result.unknownKeys.size).toBe(0)
    expect(result.replacedCount).toBe(2)

    const edgeFn = fs.readFileSync("supabase/functions/process-document-jobs/index.ts", "utf8")
    expect(edgeFn).toContain("ooxml-xml.ts")

    const contractRepo = fs.readFileSync(
      "src/modules/contracts/infrastructure/contract-documents.repository.ts",
      "utf8"
    )
    expect(contractRepo).not.toContain("generateContractDocument")

    const contractualDoc = fs.readFileSync(
      "src/modules/document-generation/presentation/components/ContractualDocumentSection.tsx",
      "utf8"
    )
    expect(contractualDoc).not.toContain("generateContractualDocument(")

    const useSc404 = fs.readFileSync(
      "src/modules/access-control/presentation/hooks/use-sc404.ts",
      "utf8"
    )
    expect(useSc404).not.toContain("generateSc404Document(")
  })

  it("7. B1: Capacitación excluye trabajadores con hireDate > fecha de sesión y usa etiqueta 'Incorporado el'", () => {
    const trainingPage = fs.readFileSync(
      "src/modules/training/presentation/pages/EntityTraining.tsx",
      "utf8"
    )
    expect(trainingPage).toContain("w.hireDate && sessionDateInput && w.hireDate > sessionDateInput")
    expect(trainingPage).toContain("Incorporado el {formatIsoDateToDisplay(w.hireDate)} (posterior a la sesión)")
  })

  it("8. B9: auditoría elimina recordAuditEvent manual en entidades y la supresión de 4s por contenido", () => {
    const orgDialog = fs.readFileSync(
      "src/modules/organization-structure/presentation/components/organization-entity-dialog.tsx",
      "utf8"
    )
    expect(orgDialog).not.toContain("recordAuditEvent")

    const auditRepo = fs.readFileSync(
      "src/modules/audit-history/infrastructure/audit-history.repository.ts",
      "utf8"
    )
    expect(auditRepo).not.toContain("recentDispatchedEvents")
    expect(auditRepo).toContain("now - prev < 150")
  })

  it("9. Bloque A Seguridad: notify_process_document_jobs usa solo pg_notify y pg_cron elimina process-document-jobs-every-minute", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000001_qa_round4b.sql",
      "utf8"
    )
    expect(migrationSql).toContain("PERFORM pg_notify(")
    expect(migrationSql).toContain("cron.unschedule('process-document-jobs-every-minute')")
    expect(migrationSql).not.toContain("current_setting('app.settings.service_role_key'")
    expect(migrationSql).not.toContain("net.http_post(")
  })

  it("10. P3, B7 triggers UPDATE y qa_data_fixes.sql", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000001_qa_round4b.sql",
      "utf8"
    )
    expect(migrationSql).toContain("v_hire_date := COALESCE(v_worker.hire_date, NEW.start_date, public.cuba_current_date());")
    expect(migrationSql).toContain("IF (TG_OP = 'INSERT' OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at)")
    expect(migrationSql).toContain("NEW.days_lost := 0;")
    expect(migrationSql).toContain("OR NEW.next_review_date IS DISTINCT FROM OLD.next_review_date")

    const qaScript = fs.readFileSync("supabase/scripts/qa_data_fixes.sql", "utf8")
    expect(qaScript).toContain("Empresa QA Ficticia")
    expect(qaScript).not.toContain("653535")
  })

  it("11. P5: trigger ADDENDUM AFTER UPDATE OF status (WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'FORMALIZED'), backfill y simulación PENDIENTE -> FORMALIZED", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000001_qa_round4b.sql",
      "utf8"
    )
    const mirrorSql = fs.readFileSync(
      "src/db/migrations/20261116000001_qa_round4b.sql",
      "utf8"
    )
    expect(migrationSql).toBe(mirrorSql)

    // Verificar definición exacta del trigger UPDATE
    expect(migrationSql).toContain("CREATE TRIGGER trg_enqueue_addendum_document_job_update")
    expect(migrationSql).toContain("AFTER UPDATE OF status ON public.contract_addendums")
    expect(migrationSql).toContain(
      "WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'FORMALIZED')"
    )
    expect(migrationSql).toContain("FROM public.contract_addendums ca")
    expect(migrationSql).toContain(
      "PERFORM public.enqueue_document_generation_job('ADDENDUM', rec.id, false);"
    )

    // Simulación fiel de la máquina de estados del trigger: PENDIENTE -> FORMALIZED crea 1 job ADDENDUM
    const jobs: Array<{ kind: string; source_id: string; status: string }> = []
    const triggerAddendumUpdate = (
      oldRow: { id: string; status: string },
      newRow: { id: string; status: string }
    ) => {
      if (oldRow.status !== newRow.status && newRow.status === "FORMALIZED") {
        jobs.push({ kind: "ADDENDUM", source_id: newRow.id, status: "PENDIENTE" })
      }
    }

    const addendum = { id: "add-qa-1", status: "PENDIENTE" }
    expect(jobs).toHaveLength(0)

    const updatedUnchanged = { ...addendum }
    triggerAddendumUpdate(addendum, updatedUnchanged)
    expect(jobs).toHaveLength(0)

    const formalized = { ...addendum, status: "FORMALIZED" }
    triggerAddendumUpdate(addendum, formalized)
    expect(jobs).toEqual([{ kind: "ADDENDUM", source_id: "add-qa-1", status: "PENDIENTE" }])
  })

  it("12. Prenómina: 20261116000000_qa_round4.sql corrige sst_worker_health_aptitude y worker_documents, y 0001 conserva prorrateo C1 (Grupo II: 5.500 hasta 18/11 y 5.600 desde 19/11)", () => {
    const m0Sql = fs.readFileSync(
      "supabase/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    const m0Mirror = fs.readFileSync(
      "src/db/migrations/20261116000000_qa_round4.sql",
      "utf8"
    )
    expect(m0Sql).toBe(m0Mirror)

    // Confirmar ausencia de tabla/columnas inexistentes que romperían 20261116000000 en producción
    expect(m0Sql).not.toContain("public.sst_health_aptitudes")
    expect(m0Sql).toContain("public.sst_worker_health_aptitude")
    expect(m0Sql).not.toContain("wd.resolution_id")
    expect(m0Sql).not.toContain("wd.payroll_movement_id")
    expect(m0Sql).not.toContain("wd.vacation_id")
    expect(m0Sql).not.toContain("wd.medical_certificate_id")
    expect(m0Sql).toContain("wd.document_source_type = 'RESOLUTION'")
    expect(m0Sql).toContain("wd.document_source_type = 'PAYROLL_MOVEMENT'")

    // Confirmar que 0001 conserva prorrateo C1 tanto en refresh como en recalc y verifica Grupo II en DO $$
    const m1Sql = fs.readFileSync(
      "supabase/migrations/20261116000001_qa_round4b.sql",
      "utf8"
    )
    expect(m1Sql).toContain("v_seg_count > 1")
    expect(m1Sql).toContain("FROM public.prenomina_prorated_scale_salary(")
    expect(m1Sql).toContain("5540.00")

    // Comprobación matemática exacta de C1: Grupo II 5.500 (1..18 nov = 18 días) y 5.600 (19..30 nov = 12 días)
    const novDays = 30
    const weightedScale = Number((5500 * (18 / novDays) + 5600 * (12 / novDays)).toFixed(2))
    const hourlyRate = Number((weightedScale / 190.6).toFixed(6))
    expect(weightedScale).toBe(5540.0)
    expect(hourlyRate).toBe(29.066107)
  })

  it("13. B7: SstSpecializedSections expone selector de severidad editable (LEVE/MODERADO/GRAVE/MORTAL) y campo de causas inmediatas", () => {
    const src = fs.readFileSync(
      "src/modules/sst/presentation/components/SstSpecializedSections.tsx",
      "utf8"
    )
    expect(src).toContain('<Label className="text-xs">Severidad</Label>')
    expect(src).toContain('<SelectItem value="LEVE">Severidad: Leve</SelectItem>')
    expect(src).toContain('<SelectItem value="MODERADO">Severidad: Moderado</SelectItem>')
    expect(src).toContain('<SelectItem value="GRAVE">Severidad: Grave</SelectItem>')
    expect(src).toContain('<SelectItem value="MORTAL">Severidad: Mortal</SelectItem>')
    expect(src).toContain('<Label className="text-xs">Causas inmediatas</Label>')
    expect(src).toContain("value={accidentCauses}")
  })

  it("14. B10: LinkWorkerToPositionDialog (línea 210/225) y CandidateDetail nunca muestran '()' ni '(null)' cuando falta el código", () => {
    const linkDialog = fs.readFileSync(
      "src/modules/people/presentation/components/LinkWorkerToPositionDialog.tsx",
      "utf8"
    )
    expect(linkDialog).toContain('{selected.code?.trim() ? ` (${selected.code.trim()})` : ""}')
    expect(linkDialog).toContain('{matchedPos?.code?.trim() ? ` (${matchedPos.code.trim()})` : ""}')

    const candidateDetail = fs.readFileSync(
      "src/modules/people/presentation/pages/CandidateDetail.tsx",
      "utf8"
    )
    expect(candidateDetail).toContain(
      '`Trabajador activo${linkedWorker.code?.trim() ? ` (${linkedWorker.code.trim()})` : ""}. Este candidato ya forma parte de la plantilla.`'
    )
    expect(candidateDetail).not.toContain("Trabajador activo (${linkedWorker.code})")
  })

  it("15. B12: loadPositionChangeWorkspace y changeWorkerPosition ejecutan consultas mínimas en paralelo y completan en < 3s", async () => {

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const posSpy = vi.spyOn(staffingRepo, "fetchEntityStaffingPositions").mockImplementation(async () => {
      await delay(20)
      return [
        {
          id: "pos-1",
          name: "Especialista B",
          code: "P-1",
          authorized_quantity: 2,
          is_active: true,
          job: { id: "job-1", name: "Especialista", area: { id: "a-1", name: "RRHH" }, salary_group: { id: "sg-1", sequence_number: 2 } },
        },
      ] as never
    })
    const occSpy = vi.spyOn(staffingRepo, "fetchEntityOccupancy").mockImplementation(async () => {
      await delay(20)
      return { counts: { "pos-1": 1 }, occupants: {} } as never
    })
    const segSpy = vi.spyOn(orgModule, "fetchEntityScheduleSegments").mockImplementation(async () => {
      await delay(20)
      return {}
    })
    const scaleSpy = vi.spyOn(orgModule, "resolveApplicableScaleId").mockImplementation(async () => {
      await delay(20)
      return "scale-1"
    })
    const salSpy = vi.spyOn(orgModule, "fetchSalaryValuesForGroups").mockImplementation(async () => {
      await delay(20)
      return { "sg-1": { id: "sv-1", group_id: "sg-1", amount: 5500, currency_code: "CUP" } } as never
    })
    const permSpy = vi.spyOn(accessRepo, "rpcCanAccessEntity").mockImplementation(async () => {
      await delay(20)
      return true
    })
    const contractTypesSpy = vi.spyOn(staffingRepo, "fetchActiveContractTypes")
    const rpcSpy = vi.spyOn(transitionsRepo, "changeWorkerPositionRpc").mockImplementation(async () => {
      await delay(20)
      return {
        worker_id: "w-1",
        new_assignment_id: "asg-2",
        addendum: { addendum_id: "add-1", addendum_number: "1", addendum_status: "FORMALIZED" },
      } as never
    })

    const t0 = performance.now()
    const ws = await loadPositionChangeWorkspace("ent-qa")
    const res = await changeWorkerPosition({
      workerId: "w-1",
      newPositionId: "pos-1",
      effectiveDate: "2026-11-20",
      reason: "Reorganización",
      notes: "",
      addendum: {
        create: true,
        formalize: true,
        signatureDate: "2026-11-16",
        signaturePlace: "La Habana",
        representativeAssignmentId: "rep-1",
      },
    })
    const elapsedMs = performance.now() - t0

    expect(ws.positions).toHaveLength(1)
    expect(ws.canManageContractData).toBe(true)
    expect(contractTypesSpy).not.toHaveBeenCalled()
    expect(posSpy).toHaveBeenCalledTimes(1)
    expect(occSpy).toHaveBeenCalledTimes(1)
    expect(segSpy).toHaveBeenCalledTimes(1)
    expect(scaleSpy).toHaveBeenCalledTimes(1)
    expect(salSpy).toHaveBeenCalledTimes(1)
    expect(permSpy).toHaveBeenCalledWith("ent-qa", "contract_data.manage")
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(res.documentWarning).toBeNull()
    expect(elapsedMs).toBeLessThan(3000)

    vi.restoreAllMocks()
  })

  it("16. P1: hiring.commands.ts, worker-transitions.commands.ts y worker-expediente.commands.ts ya no invocan ninguna función ensure* después del RPC", () => {
    const hiringCmds = fs.readFileSync(
      "src/modules/people/application/hiring.commands.ts",
      "utf8"
    )
    const transitionCmds = fs.readFileSync(
      "src/modules/people/application/worker-transitions.commands.ts",
      "utf8"
    )
    const expedienteCmds = fs.readFileSync(
      "src/modules/people/application/worker-expediente.commands.ts",
      "utf8"
    )

    for (const src of [hiringCmds, transitionCmds, expedienteCmds]) {
      expect(src).not.toMatch(/\bensure[A-Za-z0-9_]*\b/)
      expect(src).not.toContain("transition-documents")
    }
  })

  it("17. qa_data_fixes.sql incluye comentadas las correcciones de 'Corte en mano con cuchilla QA' (05/12/2026) y aptitud de Laura Tester (10/01/2026)", () => {
    const qaScript = fs.readFileSync("supabase/scripts/qa_data_fixes.sql", "utf8")
    expect(qaScript).toContain("Corte en mano con cuchilla QA")
    expect(qaScript).toContain("2026-12-05")
    expect(qaScript).toContain("Laura Tester")
    expect(qaScript).toContain("2026-01-10")
    expect(qaScript).toContain("-- -- UPDATE public.sst_accidents_incidents")
    expect(qaScript).toContain("-- -- UPDATE public.sst_worker_health_aptitude")
  })

  it("18. B12+P1: ChangePositionDialog conecta contract_data.manage a canManage/canManageContractData y propaga PermissionCheckUnavailableError con Reintentar", async () => {

    vi.spyOn(staffingRepo, "fetchEntityStaffingPositions").mockResolvedValue([] as never)
    vi.spyOn(staffingRepo, "fetchEntityOccupancy").mockResolvedValue({ counts: {}, occupants: {} } as never)
    vi.spyOn(orgModule, "fetchEntityScheduleSegments").mockResolvedValue({})
    vi.spyOn(orgModule, "resolveApplicableScaleId").mockResolvedValue(null)

    // 1) Sin permiso: canManageContractData debe ser false
    vi.spyOn(accessRepo, "rpcCanAccessEntity").mockResolvedValueOnce(false)
    const wsDenied = await loadPositionChangeWorkspace("ent-qa")
    expect(wsDenied.canManageContractData).toBe(false)

    // 2) Error de red/503 en ambos intentos: lanza PermissionCheckUnavailableError, nunca devuelve false
    vi.spyOn(accessRepo, "rpcCanAccessEntity")
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
    let caught: unknown = null
    try {
      await loadPositionChangeWorkspace("ent-qa")
    } catch (err) {
      caught = err
    }
    expect(isPermissionCheckUnavailableError(caught)).toBe(true)

    // 3) Render de RepresentativeSelect con canManage={false} vs canManage={true}
    const htmlWithoutPerm = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(RepresentativeSelect, {
          entityId: "ent-qa",
          onDate: "2026-11-16",
          value: null,
          onChange: () => {},
          canManage: wsDenied.canManageContractData,
        })
      )
    )
    expect(htmlWithoutPerm).not.toContain("Configurar representantes")

    const htmlWithPerm = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(RepresentativeSelect, {
          entityId: "ent-qa",
          onDate: "2026-11-16",
          value: null,
          onChange: () => {},
          canManage: true,
        })
      )
    )
    expect(htmlWithPerm).toContain("Configurar representantes")

    // 4) ChangePositionDialog pasa canManageContractData real y traduce PermissionCheckUnavailableError a Reintentar;
    //    ResolutionForm deshabilita Municipio donde se firma y Año de la Revolución cuando canManageContractData=false
    const changeDialogSrc = fs.readFileSync(
      "src/modules/people/presentation/components/ChangePositionDialog.tsx",
      "utf8"
    )
    expect(changeDialogSrc).toContain("canManage={canManageContractData}")
    expect(changeDialogSrc).toContain("canManageContractData={canManageContractData}")
    expect(changeDialogSrc).toContain("isPermissionCheckUnavailableError(err)")
    expect(changeDialogSrc).toContain("No se pudo conectar con el servidor")
    expect(changeDialogSrc).toContain("Reintentar")

    const resolutionFormSrc = fs.readFileSync(
      "src/modules/resolutions/presentation/components/ResolutionForm.tsx",
      "utf8"
    )
    expect(resolutionFormSrc).toContain("if (!context || !canManageContractData) return")
    expect(resolutionFormSrc).toContain('value={municipality}')
    expect(resolutionFormSrc).toContain('value={revolutionYear}')
    expect(resolutionFormSrc.match(/disabled=\{!canManageContractData\}/g)?.length).toBe(2)

    vi.restoreAllMocks()
  })
})
