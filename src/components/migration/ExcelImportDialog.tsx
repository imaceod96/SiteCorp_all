import * as React from "react"
import { useState, useCallback } from "react"
import { loadMigrationTemplateData } from "@/domains/people"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { AlertCircle, CheckCircle, Upload, FileText, Users, XCircle, Download, Eye, Trash2 } from "lucide-react"

interface ExcelImportDialogProps {
  entityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface ValidationResult {
  row: number
  field: string
  error: string
  severity: 'error' | 'warning'
}

interface ParsedRowData {
  worker?: { identification?: string; first_name?: string; first_surname?: string } | null
  position_id?: string | null
}

interface ParsedRow {
  row: number
  data: ParsedRowData
  validations: ValidationResult[]
  isValid: boolean
}

interface ImportResult {
  total: number
  valid: number
  invalid: number
  errors: ValidationResult[]
  preview: ParsedRow[]
}

/** Puestos ofrecidos por la plantilla, para nombrar el puesto de cada fila. */
type MigrationTemplatePositions = { positions: { id: string; name: string }[] }

export const ExcelImportDialog: React.FC<ExcelImportDialogProps> = ({
  entityId,
  open,
  onOpenChange,
  onSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'complete'>('upload')
  const [progress, setProgress] = useState(0)
  const [template, setTemplate] = useState<MigrationTemplatePositions | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    // Validate file type
    const validTypes = ['.xlsx', '.xls']
    const fileExtension = selectedFile.name.toLowerCase().substring(selectedFile.name.toLowerCase().lastIndexOf('.'))
    if (!validTypes.includes(fileExtension)) {
      setError('Por favor selecciona un archivo Excel (.xlsx o .xls)')
      return
    }

    // Validate file size (10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('El archivo es demasiado grande. Máximo 10MB')
      return
    }

    setFile(selectedFile)
    setError(null)
  }

  const parseExcelFile = useCallback(async () => {
    if (!file) return

    setIsLoading(true)
    setError(null)
    setStep('importing')
    setProgress(0)

    try {
      // Datos de referencia de la carga inicial: caso de uso del dominio Personas.
      const migrationTemplate = await loadMigrationTemplateData(entityId, 'basic')
      setTemplate({ positions: migrationTemplate.positions })

      // Parse Excel file using server-side API
      const formData = new FormData()
      formData.append('file', file)
      formData.append('entityId', entityId)

      const response = await fetch('/api/migration/parse-excel', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error parsing Excel file')
      }

      const result: ImportResult = await response.json()
      setImportResult(result)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error parsing Excel file')
      setStep('upload')
    } finally {
      setIsLoading(false)
    }
  }, [file, entityId])

  const handleImport = async () => {
    if (!importResult) return

    setIsLoading(true)
    setProgress(0)
    setStep('importing')

    try {
      const response = await fetch('/api/migration/import-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entityId,
          rows: importResult.preview.map(row => row.data),
          migrationBatchId: `MIG-${Date.now()}`,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error importing data')
      }

      const result = await response.json()
      setImportResult(prev => prev ? { ...prev, importResult: result } : null)
      setStep('complete')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error importing data')
      setStep('preview')
    } finally {
      setIsLoading(false)
    }
  }

  const resetDialog = () => {
    setFile(null)
    setImportResult(null)
    setError(null)
    setStep('upload')
    setProgress(0)
    setTemplate(null)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) resetDialog()
    onOpenChange(open)
  }

  const getValidationIcon = (validation: ValidationResult) => {
    return validation.severity === 'error' ? (
      <XCircle className="h-4 w-4 text-red-500" />
    ) : (
      <AlertCircle className="h-4 w-4 text-yellow-500" />
    )
  }

  return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Importar desde Excel
            </DialogTitle>
            <DialogDescription>
              Sube un archivo Excel para importar trabajadores. El sistema validará cada fila antes de importar.
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

              {file && (
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span className="text-sm font-medium">{file.name}</span>
                    <Badge variant="secondary">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </Badge>
                  </div>
                  <button
                    onClick={() => setFile(null)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-6 p-6">
            <div className="text-center space-y-4">
              <SiteCorpLoading />
              <div>
                <h3 className="text-lg font-semibold">Procesando archivo...</h3>
                <p className="text-sm text-muted-foreground">Analizando y validando filas</p>
              </div>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        )}

        {step === 'preview' && importResult && (
          <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Vista Previa de Validación</h3>
                <p className="text-sm text-muted-foreground">
                  {importResult.total} filas analizadas, {importResult.valid} válidas, {importResult.invalid} inválidas
                </p>
              </div>
              <Badge variant={importResult.invalid === 0 ? "default" : "destructive"}>
                {importResult.invalid === 0 ? 'Todo válido' : `${importResult.invalid} errores`}
              </Badge>
            </div>

            {importResult.errors.length > 0 && (
              <SiteCorpAlert type="warning">
                <AlertCircle className="h-4 w-4" />
                <div className="space-y-1">
                  <p className="font-medium">Errores de validación encontrados:</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {importResult.errors.slice(0, 5).map((error, index) => (
                      <div key={index} className="text-xs flex items-start gap-2">
                        {getValidationIcon(error)}
                        <span>Fila {error.row}, Campo {error.field}: {error.error}</span>
                      </div>
                    ))}
                    {importResult.errors.length > 5 && (
                      <p className="text-xs text-muted-foreground">
                        ...y {importResult.errors.length - 5} errores más
                      </p>
                    )}
                  </div>
                </div>
              </SiteCorpAlert>
            )}

            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Fila</th>
                      <th className="px-4 py-3 text-left font-medium">CI</th>
                      <th className="px-4 py-3 text-left font-medium">Nombre</th>
                      <th className="px-4 py-3 text-left font-medium">Puesto</th>
                      <th className="px-4 py-3 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.preview.slice(0, 10).map((row) => (
                      <tr key={row.row} className="border-t hover:bg-muted/50">
                        <td className="px-4 py-3 font-mono text-xs">{row.row}</td>
                        <td className="px-4 py-3 font-mono text-xs">{row.data.worker?.identification || 'N/A'}</td>
                        <td className="px-4 py-3 text-xs">
                          {row.data.worker?.first_name} {row.data.worker?.first_surname}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {template?.positions?.find(p => p.id === row.data.position_id)?.name || 'N/A'}
                        </td>
                        <td className="px-4 py-3">
                          {row.isValid ? (
                            <Badge variant="default" className="text-xs">Válido</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">Inválido</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {importResult.total > 10 && (
              <p className="text-sm text-muted-foreground text-center">
                Mostrando las primeras 10 de {importResult.total} filas
              </p>
            )}
          </div>
        )}

        {step === 'complete' && importResult && (
          <div className="space-y-6 p-6">
            <div className="text-center space-y-4">
              <CheckCircle className="h-16 w-16 mx-auto text-green-500" />
              <div>
                <h3 className="text-lg font-semibold">¡Importación Completada!</h3>
                <p className="text-sm text-muted-foreground">
                  Se procesaron {importResult.valid} de {importResult.total} filas
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-2">
                <div className="text-2xl font-bold text-green-600">{importResult.valid}</div>
                <div className="text-xs text-muted-foreground">Válidas</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-red-600">{importResult.invalid}</div>
                <div className="text-xs text-muted-foreground">Inválidas</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold">{importResult.total}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step !== 'upload' && (
            <SiteCorpButton
              variant="outline"
              onClick={() => setStep(step === 'preview' || step === 'complete' ? 'upload' : 'preview')}
              disabled={isLoading}
            >
              {step === 'preview' || step === 'complete' ? 'Volver' : 'Atrás'}
            </SiteCorpButton>
          )}

          {step === 'upload' && (
            <SiteCorpButton
              onClick={parseExcelFile}
              disabled={!file || isLoading}
            >
              {isLoading ? 'Procesando...' : 'Analizar Archivo'}
            </SiteCorpButton>
          )}

          {step === 'preview' && (
            <SiteCorpButton
              onClick={handleImport}
              disabled={isLoading || importResult?.invalid === 0}
            >
              {isLoading ? 'Importando...' : 'Importar Datos'}
            </SiteCorpButton>
          )}

          {step === 'complete' && (
            <SiteCorpButton onClick={() => handleOpenChange(false)}>
              Cerrar
            </SiteCorpButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}