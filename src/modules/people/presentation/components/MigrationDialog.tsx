import * as React from "react"
import { useState } from "react"
import { loadMigrationTemplateData } from "@/modules/people/application/people.queries"
import type { MigrationTemplateData } from "@/modules/people/domain/entities"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { Label } from "@/shared/components/ui/label"
import { Textarea } from "@/shared/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select"
import { Checkbox } from "@/shared/components/ui/checkbox"
import { Badge } from "@/shared/components/ui/badge"
import { AlertCircle, CheckCircle, Upload, FileText, Users, Building2, Calendar, DollarSign, FileSpreadsheet, XCircle } from "lucide-react"

interface MigrationDialogProps {
  entityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface MigrationRow {
  worker: {
    first_name: string
    first_surname: string
    second_surname: string
    identification: string
    birth_date: string
    gender_id: string
    marital_status_id: string
    education_level_id: string
    specialty: string
    profession_or_trade: string
    skin_color_id: string
    address: string
    province: string
    municipality: string
    phone: string
    email: string
  }
  position_id: string
  hire_date: string
  initial_vacation_balance: string
  vacation_cutoff_date: string
  contract_type_id: string
  contract_start_date: string
  contract_end_date: string
  contract_salary_amount: string
  contract_salary_currency: string
  signature_date: string
  signature_place: string
  payment_method_id: string
  payment_schedule_text: string
  compensation_components: string
  representative_assignment_id: string
}

/*
 * Contrato del RPC `get_migration_template_data` (ver
 * `src/db/migrations/20261020_02_worker_migration_rpcs.sql`): el modelo `MigrationTemplateData`
 * del dominio Personas describe cada catálogo, tal y como llega del backend.
 */

export const MigrationDialog: React.FC<MigrationDialogProps> = ({
  entityId,
  open,
  onOpenChange,
  onSuccess,
}) => {
  const [step, setStep] = useState<'upload' | 'preview' | 'confirm'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [template, setTemplate] = useState<MigrationTemplateData | null>(null)
  const [previewData, setPreviewData] = useState<MigrationRow[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationType, setMigrationType] = useState<'basic' | 'complete'>('basic')
  const [batchId, setBatchId] = useState<string>(`MIG-${Date.now()}`)
  const [importResult, setImportResult] = useState<{ successful: number; failed: number; total_rows: number } | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setIsLoading(true)
    setError(null)

    try {
      // Datos de referencia de la carga inicial: caso de uso del dominio Personas.
      setTemplate(await loadMigrationTemplateData(entityId, migrationType))

      // Parse Excel file
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('entityId', entityId)
      formData.append('migrationType', migrationType)

      const response = await fetch('/api/migration/parse-excel', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error parsing Excel file')
      }

      const parsedData = await response.json()
      setPreviewData(parsedData.rows)
      setValidationErrors(parsedData.errors)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error processing file')
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (previewData.length === 0) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/migration/confirm-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entityId,
          migrationType,
          rows: previewData,
          migrationBatchId: batchId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error confirming migration')
      }

      const result = await response.json()
      setImportResult(result)
      setStep('confirm')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error confirming migration')
    } finally {
      setIsLoading(false)
    }
  }

  const resetDialog = () => {
    setStep('upload')
    setFile(null)
    setTemplate(null)
    setPreviewData([])
    setValidationErrors([])
    setError(null)
    setMigrationType('basic')
    setBatchId(`MIG-${Date.now()}`)
    setImportResult(null)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) resetDialog()
    onOpenChange(open)
  }

  return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Migración de Trabajadores
            </DialogTitle>
            <DialogDescription>
              Importa trabajadores existentes desde un archivo Excel. Selecciona el tipo de migración y revisa los datos antes de confirmar.
            </DialogDescription>
          </DialogHeader>

        {error && (
          <SiteCorpAlert type="danger" className="mx-6">
            <AlertCircle className="h-4 w-4" />
            {error}
          </SiteCorpAlert>
        )}

        {step === 'upload' && (
          <div className="space-y-6 p-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="migration-type">Tipo de Migración</Label>
                <Select value={migrationType} onValueChange={(value: 'basic' | 'complete') => setMigrationType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        <span>Básica (Worker + Assignment + Vacaciones)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="complete">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        <span>Completa (Worker + Assignment + Vacaciones + Contrato)</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="batch-id">ID del Lote (para idempotencia)</Label>
                <input
                  id="batch-id"
                  type="text"
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  placeholder="MIG-123456"
                  className="w-full px-3 py-2 border rounded-md"
                />
                <p className="text-xs text-muted-foreground">
                  Usar el mismo ID para reintentos. Si el lote ya fue procesado, se ignorará.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="excel-file">Archivo Excel</Label>
                <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                  <input
                    id="excel-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <label htmlFor="excel-file" className="cursor-pointer">
                    <div className="space-y-2">
                      <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Haz clic para seleccionar archivo Excel</p>
                        <p className="text-xs text-muted-foreground">Archivos .xlsx o .xls (máx. 10MB)</p>
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {isLoading && (
              <div className="flex justify-center py-8">
                <SiteCorpLoading />
              </div>
            )}
          </div>
        )}

        {step === 'preview' && template && (
          <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Vista Previa de la Importación</h3>
                <p className="text-sm text-muted-foreground">
                  {previewData.length} filas encontradas, {validationErrors.length} errores
                </p>
              </div>
              <Badge variant={validationErrors.length === 0 ? "default" : "destructive"}>
                {validationErrors.length === 0 ? 'Todo válido' : `${validationErrors.length} errores`}
              </Badge>
            </div>

            {validationErrors.length > 0 && (
              <SiteCorpAlert type="danger">
                <AlertCircle className="h-4 w-4" />
                <div className="space-y-1">
                  <p className="font-medium">Se encontraron errores de validación:</p>
                  <ul className="text-sm space-y-1">
                    {validationErrors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              </SiteCorpAlert>
            )}

            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">CI</th>
                      <th className="px-4 py-3 text-left font-medium">Nombre</th>
                      <th className="px-4 py-3 text-left font-medium">Puesto</th>
                      <th className="px-4 py-3 text-left font-medium">Fecha de Incorporación</th>
                      <th className="px-4 py-3 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.slice(0, 10).map((row, index) => (
                      <tr key={index} className="border-t hover:bg-muted/50">
                        <td className="px-4 py-3 font-mono text-xs">{row.worker.identification}</td>
                        <td className="px-4 py-3">
                          {row.worker.first_name} {row.worker.first_surname}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {template.positions.find(p => p.id === row.position_id)?.name || 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-xs">{row.hire_date}</td>
                        <td className="px-4 py-3">
                          {validationErrors.some(e => e.includes(row.worker.identification)) ? (
                            <Badge variant="destructive" className="text-xs">Error</Badge>
                          ) : (
                            <Badge variant="default" className="text-xs">Válido</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {previewData.length > 10 && (
              <p className="text-sm text-muted-foreground text-center">
                Mostrando las primeras 10 de {previewData.length} filas
              </p>
            )}
          </div>
        )}

        {step === 'confirm' && importResult && (
          <div className="space-y-6 p-6">
            <div className="text-center space-y-4">
              <CheckCircle className="h-16 w-16 mx-auto text-green-500" />
              <div>
                <h3 className="text-lg font-semibold">¡Migración Completada!</h3>
                <p className="text-sm text-muted-foreground">
                  Se procesaron {importResult.successful} de {importResult.total_rows} filas
                </p>
              </div>
            </div>

            {importResult.failed > 0 && (
              <SiteCorpAlert type="warning">
                <AlertCircle className="h-4 w-4" />
                <div className="space-y-1">
                  <p className="font-medium">Errores encontrados:</p>
                  <p className="text-sm">Se fallaron {importResult.failed} filas. Revisa los logs para detalles.</p>
                </div>
              </SiteCorpAlert>
            )}

            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-2">
                <div className="text-2xl font-bold text-green-600">{importResult.successful}</div>
                <div className="text-xs text-muted-foreground">Exitosas</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-red-600">{importResult.failed}</div>
                <div className="text-xs text-muted-foreground">Fallidas</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold">{importResult.total_rows}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step !== 'upload' && (
            <SiteCorpButton
              variant="outline"
              onClick={() => setStep(step === 'preview' ? 'upload' : 'preview')}
              disabled={isLoading}
            >
              {step === 'preview' ? 'Volver' : 'Atrás'}
            </SiteCorpButton>
          )}

          {step === 'upload' && (
            <SiteCorpButton
              onClick={() => setStep('preview')}
              disabled={!file || isLoading}
            >
              Vista Previa
            </SiteCorpButton>
          )}

          {step === 'preview' && (
            <SiteCorpButton
              onClick={handleConfirm}
              disabled={isLoading || validationErrors.length > 0}
            >
              {isLoading ? 'Procesando...' : 'Confirmar Migración'}
            </SiteCorpButton>
          )}

          {step === 'confirm' && (
            <SiteCorpButton onClick={() => handleOpenChange(false)}>
              Cerrar
            </SiteCorpButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}