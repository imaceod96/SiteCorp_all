import JSZip from "jszip"

/**
 * Fase 11B.2 — Motor de sustitución OOXML.
 *
 * Trabaja SIEMPRE sobre una COPIA del DOCX configurado de la plantilla: nunca
 * modifica el archivo original. Sustituye TODAS las apariciones de
 * `{{variable.key}}`, incluso cuando el marcador está dividido entre varios
 * «runs» de Word (p. ej. `<w:r>{{worker.</w:r><w:r>full_name}}</w:r>`), porque
 * reconstruye el texto a nivel de PÁRRAFO antes de buscar los marcadores.
 *
 * Preserva el formato: la sustitución se hace sobre los propios `<w:t>` del
 * documento, sin reconstruir el contrato ni convertirlo a HTML.
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

export const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g

/** Partes del paquete Word que pueden contener marcadores (las mismas que analiza 11B.1). */
export const WORD_PART_PATTERN = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

const decodeXmlText = (value: string): string =>
  value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1] === "x" || entity[1] === "X"
      const code = isHex ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      return String.fromCodePoint(code)
    }
    return XML_ENTITIES[entity] ?? match
  })

const escapeXmlText = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

interface TextNode {
  /** Índices del elemento `<w:t>` completo dentro del párrafo. */
  fullStart: number
  fullEnd: number
  /** Texto decodificado del nodo. */
  decoded: string
  /** Posición inicial del nodo dentro del texto concatenado del párrafo. */
  decodedStart: number
  xml: string
}

interface ParagraphRender {
  xml: string
  replacedKeys: Set<string>
  replacedCount: number
  unknownKeys: Set<string>
  leftoverKeys: Set<string>
}

const TEXT_NODE_PATTERN = /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:t(?:\s[^>]*)?\/>/g

const innerTextOf = (xml: string): string => {
  const openEnd = xml.indexOf(">")
  if (openEnd === -1) return ""
  if (xml.endsWith("/>")) return ""
  const closeStart = xml.lastIndexOf("</w:t>")
  if (closeStart === -1 || closeStart < openEnd) return ""
  return xml.slice(openEnd + 1, closeStart)
}

const buildTextElement = (segments: string[]): string => {
  if (segments.length <= 1) {
    const text = segments[0] ?? ""
    if (text === "") return "<w:t/>"
    const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : ""
    return `<w:t${preserve}>${escapeXmlText(text)}</w:t>`
  }
  // Saltos de línea reales de Word: varias secciones de texto unidas por <w:br/>.
  return segments
    .map((segment) => `<w:t xml:space="preserve">${escapeXmlText(segment)}</w:t>`)
    .join("<w:br/>")
}

const collectNodes = (paragraphXml: string): TextNode[] => {
  const nodes: TextNode[] = []
  let decodedStart = 0
  let match: RegExpExecArray | null
  TEXT_NODE_PATTERN.lastIndex = 0
  while ((match = TEXT_NODE_PATTERN.exec(paragraphXml)) !== null) {
    const decoded = decodeXmlText(innerTextOf(match[0]))
    nodes.push({
      fullStart: match.index,
      fullEnd: match.index + match[0].length,
      decoded,
      decodedStart,
      xml: match[0],
    })
    decodedStart += decoded.length
  }
  return nodes
}

const renderParagraph = (paragraphXml: string, values: Record<string, string>, knownKeys: Set<string>): ParagraphRender => {
  const nodes = collectNodes(paragraphXml)
  const result: ParagraphRender = {
    xml: paragraphXml,
    replacedKeys: new Set(),
    replacedCount: 0,
    unknownKeys: new Set(),
    leftoverKeys: new Set(),
  }
  if (nodes.length === 0) return result

  const concatenated = nodes.map((node) => node.decoded).join("")

  const insertions = new Map<number, string>()
  const deletions: { start: number; end: number }[] = []

  PLACEHOLDER_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER_PATTERN.exec(concatenated)) !== null) {
    const key = match[1].trim()
    if (key === "") continue
    if (!knownKeys.has(key)) {
      result.unknownKeys.add(key)
      continue
    }
    if (!(key in values)) {
      // Variable conocida pero sin valor: se deja como residual para detectarla (§31).
      result.unknownKeys.add(key)
      continue
    }
    insertions.set(match.index, values[key])
    deletions.push({ start: match.index, end: match.index + match[0].length })
    result.replacedKeys.add(key)
    result.replacedCount += 1
  }

  if (insertions.size === 0 && result.unknownKeys.size === 0) return result

  const newTexts = nodes.map((node) => {
    const start = node.decodedStart
    const end = node.decodedStart + node.decoded.length
    let output = ""
    let index = start
    while (index < end) {
      let skipped = false
      for (const deletion of deletions) {
        if (index >= deletion.start && index < deletion.end) {
          const pending = insertions.get(deletion.start)
          if (pending !== undefined && deletion.start >= start && deletion.start < end) output += pending
          index = deletion.end
          skipped = true
          break
        }
      }
      if (skipped) continue
      const pending = insertions.get(index)
      if (pending !== undefined) output += pending
      output += concatenated[index]
      index += 1
    }
    return output
  })

  const segments: string[] = []
  let cursor = 0
  nodes.forEach((node, nodeIndex) => {
    const newText = newTexts[nodeIndex]
    if (newText === node.decoded) return
    segments.push(paragraphXml.slice(cursor, node.fullStart))
    segments.push(buildTextElement(newText.split("\n")))
    cursor = node.fullEnd
  })
  segments.push(paragraphXml.slice(cursor))
  result.xml = segments.join("")

  // Comprobación posterior (§31): cualquier marcador que quede sin resolver.
  const renderedText = collectNodes(result.xml)
    .map((node) => node.decoded)
    .join("")
  PLACEHOLDER_PATTERN.lastIndex = 0
  while ((match = PLACEHOLDER_PATTERN.exec(renderedText)) !== null) {
    const key = match[1].trim()
    if (key !== "") result.leftoverKeys.add(key)
  }

  return result
}

const renderPart = (
  xml: string,
  values: Record<string, string>,
  knownKeys: Set<string>
): { xml: string; replacedKeys: Set<string>; replacedCount: number; unknownKeys: Set<string>; leftoverKeys: Set<string> } => {
  const replacedKeys = new Set<string>()
  const unknownKeys = new Set<string>()
  const leftoverKeys = new Set<string>()
  let replacedCount = 0

  const rendered = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const outcome = renderParagraph(paragraph, values, knownKeys)
    outcome.replacedKeys.forEach((key) => replacedKeys.add(key))
    outcome.unknownKeys.forEach((key) => unknownKeys.add(key))
    outcome.leftoverKeys.forEach((key) => leftoverKeys.add(key))
    replacedCount += outcome.replacedCount
    return outcome.xml
  })

  return { xml: rendered, replacedKeys, replacedCount, unknownKeys, leftoverKeys }
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
    let found = false
    xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
      const text = collectNodes(paragraph)
        .map((node) => node.decoded)
        .join("")
      if (PLACEHOLDER_PATTERN.test(text)) {
        found = true
        PLACEHOLDER_PATTERN.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
          const key = match[1].trim()
          if (key !== "") keys.add(key)
        }
      }
      PLACEHOLDER_PATTERN.lastIndex = 0
      return paragraph
    })
    if (found) parts.push(name)
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
  const known = new Set(knownKeys)

  const replacedKeys = new Set<string>()
  const unknownKeys = new Set<string>()
  const leftoverKeys = new Set<string>()
  const usedParts = new Set<string>()
  let replacedCount = 0

  for (const name of Object.keys(zip.files)) {
    if (!WORD_PART_PATTERN.test(name) || zip.files[name].dir) continue
    const xml = await zip.file(name)!.async("string")
    const outcome = renderPart(xml, values, known)

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
