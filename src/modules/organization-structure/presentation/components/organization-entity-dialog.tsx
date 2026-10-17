import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { Button as SiteCorpButton } from "@/shared/components/ui/button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { Checkbox } from "@/shared/components/ui/checkbox"
import { Building2, Factory, Layers, Plus, ShieldOff } from "lucide-react"
import { useToast } from "@/shared/hooks/use-toast"
import {
  ENTITY_TYPE_OPTIONS,
  REGIME_OPTIONS,
  describeEntityError,
  resolveParentCandidates,
  saveOrganizationEntity,
  type OrganizationEntity,
} from "@/modules/organization-structure"

/**
 * Alta y edición de una entidad organizativa (Grupo Empresarial → Empresa → UEB).
 *
 * Toda la lógica de negocio y la persistencia viven en el dominio
 * (`@/domains/organization-structure`): el código autogenerado, la jerarquía válida
 * según el tipo, la Cuenta SiteCorp y su código derivado, el cliente propietario y la
 * traducción de los errores del backend. Este componente sólo compone el formulario.
 *
 * El CLIENTE propietario se fija al crear y nunca se modifica al editar: es lo que
 * mantiene el aislamiento entre clientes.
 */

interface OrganizationEntityFormData {
  name: string
  entity_type: "business_group" | "company" | "ueb"
  regime_id: string | null
  is_active: boolean
  description: string | null
  is_sitecorp_account: boolean
  account_code: string | null
  parent_id: string | null
}

// El domicilio (dirección, provincia, municipio) ya no forma parte del alta de la
// entidad: se gestiona en Entidad → Ajustes → Datos contractuales.
const organizationEntitySchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  entity_type: z.enum(["business_group", "company", "ueb"]),
  regime_id: z.enum(["PRESUPUESTADA", "EMPRESARIAL"]).nullable(),
  is_active: z.boolean().default(true),
  description: z.string().nullable(),
  is_sitecorp_account: z.boolean().default(false),
  account_code: z.string().nullable(),
  parent_id: z.string().nullable(),
}).superRefine((data, ctx) => {
  if (data.entity_type !== "business_group" && !data.parent_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["parent_id"],
      message: "Selecciona la entidad superior.",
    })
  }
})

type OrganizationEntityFormDataZod = z.infer<typeof organizationEntitySchema>

interface OrganizationEntityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  /**
   * Cliente propietario al que pertenecerá la entidad. Debe provenir siempre de
   * una fuente autoritativa (el cliente desde el que se abre el formulario, el
   * cliente activo o el cliente de la entidad que se edita). Nunca se deduce
   * «el primero». Se envía a Supabase como la columna física `tenant_id`.
   */
  companyClientId: string
  entities: OrganizationEntity[]
  editingEntity: OrganizationEntity | null
  defaultEntityType?: OrganizationEntity["entity_type"]
  /** Entidad superior preseleccionada según el nodo desde el que se crea */
  defaultParentId?: string
  defaultRegime?: OrganizationEntity["regime_id"]
}

export const OrganizationEntityDialog = ({
  open,
  onOpenChange,
  onSaved,
  companyClientId,
  entities,
  editingEntity,
  defaultEntityType = "business_group",
  defaultParentId,
  defaultRegime = "PRESUPUESTADA",
}: OrganizationEntityDialogProps) => {
  const { currentCompanyClient } = useCurrentCompanyClient()
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = React.useState(false)
  const pendingSubmit = React.useRef<OrganizationEntityFormDataZod | null>(null)

  // El cliente activo solo se usa como respaldo; nunca se toma «el primer cliente».
  const effectiveCompanyClientId = companyClientId || currentCompanyClient?.id || ""

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<OrganizationEntityFormDataZod>({
    resolver: zodResolver(organizationEntitySchema),
    defaultValues: {
          name: "",
          entity_type: defaultEntityType,
          regime_id: defaultRegime as "PRESUPUESTADA" | "EMPRESARIAL" | null,
          is_active: true,
          description: null,
          is_sitecorp_account: false,
          account_code: null,
          parent_id: null,
        },
  })

  React.useEffect(() => {
    if (open) {
      setSaveError(null)
      setDeactivateConfirmOpen(false)
      pendingSubmit.current = null

      if (editingEntity) {
              reset({
                name: editingEntity.name,
                entity_type: editingEntity.entity_type,
                regime_id: editingEntity.regime_id as "PRESUPUESTADA" | "EMPRESARIAL" | null,
                is_active: editingEntity.is_active,
                description: editingEntity.description,
                is_sitecorp_account: editingEntity.is_sitecorp_account,
                account_code: editingEntity.account_code,
                parent_id: editingEntity.parent_id,
              })
        // Al editar, el código interno de la entidad se conserva sin cambios
      } else {
              reset({
                name: "",
                entity_type: defaultEntityType,
                regime_id: defaultRegime as "PRESUPUESTADA" | "EMPRESARIAL" | null,
                is_active: true,
                description: null,
                is_sitecorp_account: false,
                account_code: null,
                parent_id: defaultParentId ?? null,
              })
            }
    }
  }, [open, editingEntity, reset, defaultEntityType, defaultParentId, defaultRegime])

  const onSubmit = async (data: OrganizationEntityFormDataZod) => {
    setSaveError(null)

    // Desactivar una Cuenta SiteCorp es una acción sensible: requiere confirmación
    if (editingEntity?.is_sitecorp_account === true && data.is_sitecorp_account !== true) {
      pendingSubmit.current = data
      setDeactivateConfirmOpen(true)
      return
    }

    await persistEntity(data)
  }

  const persistEntity = async (data: OrganizationEntityFormDataZod) => {
    setSaveError(null)

    if (!effectiveCompanyClientId) {
      const message = "No hay un cliente seleccionado para crear la entidad."
      setSaveError(message)
      toast({ title: "Error", description: message, variant: "destructive" })
      return
    }

    try {
      setSaving(true)

      await saveOrganizationEntity({
        editingEntity,
        companyClientId: effectiveCompanyClientId,
        data: {
          name: data.name,
          entity_type: data.entity_type,
          regime_id: data.regime_id,
          is_active: data.is_active,
          description: data.description,
          is_sitecorp_account: data.is_sitecorp_account,
          account_code: data.account_code,
          parent_id: data.parent_id,
        },
      })

      if (editingEntity) {
        toast({
          title: "Entidad actualizada",
          description: `La entidad "${data.name}" ha sido actualizada correctamente.`,
        })
      } else {
        toast({
          title: "Entidad creada",
          description: `La entidad "${data.name}" ha sido creada correctamente.`,
        })
      }

      onSaved()
      onOpenChange(false)
    } catch (err) {
      // El dominio ya registra el diagnóstico completo de la escritura (incluido el
      // payload). Aquí sólo se traduce el error a un mensaje entendible.
      const requestError = err as {
        code?: string
        message?: string
        details?: string | null
        hint?: string | null
      }

      const description = describeEntityError(requestError)
      setSaveError(description)
      toast({ title: "Error", description, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const watchedEntityType = watch("entity_type")
  const watchedParentId = watch("parent_id")

  // Entidades candidatas a ser la entidad superior: siempre del MISMO cliente
  // (aislamiento por cliente) y coherentes con el tipo (Grupo → Empresa → UEB).
  const filteredParentEntities = React.useMemo(
    () =>
      resolveParentCandidates({
        entities,
        editingEntity,
        companyClientId: effectiveCompanyClientId,
        entityType: watchedEntityType,
      }),
    [entities, editingEntity, effectiveCompanyClientId, watchedEntityType]
  )

  // La entidad superior debe ser coherente con el tipo: los grupos no tienen padre y
  // al cambiar de tipo se descarta una selección que ya no es válida.
  React.useEffect(() => {
    if (watchedEntityType === "business_group") {
      if (watchedParentId) setValue("parent_id", null)
      return
    }
    if (watchedParentId && !filteredParentEntities.some((e) => e.id === watchedParentId)) {
      setValue("parent_id", null)
    }
  }, [watchedEntityType, watchedParentId, filteredParentEntities, setValue])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {editingEntity ? (
              <>
                <Building2 className="h-5 w-5 text-sitecorp-primary" />
                Editar entidad
              </>
            ) : (
              <>
                <Plus className="h-5 w-5 text-sitecorp-primary" />
                Nueva entidad
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {editingEntity ? "Modifica los datos de la entidad." : "Completa los datos para crear una nueva entidad."}
          </DialogDescription>
        </DialogHeader>

        {saveError && <SiteCorpAlert type="danger">{saveError}</SiteCorpAlert>}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Nombre *</label>
              <SiteCorpInput
                placeholder="Nombre de la entidad"
                {...register("name")}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Tipo *</label>
              <SiteCorpSelect
                value={watch("entity_type")}
                onValueChange={(value) =>
                  setValue("entity_type", value as OrganizationEntityFormDataZod["entity_type"])
                }
              >
                {ENTITY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SiteCorpSelect>
            </div>

            {/* El cliente se asigna automáticamente desde el contexto */}
            <div className="space-y-2 sm:col-span-full">
              <label className="text-sm font-medium text-ink">Régimen *</label>
              <SiteCorpSelect
                value={watch("regime_id")}
                onValueChange={(value) =>
                  setValue(
                    "regime_id",
                    value as OrganizationEntityFormDataZod["regime_id"]
                  )
                }
              >
                {REGIME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SiteCorpSelect>
            </div>

            {/* Jerarquía: Grupo sin entidad superior; Empresa en un grupo; UEB en una empresa */}
            {watch("entity_type") !== "business_group" && (
              <div className="space-y-2 sm:col-span-full">
                <label className="text-sm font-medium text-ink">Entidad superior *</label>
                <SiteCorpSelect
                  value={watch("parent_id") || ""}
                  onValueChange={(value) =>
                    setValue("parent_id", value || null, { shouldValidate: true })
                  }
                  disabled={filteredParentEntities.length === 0}
                >
                  <option value="">Seleccionar entidad superior</option>
                  {filteredParentEntities.map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {parent.name} ·{" "}
                      {parent.entity_type === "business_group" ? "Grupo empresarial" : "Empresa"}
                    </option>
                  ))}
                </SiteCorpSelect>
                <p className="text-xs text-muted-foreground">
                  {errors.parent_id?.message
                    ? errors.parent_id.message
                    : watch("entity_type") === "company"
                      ? "La empresa pertenece a un grupo empresarial del mismo cliente."
                      : "La UEB pertenece a una empresa del mismo cliente."}
                </p>
                {filteredParentEntities.length === 0 && (
                  <p className="text-xs text-sitecorp-warning">
                    {watch("entity_type") === "company"
                      ? "Este cliente todavía no tiene grupos empresariales."
                      : "Este cliente todavía no tiene empresas en ese grupo empresarial."}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-ink">Descripción</label>
            <SiteCorpInput
              placeholder="Descripción"
              {...register("description")}
            />
          </div>

          {/* Cuenta SiteCorp: habilita los módulos internos de gestión de la entidad */}
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="entity-sitecorp-account"
                checked={watch("is_sitecorp_account") === true}
                onCheckedChange={(checked) =>
                  setValue("is_sitecorp_account", checked === true)
                }
              />
              <div className="min-w-0">
                <label
                  htmlFor="entity-sitecorp-account"
                  className="text-sm font-medium text-ink"
                >
                  Cuenta SiteCorp
                </label>
                <p className="text-xs text-muted-foreground">
                  {watch("is_sitecorp_account")
                    ? "Activa los módulos internos de gestión para esta entidad."
                    : "La entidad se mantendrá únicamente dentro de la estructura organizativa."}
                </p>
              </div>
            </div>

            {watch("is_sitecorp_account") && (
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                El código de la cuenta SiteCorp se genera automáticamente
                {editingEntity?.account_code ? (
                  <>
                    :{" "}
                    <span className="font-mono text-ink">{editingEntity.account_code}</span>
                  </>
                ) : null}
                .
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton
              type="submit"
              disabled={saving}
            >
              {saving ? "Guardando..." : editingEntity ? "Actualizar" : "Crear entidad"}
            </SiteCorpButton>
          </div>
        </form>

        {/* Confirmación al desactivar una Cuenta SiteCorp */}
        <Dialog open={deactivateConfirmOpen} onOpenChange={setDeactivateConfirmOpen}>
          <DialogContent className="max-w-lg rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <ShieldOff className="h-5 w-5 text-sitecorp-warning" />
                Desactivar Cuenta SiteCorp
              </DialogTitle>
              <DialogDescription>
                Al desactivar la Cuenta SiteCorp, los módulos internos de esta entidad dejarán de
                estar disponibles.
              </DialogDescription>
            </DialogHeader>

            <p className="text-sm text-muted-foreground">
              Los datos existentes no se eliminarán y podrán recuperarse si la cuenta vuelve a
              activarse.
            </p>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => {
                  pendingSubmit.current = null
                  setDeactivateConfirmOpen(false)
                }}
                disabled={saving}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                type="button"
                variant="destructive"
                disabled={saving}
                onClick={async () => {
                  const pending = pendingSubmit.current
                  pendingSubmit.current = null
                  setDeactivateConfirmOpen(false)
                  if (pending) await persistEntity(pending)
                }}
              >
                {saving ? "Desactivando..." : "Desactivar"}
              </SiteCorpButton>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
