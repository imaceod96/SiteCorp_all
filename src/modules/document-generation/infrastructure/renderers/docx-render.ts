import JSZip from "jszip"
import {
  PLACEHOLDER_PATTERN,
  WORD_PART_PATTERN,
  renderWordPartXml,
  scanWordPartPlaceholders,
} from "../../domain/ooxml-xml"

export { PLACEHOLDER_PATTERN, WORD_PART_PATTERN }

/**
 * Fase 11B.2 — Motor de sustitución OOXML.
 *
 * Delega la reconstrucción a nivel de párrafo y la preservación de nodos `<w:t>` al
 * núcleo compartido `domain/ooxml-xml.ts`.
 */

export interface DocxRenderResult {
  bytes: Uint8Array
  /** Claves realmente sustituidas. */
  replacedKeys: string[]
  /** Número total de apariciones sustituidas. */
  replacedCount: number
  /** Marcadores presentes en el documento que NO existen en el registro. */
  unknownKeys: string[]
  /** Marcadores que quedaron sin resolver tras la sustitución. */
  leftoverKeys: string[]
  /** Partes del paquete donde se encontraron marcadores. */
  parts: string[]
}

/** Escanea un DOCX y devuelve los marcadores encontrados en cada parte. */
export const scanDocxPlaceholders = async (
  bytes: Uint8Array
): Promise<{ keys: string[]; parts: string[] }> => {
  const zip = await JSZip.loadAsync(bytes)
  const keys = new Set<string>()
  const parts: string[] = []

  for (const name of Object.keys(zip.files)) {
    if (!WORD_PART_PATTERN.test(name) || zip.files[name].dir) continue
    const xml = await zip.file(name)!.async("string")
    const foundKeys = scanWordPartPlaceholders(xml)
    if (foundKeys.length > 0) {
      parts.push(name)
      foundKeys.forEach((key) => keys.add(key))
    }
  }

  return { keys: [...keys], parts }
}

/**
 * Renderiza un DOCX sustituyendo los marcadores por los valores indicados.
 * Nunca escribe sobre el archivo de entrada: devuelve un paquete nuevo.
 */
export const renderDocx = async (
  input: Uint8Array | ArrayBuffer,
  values: Record<string, string>,
  knownKeys: Iterable<string>
): Promise<DocxRenderResult> => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const zip = await JSZip.loadAsync(bytes.slice())

  const replacedKeys = new Set<string>()
  const unknownKeys = new Set<string>()
  const leftoverKeys = new Set<string>()
  const usedParts = new Set<string>()
  let replacedCount = 0

  for (const name of Object.keys(zip.files)) {
    if (!WORD_PART_PATTERN.test(name) || zip.files[name].dir) continue
    const xml = await zip.file(name)!.async("string")
    const outcome = renderWordPartXml(xml, values, { knownKeys })

    if (outcome.unknownKeys.size > 0 || outcome.replacedCount > 0) usedParts.add(name)
    outcome.replacedKeys.forEach((key) => replacedKeys.add(key))
    outcome.unknownKeys.forEach((key) => unknownKeys.add(key))
    outcome.leftoverKeys.forEach((key) => leftoverKeys.add(key))
    replacedCount += outcome.replacedCount

    if (outcome.xml !== xml) {
      zip.file(name, outcome.xml)
    }
  }

  const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })

  return {
    bytes: output,
    replacedKeys: [...replacedKeys],
    replacedCount,
    unknownKeys: [...unknownKeys],
    leftoverKeys: [...leftoverKeys],
    parts: [...usedParts],
  }
}
