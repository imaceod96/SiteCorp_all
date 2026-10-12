import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { supabase } from "@/lib/supabase"
import { columnName } from "@/integrations/supabase/schema-target"
import { Button as SiteCorpButton } from "@/components/ui/button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Building2, Factory, Layers, Plus, ShieldOff } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { buildAccountCode } from "@/lib/sitecorp-account"

interface OrganizationEntity {
  id: string
  tenant_id: string
  parent_id: string | null
  entity_type: "business_group" | "company" | "ueb"
  name: string
  code: string
  regime_id: string
  status: string
  description: string | null
  address: string | null
  municipality: string | null
  province: string | null
  postal_code: string | null
  is_active: boolean
  is_sitecorp_account: boolean
  account_is_active: boolean
  account_code: string | null
}

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

const entityTypeOptions = [
  { value: "business_group", label: "Grupo empresarial" },
  { value: "company", label: "Empresa" },
  { value: "ueb", label: "UEB" },
]

// Códigos canónicos del catálogo `entity_regimes` (determinan la escala salarial aplicable)
const regimeOptions = [
  { value: "PRESUPUESTADA", label: "Presupuestada" },
  { value: "EMPRESARIAL", label: "Empresarial" },
]

const statusOptions = [
  { value: "active", label: "Activo" },
  { value: "inactive", label: "Inactivo" },
]

// Generate automatic code based on entity type
const generateCode = (entityType: "business_group" | "company" | "ueb"): string => {
  const timestamp = Date.now().toString(36).toUpperCase().padStart(6, "0").substring(0, 6)
  const prefixes: Record<string, string> = {
    business_group: "GE",
    company: "EMP",
    ueb: "UEB",
  }
  return `${prefixes[entityType]}-${timestamp}`
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

/** Traduce errores de Supabase a un mensaje entendible sin exponer detalles internos. */
const describeEntityError = (error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}): string => {
  const code = error?.code || ""
  const message = error?.message || ""

  if (code === "23503") {
    return "El cliente o la entidad superior seleccionada no es válida."
  }
  if (code === "23505") {
    return "Ya existe una entidad con ese nombre en este cliente."
  }
  if (code === "23514") {
    return /parent/i.test(message)
      ? "La entidad superior no es válida para este tipo de entidad."
      : "Los datos no cumplen las reglas de la organización."
  }
  if (code === "23502") {
    return "Falta un dato obligatorio para crear la entidad."
  }
  if (code === "22P02") {
    return "Alguno de los identificadores enviados no es válido."
  }
  if (code === "42501" || /row-level security/i.test(message)) {
    return "No tienes permiso para crear o editar entidades en este cliente."
  }
  if (code === "PGRST204") {
    return "La estructura del formulario no coincide con la base de datos. Contacta al administrador."
  }
  return message || "No se pudo guardar la entidad."
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

    let entityPayload: Record<string, unknown> | null = null

    try {
      setSaving(true)

      // Código interno de la entidad: se sigue generando automáticamente (nunca se pide)
      const entityCode =
        data.entity_type === "business_group" || !editingEntity
          ? generateCode(data.entity_type)
          : editingEntity?.code || generateCode(data.entity_type)

      // Cuenta SiteCorp: la bandera es la única fuente de verdad de los módulos internos.
      // El código de cuenta que exige el modelo se deriva del código interno y solo se
      // genera al activar (nunca se regenera al reeditar: la operación es idempotente).
      const wasSiteCorp = editingEntity?.is_sitecorp_account === true
      const sitecorp = data.is_sitecorp_account === true
      const accountCode = sitecorp
        ? editingEntity?.account_code || buildAccountCode(entityCode)
        : null
      const accountIsActive = sitecorp ? (wasSiteCorp ? editingEntity?.account_is_active === true : true) : false

      const entityData = {
        ...data,
        code: entityCode,
        // parent_id siempre UUID real o NULL (nunca cadena vacía)
        parent_id: data.entity_type === "business_group" ? null : data.parent_id || null,
        is_sitecorp_account: sitecorp,
        account_code: accountCode,
        account_is_active: accountIsActive,
      }

      if (editingEntity) {
        // El cliente de la entidad no se modifica al editar (aislamiento por cliente)
        entityPayload = entityData
        const { error } = await supabase
          .from("organization_entities")
          .update(entityData)
          .eq("id", editingEntity.id)

        if (error) throw error

        toast({
          title: "Entidad actualizada",
          description: `La entidad "${data.name}" ha sido actualizada correctamente.`,
        })
      } else {
        // El cliente solo se fija al crear: proviene del cliente desde el que se
        // abre el formulario. La clave es el nombre FÍSICO de columna activo.
        const insertData = { ...entityData, [columnName("clientId")]: effectiveCompanyClientId }
        entityPayload = insertData

        const { error } = await supabase
          .from("organization_entities")
          .insert([insertData])
          .select()
          .single()

        if (error) throw error

        toast({
          title: "Entidad creada",
          description: `La entidad "${data.name}" ha sido creada correctamente.`,
        })
      }

      onSaved()
      onOpenChange(false)
    } catch (err) {
      const requestError = err as {
        code?: string
        message?: string
        details?: string | null
        hint?: string | null
      }

      console.error("[organization-entity] No se pudo guardar la entidad", {
        code: requestError?.code,
        message: requestError?.message,
        details: requestError?.details,
        hint: requestError?.hint,
        payload: entityPayload,
      })

      const description = describeEntityError(requestError)
      setSaveError(description)
      toast({ title: "Error", description, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  // Entidades candidatas a ser padre: siempre del MISMO cliente (aislamiento por
  // cliente). `tenant_id` es la columna FÍSICA de Supabase.
  const parentEntities = React.useMemo(() => {
    const sameCompanyClient = entities.filter(
      (e) => e.id !== editingEntity?.id && e.tenant_id === effectiveCompanyClientId
    )
    const active = sameCompanyClient.filter((e) => e.is_active !== false)

    // Al editar, la entidad superior actual debe seguir visible aunque esté inactiva
    const currentParent = editingEntity?.parent_id
      ? sameCompanyClient.find((e) => e.id === editingEntity.parent_id)
      : undefined
    if (currentParent && !active.some((e) => e.id === currentParent.id)) {
      return [currentParent, ...active]
    }
    return active
  }, [entities, editingEntity, effectiveCompanyClientId])

  const watchedEntityType = watch("entity_type")
  const watchedParentId = watch("parent_id")

  // When entity type is business_group, no parents allowed
  // When entity type is company, only business_groups as parents
  // When entity type is ueb, only companies as parents
  const filteredParentEntities = React.useMemo(() => {
    const entityType = watchedEntityType
    if (!entityType) return parentEntities

    return parentEntities.filter((e) => {
      if (entityType === "business_group") return false // No parents for business groups

      if (entityType === "company") {
        // Only business groups can be parents
        return e.entity_type === "business_group"
      }

      if (entityType === "ueb") {
        // Only companies can be parents
        return e.entity_type === "company"
      }

      return true
    })
  }, [watchedEntityType, parentEntities])

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
                {entityTypeOptions.map((opt) => (
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
                {regimeOptions.map((opt) => (
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