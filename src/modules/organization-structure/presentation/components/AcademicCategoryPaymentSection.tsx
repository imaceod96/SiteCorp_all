import * as React from "react"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { Label } from "@/components/ui/label"
import { Loader2, Save, GraduationCap } from "lucide-react"
import type { AcademicCategoryPaymentConfig } from "@/modules/organization-structure/domain/entities"
import {
  formatAcademicAmount,
  parseAcademicAmount,
} from "@/modules/organization-structure/domain/academic-payment.rules"
import { loadAcademicCategoryPaymentConfig } from "@/modules/organization-structure/application/academic-payment.queries"
import { saveAcademicCategoryPaymentAmounts } from "@/modules/organization-structure/application/academic-payment.commands"

interface AcademicCategoryPaymentSectionProps {
  entityId: string
}

/**
 * Pago por categoría académica (Máster / Doctor).
 *
 * Se administra en la MISMA pantalla que la escala de pago por antigüedad, pero
 * como una sección independiente:
 *   - Régimen PRESUPUESTADA → configuración GLOBAL (solo administradores autorizados).
 *   - Régimen EMPRESARIAL   → configuración propia de la entidad.
 *
 * No existe fallback EMPRESARIAL → PRESUPUESTADA: si una entidad empresarial no
 * tiene importe configurado, la categoría queda NO CONFIGURADA.
 *
 * Un importe vacío significa NO CONFIGURADO (NULL). Un 0 explícito es un valor
 * válido y se conserva como configuración sin pago.
 */
const AcademicCategoryPaymentSection: React.FC<AcademicCategoryPaymentSectionProps> = ({
  entityId,
}) => {
  const [config, setConfig] = React.useState<AcademicCategoryPaymentConfig | null>(null)
  const [masterInput, setMasterInput] = React.useState("")
  const [doctorInput, setDoctorInput] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setError(null)
    try {
      const next = await loadAcademicCategoryPaymentConfig(entityId)
      setConfig(next)
      setMasterInput(next.masterAmount === null ? "" : String(next.masterAmount))
      setDoctorInput(next.doctorAmount === null ? "" : String(next.doctorAmount))
    } catch (err) {
      console.error("Error loading academic category payment config:", err)
      setConfig(null)
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la configuración de pago por categoría académica"
      )
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    if (!entityId) return
    setError(null)
    setSuccess(null)

    const masterParsed = parseAcademicAmount(masterInput)
    if (!masterParsed.valid) {
      setError("El importe de Máster debe ser un número mayor o igual que 0")
      return
    }
    const doctorParsed = parseAcademicAmount(doctorInput)
    if (!doctorParsed.valid) {
      setError("El importe de Doctor debe ser un número mayor o igual que 0")
      return
    }

    setSaving(true)
    try {
      await saveAcademicCategoryPaymentAmounts({
        entityId,
        masterAmount: masterParsed.value,
        doctorAmount: doctorParsed.value,
      })
      await load()
      setSuccess("Configuración de pago por categoría académica guardada correctamente.")
    } catch (err) {
      console.error("Error saving academic category payment:", err)
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar la configuración de pago por categoría académica"
      )
    } finally {
      setSaving(false)
    }
  }

  const canManage = !!config?.canManage
  const isGlobal = config?.scope === "PRESUPUESTADA_GLOBAL"

  return (
    <SiteCorpCard>
      <div className="space-y-4">
        <div className="flex items-start gap-3 border-b pb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sitecorp-primary/10">
            <GraduationCap className="h-5 w-5 text-sitecorp-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-ink">Pago por categoría académica</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {isGlobal
                ? "Configuración global de SiteCorp, aplicable a las entidades de régimen PRESUPUESTADA."
                : "Configuración propia de esta entidad (régimen EMPRESARIAL)."}
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando configuración…</p>
        ) : !config ? (
          <SiteCorpAlert type="warning">
            {error || "No se pudo cargar la configuración de pago por categoría académica."}
          </SiteCorpAlert>
        ) : (
          <>
            {isGlobal && (
              <SiteCorpAlert type="info">
                Esta configuración es global para el régimen PRESUPUESTADA y solo puede ser
                modificada por un administrador autorizado de SiteCorp.
              </SiteCorpAlert>
            )}
            {!isGlobal && (
              <p className="text-xs text-muted-foreground">
                Las entidades de régimen EMPRESARIAL utilizan exclusivamente su propia
                configuración. Si no está configurada, la categoría académica queda como «No
                configurado» (no se toma la configuración global).
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="academic-master-amount">Máster</Label>
                <div className="flex items-center gap-2">
                  <SiteCorpInput
                    id="academic-master-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="No configurado"
                    value={masterInput}
                    onChange={(e) => setMasterInput(e.target.value)}
                    disabled={!canManage || saving}
                  />
                  <span className="text-sm font-medium text-muted-foreground">CUP</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {config.masterConfigured
                    ? `Configurado: ${formatAcademicAmount(config.masterAmount)}`
                    : "No configurado"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="academic-doctor-amount">Doctor</Label>
                <div className="flex items-center gap-2">
                  <SiteCorpInput
                    id="academic-doctor-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="No configurado"
                    value={doctorInput}
                    onChange={(e) => setDoctorInput(e.target.value)}
                    disabled={!canManage || saving}
                  />
                  <span className="text-sm font-medium text-muted-foreground">CUP</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {config.doctorConfigured
                    ? `Configurado: ${formatAcademicAmount(config.doctorAmount)}`
                    : "No configurado"}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Deje el campo vacío para dejar la categoría como «No configurado». Un importe 0 se
              guarda como configuración explícita sin pago. Si una persona tiene Máster y Doctor,
              se aplica únicamente el importe de Doctor.
            </p>

            {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}
            {success && <SiteCorpAlert type="success">{success}</SiteCorpAlert>}

            {canManage ? (
              <div className="flex justify-end">
                <SiteCorpButton onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4" /> Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" /> Guardar
                    </>
                  )}
                </SiteCorpButton>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Solo lectura: no tiene permisos para gestionar la configuración salarial.
              </p>
            )}
          </>
        )}
      </div>
    </SiteCorpCard>
  )
}

export default AcademicCategoryPaymentSection
