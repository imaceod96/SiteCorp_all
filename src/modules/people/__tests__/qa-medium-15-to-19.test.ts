import { describe, expect, it, vi, beforeEach } from "vitest"
import { CONTRACT_ALERT_META, deadlineLabel } from "@/modules/contracts/domain/contract-alerts.rules"
import { employmentMovementLabel } from "@/modules/people"

const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))

describe("QA Medios #15–#19 — Alertas, Notificaciones SST/Capacitación, Fechas, Bitácora ALTA y Concurrencia", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("#15: Las etiquetas de rango de CONTRACT_ALERT_META no contradicen los días exactos restantes", () => {
    expect(CONTRACT_ALERT_META.DUE_IN_7.label).toBe("Próximos 7 días")
    expect(CONTRACT_ALERT_META.DUE_IN_15.label).toBe("8–15 días")
    expect(CONTRACT_ALERT_META.DUE_IN_30.label).toBe("16–30 días")

    // Un contrato que vence en 16 días cae en el rango DUE_IN_30 ("16–30 días") y su detalle exacto es "Vence en 16 días"
    expect(deadlineLabel(16, "2026-11-30")).toBe("Vence en 16 días")
    expect(CONTRACT_ALERT_META.DUE_IN_30.label).not.toBe("Vence en 30 días")
  })

  it("#16: loadEntityPendingSstNotifications y loadWorkerSstProfile excluyen notificaciones DESCARTADA y COMPLETADA", async () => {
    const sstRepository = await import("@/modules/sst/infrastructure/sst.repository")
    vi.spyOn(sstRepository, "loadEntitySstState").mockResolvedValue({
      jobFolders: [],
      topics: [],
      documents: [],
      sessions: [],
      workerTrainingRecords: [],
      notifications: [
        {
          id: "notif-discarded-1",
          organization_entity_id: "ent-qa",
          worker_id: "worker-carlos",
          event_key: "ent-qa:worker-carlos:job-rrhh:NUEVA_CONTRATACION:2026-11-16",
          trigger_type: "NUEVA_CONTRATACION",
          worker_name: "Carlos Tester Uno",
          worker_code: "001",
          worker_identification: "92061412345",
          job_id: "job-rrhh",
          job_name: "Especialista en Gestión de RRHH",
          area_id: "area-rrhh",
          area_name: "Recursos Humanos",
          position_name: "Especialista RRHH",
          effective_date: "2026-11-16",
          status: "DESCARTADA",
          completed_at: "2026-11-25T10:00:00Z",
          completed_record_id: null,
          created_at: "2026-11-16T10:00:00Z",
        },
        {
          id: "notif-active-dir",
          organization_entity_id: "ent-qa",
          worker_id: "worker-carlos",
          event_key: "ent-qa:worker-carlos:job-dir:CAMBIO_CARGO:2026-11-25",
          trigger_type: "CAMBIO_CARGO",
          worker_name: "Carlos Tester Uno",
          worker_code: "001",
          worker_identification: "92061412345",
          job_id: "job-dir",
          job_name: "Director General",
          area_id: "area-dir",
          area_name: "Dirección",
          position_name: "Director General",
          effective_date: "2026-11-25",
          status: "PENDIENTE",
          completed_at: null,
          completed_record_id: null,
          created_at: "2026-11-25T10:00:00Z",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof sstRepository.loadEntitySstState>>)

    const { loadEntityPendingSstNotifications, loadWorkerSstProfile } = await import(
      "@/modules/sst/application/sst.service"
    )

    const entityPending = await loadEntityPendingSstNotifications("ent-qa")
    expect(entityPending).toHaveLength(1)
    expect(entityPending[0].id).toBe("notif-active-dir")
    expect(entityPending[0].job_name).toBe("Director General")

    const workerProfile = await loadWorkerSstProfile("ent-qa", "worker-carlos", "job-dir")
    expect(workerProfile.pendingNotifications).toHaveLength(1)
    expect(workerProfile.pendingNotifications[0].id).toBe("notif-active-dir")
  })

  it("#17: registerWorkerInitialTraining y registerWorkerDirectSstTraining rechazan fechas anteriores al alta del trabajador", async () => {
    const trainingRepo = await import("@/modules/training/infrastructure/training.repository")
    vi.spyOn(trainingRepo, "loadEntityTrainingState").mockResolvedValue({
      folders: [],
      topics: [],
      documents: [],
      sessions: [],
      workerRecords: [],
      notifications: [],
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === "workers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { hire_date: "2026-11-16" },
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    await expect(
      trainingRepo.registerWorkerInitialTraining({
        entityId: "ent-qa",
        workerId: "worker-laura",
        customTopicTitle: "Inducción general",
        receivedDate: "2026-11-14",
      })
    ).rejects.toThrow(/no puede ser anterior a la fecha de alta del trabajador \(2026-11-16\)/)

    const sstRepo = await import("@/modules/sst/infrastructure/sst.repository")
    await expect(
      sstRepo.registerWorkerDirectSstTraining({
        entityId: "ent-qa",
        workerId: "worker-laura",
        customTopicTitle: "Instrucción inicial SST",
        receivedDate: "2026-11-14",
      })
    ).rejects.toThrow(/no puede ser anterior a la fecha de alta del trabajador \(2026-11-16\)/)
  })

  it("#18: Bitácora laboral soporta el movimiento ALTA y ordena por effective_date DESC", async () => {
    expect(employmentMovementLabel("ALTA")).toBe("Alta")

    const orderCalls: { column: string; ascending?: boolean }[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === "worker_employment_movements") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: (column: string, opts?: { ascending?: boolean }) => {
            orderCalls.push({ column, ascending: opts?.ascending })
            if (orderCalls.length === 2) {
              return Promise.resolve({
                data: [
                  {
                    id: "mov-alta",
                    movement_type: "ALTA",
                    effective_date: "2026-11-16",
                    reason: "Alta laboral",
                    notes: null,
                    created_by: null,
                    created_at: "2026-11-16T08:00:00Z",
                    separation_reason: null,
                  },
                ],
                error: null,
              })
            }
            return builder
          },
        }
        return builder
      }
      return {}
    })

    const { fetchWorkerEmploymentMovements } = await import(
      "@/modules/people/infrastructure/worker-expediente.repository"
    )
    const movements = await fetchWorkerEmploymentMovements("worker-carlos")
    expect(orderCalls).toEqual([
      { column: "effective_date", ascending: false },
      { column: "created_at", ascending: false },
    ])
    expect(movements).toHaveLength(1)
    expect(movements[0].movement_type).toBe("ALTA")
  })

  it("#19: generateContractDocument reporta las etapas de progreso de generación documental", async () => {
    const queries = await import("@/modules/document-generation/application/document-generation.queries")
    vi.spyOn(queries, "precheckDocumentGeneration").mockResolvedValue({
      kind: "CONTRACT",
      sourceId: "contract-1",
      entityId: "ent-qa",
      workerId: "worker-1",
      workerCode: "001",
      workerFullName: "Laura Tester",
      documentTypeCode: "CONTRATO_INDETERMINADO",
      documentTypeLabel: "Contrato Indeterminado",
      formalized: false,
      ready: false,
      blockedReason: "NOT_FORMALIZED",
      template: {
        status: "NONE",
      },
      requiredVariables: [],
      missingVariables: [],
      resolvedValues: {},
    } as unknown as Awaited<ReturnType<typeof queries.precheckDocumentGeneration>>)

    const { generateContractDocument } = await import(
      "@/modules/document-generation/application/document-generation.commands"
    )
    const stages: string[] = []
    const res = await generateContractDocument("contract-1", (stage) => stages.push(stage))
    expect(stages).toContain("VALIDATING")
    expect(res.success).toBe(false)
  })
})
