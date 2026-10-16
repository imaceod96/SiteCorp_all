import * as React from "react"
import type { TemplateValidation } from "@/modules/document-templates/domain/entities"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { AlertTriangle, CheckCircle2, CircleSlash, Info } from "lucide-react"

/**
 * Fase 11B.1 — Validación ESTRUCTURAL de la versión (§34/§42/§43).
 *
 * Comprueba el archivo, los placeholders realmente presentes en el documento
 * configurado y la vigencia. NO comprueba si un trabajador concreto tiene
 * valores para esas variables: eso pertenece a la generación (11B.2).
 *
 * No existe ninguna lista universal de variables obligatorias: las variables
 * requeridas son las que el propio documento configurado contiene.
 *
 * Se admiten documentos Word `.doc` y `.docx`; sólo un paquete OOXML (`.docx`)
 * puede analizarse, por lo que un configurado `.doc` bloquea la activación con
 * un mensaje accionable (§10/§24/§25).
 */

interface Props {
  validation: TemplateValidation | null
  loading?: boolean
}

interface CheckDescriptor {
  key: keyof TemplateValidation["checks"]
  label: string
  blocking: boolean
  requiresAnalysis?: boolean
}

const CHECKS: CheckDescriptor[] = [
  { key: "original_file_present", label: "Documento original cargado", blocking: true },
  { key: "configured_file_present", label: "Documento configurado (con variables) cargado", blocking: true },
  {
    key: "configured_format_analyzable",
    label: "El documento configurado puede prepararse para análisis (.docx o .xlsx)",
    blocking: true,
  },
  { key: "analysis_present", label: "Análisis del documento registrado", blocking: true },
  {
    key: "analysis_matches_configured",
    label: "El análisis corresponde al documento configurado",
    blocking: true,
    requiresAnalysis: true,
  },
  {
    key: "valid_docx",
    label: "El documento analizado es un paquete OOXML válido (.docx o .xlsx)",
    blocking: true,
    requiresAnalysis: true,
  },
  { key: "no_unknown_variables", label: "Sin variables desconocidas", blocking: true, requiresAnalysis: true },
  {
    key: "no_incompatible_variables",
    label: "Variables compatibles con este tipo documental",
    blocking: true,
    requiresAnalysis: true,
  },
  {
    key: "no_malformed_placeholders",
    label: "Sin errores de sintaxis en los marcadores",
    blocking: true,
    requiresAnalysis: true,
  },
  { key: "effective_dates_coherent", label: "Vigencia coherente", blocking: true },
  { key: "no_simultaneous_active", label: "Sin versiones activas simultáneas para este tipo", blocking: true },
  {
    key: "has_placeholders",
    label: "La plantilla usa variables dinámicas",
    blocking: false,
    requiresAnalysis: true,
  },
]

const DocumentTemplateValidationPanel = ({ validation, loading }: Props) => {
  if (loading) {
    return (
      <SiteCorpCard title="Validación de la plantilla">
        <SiteCorpLoading rows={4} />
      </SiteCorpCard>
    )
  }

  if (!validation) {
    return (
      <SiteCorpCard title="Validación de la plantilla">
        <p className="text-sm text-muted-foreground">
          Seleccione una versión para ver su validación estructural.
        </p>
      </SiteCorpCard>
    )
  }

  const analysis = validation.analysis
  const analysisPresent = validation.checks.analysis_present

  return (
    <div className="space-y-4">
      <SiteCorpCard
        title="Validación de la plantilla"
        description={`Versión ${validation.version_number} · documento analizado: ${
          validation.analyzed_file_path
            ? analysis?.file_kind === "CONFIGURED"
              ? "configurado"
              : "original"
            : "ninguno"
        }`}
      >
        <div className="space-y-4">
          <div
            className={
              validation.ready
                ? "flex items-center gap-3 rounded-xl border border-sitecorp-success/30 bg-sitecorp-success/10 p-3"
                : "flex items-center gap-3 rounded-xl border border-sitecorp-warning/30 bg-sitecorp-warning/10 p-3"
            }
          >
            {validation.ready ? (
              <CheckCircle2 className="h-5 w-5 text-sitecorp-success" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-sitecorp-warning" />
            )}
            <div>
              <p className="text-sm font-semibold text-ink">
                {validation.ready
                  ? "Plantilla lista para activar"
                  : "Plantilla estructuralmente incompleta"}
              </p>
              <p className="text-xs text-muted-foreground">
                {validation.ready
                  ? "Los placeholders utilizados son válidos y la vigencia es correcta."
                  : "Resuelva los puntos marcados para poder activarla."}
              </p>
            </div>
          </div>

          {validation.analysis_issue && (
            <SiteCorpAlert type="warning" title="Documento no preparado para análisis">
              <p>{validation.analysis_issue}</p>
              <p className="mt-1 text-xs">
                El archivo original se conserva y puede descargarlo. Para activar la plantilla,
                cargue el documento configurado en formato .docx.
              </p>
            </SiteCorpAlert>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Variables encontradas</p>
              <p className="text-lg font-semibold text-ink">{validation.variables_found}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Válidas</p>
              <p className="text-lg font-semibold text-sitecorp-success">
                {validation.variables_valid}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Desconocidas</p>
              <p className="text-lg font-semibold text-ink">{validation.variables_unknown}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Incompatibles</p>
              <p className="text-lg font-semibold text-ink">{validation.variables_incompatible}</p>
            </div>
          </div>

          <ul className="space-y-2">
            {CHECKS.map((check) => {
              const passed = validation.checks[check.key]
              const pending = !analysisPresent && !!check.requiresAnalysis
              return (
                <li key={check.key} className="flex items-start gap-3 text-sm">
                  {passed ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-success" />
                  ) : pending ? (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : check.blocking ? (
                    <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-danger" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={passed ? "text-muted-foreground" : "text-ink"}>
                    {check.label}
                    {!passed && pending && " (pendiente de análisis)"}
                    {!passed && !pending && !check.blocking && " (informativo)"}
                  </span>
                </li>
              )
            })}
          </ul>

          {validation.warnings.length > 0 && (
            <SiteCorpAlert type="warning" title="Avisos">
              <ul className="list-inside list-disc space-y-1">
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </SiteCorpAlert>
          )}

          {validation.unknown_variables.length > 0 && (
            <div className="space-y-2 rounded-xl border border-sitecorp-danger/30 bg-sitecorp-danger/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sitecorp-danger">
                Variable no reconocida
              </p>
              <div className="flex flex-wrap gap-2">
                {validation.unknown_variables.map((variable) => (
                  <code
                    key={variable.key}
                    className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-sitecorp-danger"
                  >
                    {`{{${variable.key}}}`}
                  </code>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                No existen en el registro documental. Corrija el marcador en Word o utilice una
                variable del catálogo.
              </p>
            </div>
          )}

          {validation.incompatible_variables.length > 0 && (
            <div className="space-y-2 rounded-xl border border-sitecorp-danger/30 bg-sitecorp-danger/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sitecorp-danger">
                Variable incompatible con este tipo documental
              </p>
              <div className="flex flex-wrap gap-2">
                {validation.incompatible_variables.map((variable) => (
                  <code
                    key={variable.key}
                    className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-sitecorp-danger"
                    title={variable.label || undefined}
                  >
                    {`{{${variable.key}}}`}
                  </code>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Existen en el registro, pero no corresponden a este tipo de documento.
              </p>
            </div>
          )}

          {validation.malformed_placeholders.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-sitecorp-danger">
                Marcadores mal formados
              </p>
              <ul className="space-y-1">
                {validation.malformed_placeholders.map((malformed, index) => (
                  <li key={`${malformed.part}-${index}`} className="text-xs text-muted-foreground">
                    <code className="font-mono text-sitecorp-danger">{malformed.snippet}</code>{" "}
                    <span className="text-muted-foreground">({malformed.part})</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Se admiten dos llaves de apertura y dos de cierre:{" "}
                <code className="font-mono">{"{{variable.clave}}"}</code>.
              </p>
            </div>
          )}
        </div>
      </SiteCorpCard>

      <SiteCorpCard
        title="Variables requeridas por esta plantilla"
        description="Derivadas del documento configurado: son las que el motor documental (11B.2) necesitará resolver."
      >
        {validation.required_variables.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {analysisPresent
              ? "El documento configurado no contiene variables dinámicas."
              : "Todavía no hay un análisis del documento configurado."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {validation.required_variables.map((key) => (
                <code
                  key={key}
                  className="rounded-lg border border-border bg-white px-2 py-1 font-mono text-xs text-ink"
                >
                  {`{{${key}}}`}
                </code>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {validation.required_variables.length} variable(s) ·{" "}
              {validation.occurrences_total} aparición(es) en total. Las variables del catálogo que
              no aparecen en el documento no se exigen.
            </p>
          </div>
        )}
      </SiteCorpCard>

      {analysis && (
        <SiteCorpCard
          title="Análisis del documento"
          description="Resultado del analizador central sobre el documento Word analizable de la versión."
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Párrafos analizados</p>
                <p className="text-lg font-semibold text-ink">{analysis.paragraphs_scanned}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Marcadores divididos por Word</p>
                <p className="text-lg font-semibold text-ink">{analysis.split_run_placeholders}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Apariciones totales</p>
                <p className="text-lg font-semibold text-ink">{validation.occurrences_total}</p>
              </div>
            </div>

            {analysis.recognized.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Variables utilizadas
                </p>
                <div className="flex flex-wrap gap-2">
                  {analysis.recognized.map((occurrence) => (
                    <span
                      key={occurrence.key}
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-2 py-1"
                    >
                      <code className="font-mono text-xs text-ink">{`{{${occurrence.key}}}`}</code>
                      <SiteCorpStatusBadge status="neutral">×{occurrence.count}</SiteCorpStatusBadge>
                      {occurrence.split_runs > 0 && (
                        <SiteCorpStatusBadge status="info">dividido</SiteCorpStatusBadge>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Partes analizadas: {analysis.scanned_parts.join(", ") || "—"}
              {analysis.file_name ? ` · archivo: ${analysis.file_name}` : ""}
            </p>
          </div>
        </SiteCorpCard>
      )}
    </div>
  )
}

export default DocumentTemplateValidationPanel
