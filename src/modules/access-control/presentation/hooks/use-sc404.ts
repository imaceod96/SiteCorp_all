import * as React from "react"
import { useToast } from "@/shared/hooks/use-toast"
import {
  downloadGeneratedDocument,
  fetchGeneratedDocuments,
  type Sc404SourceType,
} from "@/modules/document-generation"
import { ensureSc404DocumentQueued } from "@/modules/contracts"

/**
 * Fase 20 / Bloque A — Generación y descarga del modelo SC-4-04 desde Vacaciones o Certificados Médicos.
 *
 * Los triggers en PostgreSQL encolan automáticamente cada vacación o certificado médico en
 * `public.document_generation_jobs`. Este hook también permite disparar o reintentar el
 * trabajo en cola y descargar el documento archivado en el expediente del trabajador.
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
      const queued = await ensureSc404DocumentQueued(
        sourceType === "VACATION"
          ? { vacationId: sourceId }
          : { medicalCertificateId: sourceId }
      )
      if (queued.generated || queued.skipped) {
        const doc = await downloadLatest(sourceType, sourceId)
        toast({
          title: "SC-4-04 generado",
          description: doc
            ? `El documento se generó y descargó: ${doc.file_name}`
            : "El documento se generó en el expediente del trabajador.",
        })
        return
      }

      toast({
        title: "No se pudo generar el SC-4-04",
        description:
          queued.result?.error ?? "La generación automática quedó en cola en el servidor.",
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

export const useSc404 = useSc404Generation
