import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ExcelJSNode from "exceljs"
import {
  MIGRATION_HEADERS,
  WorkerMigrationTemplateError,
  buildWorkerMigrationTemplate,
  readWorkerMigrationExcel,
} from "../infrastructure/worker-migration.workbook"

/**
 * Pruebas del adaptador del archivo de Carga inicial de trabajadores.
 *
 * El adaptador carga ExcelJS desde el bundle UMD (`window.ExcelJS`). En el entorno de
 * pruebas (Node) se inyecta la build de Node de la misma librería en el objeto global,
 * de modo que estas pruebas ejercitan la lectura real (.xlsx → filas de migración) y el
 * manejo de errores, sin depender del navegador.
 */

const globalScope = globalThis as typeof globalThis & { ExcelJS?: unknown }

// `readWorkerMigrationExcel` solo necesita nombre, tamaño y bytes: no se requiere un File real.
const xlsxFile = (data: ArrayBuffer, name = "Plantilla_Carga_Inicial_Trabajadores.xlsx", size = data.byteLength): File =>
  ({ name, size, arrayBuffer: async () => data }) as unknown as File

const codeOf = (error: unknown): string | undefined =>
  error instanceof WorkerMigrationTemplateError ? error.code : undefined

const workbookBuffer = async (headers: string[], rows: unknown[][]): Promise<ArrayBuffer> => {
  const workbook = new ExcelJSNode.Workbook()
  const sheet = workbook.addWorksheet("Trabajadores")
  sheet.addRow(headers)
  rows.forEach((row) => sheet.addRow(row))
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer
}

const templateWithRows = async (rows: unknown[][]): Promise<ArrayBuffer> => {
  const blob = await buildWorkerMigrationTemplate()
  const workbook = new ExcelJSNode.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  const sheet = workbook.getWorksheet("Trabajadores")
  rows.forEach((row) => sheet.addRow(row))
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer
}

beforeEach(() => {
  globalScope.ExcelJS = ExcelJSNode
})

afterEach(() => {
  delete globalScope.ExcelJS
})

describe("worker-migration.workbook · plantilla oficial", () => {
  it("genera la plantilla con la hoja Trabajadores, sus columnas y la hoja de instrucciones", async () => {
    const blob = await buildWorkerMigrationTemplate()
    const workbook = new ExcelJSNode.Workbook()
    await workbook.xlsx.load(await blob.arrayBuffer())

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Trabajadores", "Instrucciones"])
    const headerRow = workbook.getWorksheet("Trabajadores").getRow(1)
    expect(headerRow.values).toEqual([undefined, ...MIGRATION_HEADERS])
  })

  it("lee la plantilla oficial rellenada (descargar → completar → subir → validar)", async () => {
    const rows = await readWorkerMigrationExcel(
      xlsxFile(
        await templateWithRows([
          ["00123456789", "Ana", "Pérez", "Gómez", "Femenino", "", "Soltera", "Calle 1", "01/03/2020", "12,5", "31/12/2023", "8095551234", "ana@example.com", "Santiago", "Santiago", "Universitario", "", "Contadora", "Sí", "01, 02"],
        ]),
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      identification: "00123456789",
      first_name: "Ana",
      first_surname: "Pérez",
      second_surname: "Gómez",
      employment_start_date: "2020-03-01",
      vacation_cutoff_date: "2023-12-31",
      initial_vacation_balance: "12.5",
      driving_license_category_ids: ["01", "02"],
    })
  })

  it("rechaza con mensaje comprensible una plantilla válida sin trabajadores", async () => {
    const blob = await buildWorkerMigrationTemplate()
    await expect(readWorkerMigrationExcel(xlsxFile(await blob.arrayBuffer()))).rejects.toThrow(
      /No se encontraron filas de trabajadores/,
    )
  })
})

describe("worker-migration.workbook · lectura de archivos de trabajadores", () => {
  it("lee todas las filas con datos y omite las filas vacías sin perder información", async () => {
    const data = await templateWithRows([
      ["111", "Ana", "Pérez", "", "Femenino", "Blanca", "Soltera", "Calle 1", "02/01/2019", "5", "31/12/2024", "8091111111", "ana@example.com", "Santiago", "Santiago", "Universitario", "Gestión", "Contadora", "No", ""],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["222", "Luis", "Díaz", "Ruiz", "", "", "", "", "15/06/2021", "", "", "", "", "La Vega", "Jarabacoa", "", "", "Técnico", "No", ""],
    ])

    const rows = await readWorkerMigrationExcel(xlsxFile(data))

    expect(rows.map((row) => row.identification)).toEqual(["111", "222"])
    expect(rows[0].driving_license_category_ids).toEqual([])
    expect(rows[1]).toMatchObject({
      first_name: "Luis",
      second_surname: "Ruiz",
      province: "La Vega",
      municipality: "Jarabacoa",
      profession_or_trade: "Técnico",
      employment_start_date: "2021-06-15",
      initial_vacation_balance: "",
      vacation_cutoff_date: "",
    })
  })

  it("rechaza un archivo vacío con un mensaje comprensible", async () => {
    const error = await readWorkerMigrationExcel(xlsxFile(new ArrayBuffer(0))).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkerMigrationTemplateError)
    expect(codeOf(error)).toBe("INVALID_FILE")
    expect((error as Error).message).toMatch(/No se pudo leer el archivo/)
  })

  it("rechaza un .xlsx con contenido inválido", async () => {
    const garbage = new TextEncoder().encode("esto no es un archivo de Excel").buffer as ArrayBuffer
    const error = await readWorkerMigrationExcel(xlsxFile(garbage)).catch((cause: unknown) => cause)

    expect(codeOf(error)).toBe("INVALID_FILE")
  })

  it("rechaza un archivo sin las columnas obligatorias indicando cuáles faltan", async () => {
    const data = await workbookBuffer(["Identificación", "Nombre"], [["111", "Ana"]])
    const error = await readWorkerMigrationExcel(xlsxFile(data)).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkerMigrationTemplateError)
    expect(codeOf(error)).toBe("MISSING_COLUMNS")
    expect((error as WorkerMigrationTemplateError).missingColumns).toEqual([
      "primer apellido",
      "fecha de incorporación",
    ])
  })

  it("rechaza un archivo que no es .xlsx y uno que supera el límite de 10 MB", async () => {
    const notXlsx = await readWorkerMigrationExcel(xlsxFile(new ArrayBuffer(4), "datos.csv")).catch((cause: unknown) => cause)
    const tooBig = await readWorkerMigrationExcel(
      xlsxFile(new ArrayBuffer(4), "plantilla.xlsx", 11 * 1024 * 1024),
    ).catch((cause: unknown) => cause)

    expect(codeOf(notXlsx)).toBe("INVALID_FILE")
    expect(codeOf(tooBig)).toBe("INVALID_FILE")
    expect((tooBig as Error).message).toMatch(/10 MB/)
  })

  it("convierte un error interno de ExcelJS en un error tipado y comprensible", async () => {
    // Reproduce el fallo reportado: xlsx.load() revienta con
    // TypeError: Cannot read properties of undefined (reading 'sheets').
    globalScope.ExcelJS = {
      Workbook: class {
        xlsx = {
          load: async () => {
            throw new TypeError("Cannot read properties of undefined (reading 'sheets')")
          },
        }
      },
    }
    const error = await readWorkerMigrationExcel(xlsxFile(new ArrayBuffer(16))).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkerMigrationTemplateError)
    expect(codeOf(error)).toBe("INVALID_FILE")
    expect((error as Error).message).not.toMatch(/sheets/)
  })

  it("valida sin escribir: no realiza ninguna llamada de red durante la lectura", async () => {
    const originalFetch = globalThis.fetch
    const fetchSpy = vi.fn(originalFetch)
    globalThis.fetch = fetchSpy as typeof fetch
    try {
      await readWorkerMigrationExcel(xlsxFile(await templateWithRows([["111", "Ana", "Pérez", "", "", "", "", "", "02/01/2019", "", "", "", "", "", "", "", "", "", "No", ""]])))
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
