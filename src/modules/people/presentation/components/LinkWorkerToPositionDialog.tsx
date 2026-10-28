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
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group"
import { Badge } from "@/shared/components/ui/badge"

interface Props {
  workerId: string
  positions: WorkerPositionOption[]
  onSuccess: () => void
  onCancel: () => void
}

interface SuggestedPosition {
  positionId: string
  positionName: string
  areaMatch: boolean
  jobMatch: boolean
  currentAssignments: number
  authorizedQuantity: number
}

export function LinkWorkerToPositionDialog({ workerId, positions, onSuccess, onCancel }: Props) {
  const { entityId } = useParams<{ entityId: string }>()
  const [positionId, setPositionId] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [hierarchy, setHierarchy] = React.useState<Record<string, { area: string; job: string }>>({})
  const [mode, setMode] = React.useState<"manual" | "auto">("manual")
  const [suggestedPositions, setSuggestedPositions] = React.useState<SuggestedPosition[]>([])

  const available = positions.filter((position) => position.is_active && position.currentAssignments < position.authorized_quantity)
  const selected = positions.find((position) => position.id === positionId)

  React.useEffect(() => {
    if (!entityId) return
    // Jerarquía de los puestos de la entidad: lectura del dominio de estructura organizativa.
    fetchEntityPositionHierarchy(entityId)
      .then(setHierarchy)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar la estructura."))
  }, [entityId])

  const computeSuggestedPositions = React.useCallback((
    availablePositions: WorkerPositionOption[]
  ): SuggestedPosition[] => {
    const suggestions: SuggestedPosition[] = []
    
    availablePositions.forEach(position => {
      const positionArea = hierarchy[position.id]?.area || position.job?.area?.name || ""
      const positionJob = hierarchy[position.id]?.job || position.job?.name || ""
      
      // Para el emparejamiento automático, necesitamos determinar el área/cargo del trabajador
      // Esto podría venir de su posición anterior o ser genérico
      // Por ahora, usaremos un emparejamiento simple basado en el nombre del puesto
      const workerArea = "Área"  // TODO: Obtener del trabajador
      const workerJob = "Cargo"   // TODO: Obtener del trabajador
      
      const areaMatch = workerArea === positionArea
      const jobMatch = workerJob === positionJob
      
      if (areaMatch || jobMatch) {
        suggestions.push({
          positionId: position.id,
          positionName: position.name,
          areaMatch,
          jobMatch,
          currentAssignments: position.currentAssignments,
          authorizedQuantity: position.authorized_quantity
        })
      }
    })
    
    return suggestions
  }, [hierarchy])

  const handleModeChange = (value: string) => {
    setMode(value as "manual" | "auto")
    // Reset states when switching modes
    setPositionId("")
    setSuggestedPositions([])
    setError("")
  }

  const handleAutoMatching = () => {
    const suggestions = computeSuggestedPositions(available)
    setSuggestedPositions(suggestions)
    // Auto-seleccionar la primera sugerencia si existe
    if (suggestions.length > 0) {
      setPositionId(suggestions[0].positionId)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    
    if (mode === "manual") {
      if (!positionId) return
    } else {
      if (!positionId) {
        setError("Por favor, selecciona una posición sugerida o usa la selección manual.")
        return
      }
    }
    
    setBusy(true)
    setError("")
    
    try {
      await linkMigratedWorker(workerId, positionId)
      onSuccess()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : typeof cause === "object" && cause !== null && "message" in cause ? String((cause as { message?: unknown }).message) : "No se pudo vincular al puesto."
      setError(message)
    } finally { setBusy(false) }
  }

  return <form onSubmit={submit} className="space-y-4">
    {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}
    <p className="text-sm text-slate-600">Solo se crea un Assignment. No se crea contrato ni se generan documentos.</p>

    {/* Selector de Modo */}
    <div className="space-y-2">
      <Label>Modo de Vinculación</Label>
      <RadioGroup value={mode} onValueChange={handleModeChange} className="flex gap-4">
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="manual" id="manual" />
          <Label htmlFor="manual" className="text-sm font-normal">Selección Manual</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="auto" id="auto" />
          <Label htmlFor="auto" className="text-sm font-normal">Asignación Automática por Cargo/Área</Label>
        </div>
      </RadioGroup>
    </div>

    {mode === "manual" ? (
      // Panel de Selección Manual (existente)
      <div className="space-y-2">
        <Label>Puesto con capacidad disponible</Label>
        <SiteCorpSelect value={positionId || undefined} onValueChange={(value) => setPositionId(value === "__placeholder__" ? "" : value)}>
          <SelectItem value="__placeholder__">Seleccionar puesto</SelectItem>
          {available.filter((position) => position.id && position.id.trim() !== "").map((position) => (
            <SelectItem key={position.id} value={position.id}>
              {hierarchy[position.id]?.area || "Área"} → {hierarchy[position.id]?.job || position.job?.name || "Cargo"} → {position.name} · {position.currentAssignments}/{position.authorized_quantity} ocupados
            </SelectItem>
          ))}
        </SiteCorpSelect>
      </div>
    ) : (
      // Panel de Asignación Automática
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Sugerencias de Puestos</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAutoMatching}
          >
            Generar Sugerencias
          </Button>
        </div>

        {suggestedPositions.length > 0 && (
          <div className="space-y-2">
            <Label>Puestos Sugeridos ({suggestedPositions.length})</Label>
            <div className="max-h-60 overflow-y-auto rounded-md border border-border p-3">
              {suggestedPositions.map((suggestion) => (
                <div
                  key={suggestion.positionId}
                  className={`flex items-center space-x-2 py-2 border-b border-border last:border-b-0 cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors ${positionId === suggestion.positionId ? 'bg-sitecorp-primary/10 border-sitecorp-primary/30' : ''}`}
                  onClick={() => setPositionId(suggestion.positionId)}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      {suggestion.positionName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {suggestion.areaMatch ? "✓ Área" : "Área"} {suggestion.jobMatch ? "✓ Cargo" : "Cargo"} · {suggestion.currentAssignments}/{suggestion.authorizedQuantity} ocupados
                    </div>
                  </div>
                  {positionId === suggestion.positionId && (
                    <Badge variant="default" className="text-xs">Seleccionado</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {suggestedPositions.length === 0 && (
          <SiteCorpAlert type="info">
            Haz clic en "Generar Sugerencias" para ver puestos que coinciden con el área/cargo del trabajador.
          </SiteCorpAlert>
        )}
      </div>
    )}

    {mode === "manual" && selected && (
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
        <div><span className="text-slate-500">Área</span><p className="font-medium">{hierarchy[selected.id]?.area || "—"}</p></div>
        <div><span className="text-slate-500">Cargo</span><p className="font-medium">{hierarchy[selected.id]?.job || selected.job?.name || "—"}</p></div>
        <div><span className="text-slate-500">Puesto</span><p className="font-medium">{selected.name} ({selected.code})</p></div>
        <div><span className="text-slate-500">Capacidad</span><p className="font-medium">{selected.currentAssignments}/{selected.authorized_quantity}</p></div>
      </div>
    )}

    {mode === "auto" && positionId && (
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
        {(() => {
          const suggested = suggestedPositions.find(s => s.positionId === positionId)
          if (!suggested) return null
          return (
            <>
              <div><span className="text-slate-500">Área</span><p className="font-medium">{hierarchy[positionId]?.area || "—"}</p></div>
              <div><span className="text-slate-500">Cargo</span><p className="font-medium">{hierarchy[positionId]?.job || positions.find(p => p.id === positionId)?.job?.name || "—"}</p></div>
              <div><span className="text-slate-500">Puesto</span><p className="font-medium">{positions.find(p => p.id === positionId)?.name} ({positions.find(p => p.id === positionId)?.code})</p></div>
              <div><span className="text-slate-500">Capacidad</span><p className="font-medium">{positions.find(p => p.id === positionId)?.currentAssignments}/{positions.find(p => p.id === positionId)?.authorized_quantity}</p></div>
            </>
          )
        })()}
      </div>
    )}

    {!available.length && <SiteCorpAlert type="warning">No hay puestos activos con capacidad disponible.</SiteCorpAlert>}

    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
      <Button type="submit" disabled={busy || (mode === "manual" && !positionId) || (mode === "auto" && !positionId)}>
        {busy ? "Vinculando…" : "Vincular a plantilla"}
      </Button>
    </div>
  </form>
}