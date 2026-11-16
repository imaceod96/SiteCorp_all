import fs from "fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { addDaysIsoInCuba, todayIsoInCuba } from "@/utils/cuba-date"
import {
  isPermissionCheckUnavailableError,
  loadEntityPermissionSafe,
  PermissionCheckUnavailableError,
} from "@/modules/access-control/application/entity-access.queries"
import * as entityAccessRepo from "@/modules/access-control/infrastructure/entity-access.repository"
import { loadEntityStaffingBoard } from "@/modules/people/application/staffing.queries"
import { hireCandidateWithContract } from "@/modules/people/application/hiring.commands"
import * as workerTransitionsRepo from "@/modules/people/infrastructure/worker-transitions.repository"
import { supabase } from "@/lib/supabase"
import { clearContractDocumentStatusStore } from "@/modules/contracts"
import { getMedicalCertificateIncoherenceReason } from "@/modules/vacations-licenses/medical-certificates"

describe("QA Round 3 — Pendientes (P1, P2, P3, P4 y P5)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearContractDocumentStatusStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("P1: cuando rpcCanAccessEntity lanza un error dos veces, loadEntityPermissionSafe y loadEntityStaffingBoard lanzan PermissionCheckUnavailableError y EntityHiring muestra 'No se pudo conectar con el servidor' con botón 'Reintentar' (nunca 'No tiene permiso')", async () => {
    const rpcSpy = vi
      .spyOn(entityAccessRepo, "rpcCanAccessEntity")
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))

    await expect(
      loadEntityPermissionSafe("ent-qa", "candidates.manage")
    ).rejects.toBeInstanceOf(PermissionCheckUnavailableError)
    expect(rpcSpy).toHaveBeenCalledTimes(2)

    // Si el RPC responde false legítimamente, devuelve false sin lanzar error de red
    rpcSpy.mockResolvedValueOnce(false)
    await expect(loadEntityPermissionSafe("ent-qa", "candidates.manage")).resolves.toBe(
      false
    )

    // En loadEntityStaffingBoard, dos fallos seguidos de red propagan PermissionCheckUnavailableError
    rpcSpy
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockRejectedValueOnce(new Error("Failed to fetch"))

    let caughtError: unknown = null
    try {
      await loadEntityStaffingBoard("ent-qa")
    } catch (err) {
      caughtError = err
    }
    expect(isPermissionCheckUnavailableError(caughtError)).toBe(true)

    // Comprobar que EntityHiring traduce PermissionCheckUnavailableError a "No se pudo conectar con el servidor" + botón "Reintentar" y no "No tiene permiso"
    const entityHiringSource = fs.readFileSync(
      "src/modules/people/presentation/pages/EntityHiring.tsx",
      "utf8"
    )
    expect(entityHiringSource).toContain("isPermissionCheckUnavailableError")
    expect(entityHiringSource).toContain("No se pudo conectar con el servidor")
    expect(entityHiringSource).toContain("Reintentar")
  })

  it("P2: con el reloj del sistema fijo en 2026-11-15T01:00:00Z (20:00 del 14/11 en Cuba), todayIsoInCuba() devuelve '2026-11-14' y la fecha por defecto de 'Programar sesión' en EntityTraining es '2026-11-14'", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-15T01:00:00Z"))

    // En UTC ya es 2026-11-15, pero en America/Havana (UTC-5) son las 20:00 del 2026-11-14
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-15")
    expect(todayIsoInCuba()).toBe("2026-11-14")
    expect(addDaysIsoInCuba(10)).toBe("2026-11-24")

    const entityTrainingSource = fs.readFileSync(
      "src/modules/training/presentation/pages/EntityTraining.tsx",
      "utf8"
    )
    expect(entityTrainingSource).toContain("const [scheduleDate, setScheduleDate] = React.useState<string>(() =>\n    todayIsoInCuba()\n  )")
    expect(entityTrainingSource).toContain("setScheduleDate(`${selectedYear}-${todayIsoInCuba().slice(5, 10)}`)")
    expect(entityTrainingSource).not.toContain("new Date().toISOString().slice(0, 10)")

    // Verificar que la migración nueva define public.cuba_current_date() y actualiza las funciones de negocio
    const sqlMigration = fs.readFileSync(
      "supabase/migrations/20261115000006_qa_round3_pendientes.sql",
      "utf8"
    )
    expect(sqlMigration).toContain("CREATE OR REPLACE FUNCTION public.cuba_current_date()")
    expect(sqlMigration).toContain("public.register_worker_separation")
    expect(sqlMigration).toContain("public.salary_change_impact")
    expect(sqlMigration).toContain("public.apply_salary_group_value_change")
    expect(sqlMigration).toContain("public.handle_worker_sst_assignment_notification")
    expect(sqlMigration).toContain("public.handle_worker_hiring_training_notification")
    expect(sqlMigration).toContain("public.create_worker_with_position")
    expect(sqlMigration).toContain("public.resolve_entity_representatives")
    expect(sqlMigration).toContain("public.resolve_tenure_payment_for_worker")
    expect(sqlMigration).toContain("public.migration_validate_rows")
    expect(sqlMigration).toContain("public.migration_create_worker")
    expect(sqlMigration).toContain("public.create_contract_addendum")
  })

  it("P3: hireCandidateWithContract concluye tras el RPC sin ensure* en el cliente, y si la Edge Function process-document-jobs responde 503 el contrato queda en estado ERROR visible en PendingContractDocumentsBanner", async () => {
    vi.spyOn(workerTransitionsRepo, "hireCandidateRpc").mockResolvedValueOnce({
      workerId: "worker-pedro-tester",
      contractId: "contract-pedro-503",
      resolutionId: null,
    })

    const rpcSpy = vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: null } as never)
    vi.spyOn(supabase, "functions", "get").mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("503 Service Unavailable"),
      }),
    } as never)

    const outcome = await hireCandidateWithContract({
      candidateId: "cand-pedro",
      positionId: "pos-1",
      hireDate: "2026-11-14",
      specialDocumentRole: false,
      contractTypeId: "ct-indeterminado",
      contractStartDate: "2026-11-14",
      isDetermined: false,
      contractEndDate: "",
      notes: "",
      representativeAssignmentId: "rep-1",
      signatureDate: "2026-11-14",
      signaturePlace: "La Habana",
      paymentMethodId: "pm-1",
      compensationComponents: [],
      paymentScheduleText: "Mensual",
    })

    expect(outcome.workerId).toBe("worker-pedro-tester")
    expect(outcome.contractId).toBe("contract-pedro-503")
    // En la arquitectura actual (P1), el trigger en PostgreSQL encola el documento sin bloquear la UI
    expect(outcome.documentWarning).toBeNull()

    // Si la cola en el backend / Edge Function falla con 503, marca el contrato como ERROR
    const { triggerDocumentGenerationJobs } = await import("@/modules/contracts")
    const triggerRes = await triggerDocumentGenerationJobs({
      kind: "CONTRACT",
      sourceId: "contract-pedro-503",
    })
    expect(triggerRes.ok).toBe(false)
    expect(triggerRes.status).toBe("ERROR")
    expect(triggerRes.error).toContain("503 Service Unavailable")
    expect(rpcSpy).toHaveBeenCalledWith(
      "set_contract_document_status",
      expect.objectContaining({
        p_contract_id: "contract-pedro-503",
        p_status: "ERROR",
        p_error: "503 Service Unavailable",
      })
    )

    const bannerSource = fs.readFileSync(
      "src/modules/contracts/presentation/components/PendingContractDocumentsBanner.tsx",
      "utf8"
    )
    expect(bannerSource).toContain("Documentos pendientes de generar")
    expect(bannerSource).toContain("Generar documento")
  })

  it("P4: las consultas de lectura (staffing, people y worker-expediente) ya no invocan applyDueScheduledSeparationsRpc al abrir pantallas", () => {
    const staffingQueries = fs.readFileSync(
      "src/modules/people/application/staffing.queries.ts",
      "utf8"
    )
    const peopleQueries = fs.readFileSync(
      "src/modules/people/application/people.queries.ts",
      "utf8"
    )
    const workerExpedienteQueries = fs.readFileSync(
      "src/modules/people/application/worker-expediente.queries.ts",
      "utf8"
    )
    const workerTransitionsCommands = fs.readFileSync(
      "src/modules/people/application/worker-transitions.commands.ts",
      "utf8"
    )

    expect(staffingQueries).not.toContain("applyDueScheduledSeparationsRpc")
    expect(peopleQueries).not.toContain("applyDueScheduledSeparationsRpc")
    expect(workerExpedienteQueries).not.toContain("applyDueScheduledSeparationsRpc")
    // Solo se conserva la acción explícita en worker-transitions.commands.ts
    expect(workerTransitionsCommands).toContain("applyDueScheduledSeparationsRpc")
  })

  it("P5: detecta certificados médicos con datos incoherentes y muestra la etiqueta 'Certificado con datos incoherentes'", () => {
    const reasonMismatch = getMedicalCertificateIncoherenceReason({
      startDate: "2026-11-10",
      returnDate: "2026-11-13",
      days: 5,
    })
    expect(reasonMismatch).toContain("debe coincidir con la diferencia")

    const reasonCoherent = getMedicalCertificateIncoherenceReason({
      startDate: "2026-11-10",
      returnDate: "2026-11-13",
      days: 3,
    })
    expect(reasonCoherent).toBeNull()

    const entityCertsPage = fs.readFileSync(
      "src/modules/vacations-licenses/medical-certificates/presentation/pages/EntityMedicalCertificates.tsx",
      "utf8"
    )
    const workerCertsTab = fs.readFileSync(
      "src/modules/vacations-licenses/medical-certificates/presentation/components/WorkerMedicalCertificatesTab.tsx",
      "utf8"
    )
    expect(entityCertsPage).toContain("Certificado con datos incoherentes")
    expect(workerCertsTab).toContain("Certificado con datos incoherentes")
  })
})
