import * as React from "react"
import { useToast } from "@/shared/hooks/use-toast"
import {
  downloadGeneratedDocument,
  fetchGeneratedDocuments,
  generateSc404Document,
  parseSc404ExistingId,
  type Sc404SourceType,
} from "@/modules/document-generation"

/**
 * Fase 20 — Generación del modelo SC-4-04 desde Vacaciones o Certificados Médicos.
 *
 * La generación es EXPLÍCITA (nunca automática al registrar). Si ya existe un
 * documento para (source_type, source_id, template_version), el backend lo
 * rechaza con SC404_ALREADY_EXISTS y aquí se ofrece/descarga el existente
 * (§47/§48). El DOCX se guarda en el expediente del trabajador (Storage privado).
 */
export function useSc404Generation() {
  const { toast } = useToast()
  const [generatingId, setGeneratingId] = React.useState<string | null>(null)

  const downloadLatest = async (sourceType: Sc404SourceType, sourceId: string) => {
    const docs = await fetchGeneratedDocuments(
      sourceType === "VACATION" ? { vacationId: sourceId } : { certificateId: sourceId }
    )
    const latest = docs.length > 0 ? docs[docs.length - 1] : null
    if (!latest) return null
    await downloadGeneratedDocument(latest)
    return latest
  }

  const generate = async (sourceType: Sc404SourceType, sourceId: string) => {
    if (generatingId) return
    setGeneratingId(sourceId)
    try {
      const result = await generateSc404Document(sourceType, sourceId)

      if (result.success) {
        const doc = await downloadLatest(sourceType, sourceId)
        toast({
          title: "SC-4-04 generado",
          description: doc
            ? `El documento se generó y descargó: ${doc.file_name}`
            : "El documento se generó en el expediente del trabajador.",
        })
        return
      }

      // §48: ya existe un documento idéntico (mismo origen + misma versión).
      const existingId = parseSc404ExistingId(result.error)
      if (existingId) {
        const downloaded = await downloadLatest(sourceType, sourceId)
        toast({
          title: downloaded ? "SC-4-04 ya existía" : "SC-4-04 ya existía",
          description: downloaded
            ? `Ya existía un SC-4-04 para este registro con esta versión de plantilla. Se descargó el documento existente: ${downloaded.file_name}`
            : "Ya existe un SC-4-04 para este registro con esta versión de plantilla. Puede consultarlo en el expediente del trabajador.",
        })
        return
      }

      toast({
        title: "No se pudo generar el SC-4-04",
        description: result.error ?? "Error desconocido.",
      })
    } catch (err) {
      toast({
        title: "No se pudo generar el SC-4-04",
        description: err instanceof Error ? err.message : "Error desconocido.",
      })
    } finally {
      setGeneratingId(null)
    }
  }

  return { generate, generatingId }
}
