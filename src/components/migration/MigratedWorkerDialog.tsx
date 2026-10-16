import * as React from "react"
import { useParams } from "react-router-dom"
import { ciToBirthDate, isValidIdentification, IDENTIFICATION_ERROR_MESSAGE } from "@/utils/ci"
import {
  createMigratedWorker,
  loadCandidateRegistryCatalogs,
  loadPersonIdentificationStatus,
  type CatalogOption,
  type MigrationRow,
} from "@/modules/people"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { Button } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { Label } from "@/components/ui/label"
import { SelectItem } from "@/components/ui/select"
import { DrivingLicenseSelector } from "@/modules/people/presentation/components/DrivingLicenseSelector"

interface Props {
  onSuccess: (workerId: string) => void
  onCancel: () => void
}

const EMPTY_FORM = {
  identification: "", first_name: "", first_surname: "", second_surname: "", birth_date: "",
  gender_id: "", marital_status_id: "", skin_color_id: "", phone: "", email: "", address: "",
  province: "", municipality: "", employment_start_date: "", education_level_id: "", specialty: "",
  profession_or_trade: "", initial_vacation_balance: "", vacation_cutoff_date: "",
}

export function MigratedWorkerDialog({ onSuccess, onCancel }: Props) {
  const { entityId } = useParams<{ entityId: string }>()
  const [catalogs, setCatalogs] = React.useState<Record<string, CatalogOption[]>>({})
  const [licenseCategories, setLicenseCategories] = React.useState<CatalogOption[]>([])
  const [licenseIds, setLicenseIds] = React.useState<string[]>([])
  const [form, setForm] = React.useState({ ...EMPTY_FORM })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    // Catálogos de persona: caso de uso del dominio Personas (la misma lectura que el alta de
    // candidatos; ningún formulario compone ya sus propios catálogos).
    loadCandidateRegistryCatalogs()
      .then((catalogs) => {
        setCatalogs({
          gender_id: catalogs.genders,
          marital_status_id: catalogs.maritalStatuses,
          skin_color_id: catalogs.skinColors,
          education_level_id: catalogs.educationLevels,
        })
        setLicenseCategories(catalogs.licenseCategories)
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "No se cargaron los catálogos.")
      )
  }, [])

  const set = (key: keyof typeof form, value: string) => setForm((previous) => ({ ...previous, [key]: value }))

  // Al escribir la identificación, deriva la fecha de nacimiento con la lógica
  // existente de SiteCorp (nunca la inventa).
  const handleIdentification = (value: string) => {
    setForm((previous) => {
      const derivedBefore = ciToBirthDate(previous.identification)
      const next = { ...previous, identification: value }
      if (!previous.birth_date || previous.birth_date === derivedBefore) {
        next.birth_date = ciToBirthDate(value) || ""
      }
      return next
    })
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!entityId) {
      setError("No se pudo determinar la entidad actual.")
      return
    }
    setBusy(true)
    setError("")
    try {
      if (!form.identification.trim()) throw new Error("El número de identificación es obligatorio.")
      if (!isValidIdentification(form.identification)) throw new Error(IDENTIFICATION_ERROR_MESSAGE)
      const startDate = form.employment_start_date.trim()
      if (!startDate) throw new Error("Indica la fecha en la que el trabajador comenzó a trabajar en la entidad.")
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("La fecha de incorporación no es válida.")
      if (startDate > new Date().toISOString().slice(0, 10)) throw new Error("La fecha de incorporación no puede ser futura.")
      const balance = form.initial_vacation_balance.trim().replace(/\s/g, "").replace(",", ".")
      if (balance && !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(balance)) throw new Error("El saldo inicial de vacaciones no es válido.")
      const row: MigrationRow = {
        ...form,
        birth_date: form.birth_date || ciToBirthDate(form.identification) || "",
        driving_license_category_ids: licenseIds,
        position_code: "",
        initial_vacation_balance: balance,
      }
      // UNICIDAD DE PERSONAS (§27–§33): la migración individual no puede duplicar a
      // una persona ya existente (Candidato, Trabajador o Reingreso) por CI. La
      // comprobación la resuelve el backend a través del caso de uso del dominio.
      const existingPerson = await loadPersonIdentificationStatus(entityId, form.identification)
      if (existingPerson.worker_id) {
        throw new Error(
          existingPerson.worker_status === "active"
            ? "Esta persona ya está registrada como trabajador. Solo puede actualizar su información."
            : "Esta persona ya existe y actualmente se encuentra en Reingresos. Debe utilizar el expediente existente."
        )
      }
      if ((existingPerson.candidate_count ?? 0) > 0) {
        throw new Error(
          "Ya existe una persona con este número de identificación. Solo puede actualizar su información."
        )
      }

      const result = await createMigratedWorker(entityId, row)
      onSuccess(result.worker_id)
    } catch (cause) {
      console.error("[migrated-worker-dialog] No se pudo crear el trabajador", cause)
      setError(cause instanceof Error ? cause.message : "No se pudo crear el trabajador.")
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, key: keyof typeof form, type = "text", required = false, onChange?: (value: string) => void) => <div className="space-y-1.5" key={key}>
    <Label htmlFor={`migration-${key}`}>{label}{required ? " *" : ""}</Label>
    <SiteCorpInput id={`migration-${key}`} type={type} value={form[key]} onChange={(event) => (onChange ? onChange(event.target.value) : set(key, event.target.value))} required={required} />
  </div>
  const catalog = (label: string, key: "gender_id" | "marital_status_id" | "skin_color_id" | "education_level_id") => <div className="space-y-1.5" key={key}>
    <Label>{label}</Label>
    <SiteCorpSelect value={form[key] || undefined} onValueChange={(value) => set(key, value === "__placeholder__" ? "" : value)}>
      <SelectItem value="__placeholder__">Sin especificar</SelectItem>
      {(catalogs[key] || []).filter((item) => item.id && item.id.trim() !== "").map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
    </SiteCorpSelect>
  </div>

  return <form className="space-y-5" onSubmit={submit}>
    {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {field("Identificación", "identification", "text", true, handleIdentification)}{field("Nombre", "first_name", "text", true)}{field("Primer apellido", "first_surname", "text", true)}
      {field("Segundo apellido", "second_surname")}{field("Fecha de nacimiento", "birth_date", "date")}{catalog("Sexo", "gender_id")}
      {catalog("Estado civil", "marital_status_id")}{catalog("Color de piel", "skin_color_id")}{field("Teléfono", "phone")}
      {field("Correo", "email", "email")}{field("Dirección", "address")}{field("Provincia", "province")}
      {field("Municipio", "municipality")}
      <div className="space-y-1.5" key="employment_start_date">
        <Label htmlFor="migration-employment_start_date">Fecha de incorporación *</Label>
        <SiteCorpInput id="migration-employment_start_date" type="date" value={form.employment_start_date} required onChange={(event) => set("employment_start_date", event.target.value)} />
        <p className="text-xs text-slate-500">Fecha en la que el trabajador comenzó a trabajar en la entidad.</p>
      </div>
      {catalog("Nivel educacional", "education_level_id")}{field("Especialidad", "specialty")}{field("Profesión u oficio", "profession_or_trade")}
    </div>
    <p className="-mt-1 text-xs text-slate-600">La fecha de nacimiento se deriva del carné de identidad cuando es posible; puede completarla manualmente si no se deriva.</p>
    <div className="space-y-2"><Label>Licencias de conducción</Label><DrivingLicenseSelector categories={licenseCategories} value={licenseIds} onChange={setLicenseIds} disabled={busy} /></div>
    <div className="grid gap-3 sm:grid-cols-3">
      {field("Saldo inicial vacaciones (opcional)", "initial_vacation_balance", "text")}{field("Fecha corte vacaciones", "vacation_cutoff_date", "date")}
    </div>
    <p className="text-xs text-slate-600">El trabajador se crea sin puesto y sin documentos. Podrá vincularlo a la plantilla posteriormente desde su ficha.</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Creando…" : "Crear trabajador"}</Button></div>
  </form>
}
