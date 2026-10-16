import * as React from "react"
import { SiteCorpCheckbox } from "@/components/ui/sitecorp-checkbox"

interface AcademicDegreeCheckboxesProps {
  hasMastersDegree: boolean
  hasDoctorateDegree: boolean
  onMastersChange: (checked: boolean) => void
  onDoctorateChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * Indicadores académicos de Máster y Doctor.
 *
 * Son dos casillas INDEPENDIENTES y NO excluyentes: una persona puede tener
 * Máster, Doctor, ambos o ninguno (primero una maestría y después un doctorado).
 * No representan documentos ni validaciones: sólo Sí / No.
 */
export const AcademicDegreeCheckboxes: React.FC<AcademicDegreeCheckboxesProps> = ({
  hasMastersDegree,
  hasDoctorateDegree,
  onMastersChange,
  onDoctorateChange,
  disabled = false,
  className,
}) => (
  <div className={["flex flex-col gap-2 sm:flex-row sm:gap-6", className].filter(Boolean).join(" ")}>
    <SiteCorpCheckbox
      id="has_masters_degree"
      label="Máster"
      checked={hasMastersDegree}
      onCheckedChange={(checked) => onMastersChange(checked === true)}
      disabled={disabled}
    />
    <SiteCorpCheckbox
      id="has_doctorate_degree"
      label="Doctor"
      checked={hasDoctorateDegree}
      onCheckedChange={(checked) => onDoctorateChange(checked === true)}
      disabled={disabled}
    />
  </div>
)

export default AcademicDegreeCheckboxes
