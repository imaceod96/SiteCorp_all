import * as React from "react"
import {
  DOCUMENT_VARIABLES,
  type DocumentVariableDefinition,
} from "@/modules/document-templates/domain/document-variables"
import { documentTypeCodeForTemplateType } from "@/modules/document-templates/domain/rules"
import type { TemplateOccurrence } from "@/modules/document-templates/domain/entities"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { showSuccess, showError } from "@/utils/toast"
import { Copy, Search, Braces } from "lucide-react"

/**
 * Fase 11B.1 — Catálogo de variables documentales DISPONIBLES (§16/§27/§28/§60).
 *
 * Lee el registro central de 11A.7: no existe una lista paralela escrita a mano.
 * Este catálogo NO es una lista de variables obligatorias: la plantilla sólo
 * requiere las variables que realmente aparecen en su documento configurado (§4/§38).
 */

interface Props {
  templateTypeCode: string
  /** Variables detectadas en el DOCX configurado de la versión en pantalla. */
  usedVariables: TemplateOccurrence[]
}

type UsageFilter = "ALL" | "USED" | "UNUSED"

const templatePlaceholder = (key: string): string => `{{${key}}}`

const dataTypeLabel: Record<DocumentVariableDefinition["dataType"], string> = {
  text: "Texto",
  integer: "Número",
  amount: "Importe",
  date: "Fecha",
  hours: "Horas",
}

const DocumentTemplateVariablesPanel = ({ templateTypeCode, usedVariables }: Props) => {
  const [search, setSearch] = React.useState("")
  const [usageFilter, setUsageFilter] = React.useState<UsageFilter>("ALL")

  const documentType = documentTypeCodeForTemplateType(templateTypeCode)
  const usage = React.useMemo(() => {
    const map = new Map<string, number>()
    usedVariables.forEach((occurrence) => map.set(occurrence.key, occurrence.count))
    return map
  }, [usedVariables])

  const applicable = React.useMemo(
    () =>
      DOCUMENT_VARIABLES.filter(
        (definition) =>
          definition.documentTypes.includes(documentType) &&
          // Aislamiento de catálogo (§Fase 22): p. ej. SC_4_04 muestra
          // exclusivamente variables sc404.*; las legacy siguen resolviendo
          // pero no se ofrecen en el selector.
          !definition.catalogHiddenFor?.includes(documentType)
      ),
    [documentType]
  )

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    return applicable.filter((definition) => {
      const isUsed = usage.has(definition.key)
      if (usageFilter === "USED" && !isUsed) return false
      if (usageFilter === "UNUSED" && isUsed) return false
      if (!term) return true
      return (
        definition.key.toLowerCase().includes(term) ||
        definition.label.toLowerCase().includes(term) ||
        definition.category.toLowerCase().includes(term) ||
        definition.description.toLowerCase().includes(term)
      )
    })
  }, [applicable, search, usage, usageFilter])

  const byCategory = React.useMemo(() => {
    const map = new Map<string, DocumentVariableDefinition[]>()
    filtered.forEach((definition) => {
      const list = map.get(definition.category) || []
      list.push(definition)
      map.set(definition.category, list)
    })
    return Array.from(map.entries())
  }, [filtered])

  const handleCopy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(templatePlaceholder(key))
      showSuccess("Variable copiada")
    } catch {
      showError("No se pudo copiar la variable al portapapeles.")
    }
  }

  return (
    <SiteCorpCard
      title="Variables disponibles"
      description={`Variables del registro documental compatibles con este tipo de documento (${applicable.length}). La plantilla utiliza sólo las que necesite.`}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <SiteCorpInput
              className="pl-9"
              value={search}
              placeholder="Buscar por nombre, variable, descripción o categoría…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <SiteCorpSelect
            className="sm:w-64"
            value={usageFilter}
            onValueChange={(value) => setUsageFilter(value as UsageFilter)}
          >
            <option value="ALL">Todas las variables</option>
            <option value="USED">Sólo las usadas en esta plantilla</option>
            <option value="UNUSED">Sólo las no usadas</option>
          </SiteCorpSelect>
        </div>

        <p className="rounded-xl border border-sitecorp-primary/20 bg-sitecorp-primary/5 p-3 text-xs text-muted-foreground">
          Copie la variable y péguela en Word en el lugar del dato que cambia. El analizador central
          une los fragmentos internos del DOCX, por lo que un marcador partido por Word sigue siendo
          reconocido. Las variables que no aparezcan en el documento no se exigen ni se añaden solas.
        </p>

        {byCategory.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay variables que coincidan con el filtro.</p>
        ) : (
          <div className="space-y-5">
            {byCategory.map(([category, definitions]) => (
              <div key={category} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </p>
                <div className="space-y-2">
                  {definitions.map((definition) => {
                    const occurrences = usage.get(definition.key)
                    return (
                      <div
                        key={definition.key}
                        className="flex flex-col gap-2 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Braces className="h-3.5 w-3.5 text-sitecorp-primary" />
                            <span className="text-sm font-medium text-ink">{definition.label}</span>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-ink">
                              {templatePlaceholder(definition.key)}
                            </code>
                            {occurrences !== undefined && (
                              <SiteCorpStatusBadge status="success">
                                {occurrences === 1 ? "1 aparición" : `${occurrences} apariciones`}
                              </SiteCorpStatusBadge>
                            )}
                            {definition.kind === "CALCULATED" && (
                              <SiteCorpStatusBadge status="info">Calculada</SiteCorpStatusBadge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {definition.description} · {dataTypeLabel[definition.dataType]}
                          </p>
                        </div>
                        <SiteCorpButton
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopy(definition.key)}
                        >
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          Copiar
                        </SiteCorpButton>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SiteCorpCard>
  )
}

export default DocumentTemplateVariablesPanel
