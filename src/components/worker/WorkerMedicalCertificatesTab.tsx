/**
 * FASE 19 — LICENCIAS / CERTIFICADOS MÉDICOS
 * Pestaña del expediente del trabajador para certificados médicos.
 *
 * Principios (§2/§82):
 *   · Cada certificado es un EVENTO registrado en el historial del trabajador.
 *   · NO hay saldo, devengo, acumulación mensual, máximo anual.
 *   · La cantidad de días se introduce explícitamente, NO se calcula de fechas (§7).
 *   · El total anual se deriva de SUM(days) WHERE year(start_date) = year (§46).
 *   · El documento es obligatorio y se almacena en storage privado (§11/§14).
 *   · Lectura por RPC único (list_worker_medical_certificates) validando
 *     can_access_entity('medical_certificates.view'|'manage'); la escritura
 *     SIEMPRE por RPC SECURITY DEFINER con validación backend.
 */

import * as React from "react"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { useToast } from "@/hooks/use-toast"
import { useEntityPermissions } from "@/hooks/use-entity-permissions"
import { useWorkerMedicalCertificates } from "@/hooks/use-medical-certificates"
import { useSc404Generation } from "@/hooks/use-sc404"
import { getCertificateSignedUrl } from "@/modules/vacations-licenses/medical-certificates"
import MedicalCertificateFormDialog from "@/components/medical-certificates/MedicalCertificateFormDialog"
import { Upload, FileText, Loader2, RefreshCw } from "lucide-react"

interface WorkerMedicalCertificatesTabProps {
  workerId: string
  entityId: string
  canManage: boolean
}

const YEAR_WINDOW = 4

export default function WorkerMedicalCertificatesTab({
  workerId,
  entityId,
}: WorkerMedicalCertificatesTabProps) {
  const { toast } = useToast()
  const { has: hasEntityPermission } = useEntityPermissions(entityId)
  const canView = hasEntityPermission(["medical_certificates.view", "medical_certificates.manage"])
  const canManageCert = hasEntityPermission(["medical_certificates.manage"])

  const [selectedYear, setSelectedYear] = React.useState<number>(new Date().getFullYear())
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const { generate: generateSc404, generatingId: generatingSc404Id } = useSc404Generation()

  // Reset al cambiar de trabajador (caso de prueba: Worker A → Worker B).
  React.useEffect(() => {
    setSelectedYear(new Date().getFullYear())
  }, [workerId])

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useWorkerMedicalCertificates(entityId, canView ? workerId : null, selectedYear)

  const certificates = data?.certificates ?? []
  const totalDays = data?.total_days ?? 0
  const count = data?.count ?? 0

  const yearOptions = React.useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: YEAR_WINDOW }, (_, i) => current - i)
  }, [])

  const handleViewDocument = async (
    storagePath: string,
    fileName: string | null,
    mimeType: string | null
  ) => {
    const signedUrl = await getCertificateSignedUrl(storagePath)
    if (!signedUrl) {
      toast({
        title: "Error",
        description: "No se pudo generar el enlace de acceso al documento.",
      })
      return
    }

    if (mimeType?.startsWith("image/")) {
      window.open(signedUrl, "_blank", "noopener,noreferrer")
    } else {
      const link = document.createElement("a")
      link.href = signedUrl
      link.download = fileName || "certificado"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  if (!canView) {
    return (
      <SiteCorpCard>
        <SiteCorpAlert type="info">
          No tienes permiso para ver los certificados médicos de este trabajador.
        </SiteCorpAlert>
      </SiteCorpCard>
    )
  }

  return (
    <div className="space-y-6">
      {/* Resumen anual + selector de año */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SiteCorpCard>
          <div className="p-4">
            <p className="text-xs text-muted-foreground">Año</p>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-ink"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </SiteCorpCard>
        <SiteCorpCard>
          <div className="p-4">
            <p className="text-xs text-muted-foreground">Días por certificado en {selectedYear}</p>
            <p className="mt-1 text-2xl font-bold text-ink">{totalDays} días</p>
          </div>
        </SiteCorpCard>
        <SiteCorpCard>
          <div className="p-4">
            <p className="text-xs text-muted-foreground">Certificados en {selectedYear}</p>
            <p className="mt-1 text-2xl font-bold text-ink">{count}</p>
          </div>
        </SiteCorpCard>
      </div>

      {/* Botón registrar (contexto Worker: trabajador preseleccionado) */}
      {canManageCert && (
        <SiteCorpButton onClick={() => setDialogOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Registrar certificado
        </SiteCorpButton>
      )}

      {/* Histórico */}
      <SiteCorpCard>
        <div className="p-4">
          <h3 className="mb-4 text-lg font-semibold text-ink">Historial de certificados médicos</h3>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="space-y-3">
              <SiteCorpAlert type="danger">
                No se pudo cargar el historial de certificados médicos.
              </SiteCorpAlert>
              <div>
                <SiteCorpButton variant="outline" onClick={() => refetch()}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Reintentar
                </SiteCorpButton>
              </div>
            </div>
          ) : certificates.length === 0 ? (
            <SiteCorpAlert type="info">
              Este trabajador no tiene certificados médicos registrados
              {selectedYear ? ` en ${selectedYear}` : ""}.
            </SiteCorpAlert>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-3 font-medium">Fecha de salida</th>
                    <th className="pb-3 font-medium">Reincorporación</th>
                    <th className="pb-3 font-medium">Días</th>
                    <th className="pb-3 font-medium">Documento</th>
                    {canManageCert && <th className="pb-3 font-medium">SC-4-04</th>}
                  </tr>
                </thead>
                <tbody>
                  {certificates.map((cert) => (
                    <tr key={cert.id} className="border-b border-border/50">
                      <td className="py-3 text-ink">{cert.start_date}</td>
                      <td className="py-3 text-ink">{cert.return_date}</td>
                      <td className="py-3 text-ink">{cert.days}</td>
                      <td className="py-3">
                        {cert.document?.storage_path ? (
                          <SiteCorpButton
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleViewDocument(
                                cert.document!.storage_path!,
                                cert.document!.file_name,
                                cert.document!.mime_type
                              )
                            }
                          >
                            <FileText className="mr-1 h-3 w-3" />
                            {cert.document.file_name || "Ver certificado"}
                          </SiteCorpButton>
                        ) : (
                          <span className="text-muted-foreground">Sin documento</span>
                        )}
                      </td>
                      {canManageCert && (
                        <td className="py-3">
                          <SiteCorpButton
                            variant="outline"
                            size="sm"
                            onClick={() => generateSc404("MEDICAL_CERTIFICATE", cert.id)}
                            disabled={generatingSc404Id === cert.id || !!generatingSc404Id}
                          >
                            <FileText className="mr-1 h-3 w-3" />
                            {generatingSc404Id === cert.id ? "Generando…" : "Generar"}
                          </SiteCorpButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* Diálogo compartido: trabajador fijo (contexto WorkerDetail) */}
      <MedicalCertificateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityId={entityId}
        workerId={workerId}
        onSuccess={() => refetch()}
      />
    </div>
  )
}
