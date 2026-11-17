/**
 * Motor OOXML compartido (navegador, Vitest y Deno Edge Functions).
 *
 * Sin dependencias externas: opera directamente sobre los `<w:p>` y `<w:t>` de Word (.docx)
 * y sobre `sharedStrings.xml` (`<si>`) y `worksheets/sheet*.xml` (`<is>`) de Excel (.xlsx),
 * reconstruyendo el texto concatenado por bloque para resolver marcadores `{{variable}}`
 * incluso cuando Word o Excel los divide entre múltiples `<w:r>`/`<r>` o `<w:t>`/`<t>`.
 */

export const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g

export const WORD_PART_PATTERN =
  /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/

export const XLSX_PART_PATTERN = /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

export const normalizeVariableKey = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

export const decodeXmlText = (value: string): string =>
  value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1] === "x" || entity[1] === "X"
      const code = isHex
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      return String.fromCodePoint(code)
    }
    return XML_ENTITIES[entity] ?? match
  })

export const escapeXmlText = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

interface TextNode {
  fullStart: number
  fullEnd: number
  decoded: string
  decodedStart: number
  xml: string
}

export interface WordPartRenderResult {
  xml: string
  replacedKeys: Set<string>
  replacedCount: number
  unknownKeys: Set<string>
  leftoverKeys: Set<string>
}

export interface WordPartRenderOptions {
  knownKeys?: Iterable<string>
  normalizeKeys?: boolean
  fallbackEmpty?: boolean
}

const WORD_TEXT_NODE_PATTERN = /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:t(?:\s[^>]*)?\/>/g
const XLSX_TEXT_NODE_PATTERN = /<t(?:\s[^>]*)?>[\s\S]*?<\/t>|<t(?:\s[^>]*)?\/>/g

const innerTextOfTag = (xml: string, closingTag: string): string => {
  const openEnd = xml.indexOf(">")
  if (openEnd === -1) return ""
  if (xml.endsWith("/>")) return ""
  const closeStart = xml.lastIndexOf(closingTag)
  if (closeStart === -1 || closeStart < openEnd) return ""
  return xml.slice(openEnd + 1, closeStart)
}

const buildWordTextElement = (segments: string[]): string => {
  if (segments.length <= 1) {
    const text = segments[0] ?? ""
    if (text === "") return "<w:t/>"
    const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : ""
    return `<w:t${preserve}>${escapeXmlText(text)}</w:t>`
  }
  return segments
    .map((segment) => `<w:t xml:space="preserve">${escapeXmlText(segment)}</w:t>`)
    .join("<w:br/>")
}

const buildXlsxTextElement = (segments: string[]): string => {
  const joined = segments.join("\n")
  if (joined === "") return "<t/>"
  const preserve = /^\s|\s$|\n/.test(joined) ? ' xml:space="preserve"' : ""
  return `<t${preserve}>${escapeXmlText(joined)}</t>`
}

const collectNodesByPattern = (
  containerXml: string,
  pattern: RegExp,
  closingTag: string
): TextNode[] => {
  const nodes: TextNode[] = []
  let decodedStart = 0
  let match: RegExpExecArray | null
  pattern.lastIndex = 0
  while ((match = pattern.exec(containerXml)) !== null) {
    const decoded = decodeXmlText(innerTextOfTag(match[0], closingTag))
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

const renderContainerWithTextNodes = (
  containerXml: string,
  nodePattern: RegExp,
  closingTag: string,
  buildElement: (segments: string[]) => string,
  values: Record<string, string>,
  normalizedValues: Record<string, string> | null,
  knownKeys: Set<string> | null,
  fallbackEmpty: boolean
): {
  xml: string
  replacedKeys: Set<string>
  replacedCount: number
  unknownKeys: Set<string>
  leftoverKeys: Set<string>
} => {
  const nodes = collectNodesByPattern(containerXml, nodePattern, closingTag)
  const result = {
    xml: containerXml,
    replacedKeys: new Set<string>(),
    replacedCount: 0,
    unknownKeys: new Set<string>(),
    leftoverKeys: new Set<string>(),
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

    if (knownKeys && !knownKeys.has(key)) {
      result.unknownKeys.add(key)
      continue
    }

    let resolved: string | undefined
    if (key in values) {
      resolved = values[key]
    } else if (normalizedValues) {
      const norm = normalizeVariableKey(key)
      if (norm in normalizedValues) {
        resolved = normalizedValues[norm]
      }
    }

    if (resolved === undefined) {
      if (fallbackEmpty) {
        resolved = ""
      } else {
        result.unknownKeys.add(key)
        continue
      }
    }

    insertions.set(match.index, resolved)
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
          if (pending !== undefined && deletion.start >= start && deletion.start < end) {
            output += pending
          }
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
    segments.push(containerXml.slice(cursor, node.fullStart))
    segments.push(buildElement(newText.split(/\r?\n/)))
    cursor = node.fullEnd
  })
  segments.push(containerXml.slice(cursor))
  result.xml = segments.join("")

  const renderedText = collectNodesByPattern(result.xml, nodePattern, closingTag)
    .map((node) => node.decoded)
    .join("")
  PLACEHOLDER_PATTERN.lastIndex = 0
  while ((match = PLACEHOLDER_PATTERN.exec(renderedText)) !== null) {
    const key = match[1].trim()
    if (key !== "") result.leftoverKeys.add(key)
  }

  return result
}

export const scanWordPartPlaceholders = (xml: string): string[] => {
  const keys = new Set<string>()
  xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = collectNodesByPattern(paragraph, WORD_TEXT_NODE_PATTERN, "</w:t>")
      .map((node) => node.decoded)
      .join("")
    PLACEHOLDER_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
      const key = match[1].trim()
      if (key !== "") keys.add(key)
    }
    PLACEHOLDER_PATTERN.lastIndex = 0
    return paragraph
  })
  return [...keys]
}

export const renderWordPartXml = (
  xml: string,
  values: Record<string, string>,
  options: WordPartRenderOptions = {}
): WordPartRenderResult => {
  const replacedKeys = new Set<string>()
  const unknownKeys = new Set<string>()
  const leftoverKeys = new Set<string>()
  let replacedCount = 0

  const knownKeys = options.knownKeys ? new Set(options.knownKeys) : null
  const fallbackEmpty = options.fallbackEmpty === true
  let normalizedValues: Record<string, string> | null = null
  if (options.normalizeKeys) {
    normalizedValues = {}
    for (const [k, v] of Object.entries(values)) {
      normalizedValues[k] = v ?? ""
      normalizedValues[normalizeVariableKey(k)] = v ?? ""
    }
  }

  const rendered = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const outcome = renderContainerWithTextNodes(
      paragraph,
      WORD_TEXT_NODE_PATTERN,
      "</w:t>",
      buildWordTextElement,
      values,
      normalizedValues,
      knownKeys,
      fallbackEmpty
    )
    outcome.replacedKeys.forEach((key) => replacedKeys.add(key))
    outcome.unknownKeys.forEach((key) => unknownKeys.add(key))
    outcome.leftoverKeys.forEach((key) => leftoverKeys.add(key))
    replacedCount += outcome.replacedCount
    return outcome.xml
  })

  return { xml: rendered, replacedKeys, replacedCount, unknownKeys, leftoverKeys }
}

/**
 * Renderizado XML detallado para Excel (.xlsx): opera sobre `<si>` (en `sharedStrings.xml`)
 * e `<is>` (inline strings en `sheet*.xml`), reconstruyendo `<t>` consecutivos cuando Excel
 * fragmenta un marcador en texto enriquecido.
 */
export const renderXlsxXmlPartDetailed = (
  xml: string,
  values: Record<string, string>,
  options: WordPartRenderOptions = {}
): WordPartRenderResult => {
  const replacedKeys = new Set<string>()
  const unknownKeys = new Set<string>()
  const leftoverKeys = new Set<string>()
  let replacedCount = 0

  const knownKeys = options.knownKeys ? new Set(options.knownKeys) : null
  const fallbackEmpty = options.fallbackEmpty === true
  let normalizedValues: Record<string, string> | null = null
  if (options.normalizeKeys) {
    normalizedValues = {}
    for (const [k, v] of Object.entries(values)) {
      normalizedValues[k] = v ?? ""
      normalizedValues[normalizeVariableKey(k)] = v ?? ""
    }
  }

  const rendered = xml.replace(/<(si|is)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, (cellBlock) => {
    const outcome = renderContainerWithTextNodes(
      cellBlock,
      XLSX_TEXT_NODE_PATTERN,
      "</t>",
      buildXlsxTextElement,
      values,
      normalizedValues,
      knownKeys,
      fallbackEmpty
    )
    outcome.replacedKeys.forEach((key) => replacedKeys.add(key))
    outcome.unknownKeys.forEach((key) => unknownKeys.add(key))
    outcome.leftoverKeys.forEach((key) => leftoverKeys.add(key))
    replacedCount += outcome.replacedCount
    return outcome.xml
  })

  return { xml: rendered, replacedKeys, replacedCount, unknownKeys, leftoverKeys }
}

export const renderXlsxXmlPart = (
  xml: string,
  values: Record<string, string>
): string => {
  const normalizedValues: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    normalizedValues[k] = v ?? ""
    normalizedValues[normalizeVariableKey(k)] = v ?? ""
  }

  return xml.replace(PLACEHOLDER_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.trim()
    if (!key) return ""
    const val = values[key] ?? normalizedValues[key] ?? normalizedValues[normalizeVariableKey(key)] ?? ""
    return escapeXmlText(String(val))
  })
}
