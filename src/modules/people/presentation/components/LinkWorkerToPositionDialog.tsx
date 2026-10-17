import * as React from "react"
import { useParams } from "react-router-dom"
import { linkMigratedWorker } from "@/modules/people/application/worker-migration.commands"
import { fetchEntityPositionHierarchy } from "@/modules/organization-structure"
import type { WorkerPositionOption } from "@/modules/people/presentation/components/WorkerForm"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Button } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SelectItem } from "@/shared/components/ui/select"
import { Label } from "@/shared/components/ui/label"

interface Props { workerId: string; positions: WorkerPositionOption[]; onSuccess: () => void; onCancel: () => void }

export function LinkWorkerToPositionDialog({ workerId, positions, onSuccess, onCancel }: Props) {
  const { entityId } = useParams<{ entityId: string }>()
  const [positionId, setPositionId] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [hierarchy, setHierarchy] = React.useState<Record<string, { area: string; job: string }>>({})
  React.useEffect(() => {
    if (!entityId) return
    // Jerarquía de los puestos de la entidad: lectura del dominio de estructura organizativa.
    fetchEntityPositionHierarchy(entityId)
      .then(setHierarchy)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar la estructura."))
  }, [entityId])
  const available = positions.filter((position) => position.is_active && position.currentAssignments < position.authorized_quantity)
  const selected = positions.find((position) => position.id === positionId)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!positionId) return
    setBusy(true)
    setError("")
    try {
      await linkMigratedWorker(workerId, positionId)
      onSuccess()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo vincular al puesto.")
    } finally { setBusy(false) }
  }
  return <form onSubmit={submit} className="space-y-4">
    {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}
    <p className="text-sm text-slate-600">Solo se crea un Assignment. No se crea contrato ni se generan documentos.</p>
    <div className="space-y-2"><Label>Puesto con capacidad disponible</Label><SiteCorpSelect value={positionId || undefined} onValueChange={(value) => setPositionId(value === "__placeholder__" ? "" : value)}><SelectItem value="__placeholder__">Seleccionar puesto</SelectItem>{available.filter((position) => position.id && position.id.trim() !== "").map((position) => <SelectItem key={position.id} value={position.id}>{hierarchy[position.id]?.area || "Área"} → {hierarchy[position.id]?.job || position.job?.name || "Cargo"} → {position.name} · {position.currentAssignments}/{position.authorized_quantity} ocupados</SelectItem>)}</SiteCorpSelect></div>
    {selected && <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm"><div><span className="text-slate-500">Área</span><p className="font-medium">{hierarchy[selected.id]?.area || "—"}</p></div><div><span className="text-slate-500">Cargo</span><p className="font-medium">{hierarchy[selected.id]?.job || selected.job?.name || "—"}</p></div><div><span className="text-slate-500">Puesto</span><p className="font-medium">{selected.name} ({selected.code})</p></div><div><span className="text-slate-500">Capacidad</span><p className="font-medium">{selected.currentAssignments}/{selected.authorized_quantity}</p></div></div>}
    {!available.length && <SiteCorpAlert type="warning">No hay puestos activos con capacidad disponible.</SiteCorpAlert>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={busy || !positionId}>{busy ? "Vinculando…" : "Vincular a plantilla"}</Button></div>
  </form>
}
