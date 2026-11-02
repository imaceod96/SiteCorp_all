import * as React from "react"
import { useNavigate } from "react-router-dom"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SelectItem } from "@/shared/components/ui/select"
import { Users, UserPlus, Building2, Search, Edit, Eye } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { selectColumn, selectQuery } from "@/integrations/supabase/schema-target"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog"
import { Checkbox } from "@/shared/components/ui/checkbox"
import { Label } from "@/shared/components/ui/label"
import CandidateForm from "@/modules/people/presentation/components/CandidateForm"
import {
  CANDIDATES_CHANGED_EVENT,
  fetchCandidatesPoolMeta,
  notifyCandidatesChanged,
  saveCandidateAreaMeta,
  saveCandidateEntitiesMeta,
} from "@/modules/people/infrastructure/candidate-pool-meta"
import {
  fetchDeduplicatedGlobalAreas,
} from "@/modules/people/infrastructure/people.repository"
import {
  buildEmploymentIndex,
  filterUnlinkedCandidates,
  isPendingCandidate,
} from "@/modules/people/domain/rules"
import type { PersonCandidate } from "@/modules/people/domain/entities"

interface EntityRow {
  id: string
  name: string
  tenant_id: string
}

export interface AdminCandidateItem extends PersonCandidate {
  area_name: string | null
  postulatedEntityIds: string[]
}

export interface GroupedPoolCandidate {
  identification: string
  first_name: string
  first_surname: string
  second_surname: string | null
  phone: string | null
  email: string | null
  province: string | null
  municipality: string | null
  specialty: string | null
  profession_or_trade: string | null
  area_id: string | null
  area_name: string | null
  postulatedEntityIds: string[]
  records: AdminCandidateItem[]
}

export default function AdminCandidates() {
  const navigate = useNavigate()

  const [candidates, setCandidates] = React.useState<AdminCandidateItem[]>([])
  const [entities, setEntities] = React.useState<EntityRow[]>([])
  const [globalAreas, setGlobalAreas] = React.useState<{ id: string; name: string }[]>([])
  const [areaNameById, setAreaNameById] = React.useState<Map<string, string>>(new Map())
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = React.useState<string | null>(null)

  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedAreaId, setSelectedAreaId] = React.useState<string>("all")
  const [selectedEntityId, setSelectedEntityId] = React.useState<string>("all")

  // Modal para Nuevo Candidato
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)

  // Modal para Editar Ficha Completa
  const [editingCandidate, setEditingCandidate] = React.useState<{
    id: string
    entityId: string
    fullName: string
  } | null>(null)

  // Modal para Asignar a Entidades
  const [assignModalGroup, setAssignModalGroup] = React.useState<GroupedPoolCandidate | null>(null)
  const [targetEntityIds, setTargetEntityIds] = React.useState<string[]>([])
  const [assigning, setAssigning] = React.useState(false)
  const [assignError, setAssignError] = React.useState<string | null>(null)

  const loadData = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true)
    }
    setError(null)
    try {
      // 1. Cargar todas las entidades de la plataforma (con su cliente/tenant_id resuelto)
      const [entRes, rawCandRes, allAreasRes, dedupAreas] = await Promise.all([
        supabase
          .from("organization_entities")
          .select(selectQuery(`id, name, ${selectColumn("clientId")}`))
          .order("name"),
        filterUnlinkedCandidates(
          supabase
            .from("candidates")
            .select(selectQuery(`*, ${selectColumn("clientId")}`))
        ).order("created_at", { ascending: false }),
        supabase.from("organization_areas").select("id, name"),
        fetchDeduplicatedGlobalAreas(),
      ])

      if (entRes.error) throw entRes.error
      if (rawCandRes.error) throw rawCandRes.error

      const fetchedEntities = ((entRes.data || []) as unknown as EntityRow[])
      setEntities(fetchedEntities)

      const rawCandidates = ((rawCandRes.data || []) as unknown as PersonCandidate[])

      // 2. Excluir candidatos que ya fueron contratados como trabajadores en cualquier entidad
      const identifications = Array.from(
        new Set(rawCandidates.map((c) => (c.identification ?? "").trim()).filter(Boolean))
      )

      const [workerRes, poolMeta] = await Promise.all([
        identifications.length > 0
          ? supabase
              .from("workers")
              .select("identification, employment_status")
              .in("identification", identifications)
          : Promise.resolve({ data: [] }),
        fetchCandidatesPoolMeta(rawCandidates.map((c) => c.id)),
      ])

      const employmentIndex = buildEmploymentIndex(
        (workerRes.data as { identification: string; employment_status: string | null }[]) || []
      )

      const pendingCandidates = rawCandidates.filter((c) =>
        isPendingCandidate(c, employmentIndex)
      )

      // 3. Mapa de áreas y áreas globales sin duplicados
      const fullAreaMap = new Map<string, string>()
      ;((allAreasRes.data || []) as { id: string; name: string }[]).forEach((a) => {
        if (a.id && a.name) fullAreaMap.set(a.id, a.name.trim())
      })
      setAreaNameById(fullAreaMap)
      setGlobalAreas(dedupAreas)

      const validEntityIds = new Set(fetchedEntities.map((e) => e.id))

      const mapped: AdminCandidateItem[] = pendingCandidates.map((c) => {
        const resolvedAreaId = poolMeta.areaByCandidateId.get(c.id) ?? c.area_id ?? null
        const resolvedAreaName = resolvedAreaId ? fullAreaMap.get(resolvedAreaId) ?? null : null

        const explicitEntities = poolMeta.entitiesByCandidateId.get(c.id)
        const postulatedEntityIds =
          explicitEntities !== undefined
            ? explicitEntities.filter((id) => validEntityIds.has(id))
            : validEntityIds.has(c.organization_entity_id)
              ? [c.organization_entity_id]
              : []

        return {
          ...c,
          area_id: resolvedAreaId,
          area_name: resolvedAreaName,
          postulatedEntityIds,
        }
      })

      setCandidates(mapped)
    } catch (err) {
      console.error("Error loading admin candidates:", err)
      if (!options?.silent) {
        setError(
          err instanceof Error ? err.message : "Error al cargar la bolsa de candidatos"
        )
      }
    } finally {
      if (!options?.silent) {
        setLoading(false)
      }
    }
  }, [])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  React.useEffect(() => {
    const handleChanged = () => {
      loadData({ silent: true })
    }
    window.addEventListener(CANDIDATES_CHANGED_EVENT, handleChanged)

    const channel = supabase
      .channel("admin_global_candidates_pool")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "candidates" },
        () => loadData({ silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workers" },
        () => loadData({ silent: true })
      )
      .subscribe()

    return () => {
      window.removeEventListener(CANDIDATES_CHANGED_EVENT, handleChanged)
      supabase.removeChannel(channel)
    }
  }, [loadData])

  const entityMap = React.useMemo(() => {
    const map = new Map<string, EntityRow>()
    entities.forEach((e) => map.set(e.id, e))
    return map
  }, [entities])

  // Agrupar candidatos por número de identificación para la Bolsa Global
  const groupedCandidates = React.useMemo<GroupedPoolCandidate[]>(() => {
    const map = new Map<string, GroupedPoolCandidate>()

    for (const c of candidates) {
      const key = (c.identification ?? "").trim() || c.id
      if (!map.has(key)) {
        map.set(key, {
          identification: c.identification,
          first_name: c.first_name,
          first_surname: c.first_surname,
          second_surname: c.second_surname,
          phone: c.phone,
          email: c.email,
          province: c.province,
          municipality: c.municipality,
          specialty: c.specialty,
          profession_or_trade: c.profession_or_trade,
          area_id: c.area_id,
          area_name: c.area_name,
          postulatedEntityIds: [],
          records: [],
        })
      }

      const group = map.get(key)!
      group.records.push(c)
      if (!group.area_id && c.area_id) {
        group.area_id = c.area_id
        group.area_name = c.area_name
      }
      for (const entId of c.postulatedEntityIds) {
        if (!group.postulatedEntityIds.includes(entId)) {
          group.postulatedEntityIds.push(entId)
        }
      }
    }

    return Array.from(map.values())
  }, [candidates])

  // Filtrado por texto, área (comparando también por nombre normalizado) y entidad
  const filteredGrouped = React.useMemo(() => {
    const selectedAreaNameNorm =
      selectedAreaId !== "all"
        ? (areaNameById.get(selectedAreaId) || "").trim().toLowerCase()
        : ""

    return groupedCandidates.filter((item) => {
      const fullName = `${item.first_name} ${item.first_surname} ${item.second_surname || ""}`.toLowerCase()
      const q = searchQuery.trim().toLowerCase()
      const matchesSearch =
        !q ||
        fullName.includes(q) ||
        item.identification.toLowerCase().includes(q) ||
        Boolean(item.email && item.email.toLowerCase().includes(q)) ||
        Boolean(item.profession_or_trade && item.profession_or_trade.toLowerCase().includes(q))

      const itemAreaNorm = (item.area_name || "").trim().toLowerCase()
      const matchesArea =
        selectedAreaId === "all" ||
        item.area_id === selectedAreaId ||
        (Boolean(selectedAreaNameNorm) && itemAreaNorm === selectedAreaNameNorm)

      const matchesEntity =
        selectedEntityId === "all"
          ? true
          : selectedEntityId === "__unassigned__"
            ? item.postulatedEntityIds.length === 0
            : item.postulatedEntityIds.includes(selectedEntityId)

      return matchesSearch && matchesArea && matchesEntity
    })
  }, [groupedCandidates, searchQuery, selectedAreaId, selectedEntityId, areaNameById])

  const handleOpenAssignModal = (group: GroupedPoolCandidate) => {
    setAssignError(null)
    setAssignModalGroup(group)
    setTargetEntityIds([...group.postulatedEntityIds])
  }

  const handleSaveAssignments = async () => {
    if (!assignModalGroup) return
    setAssigning(true)
    setAssignError(null)

    try {
      const uniqueTargets = Array.from(new Set(targetEntityIds.filter(Boolean)))
      const primaryRecord = assignModalGroup.records[0]

      // 1. Agrupar las entidades seleccionadas por cliente (tenant_id)
      const targetEntitiesByTenant = new Map<string, string[]>()
      for (const entId of uniqueTargets) {
        const ent = entityMap.get(entId)
        if (!ent) continue
        const list = targetEntitiesByTenant.get(ent.tenant_id) || []
        list.push(entId)
        targetEntitiesByTenant.set(ent.tenant_id, list)
      }

      // 2. Actualizar todas las filas existentes de este candidato
      const existingByTenant = new Map<string, AdminCandidateItem>()
      for (const rec of assignModalGroup.records) {
        existingByTenant.set(rec.tenant_id, rec)
        const tenantTargets = targetEntitiesByTenant.get(rec.tenant_id) || []
        const preferredHostEntityId = tenantTargets[0] || rec.organization_entity_id

        if (preferredHostEntityId !== rec.organization_entity_id) {
          await supabase
            .from("candidates")
            .update({
              organization_entity_id: preferredHostEntityId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", rec.id)
        }

        await saveCandidateEntitiesMeta(rec.id, preferredHostEntityId, uniqueTargets)
        if (assignModalGroup.area_id) {
          await saveCandidateAreaMeta(rec.id, preferredHostEntityId, assignModalGroup.area_id)
        }
      }

      // 3. Si se postuló a una entidad de otro cliente donde aún no tenía fila en `candidates`, crearla
      for (const [tenantId, entIds] of targetEntitiesByTenant.entries()) {
        if (!existingByTenant.has(tenantId) && entIds.length > 0 && primaryRecord) {
          const hostEntityId = entIds[0]
          try {
            const { insertCandidate } = await import(
              "@/modules/people/infrastructure/candidate-registration.repository"
            )
            const newId = await insertCandidate({
              companyClientId: tenantId,
              entityId: hostEntityId,
              first_name: primaryRecord.first_name,
              first_surname: primaryRecord.first_surname,
              second_surname: primaryRecord.second_surname,
              identification: primaryRecord.identification,
              birth_date: primaryRecord.birth_date,
              gender_id: primaryRecord.gender_id,
              marital_status_id: primaryRecord.marital_status_id,
              phone: primaryRecord.phone,
              email: primaryRecord.email,
              address: primaryRecord.address,
              municipality: primaryRecord.municipality,
              province: primaryRecord.province,
              education_level_id: primaryRecord.education_level_id,
              specialty: primaryRecord.specialty,
              area_id: assignModalGroup.area_id,
              has_masters_degree: Boolean(primaryRecord.has_masters_degree),
              has_doctorate_degree: Boolean(primaryRecord.has_doctorate_degree),
              profession_or_trade: primaryRecord.profession_or_trade,
              skin_color_id: primaryRecord.skin_color_id,
              political_affiliation: primaryRecord.political_affiliation,
              is_retired_or_rehired: Boolean(primaryRecord.is_retired_or_rehired),
              has_disciplinary_measures: Boolean(primaryRecord.has_disciplinary_measures),
            })
            await saveCandidateEntitiesMeta(newId, hostEntityId, uniqueTargets)
          } catch (crossErr) {
            console.warn("No se pudo crear réplica en otro cliente:", crossErr)
          }
        }
      }

      notifyCandidatesChanged()
      setAssignModalGroup(null)
      setActionSuccess("Asignación de entidades actualizada correctamente.")
      setTimeout(() => setActionSuccess(null), 3500)
      await loadData({ silent: true })
    } catch (err) {
      console.error("Error saving entity assignments:", err)
      setAssignError(
        err instanceof Error
          ? err.message
          : "No se pudieron actualizar las asignaciones de entidades."
      )
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Bolsa de Candidatos Global"
        description="Gestión centralizada del talento humano postulado en todas las entidades de la plataforma"
      />

      {error && <SiteCorpAlert type="error">{error}</SiteCorpAlert>}
      {actionSuccess && <SiteCorpAlert type="success">{actionSuccess}</SiteCorpAlert>}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <SiteCorpInput
              placeholder="Buscar por nombre, carnet o profesión..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="w-[220px]">
            <SiteCorpSelect
              value={selectedAreaId}
              onValueChange={(val) => setSelectedAreaId(val)}
              placeholder="Área de interés"
            >
              <SelectItem value="all">Todas las áreas</SelectItem>
              {globalAreas.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SiteCorpSelect>
          </div>

          <div className="w-[220px]">
            <SiteCorpSelect
              value={selectedEntityId}
              onValueChange={(val) => setSelectedEntityId(val)}
              placeholder="Entidad postulada"
            >
              <SelectItem value="all">Todas las entidades</SelectItem>
              <SelectItem value="__unassigned__">Sin entidad asignada</SelectItem>
              {entities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SiteCorpSelect>
          </div>
        </div>

        <SiteCorpButton
          onClick={() => setCreateDialogOpen(true)}
          className="inline-flex items-center gap-2 bg-sitecorp-primary text-white hover:bg-sitecorp-primary-dark"
        >
          <UserPlus className="h-4 w-4" />
          Nuevo Candidato en Bolsa
        </SiteCorpButton>
      </div>

      <SiteCorpCard>
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Cargando bolsa de candidatos...
          </div>
        ) : filteredGrouped.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-base font-semibold text-ink">
              No hay candidatos en la bolsa
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Registra un nuevo candidato o espera postulaciones desde las entidades.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <th className="py-3 px-4">Candidato</th>
                  <th className="py-3 px-4">Carnet de Identidad</th>
                  <th className="py-3 px-4">Área de Interés</th>
                  <th className="py-3 px-4">Profesión / Especialidad</th>
                  <th className="py-3 px-4">Entidades Postuladas</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {filteredGrouped.map((item) => {
                  const fullName = [
                    item.first_name,
                    item.first_surname,
                    item.second_surname,
                  ]
                    .filter(Boolean)
                    .join(" ")
                  const firstRecord = item.records[0]

                  return (
                    <tr
                      key={item.identification || firstRecord.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-ink">
                        <div>{fullName}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.email || item.phone || "Sin contacto"}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-ink">
                        {item.identification}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sitecorp-primary/10 text-sitecorp-primary">
                          {item.area_name || "Sin área asignada"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {item.profession_or_trade || item.specialty || item.province || "—"}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {item.postulatedEntityIds.length === 0 ? (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 border border-amber-500/20">
                              Disponible en Bolsa (sin entidad)
                            </span>
                          ) : (
                            item.postulatedEntityIds.map((entId) => {
                              const entName = entityMap.get(entId)?.name || "Entidad"
                              return (
                                <span
                                  key={entId}
                                  className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-ink border border-border"
                                >
                                  <Building2 className="h-3 w-3 text-muted-foreground" />
                                  {entName}
                                </span>
                              )
                            })
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <SiteCorpButton
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenAssignModal(item)}
                            title="Asignar a una o varias entidades"
                          >
                            <Building2 className="h-4 w-4 mr-1" />
                            Asignar
                          </SiteCorpButton>
                          <SiteCorpButton
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setEditingCandidate({
                                id: firstRecord.id,
                                entityId: firstRecord.organization_entity_id,
                                fullName,
                              })
                            }
                            title="Editar ficha completa"
                          >
                            <Edit className="h-4 w-4 mr-1" />
                            Editar
                          </SiteCorpButton>
                          <SiteCorpButton
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              navigate(
                                `/entity/${firstRecord.organization_entity_id}/candidates/${firstRecord.id}`
                              )
                            }
                            title="Ver expediente completo"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Expediente
                          </SiteCorpButton>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SiteCorpCard>

      {/* Modal Nuevo Candidato en Bolsa */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar Nuevo Candidato en la Bolsa Global</DialogTitle>
          </DialogHeader>
          {createDialogOpen && (
            <CandidateForm
              variant="dialog"
              mode="create"
              useGlobalAreas={true}
              onSuccess={() => {
                setCreateDialogOpen(false)
                setActionSuccess("Candidato registrado exitosamente en la Bolsa Global.")
                setTimeout(() => setActionSuccess(null), 3500)
                loadData({ silent: true })
              }}
              onCancel={() => setCreateDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Editar Ficha Completa */}
      <Dialog
        open={!!editingCandidate}
        onOpenChange={(open) => !open && setEditingCandidate(null)}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Editar Ficha: {editingCandidate?.fullName}
            </DialogTitle>
          </DialogHeader>
          {editingCandidate && (
            <CandidateForm
              variant="dialog"
              mode="edit"
              candidateId={editingCandidate.id}
              entityId={editingCandidate.entityId}
              useGlobalAreas={true}
              onSuccess={() => {
                setEditingCandidate(null)
                setActionSuccess("Ficha del candidato actualizada exitosamente.")
                setTimeout(() => setActionSuccess(null), 3500)
                loadData({ silent: true })
              }}
              onCancel={() => setEditingCandidate(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Asignar a Entidades */}
      <Dialog
        open={!!assignModalGroup}
        onOpenChange={(open) => !open && setAssignModalGroup(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar Candidato a Entidades</DialogTitle>
          </DialogHeader>
          {assignModalGroup && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Selecciona una o varias entidades en las que deseas postular a{" "}
                <span className="font-semibold text-ink">
                  {assignModalGroup.first_name} {assignModalGroup.first_surname}
                </span>
                . Si desmarcas todas, permanecerá únicamente en la Bolsa Global:
              </p>

              {assignError && <SiteCorpAlert type="error">{assignError}</SiteCorpAlert>}

              <div className="space-y-2 max-h-60 overflow-y-auto border border-border rounded-lg p-3">
                {entities.map((ent) => {
                  const isChecked = targetEntityIds.includes(ent.id)
                  return (
                    <div key={ent.id} className="flex items-center space-x-3 py-1.5">
                      <Checkbox
                        id={`ent-${ent.id}`}
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setTargetEntityIds((prev) =>
                              prev.includes(ent.id) ? prev : [...prev, ent.id]
                            )
                          } else {
                            setTargetEntityIds((prev) => prev.filter((id) => id !== ent.id))
                          }
                        }}
                      />
                      <Label
                        htmlFor={`ent-${ent.id}`}
                        className="text-sm font-medium text-ink cursor-pointer"
                      >
                        {ent.name}
                      </Label>
                    </div>
                  )
                })}
              </div>

              <DialogFooter className="pt-4">
                <SiteCorpButton
                  variant="outline"
                  onClick={() => setAssignModalGroup(null)}
                  disabled={assigning}
                >
                  Cancelar
                </SiteCorpButton>
                <SiteCorpButton onClick={handleSaveAssignments} disabled={assigning}>
                  {assigning ? "Guardando..." : "Guardar Asignaciones"}
                </SiteCorpButton>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
