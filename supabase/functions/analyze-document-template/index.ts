import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"
import JSZip from "https://esm.sh/jszip@3.10.1"

/**
 * Fase 11B.1 — Analizador central de plantillas documentales Word (§79 + 11B.1).
 *
 * Es el ÚNICO componente autorizado a leer el contenido de una plantilla:
 *   1. autentica al llamante y descarga el archivo respetando las políticas del bucket,
 *   2. DETECTA el formato real por firma/estructura (no por extensión):
 *        DOCX → paquete OOXML (ZIP + [Content_Types].xml + word/document.xml)
 *        DOC  → contenedor OLE/CFB con el flujo interno «WordDocument» (Word 97-2003)
 *        UNSUPPORTED → cualquier otra cosa (PDF, RTF, ODT, texto, binario desconocido)
 *   3. analiza marcadores `{{variable.key}}` SÓLO en paquetes OOXML. Un `.doc`
 *      binario NUNCA se abre como ZIP ni se pasa por el parser OOXML (§3/§7/§8).
 *
 * NO modifica el documento, NO sustituye variables y NO genera nada: eso es 11B.2.
 * La decisión sobre qué variable es válida vive en la base de datos.
 *
 * Nota 11B.1: la conversión real `.doc` → `.docx` requeriría un proceso nativo
 * (LibreOffice/antiword) que este runtime (Deno sin subprocesos) o el navegador
 * no pueden ejecutar, y no se permite enviar contratos a servicios externos (§9).
 * Por eso un `.doc` se conserva intacto, se identifica y se marca explícitamente
 * como «no preparable para análisis», sin fingir que fue analizado (§10/§24).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const BUCKET = "document-templates"
const MAX_FILE_SIZE = 10485760
const PART_PATTERN = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/
const VALID_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g
const SINGLE_BRACE = /(^|[^{])\{\s*([A-Za-z0-9_.]+)\s*\}(?!\})/
const MAX_MALFORMED = 20

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const DOC_MIME = "application/msword"
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const FORMAT_ISSUE: Record<string, string> = {
  DOC:
    "Archivo Word 97-2003 (.doc) detectado. El archivo se conserva intacto, pero no puede " +
    "prepararse para el análisis de variables en esta instalación (requiere formato .docx). " +
    "Puede descargarlo, convertirlo a .docx y volver a subirlo.",
  DOC_CORRUPT:
    "Archivo Word 97-2003 (.doc) detectado, pero su estructura interna no pudo verificarse. " +
    "El original se conserva intacto y sin modificar. La plantilla no podrá analizarse ni " +
    "activarse hasta disponer de una versión analizable (.docx).",
  ODT: "Formato no compatible (documento OpenDocument). Seleccione un documento Word (.doc o .docx).",
  PDF: "Formato no compatible (documento PDF). Seleccione un documento Word (.doc o .docx).",
  RTF: "Formato no compatible (documento RTF). Seleccione un documento Word (.doc o .docx).",
  UNKNOWN: "Formato no compatible. Seleccione un documento Word (.doc o .docx).",
}

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const decodeXml = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")

interface RunRange {
  start: number
  end: number
}

interface Occurrence {
  key: string
  count: number
  split_runs: number
}

interface Malformed {
  part: string
  snippet: string
}

/** Extrae el texto de un párrafo junto con los límites de cada «run» (<w:t>). */
const readParagraph = (paragraphXml: string): { text: string; runs: RunRange[] } => {
  const runs: RunRange[] = []
  let text = ""
  const runPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let match: RegExpExecArray | null
  while ((match = runPattern.exec(paragraphXml)) !== null) {
    const value = decodeXml(match[1])
    const start = text.length
    text += value
    runs.push({ start, end: text.length })
  }
  return { text, runs }
}

const isSplitAcrossRuns = (runs: RunRange[], start: number, end: number): boolean =>
  runs.some((run) => run.start > start && run.start < end)

/**
 * Extrae los textos de celda de un XML de Excel.
 *
 * - `xl/sharedStrings.xml`: cada celda de texto apunta a un `<si>`; dentro de un
 *   `<si>` puede haber varios `<t>` (texto enriquecido), así que se CONCATENAN
 *   antes de buscar, igual que se hace con los «runs» de Word.
 * - `xl/worksheets/sheetN.xml`: sólo se consideran las cadenas en línea `<is>`.
 *
 * Devuelve la lista de textos de celda ya decodificados.
 */
const readXlsxCellTexts = (xml: string, containerTag: "si" | "is"): string[] => {
  const texts: string[] = []
  const containerPattern = new RegExp(`<${containerTag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${containerTag}>`, "g")
  const textPattern = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let container: RegExpExecArray | null
  while ((container = containerPattern.exec(xml)) !== null) {
    let text = ""
    let piece: RegExpExecArray | null
    textPattern.lastIndex = 0
    while ((piece = textPattern.exec(container[0])) !== null) {
      text += decodeXml(piece[1])
    }
    texts.push(text)
  }
  return texts
}

const startsWith = (bytes: Uint8Array, sequence: number[], offset = 0): boolean =>
  sequence.every((byte, index) => bytes[offset + index] === byte)

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] | (bytes[offset + 1] << 8)

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0

const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff

/**
 * Comprueba de verdad que el contenedor OLE/CFB contiene el flujo «WordDocument».
 *
 * No basta con buscar el nombre en los primeros KB: Word suele escribir el
 * directorio al final del archivo, por lo que se recorre la cadena de sectores
 * del directorio siguiendo la FAT (igual que un lector CFB real).
 *
 * Devuelve `null` cuando el contenedor no pudo interpretarse (para poder recurrir
 * a una búsqueda de respaldo) y `boolean` cuando la estructura sí se leyó.
 */
const hasWordDocumentStream = (bytes: Uint8Array): boolean | null => {
  if (bytes.length < 512) return null
  const sectorShift = readUint16(bytes, 0x1e)
  if (sectorShift < 7 || sectorShift > 12) return null
  const sectorSize = 1 << sectorShift
  const sectorStart = (sector: number) => 512 + sector * sectorSize

  // FAT: 109 entradas DIFAT de la cabecera + las que encadenan los sectores DIFAT.
  const fat: number[] = []
  const appendFatSector = (fatSector: number) => {
    const start = sectorStart(fatSector)
    if (start + sectorSize > bytes.length || fat.length > 65536) return
    for (let offset = 0; offset + 4 <= sectorSize; offset += 4) fat.push(readUint32(bytes, start + offset))
  }
  for (let index = 0; index < 109; index += 1) {
    const entry = readUint32(bytes, 0x4c + index * 4)
    if (entry !== FREESECT && entry !== ENDOFCHAIN) appendFatSector(entry)
    if (fat.length > 65536) break
  }

  let walked = false
  let sector = readUint32(bytes, 0x30)
  for (let step = 0; step < 64; step += 1) {
    if (sector === ENDOFCHAIN || sector === FREESECT) break
    const start = sectorStart(sector)
    if (start + 128 > bytes.length) break
    const end = Math.min(start + sectorSize, bytes.length)
    walked = true
    if (containsSequence(bytes.subarray(start, end), WORD_STREAM_NAME)) return true
    const next = fat[sector]
    if (next === undefined) break
    sector = next
  }

  return walked ? false : null
}

const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
// Los nombres de entrada del contenedor OLE/CFB se guardan en UTF-16LE.
const WORD_STREAM_NAME = [
  0x57, 0x00, 0x6f, 0x00, 0x72, 0x00, 0x64, 0x00, 0x44, 0x00,
  0x6f, 0x00, 0x63, 0x00, 0x75, 0x00, 0x6d, 0x00, 0x65, 0x00, 0x6e, 0x00, 0x74, 0x00,
]

const containsSequence = (bytes: Uint8Array, sequence: number[], limit = bytes.length): boolean => {
  for (let index = 0; index + sequence.length <= limit; index += 1) {
    if (sequence.every((byte, offset) => bytes[index + offset] === byte)) return true
  }
  return false
}

type WordFormat = "DOC" | "DOCX" | "UNSUPPORTED"
type UnsupportedKind = "PDF" | "RTF" | "ODT" | "UNKNOWN"

interface FormatDetection {
  format: WordFormat
  /** Subtipo cuando format === "UNSUPPORTED" o cuando el .doc está dañado. */
  kind?: UnsupportedKind | "ZIP" | "ZIP_BROKEN" | "DOC_CORRUPT"
  mimeType: string | null
}

/**
 * Detección centralizada del formato real (§4). No se apoya en la extensión:
 * comprueba firma de archivo y, cuando es viable, la estructura interna.
 */
const detectWordDocumentFormat = (bytes: Uint8Array): FormatDetection => {
  if (startsWith(bytes, OLE2_SIGNATURE)) {
    // Contenedor OLE/CFB → familia Word 97-2003. Se verifica la estructura real
    // del contenedor (cadena de directorios) y, para no declarar dañado un archivo
    // legítimo, se acepta también el nombre del flujo hallado en cualquier parte.
    const looksLikeWord =
      hasWordDocumentStream(bytes) === true || containsSequence(bytes, WORD_STREAM_NAME)
    return {
      format: "DOC",
      kind: looksLikeWord ? undefined : "DOC_CORRUPT",
      mimeType: DOC_MIME,
    }
  }
  if (startsWith(bytes, [0x50, 0x4b])) {
    return { format: "DOCX", kind: "ZIP", mimeType: DOCX_MIME }
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { format: "UNSUPPORTED", kind: "PDF", mimeType: "application/pdf" }
  }
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) {
    return { format: "UNSUPPORTED", kind: "RTF", mimeType: "application/rtf" }
  }
  return { format: "UNSUPPORTED", kind: "UNKNOWN", mimeType: null }
}

const normalizeMime = (rawMime: string | null, detected: FormatDetection): string => {
  const clean = (rawMime ?? "").split(";")[0].trim().toLowerCase()
  if (detected.format === "DOC") return DOC_MIME
  if (detected.format === "DOCX") return DOCX_MIME
  if (clean === "application/pdf" || clean === "application/rtf") return clean
  return detected.mimeType ?? "application/octet-stream"
}

const extensionOf = (path: string): string => {
  const name = path.split("/").pop() ?? ""
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase()
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return jsonResponse({ error: "No autorizado." }, 401)
    }

    const body = await req.json().catch(() => null)
    const filePath = typeof body?.file_path === "string" ? body.file_path.trim() : ""
    if (!filePath) {
      return jsonResponse({ error: "Falta la ruta del archivo a analizar." }, 400)
    }
    if (!filePath.startsWith("entity/")) {
      return jsonResponse({ error: "Ruta de archivo no permitida." }, 400)
    }

    const token = authHeader.replace("Bearer ", "")
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const { data: userData, error: userError } = await client.auth.getUser(token)
    if (userError || !userData?.user) {
      console.error("[analyze-document-template] token inválido", { userError })
      return jsonResponse({ error: "Sesión no válida." }, 401)
    }

    // Barrera de servidor: el llamante no puede tener un cambio de contraseña pendiente.
    // Se lee la propia fila (RLS permite al titular) sin usar claves privilegiadas.
    const { data: callerLifecycle } = await client
      .from("user_password_lifecycle")
      .select("must_change_password")
      .eq("user_id", userData.user.id)
      .maybeSingle()
    if (callerLifecycle?.must_change_password === true) {
      return jsonResponse({ error: "Debes cambiar tu contraseña inicial antes de continuar." }, 403)
    }

    console.log("[analyze-document-template] analizando", { filePath, userId: userData.user.id })

    const { data: fileBlob, error: downloadError } = await client.storage.from(BUCKET).download(filePath)
    if (downloadError || !fileBlob) {
      console.error("[analyze-document-template] descarga fallida", { downloadError })
      return jsonResponse({ error: "No se pudo leer el archivo (¿permisos o ruta incorrecta?)." }, 403)
    }

    const bytes = new Uint8Array(await fileBlob.arrayBuffer())
    if (bytes.length === 0) {
      return jsonResponse({ error: "El archivo está vacío." }, 400)
    }
    if (bytes.length > MAX_FILE_SIZE) {
      return jsonResponse({ error: "El archivo supera el límite permitido de 10 MB." }, 400)
    }

    const digest = await crypto.subtle.digest("SHA-256", bytes)
    const fileSha256 = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")

    const detected = detectWordDocumentFormat(bytes)
    const declaredExtension = extensionOf(filePath)
    const canonicalExtension = detected.format === "DOC" ? "doc" : detected.format === "DOCX" ? "docx" : declaredExtension
    const declaredExtensionMatches = declaredExtension === canonicalExtension
    const mimeType = normalizeMime(fileBlob.type ?? null, detected)

    const common = {
      file_path: filePath,
      file_name: filePath.split("/").pop() ?? "",
      file_size: bytes.length,
      file_sha256: fileSha256,
      detected_format: detected.format,
      detected_kind: detected.kind ?? null,
      mime_type: mimeType,
      declared_extension: declaredExtension,
      declared_extension_matches: declaredExtensionMatches,
      analyzed_at: new Date().toISOString(),
    }

    // ── Word 97-2003 (.doc): se identifica y se conserva, NO se analiza (§3/§8/§10) ──
    if (detected.format === "DOC") {
      const issue = detected.kind === "DOC_CORRUPT" ? FORMAT_ISSUE.DOC_CORRUPT : FORMAT_ISSUE.DOC
      console.log("[analyze-document-template] .doc detectado: no se ejecuta el parser OOXML", {
        filePath,
        corrupt: detected.kind === "DOC_CORRUPT",
      })
      return jsonResponse({
        ...common,
        analysis_supported: false,
        issue,
        valid_docx: false,
        zip_signature_ok: false,
        has_document_xml: false,
        scanned_parts: [],
        paragraphs_scanned: 0,
        occurrences: [],
        malformed_placeholders: [],
        split_run_placeholders: 0,
        warnings: [issue],
        analysis: null,
      })
    }

    // ── Formato ajeno a Word: se rechaza de forma controlada (§20/§22/§35) ──
    if (detected.format === "UNSUPPORTED") {
      const kind = (detected.kind ?? "UNKNOWN") as UnsupportedKind
      console.warn("[analyze-document-template] formato no compatible", { filePath, kind })
      return jsonResponse({
        ...common,
        analysis_supported: false,
        issue: FORMAT_ISSUE[kind] ?? FORMAT_ISSUE.UNKNOWN,
        analysis: null,
      })
    }

    // ── DOCX / OOXML: comportamiento existente, sin cambios (§7/§33) ──
    const warnings: string[] = []
    const malformed: Malformed[] = []
    const occurrences = new Map<string, Occurrence>()
    const scannedParts: string[] = []
    let paragraphsScanned = 0
    let hasDocumentXml = false
    let hasContentTypes = false
    let order = 0
    const zipSignatureOk = true

    if (!declaredExtensionMatches) {
      warnings.push(`La extensión declarada (.${declaredExtension}) no coincide con el formato real (.docx).`)
    }

    let zip: JSZip | null = null
    let zipReadable = true
    try {
      zip = await JSZip.loadAsync(bytes)
    } catch (zipError) {
      console.error("[analyze-document-template] ZIP ilegible", { zipError })
      zipReadable = false
    }

    if (zipReadable && zip) {
      const names = Object.keys(zip.files)
      hasContentTypes = names.some((name) => name === "[Content_Types].xml")
      hasDocumentXml = names.some((name) => name === "word/document.xml")

      // Un ZIP sin partes OOXML puede ser un OpenDocument u otro comprimido (§20).
      if (!hasContentTypes && names.some((name) => name === "mimetype")) {
        return jsonResponse({
          ...common,
          analysis_supported: false,
          issue: FORMAT_ISSUE.ODT,
          analysis: null,
        })
      }

      // ── XLSX (Excel): plantilla de hoja de cálculo (Movimiento de Nómina) ──
      // Se reconoce por la parte propia de un libro de Excel (xl/workbook.xml).
      if (names.some((name) => name === "xl/workbook.xml")) {
        const xlsxWarnings: string[] = []
        const xlsxMalformed: Malformed[] = []
        const xlsxOccurrences = new Map<string, Occurrence>()
        const xlsxScannedParts: string[] = []
        let cellsScanned = 0
        let xlsxOrder = 0

        const scanXlsxText = (text: string, partName: string) => {
          if (!text || !text.includes("{")) return
          cellsScanned += 1
          VALID_PLACEHOLDER.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = VALID_PLACEHOLDER.exec(text)) !== null) {
            const key = match[1].trim()
            if (!key) continue
            const current = xlsxOccurrences.get(key)
            if (current) {
              current.count += 1
            } else {
              xlsxOrder += 1
              xlsxOccurrences.set(key, { key, count: 1, split_runs: 0 })
            }
          }
          const remainder = text.replace(VALID_PLACEHOLDER, "")
          VALID_PLACEHOLDER.lastIndex = 0
          const singleBrace = remainder.match(SINGLE_BRACE)
          if (
            (remainder.includes("{{") || remainder.includes("}}")) &&
            xlsxMalformed.length < MAX_MALFORMED
          ) {
            xlsxMalformed.push({ part: partName, snippet: remainder.trim().slice(0, 120) })
          } else if (singleBrace && xlsxMalformed.length < MAX_MALFORMED) {
            xlsxMalformed.push({ part: partName, snippet: singleBrace[0].trim().slice(0, 120) })
          }
        }

        const sharedStrings = zip.file("xl/sharedStrings.xml")
        if (sharedStrings) {
          const xml = await sharedStrings.async("string")
          xlsxScannedParts.push("xl/sharedStrings.xml")
          for (const text of readXlsxCellTexts(xml, "si")) scanXlsxText(text, "xl/sharedStrings.xml")
        }

        const sheetNames = names
          .filter((name) => /^xl\/worksheets\/sheet\d*\.xml$/.test(name))
          .sort()
        for (const sheetName of sheetNames) {
          const xml = await zip.file(sheetName)!.async("string")
          xlsxScannedParts.push(sheetName)
          for (const text of readXlsxCellTexts(xml, "is")) scanXlsxText(text, sheetName)
        }

        if (xlsxOccurrences.size === 0) {
          xlsxWarnings.push("La plantilla no contiene ningún marcador {{variable}}.")
        }

        const orderedOccurrences = Array.from(xlsxOccurrences.values()).map((occurrence, index) => ({
          key: occurrence.key,
          count: occurrence.count,
          split_runs: 0,
          sort_order: index + 1,
        }))

        console.log("[analyze-document-template] análisis XLSX completado", {
          filePath,
          placeholders: orderedOccurrences.length,
          malformed: xlsxMalformed.length,
        })

        return jsonResponse({
          ...common,
          detected_format: "XLSX",
          mime_type: XLSX_MIME,
          analysis_supported: true,
          issue: null,
          valid_docx: true,
          zip_signature_ok: true,
          has_document_xml: true,
          scanned_parts: xlsxScannedParts,
          paragraphs_scanned: cellsScanned,
          occurrences: orderedOccurrences,
          malformed_placeholders: xlsxMalformed,
          split_run_placeholders: 0,
          warnings: xlsxWarnings,
          analysis: {
            file_path: filePath,
            file_sha256: fileSha256,
            file_size: bytes.length,
            format: "XLSX",
            valid_docx: true,
            zip_signature_ok: true,
            has_document_xml: true,
            scanned_parts: xlsxScannedParts,
            paragraphs_scanned: cellsScanned,
            occurrences: orderedOccurrences,
            malformed_placeholders: xlsxMalformed,
            split_run_placeholders: 0,
            warnings: xlsxWarnings,
            analyzed_at: new Date().toISOString(),
          },
        })
      }

      if (!hasContentTypes || !hasDocumentXml) {
        warnings.push("El paquete no contiene las partes mínimas de un documento Word ([Content_Types].xml / word/document.xml).")
      }

      const partNames = names.filter((name) => PART_PATTERN.test(name)).sort()
      const paragraphPattern = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g

      for (const partName of partNames) {
        const partText = await zip.file(partName)!.async("string")
        scannedParts.push(partName)
        const paragraphs = partText.match(paragraphPattern) ?? []

        for (const paragraph of paragraphs) {
          const { text, runs } = readParagraph(paragraph)
          if (!text) continue
          paragraphsScanned += 1
          if (!text.includes("{")) continue

          VALID_PLACEHOLDER.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = VALID_PLACEHOLDER.exec(text)) !== null) {
            const key = match[1].trim()
            if (!key) continue
            const splitRuns = isSplitAcrossRuns(runs, match.index, match.index + match[0].length) ? 1 : 0
            const current = occurrences.get(key)
            if (current) {
              current.count += 1
              current.split_runs += splitRuns
            } else {
              order += 1
              occurrences.set(key, { key, count: 1, split_runs: splitRuns })
            }
          }

          const remainder = text.replace(VALID_PLACEHOLDER, "")
          const singleBrace = remainder.match(SINGLE_BRACE)
          if ((remainder.includes("{{") || remainder.includes("}}")) && malformed.length < MAX_MALFORMED) {
            malformed.push({ part: partName, snippet: remainder.trim().slice(0, 120) })
          } else if (singleBrace && malformed.length < MAX_MALFORMED) {
            malformed.push({ part: partName, snippet: singleBrace[0].trim().slice(0, 120) })
          }
        }

        VALID_PLACEHOLDER.lastIndex = 0
      }
    } else {
      warnings.push("El archivo tiene firma ZIP pero no pudo descomprimirse.")
    }

    if (!hasDocumentXml) {
      warnings.push("No se encontró word/document.xml: el texto del documento no pudo analizarse.")
    }
    if (scannedParts.length === 0) {
      warnings.push("No se encontró ninguna parte de texto analizable.")
    }
    if (occurrences.size === 0) {
      warnings.push("La plantilla no contiene ningún marcador {{variable}}.")
    }

    const orderedOccurrences = Array.from(occurrences.values()).map((occurrence, index) => ({
      key: occurrence.key,
      count: occurrence.count,
      split_runs: occurrence.split_runs,
      sort_order: index + 1,
    }))
    const splitRunPlaceholders = orderedOccurrences.reduce(
      (total, occurrence) => total + (occurrence.split_runs > 0 ? 1 : 0),
      0
    )
    const validDocx = zipReadable && hasContentTypes && hasDocumentXml

    console.log("[analyze-document-template] análisis completado", {
      filePath,
      validDocx,
      placeholders: orderedOccurrences.length,
      malformed: malformed.length,
    })

    return jsonResponse({
      ...common,
      analysis_supported: true,
      issue: null,
      analysis: {
        file_path: filePath,
        file_sha256: fileSha256,
        file_size: bytes.length,
        valid_docx: validDocx,
        zip_signature_ok: zipSignatureOk,
        has_document_xml: hasDocumentXml,
        scanned_parts: scannedParts,
        paragraphs_scanned: paragraphsScanned,
        occurrences: orderedOccurrences,
        malformed_placeholders: malformed,
        split_run_placeholders: splitRunPlaceholders,
        warnings,
        analyzed_at: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("[analyze-document-template] error inesperado", { error })
    return jsonResponse({ error: "No se pudo analizar la plantilla documental." }, 500)
  }
})
