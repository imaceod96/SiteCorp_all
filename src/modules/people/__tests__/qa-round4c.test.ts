import fs from "fs"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { supabase } from "@/lib/supabase"
import { fetchPendingContractDocuments } from "@/modules/contracts/infrastructure/contract-documents.repository"
import {
  fetchWorkersLinkageDetails,
} from "@/modules/people/infrastructure/people.repository"
import * as peopleRepo from "@/modules/people/infrastructure/people.repository"
import * as accessControl from "@/modules/access-control"
import { loadEntityWorkersDirectory } from "@/modules/people/application/people.queries"
import EntityWorkers from "@/modules/people/presentation/pages/EntityWorkers"
import { formatAccidentSeverityLabel } from "@/modules/sst/domain/entities"
import { selectCurrentSstAssignment } from "@/modules/sst/infrastructure/sst.repository"
import { SstSpecializedSections } from "@/modules/sst/presentation/components/SstSpecializedSections"
import { SstEppAndInspectionsSection } from "@/modules/sst/presentation/components/SstEppAndInspectionsSection"

vi.mock("@/contexts/CurrentEntityContext", () => ({
  useActiveEntityId: () => "ent-1",
}))

describe("QA Round 4c — Reapertura histórica, vinculación futura, banner de cola y SST", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("1. Migración 20261116000002_qa_round4c.sql reabre asignaciones/contratos cerrados por cambios futuros y sincroniza copia espejo", () => {
    const migrationSql = fs.readFileSync(
      "supabase/migrations/20261116000002_qa_round4c.sql",
      "utf8"
    )
    const mirrorSql = fs.readFileSync(
      "src/db/migrations/20261116000002_qa_round4c.sql",
      "utf8"
    )
    expect(migrationSql).toBe(mirrorSql)

    // Backfill 1A/1B/1C: futuras a is_current = false y reapertura de la anterior con end_date = future_start - 1
    expect(migrationSql).toContain("WHERE a.start_date > v_today")
    expect(migrationSql).toContain("end_date = v_fut.future_start_date - 1")
    expect(migrationSql).toContain("actual_end_date = v_next_ctr_start - 1")
    expect(migrationSql).toContain("UPDATE public.employment_contracts ec")
    expect(migrationSql).toContain("UPDATE public.worker_vacations wv")
    expect(migrationSql).toContain("UPDATE public.worker_vacation_movements wvm")

    // Activación diferida también para altas iniciales futuras cuando llegue hire_date/start_date
    expect(migrationSql).toContain("CREATE OR REPLACE FUNCTION public.apply_due_scheduled_separations")
    expect(migrationSql).toContain("RAISE EXCEPTION")

    // WorkerDetail no descarta la asignación vigente reabierta porque ya tenga end_date = future_start - 1 (>= today)
    const workerDetail = fs.readFileSync(
      "src/modules/people/presentation/pages/WorkerDetail.tsx",
      "utf8"
    )
    expect(workerDetail).toContain("(!a.end_date || a.end_date >= today)")
    expect(workerDetail).toContain("(!a.end_date || a.end_date >= todayCuba)")
  })

  it("2. Trabajador con incorporación futura vinculado a un puesto muestra 'Vinculado (desde dd/mm/aaaa)' y no 'Pendiente de vinculación'", async () => {
    vi.spyOn(supabase, "from").mockImplementation((table: string) => {
      if (table === "worker_position_assignments") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          in: () => chain,
          order: async () => ({
            data: [
              {
                worker_id: "w-future",
                is_current: false,
                start_date: "2099-11-23",
                end_date: null,
              },
              {
                worker_id: "w-current",
                is_current: true,
                start_date: "2020-01-10",
                end_date: "2099-11-19",
              },
            ],
            error: null,
          }),
        }
        return chain as never
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const details = await fetchWorkersLinkageDetails(["w-future", "w-current", "w-unlinked"])
    expect(details["w-future"]).toEqual({
      linkedToday: false,
      scheduledStartDate: "2099-11-23",
    })
    expect(details["w-current"]).toEqual({
      linkedToday: true,
      scheduledStartDate: null,
    })
    expect(details["w-unlinked"]).toBeUndefined()

    vi.spyOn(accessControl, "loadEntityPermission").mockResolvedValue(true)
    vi.spyOn(peopleRepo, "fetchEntityActiveWorkers").mockResolvedValue([
      {
        id: "w-future",
        code: "T-001",
        first_name: "Pedro",
        first_surname: "Tester",
        second_surname: null,
        identification: "99010112345",
        gender_id: null,
        marital_status_id: null,
        skin_color_id: null,
        education_level_id: null,
        phone: null,
        email: null,
        birth_date: null,
        province: null,
        municipality: null,
        address: null,
        specialty: null,
        has_masters_degree: null,
        has_doctorate_degree: null,
        hire_date: "2099-11-23",
        employment_start_date: null,
        employment_status: "active",
      } as never,
    ])
    vi.spyOn(peopleRepo, "fetchGenders").mockResolvedValue([])
    vi.spyOn(peopleRepo, "fetchMaritalStatuses").mockResolvedValue([])
    vi.spyOn(peopleRepo, "fetchSkinColorsCatalog").mockResolvedValue([])
    vi.spyOn(peopleRepo, "fetchEducationLevels").mockResolvedValue([])

    const dirView = await loadEntityWorkersDirectory("ent-1")
    expect(dirView.linkageByWorker["w-future"]).toEqual({
      linkedToday: false,
      scheduledStartDate: "2099-11-23",
    })

    const entityWorkersSrc = fs.readFileSync(
      "src/modules/people/presentation/pages/EntityWorkers.tsx",
      "utf8"
    )
    expect(entityWorkersSrc).toContain("Vinculado (desde {formatIsoDateToDisplay(futureStart)})")
    expect(entityWorkersSrc).not.toContain('linkedWorkerIds.has(w.id) ? (\n                        <SiteCorpStatusBadge status="neutral">')

    // Smoke render of EntityWorkers initial state
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(EntityWorkers))
    )
    expect(html).toContain("Trabajadores")
  })

  it("3. fetchPendingContractDocuments lee exclusivamente de document_generation_jobs y nunca consulta employment_contracts", async () => {
    const queriedTables: string[] = []

    vi.spyOn(supabase, "from").mockImplementation((table: string) => {
      queriedTables.push(table)
      if (table === "document_generation_jobs") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: async () => ({
            data: [
              {
                id: "job-1",
                organization_entity_id: "ent-1",
                worker_id: "w-1",
                kind: "ADDENDUM",
                source_id: "add-1",
                status: "PENDIENTE",
                attempts: 0,
                last_error: null,
                worker_document_id: null,
                updated_at: "2026-11-16T10:00:00.000Z",
              },
            ],
            error: null,
          }),
        }
        return chain as never
      }
      if (table === "workers") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          in: async () => ({
            data: [
              {
                id: "w-1",
                first_name: "Carlos",
                first_surname: "Ficticio",
                second_surname: null,
                identification: "90010112345",
              },
            ],
            error: null,
          }),
        }
        return chain as never
      }
      throw new Error(`No debe consultar la tabla ${table}`)
    })

    const rows = await fetchPendingContractDocuments("ent-1")
    expect(queriedTables).toEqual(["document_generation_jobs", "workers"])
    expect(queriedTables).not.toContain("employment_contracts")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      job_id: "job-1",
      kind: "ADDENDUM",
      source_id: "add-1",
      worker_name: "Carlos Ficticio",
      worker_identification: "90010112345",
      document_status: "PENDIENTE",
    })

    // Incluso ante error en document_generation_jobs no hace fallback a employment_contracts
    queriedTables.length = 0
    vi.spyOn(supabase, "from").mockImplementation((table: string) => {
      queriedTables.push(table)
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: async () => ({ data: null, error: { message: "db error" } }),
      }
      return chain as never
    })

    const emptyOnError = await fetchPendingContractDocuments("ent-1")
    expect(emptyOnError).toEqual([])
    expect(queriedTables).toEqual(["document_generation_jobs"])
    expect(queriedTables).not.toContain("employment_contracts")
  })

  it("4a. SST lista de accidentes traduce severity (GRAVE -> Grave)", () => {
    expect(formatAccidentSeverityLabel("GRAVE")).toBe("Grave")
    expect(formatAccidentSeverityLabel("LEVE")).toBe("Leve")
    expect(formatAccidentSeverityLabel("MODERADO")).toBe("Moderado")
    expect(formatAccidentSeverityLabel("MORTAL")).toBe("Mortal")

    const html = renderToStaticMarkup(
      React.createElement(SstSpecializedSections, {
        entityId: "ent-1",
        canManage: false,
        areas: [],
        jobs: [],
        workers: [],
        onRefresh: async () => {},
        state: {
          committeeRecords: [],
          emergencyPlans: [],
          safeWorkProcedures: [],
          risks: [],
          preventiveActions: [],
          sessions: [],
          accidentsIncidents: [
            {
              id: "acc-1",
              organization_entity_id: "ent-1",
              area_id: null,
              area_name_snapshot: null,
              job_id: null,
              job_name_snapshot: "Operario",
              affected_worker_id: "w-1",
              affected_worker_name: "Carlos Ficticio",
              event_type: "ACCIDENTE_CON_LESION",
              occurred_at: "2026-11-16",
              description: "Corte en mano con cuchilla",
              immediate_causes: null,
              root_causes: null,
              severity: "GRAVE",
              days_lost: 5,
              corrective_actions: null,
              investigated_by: null,
              status: "ABIERTA",
              created_at: "2026-11-16T10:00:00Z",
            },
          ],
          healthAptitudes: [],
        } as never,
      })
    )
    expect(html).toContain("Severidad: Grave")
    expect(html).not.toContain("Severidad: GRAVE")
  })

  it("4b. SST entrega de EPP deshabilita stock 0 y selecciona/muestra el puesto vigente hoy, nunca el programado", () => {
    const selected = selectCurrentSstAssignment(
      [
        {
          is_current: false,
          start_date: "2026-11-20",
          end_date: null,
          position: { id: "pos-fut", name: "Técnico QA" },
        },
        {
          is_current: true,
          start_date: "2026-11-16",
          end_date: "2026-11-19",
          position: { id: "pos-hoy", name: "Especialista RRHH QA" },
        },
      ],
      "2026-11-16"
    )
    expect(selected?.position?.name).toBe("Especialista RRHH QA")

    // Incluso si por error la futura tuviera is_current=true, nunca se elige para hoy
    const neverFuture = selectCurrentSstAssignment(
      [
        {
          is_current: true,
          start_date: "2026-11-20",
          end_date: null,
          position: { id: "pos-fut", name: "Técnico QA" },
        },
      ],
      "2026-11-16"
    )
    expect(neverFuture).toBeNull()

    const eppSectionSrc = fs.readFileSync(
      "src/modules/sst/presentation/components/SstEppAndInspectionsSection.tsx",
      "utf8"
    )
    expect(eppSectionSrc).toContain("disabled={stock <= 0}")
    expect(eppSectionSrc).toContain("— Sin stock")
    expect(eppSectionSrc).toContain("w.positionName")

    // Smoke render of SstEppAndInspectionsSection
    const html = renderToStaticMarkup(
      React.createElement(SstEppAndInspectionsSection, {
        entityId: "ent-1",
        canManage: true,
        areas: [],
        jobs: [],
        workers: [
          {
            id: "w-1",
            code: "T-01",
            fullName: "Carlos Ficticio",
            identification: "90010112345",
            jobId: "j-1",
            jobName: "Especialista RRHH",
            areaId: "a-1",
            areaName: "RRHH",
            positionId: "p-1",
            positionName: "Especialista RRHH QA",
            employmentStatus: "active",
            hireDate: "2026-11-16",
          },
        ],
        onRefresh: async () => {},
        state: {
          eppCatalog: [
            {
              id: "epp-0",
              organization_entity_id: "ent-1",
              name: "Guantes sin stock",
              category: "MANOS",
              default_lifespan_days: 180,
              stock_quantity: 0,
              min_stock_alert: 3,
              is_active: true,
            },
            {
              id: "epp-5",
              organization_entity_id: "ent-1",
              name: "Casco disponible",
              category: "CABEZA",
              default_lifespan_days: 365,
              stock_quantity: 5,
              min_stock_alert: 2,
              is_active: true,
            },
          ],
          jobEppRequirements: [],
          workerEppDeliveries: [],
          inspections: [],
          inspectionFindings: [],
        } as never,
      })
    )
    expect(html).toContain("Registrar entrega a trabajador")
    expect(html).toContain("Guantes sin stock")
    expect(html).toContain("Stock: 0 u.")
  })
})
