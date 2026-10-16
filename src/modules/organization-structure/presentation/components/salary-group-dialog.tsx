import * as React from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { X } from "lucide-react"

/**
 * Alta de grupo salarial.
 *
 * Sólo se solicitan los datos del grupo y su salario: número de secuencia
 * (asignado por el sistema) + importe + vigencia. La descripción dejó de formar
 * parte de la interfaz en ambos regímenes (PRESUPUESTADA y EMPRESARIAL); la
 * columna `salary_groups.description` se conserva en la base de datos para no
 * alterar históricos, pero nunca se inventa un valor nuevo.
 */
interface SalaryGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (salary: string, effectiveFrom: string) => Promise<void>
  isLoading?: boolean
}

export const SalaryGroupDialog = ({ open, onOpenChange, onSubmit, isLoading }: SalaryGroupDialogProps) => {
  const [salary, setSalary] = React.useState("")
  const [effectiveFrom, setEffectiveFrom] = React.useState("")
  const [salaryError, setSalaryError] = React.useState("")

  const validateSalary = (value: string): string => {
    if (!value.trim()) return "El salario es obligatorio"
    const num = parseFloat(value)
    if (isNaN(num)) return "El salario debe ser un número válido"
    if (num <= 0) return "El salario debe ser mayor que 0"
    return ""
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return

    const salaryErr = validateSalary(salary)
    if (salaryErr) {
      setSalaryError(salaryErr)
      return
    }
    setSalaryError("")

    if (!effectiveFrom.trim()) return

    await onSubmit(salary.trim(), effectiveFrom)
    setSalary("")
    setEffectiveFrom("")
    setSalaryError("")
    onOpenChange(false)
  }

  const handleClose = () => {
    setSalary("")
    setEffectiveFrom("")
    setSalaryError("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            Añadir grupo salarial
            <X className="ml-auto h-4 w-4 text-muted-foreground cursor-pointer hover:text-ink" onClick={handleClose} />
          </DialogTitle>
          <DialogDescription>
            Ingrese el salario y la vigencia del nuevo grupo salarial
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Salario *</label>
            <SiteCorpInput
              type="number"
              placeholder="Monto (mayor que 0)"
              value={salary}
              onChange={(e) => {
                setSalary(e.target.value)
                if (salaryError) setSalaryError("")
              }}
              disabled={isLoading}
              autoFocus
            />
            {salaryError && (
              <p className="text-xs text-sitecorp-danger">{salaryError}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Vigente desde *</label>
            <SiteCorpInput
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <SiteCorpButton variant="outline" type="button" onClick={handleClose} disabled={isLoading}>
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton type="submit" disabled={isLoading || !salary || !effectiveFrom}>
              {isLoading ? "Guardando..." : "Guardar"}
            </SiteCorpButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
