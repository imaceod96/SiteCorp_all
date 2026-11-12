import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpCheckbox } from "@/shared/components/ui/sitecorp-checkbox"
import { Label } from "@/shared/components/ui/label"
import { Textarea } from "@/shared/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/components/ui/dialog"
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  CheckCircle,
  X,
  Loader2,
  ChevronDown,
} from "lucide-react"
import { SelectItem } from "@/shared/components/ui/select"
import AcademicCategoryPaymentSection from "@/modules/organization-structure/presentation/components/AcademicCategoryPaymentSection"
import {
  EMPTY_TENURE_FORM,
  createTenureScaleRange,
  deleteTenureScaleRange,
  formatTenureMonths,
  formatTenureRange,
  loadTenureScaleRanges,
  tenureRangeToForm,
  updateTenureScaleRangeById,
  type TenureScaleFormValues,
  type TenureScaleRange,
} from "@/modules/organization-structure"
import { showSuccess, showError } from "@/utils/toast"

/**
 * Escala de pago de antigüedad de UNA entidad.
 *
 * La lectura, la conversión meses/años, las validaciones y las escrituras viven en el
 * dominio de estructura organizativa. La escala es propia de cada entidad y los tramos
 * se desactivan (no se borran), conservando el histórico salarial.
 *
 * Esta pantalla no comprueba permisos (no los comprobaba antes): la autorización
 * efectiva es de RLS y no se añade ninguna regla nueva de acceso.
 */
const EntitySettingsTenureScale = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()

  const [ranges, setRanges] = React.useState<TenureScaleRange[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [formDialogOpen, setFormDialogOpen] = React.useState(false)
  const [formMode, setFormMode] = React.useState<"create" | "edit">("create")
  const [formData, setFormData] = React.useState<TenureScaleFormValues>(EMPTY_TENURE_FORM)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [deletingRange, setDeletingRange] = React.useState<TenureScaleRange | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const loadRanges = React.useCallback(async (silent = false) => {
    if (!entityId) return

    if (!silent) {
      setLoading(true)
      setError(null)
    }

    try {
      const data = await loadTenureScaleRanges(entityId)
      setRanges(data)
    } catch (err) {
      console.error("Error loading tenure scales:", err)
      const msg =
        err instanceof Error ? err.message : "Error al cargar los tramos de escala"
      if (silent) {
        showError(msg)
      } else {
        setError(msg)
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [entityId])

  React.useEffect(() => {
    loadRanges(false)
  }, [loadRanges])

  const handleOpenCreateForm = () => {
    setFormMode("create")
    setFormData(EMPTY_TENURE_FORM)
    setFormError(null)
    setEditingId(null)
    setFormDialogOpen(true)
  }

  const handleOpenEditForm = (range: TenureScaleRange) => {
    setFormMode("edit")
    setFormData(tenureRangeToForm(range))
    setFormError(null)
    setEditingId(range.id)
    setFormDialogOpen(true)
  }

  const handleCloseForm = () => {
    setFormDialogOpen(false)
    setFormError(null)
    setEditingId(null)
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId) return

    setFormError(null)
    setSubmitting(true)
    try {
      if (formMode === "create") {
        await createTenureScaleRange(entityId, formData, ranges)
        showSuccess("Tramo de antigüedad creado correctamente.")
      } else {
        if (!editingId) throw new Error("ID de edición no disponible")
        await updateTenureScaleRangeById(editingId, formData, ranges)
        showSuccess("Tramo de antigüedad actualizado correctamente.")
      }

      setFormDialogOpen(false)
      setFormError(null)
      await loadRanges(true)
    } catch (err) {
      console.error("Error saving tenure scale:", err)
      setFormError(
        err instanceof Error
          ? err.message
          : "Error al guardar el tramo de escala salarial"
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmDeleteRange = async () => {
    if (!deletingRange) return
    setDeleting(true)
    try {
      await deleteTenureScaleRange(deletingRange.id)
      showSuccess("Tramo de antigüedad eliminado.")
      setDeletingRange(null)
      await loadRanges(true)
    } catch (err) {
      console.error("Error deleting tenure scale:", err)
      showError(
        err instanceof Error
          ? err.message
          : "Error al eliminar el tramo de escala salarial"
      )
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Escala de pago de antigüedad" />
        <SiteCorpAlert type="info">Cargando...</SiteCorpAlert>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Escala de pago de antigüedad" />
        <SiteCorpAlert type="danger">{error}</SiteCorpAlert>
        <SiteCorpButton variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver
        </SiteCorpButton>
        {entityId && <AcademicCategoryPaymentSection entityId={entityId} />}
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Escala de pago de antigüedad"
        description="Configure los tramos de antigüedad y sus importes asociados"
        actions={
          <SiteCorpButton
            variant="default"
            onClick={handleOpenCreateForm}
            className="ml-4"
          >
            <Plus className="mr-2 h-4 w-4" /> Nuevo tramo
          </SiteCorpButton>
        }
      />

      {ranges.length === 0 ? (
        <SiteCorpAlert type="info">
          No hay tramos configurados. Haga clic en "Nuevo tramo" para comenzar.
        </SiteCorpAlert>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">
                    Desde
                  </th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">
                    Hasta
                  </th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">
                    Total a pagar
                  </th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ranges.map((range) => (
                  <tr key={range.id} className="hover:bg-muted">
                    <td className="px-4 py-3">{formatTenureMonths(range.from_months)}</td>
                    <td className="px-4 py-3">
                      {range.to_months === null ? (
                        <span className="font-medium text-sitecorp-primary">
                          Sin límite
                        </span>
                      ) : (
                        formatTenureMonths(range.to_months)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {range.amount.toLocaleString("es-CU", {
                        minimumFractionDigits: 2,
                      })} CUP
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <SiteCorpButton
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenEditForm(range)}
                          className="flex items-center gap-1"
                        >
                          <Pencil className="h-3 w-3" /> Editar
                        </SiteCorpButton>
                        <SiteCorpButton
                          variant="outline"
                          size="sm"
                          onClick={() => setDeletingRange(range)}
                          className="flex items-center gap-1 text-sitecorp-danger"
                        >
                          <Trash2 className="h-3 w-3" /> Eliminar
                        </SiteCorpButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sección independiente: pago por categoría académica (Máster / Doctor).
          Presupuestada → configuración global; Empresarial → configuración de la entidad. */}
      {entityId && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pago por categoría académica
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <AcademicCategoryPaymentSection entityId={entityId} />
        </div>
      )}

      <Dialog
        open={formDialogOpen}
        onOpenChange={(open) => {
          setFormDialogOpen(open)
          if (!open) setFormError(null)
        }}
      >
        <DialogContent className="p-6 space-y-4">
          <DialogHeader>
            <DialogTitle>
              {formMode === "create" ? "Nuevo tramo" : "Editar tramo"}
            </DialogTitle>
            <DialogDescription>
              Configure un tramo continuo de antigüedad para esta entidad (por ejemplo: 1 a 5 años, 5 a 10 años, 10 años Sin límite).
            </DialogDescription>
          </DialogHeader>

          {formError && <SiteCorpAlert type="danger">{formError}</SiteCorpAlert>}

          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Desde</Label>
                <div className="flex items-center gap-2">
                  <SiteCorpInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.from_amount}
                    onChange={(e) => {
                      setFormError(null)
                      setFormData((d) => ({ ...d, from_amount: e.target.value }))
                    }}
                    placeholder="0"
                    required
                  />
                  <SiteCorpSelect
                    value={formData.from_unit}
                    onValueChange={(v) => {
                      setFormError(null)
                      setFormData((d) => ({ ...d, from_unit: v as "Meses" | "Años" }))
                    }}
                  >
                    <option value="Meses">Meses</option>
                    <option value="Años">Años</option>
                  </SiteCorpSelect>
                </div>
                <p className="text-xs text-muted-foreground">
                  Para tramos consecutivos, use el mismo límite anterior (ej. 5 Años).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Hasta</Label>
                <div className="flex items-center gap-2">
                  <SiteCorpInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.to_amount}
                    onChange={(e) => {
                      setFormError(null)
                      setFormData((d) => ({ ...d, to_amount: e.target.value }))
                    }}
                    placeholder="0"
                    disabled={formData.to_limit}
                  />
                  <SiteCorpSelect
                    value={formData.to_unit}
                    onValueChange={(v) => {
                      setFormError(null)
                      setFormData((d) => ({ ...d, to_unit: v as "Meses" | "Años" }))
                    }}
                    disabled={formData.to_limit}
                  >
                    <option value="Meses">Meses</option>
                    <option value="Años">Años</option>
                  </SiteCorpSelect>
                  <SiteCorpCheckbox
                    label="Sin límite"
                    checked={formData.to_limit}
                    onCheckedChange={(checked) => {
                      setFormError(null)
                      setFormData((d) => ({
                        ...d,
                        to_limit: !!checked,
                        to_amount: checked ? "" : formData.to_amount,
                        to_unit: checked ? "Meses" : formData.to_unit,
                      }))
                    }}
                    disabled={false}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Marque "Sin límite" únicamente en el último tramo de la escala
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Total a pagar *</Label>
              <SiteCorpInput
                type="number"
                min="0"
                step="0.01"
                value={formData.amount}
                onChange={(e) => {
                  setFormError(null)
                  setFormData((d) => ({ ...d, amount: e.target.value }))
                }}
                placeholder="0.00"
                required
              />
              <p className="text-xs text-muted-foreground">
                Importe en CUP asociado a este tramo de antigüedad
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <SiteCorpButton
                variant="outline"
                type="button"
                onClick={handleCloseForm}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                type="submit"
                disabled={submitting}
                className="ml-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Guardando...
                  </>
                ) : formMode === "create" ? (
                  "Crear tramo"
                ) : (
                  "Actualizar tramo"
                )}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deletingRange)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingRange(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar tramo de antigüedad</DialogTitle>
            <DialogDescription>
              {deletingRange
                ? `¿Está seguro de desactivar el tramo "${formatTenureRange(deletingRange)}" (${deletingRange.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} CUP)?`
                : "¿Está seguro de eliminar este tramo?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2">
            <SiteCorpButton
              variant="outline"
              type="button"
              disabled={deleting}
              onClick={() => setDeletingRange(null)}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton
              variant="destructive"
              type="button"
              disabled={deleting}
              onClick={handleConfirmDeleteRange}
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </SiteCorpButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default EntitySettingsTenureScale