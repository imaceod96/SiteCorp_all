import * as React from "react"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { Label } from "@/shared/components/ui/label"
import { Textarea } from "@/shared/components/ui/textarea"
import {
  areaParentOptions,
  areaSaveErrorMessage,
  saveArea,
  validateAreaInput,
  type OrganizationArea,
} from "@/modules/organization-structure"

/**
 * Área de la entidad: alta y edición.
 *
 * El formulario no compone consultas ni habla con Supabase: valida con las reglas puras del
 * dominio (nombre obligatorio y área superior de la misma entidad) y delega el guardado en
 * su caso de uso. El código del área lo genera la base de datos y es de sólo lectura.
 *
 * La jerarquía se edita eligiendo «Área superior»: un área nunca puede colgar de sí misma ni
 * de su propia rama (ni crear ciclos), y el backend lo impone de nuevo al guardar.
 */
interface AreaFormProps {
  entityId: string
  areas: OrganizationArea[]
  editingArea: OrganizationArea | null
  onSuccess: () => void
  onCancel: () => void
}

export const AreaForm: React.FC<AreaFormProps> = ({
  entityId,
  areas,
  editingArea,
  onSuccess,
  onCancel,
}) => {
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [hierarchyOrder, setHierarchyOrder] = React.useState<string>(() =>
    editingArea?.hierarchy_order !== undefined ? String(editingArea.hierarchy_order) : "0"
  )
  const [selectedParentId, setSelectedParentId] = React.useState<string>(
    () => editingArea?.parent_area_id || ""
  )

  React.useEffect(() => {
    setHierarchyOrder(
      editingArea?.hierarchy_order !== undefined ? String(editingArea.hierarchy_order) : "0"
    )
    setSelectedParentId(editingArea?.parent_area_id || "")
  }, [editingArea])

  const parsedOrder = parseInt(hierarchyOrder, 10)
  const effectiveOrder = Number.isNaN(parsedOrder) ? 0 : parsedOrder

  // Opciones de «Área superior»: activas de esta entidad, sin el área ni sus descendientes,
  // y con orden menor o igual al orden del área actual.
  const parentOptions = React.useMemo(
    () => areaParentOptions(areas, editingArea, effectiveOrder),
    [areas, editingArea, effectiveOrder]
  )

  React.useEffect(() => {
    if (selectedParentId && !parentOptions.some((a) => a.id === selectedParentId)) {
      setSelectedParentId("")
    }
  }, [parentOptions, selectedParentId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId) return

    setFormError(null)

    const form = e.target as HTMLFormElement
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim()
    const description =
      (form.elements.namedItem("description") as HTMLTextAreaElement).value.trim() || null
    const parent_area_id = selectedParentId.trim() || null

    const validationError = validateAreaInput({
      name,
      parentAreaId: parent_area_id,
      entityId,
      areas,
      hierarchyOrder: effectiveOrder,
      editingAreaId: editingArea ? editingArea.id : null,
    })
    if (validationError) {
      setFormError(validationError)
      return
    }

    setSubmitting(true)

    try {
      await saveArea({
        entityId,
        areaId: editingArea ? editingArea.id : null,
        name,
        description,
        parentAreaId: parent_area_id,
        hierarchyOrder: effectiveOrder,
      })
      onSuccess()
    } catch (err) {
      console.error("Error saving area:", err)
      setFormError(areaSaveErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && <SiteCorpAlert type="danger">{formError}</SiteCorpAlert>}

      <div className="space-y-2">
        <Label htmlFor="area-name">Nombre *</Label>
        <SiteCorpInput
          id="area-name"
          name="name"
          defaultValue={editingArea?.name || ""}
          placeholder="Ej.: Recursos Humanos"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="area-order">Orden</Label>
        <SiteCorpInput
          id="area-order"
          name="hierarchy_order"
          type="number"
          value={hierarchyOrder}
          onChange={(e) => setHierarchyOrder(e.target.value)}
          placeholder="0"
        />
        <p className="text-xs text-muted-foreground">
          Define la posición del área en la ventana de áreas y en la plantilla (menor número = mayor prioridad).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="area-parent">Área superior</Label>
        <SiteCorpSelect
          name="parent_area_id"
          value={selectedParentId}
          onValueChange={setSelectedParentId}
        >
          <option value="">Sin área superior (área principal)</option>
          {parentOptions.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name} (Orden {area.hierarchy_order})
            </option>
          ))}
        </SiteCorpSelect>
        <p className="text-xs text-muted-foreground">
          Dejar vacío para crear un área principal. Nunca un área de orden mayor puede estar por encima de una de orden menor.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="area-description">Descripción</Label>
        <Textarea
          id="area-description"
          name="description"
          defaultValue={editingArea?.description || ""}
          placeholder="Descripción opcional del área"
          rows={2}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <SiteCorpButton variant="outline" type="button" onClick={onCancel}>
          Cancelar
        </SiteCorpButton>
        <SiteCorpButton type="submit" disabled={submitting}>
          {submitting ? "Guardando..." : editingArea ? "Guardar cambios" : "Crear área"}
        </SiteCorpButton>
      </div>
    </form>
  )
}

