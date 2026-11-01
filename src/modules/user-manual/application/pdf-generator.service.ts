import { jsPDF } from "jspdf"
import {
  MANUAL_METADATA,
  ARCHITECTURE_OVERVIEW,
  ENTITY_INITIAL_SETUP_FLOW,
  MANUAL_SECTIONS,
  ROLES_MATRIX,
  GLOSSARY_TERMS,
  type ManualSection,
} from "../domain/manual-data"

async function loadImageBase64(url: string): Promise<string | null> {
  if (typeof window === "undefined" || !url) return null
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "Anonymous"
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext("2d")
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL("image/png"))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export class UserManualPdfService {
  /**
   * Genera el PDF del manual de usuario según el perfil (gestor o entidad) y dispara su descarga.
   */
  public static async generateAndDownloadManual(mode: "gestor" | "entity" = "gestor"): Promise<void> {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    })

    const pageWidth = doc.internal.pageSize.getWidth() // 210mm
    const pageHeight = doc.internal.pageSize.getHeight() // 297mm
    const margin = 14
    const contentWidth = pageWidth - margin * 2 // 182mm

    let currentPage = 1

    // Helper: agrega cabecera y pie de página institucional a partir de la página 2
    const addHeaderAndFooter = (sectionTitle: string) => {
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(100, 116, 139)

      // Encabezado superior
      doc.text("SITECORP ERP · MANUAL OFICIAL DE USUARIO", margin, 9)
      doc.text(sectionTitle.toUpperCase(), pageWidth - margin, 9, { align: "right" })

      // Línea divisoria del encabezado
      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.3)
      doc.line(margin, 11, pageWidth - margin, 11)

      // Pie de página
      doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11)
      doc.text(
        `${MANUAL_METADATA.code} · Documento Institucional Confidencial`,
        margin,
        pageHeight - 7
      )
      doc.text(`Página ${currentPage}`, pageWidth - margin, pageHeight - 7, { align: "right" })
    }

    // ==========================================
    // PÁGINA 1: PORTADA INSTITUCIONAL
    // ==========================================
    // Barra superior decorativa corporativa
    doc.setFillColor(15, 23, 42) // Navy oscuro
    doc.rect(0, 0, pageWidth, 55, "F")

    // Franja de acento azul
    doc.setFillColor(37, 99, 235)
    doc.rect(0, 52, pageWidth, 3, "F")

    // Texto de la marca
    doc.setFont("helvetica", "bold")
    doc.setFontSize(26)
    doc.setTextColor(255, 255, 255)
    doc.text("SITECORP", margin, 28)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(191, 219, 254)
    doc.text("SISTEMA INTEGRAL DE GESTIÓN DE TALENTO, NÓMINA Y SST", margin, 38)

    const isEntity = mode === "entity"
    const activeSections = isEntity
      ? MANUAL_SECTIONS.filter((s) => s.category !== "global")
      : MANUAL_SECTIONS

    // Título principal
    doc.setFont("helvetica", "bold")
    doc.setFontSize(isEntity ? 20 : 21)
    doc.setTextColor(15, 23, 42)
    doc.text(
      isEntity ? "MANUAL DE USUARIO · GESTIÓN DE ENTIDAD" : "MANUAL DE USUARIO · GESTORES SITECORP",
      margin,
      75
    )

    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    doc.setTextColor(71, 85, 105)
    doc.text(
      isEntity
        ? "Guía Operativa de Colaboradores, Plantilla, Nómina, SST y Contratación"
        : "Guía de Gobernanza de Plataforma, Clientes, Planes Comerciales y Operación",
      margin,
      83
    )

    // Cuadro de Resumen Ejecutivo
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.5)
    doc.roundedRect(margin, 94, contentWidth, 38, 3, 3, "FD")

    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(30, 58, 138)
    doc.text("RESUMEN EJECUTIVO", margin + 6, 102)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(51, 65, 85)
    const summaryText = isEntity
      ? "Manual operativo exclusivo para usuarios de entidades y filiales. Detalla la gestión de plantilla orgánica, directorio de trabajadores, altas y contrataciones, alertas de vencimiento contractual, cálculo de prenómina y condiciones laborales anormales (CLA), plan anual de capacitación, los 4 submódulos de SST, vacaciones y certificados médicos."
      : MANUAL_METADATA.summary
    const summaryLines = doc.splitTextToSize(summaryText, contentWidth - 12)
    doc.text(summaryLines, margin + 6, 108)

    // Tabla de Metadatos del Documento
    const metaY = 140
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(margin, metaY, contentWidth, 54, 2, 2, "D")

    // Cabecera de metadatos
    doc.setFillColor(241, 245, 249)
    doc.roundedRect(margin, metaY, contentWidth, 8, 2, 2, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(15, 23, 42)
    doc.text("FICHA TÉCNICA DEL MANUAL", margin + 5, metaY + 5.5)

    const metaItems = [
      ["Versión de la Plataforma:", `${MANUAL_METADATA.version} (Edición ${MANUAL_METADATA.editionDate})`],
      ["Código de Documento:", MANUAL_METADATA.code],
      ["Dirección Responsable:", MANUAL_METADATA.author],
      ["Audiencia Objetivo:", MANUAL_METADATA.audience],
      ["Alcance del Sistema:", "Nivel Global Corporativo (/admin) y Nivel Operativo Entidad (/entity)"],
      ["Compatibilidad:", "Despliegue Web React 19, Supabase RLS, PostgreSQL"],
    ]

    let curMetaY = metaY + 14
    metaItems.forEach(([label, val]) => {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8)
      doc.setTextColor(71, 85, 105)
      doc.text(label, margin + 5, curMetaY)

      doc.setFont("helvetica", "normal")
      doc.setTextColor(15, 23, 42)
      const valLines = doc.splitTextToSize(val, contentWidth - 65)
      doc.text(valLines, margin + 55, curMetaY)
      curMetaY += 6.5
    })

    // Bloque de Estructura de Módulos (Mini mapa visual de la portada)
    const blocksY = 202
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    const modulesList = isEntity
      ? [
          { col: 0, text: "• Panel de Resumen y Dotación" },
          { col: 0, text: "• Plantilla Orgánica (Anexo14B)" },
          { col: 0, text: "• Padrón Maestro de Trabajadores" },
          { col: 1, text: "• Contratación y Cobertura Vacantes" },
          { col: 1, text: "• Vencimientos y Alertas Contratos" },
          { col: 1, text: "• Prenómina y Períodos Salariales" },
          { col: 2, text: "• SST: Avisos y Capacitación" },
          { col: 2, text: "• SST: EPP, IPERC y Accidentes" },
          { col: 2, text: "• Licencias y Certificados Médicos" },
        ]
      : [
          { col: 0, text: "• Panel de Inicio y Métricas" },
          { col: 0, text: "• Catálogo de Clientes y Empresas" },
          { col: 0, text: "• Planes por Cuenta SiteCorp" },
          { col: 0, text: "• Auditoría e Historial Inmutable" },
          { col: 1, text: "• Paso 1: Escala Salarial (CUP)" },
          { col: 1, text: "• Paso 2: Plantilla (Área/Cargo/Puesto)" },
          { col: 1, text: "• Paso 3: Datos Contractuales" },
          { col: 1, text: "• Paso 4: Escala de Antigüedad" },
          { col: 1, text: "• Paso 5: Plantillas Word (.docx)" },
          { col: 2, text: "• Resumen y Plantilla (Anexo14B)" },
          { col: 2, text: "• Padrón y Contratación" },
          { col: 2, text: "• Vencimientos y Prenómina" },
          { col: 2, text: "• SST: EPP, IPERC, Accidentes" },
          { col: 2, text: "• Licencias y Certificados Médicos" },
        ]

    const colWidth = contentWidth / 3
    const lineCounts = [0, 0, 0]
    modulesList.forEach((item) => {
      const colX = margin + item.col * colWidth
      const itemY = blocksY + 8 + lineCounts[item.col] * 5.2
      doc.setFont("helvetica", "normal")
      doc.setFontSize(7.5)
      doc.setTextColor(51, 65, 85)
      doc.text(item.text, colX, itemY)
      lineCounts[item.col]++
    })

    // Sello de confidencialidad inferior
    doc.setFillColor(241, 245, 249)
    doc.rect(margin, pageHeight - 22, contentWidth, 12, "F")
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    doc.text(
      "CONFIDENCIALIDAD: Este documento contiene especificaciones y guías operativas exclusivas de SiteCorp. Su reproducción o distribución no autorizada está prohibida.",
      margin + 3,
      pageHeight - 16,
      { maxWidth: contentWidth - 6 }
    )

    // ==========================================
    // PÁGINA 2: ARQUITECTURA Y ROLES
    // ==========================================
    doc.addPage()
    currentPage++
    addHeaderAndFooter("Arquitectura y Seguridad")

    let y = 18
    doc.setFont("helvetica", "bold")
    doc.setFontSize(15)
    doc.setTextColor(15, 23, 42)
    doc.text(ARCHITECTURE_OVERVIEW.title, margin, y)

    y += 7
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(71, 85, 105)
    const archDesc = doc.splitTextToSize(ARCHITECTURE_OVERVIEW.description, contentWidth)
    doc.text(archDesc, margin, y)
    y += archDesc.length * 4.5 + 4

    // Dos cajas para los dos niveles
    const levelBoxWidth = (contentWidth - 6) / 2
    ARCHITECTURE_OVERVIEW.levels.forEach((lvl, idx) => {
      const boxX = margin + idx * (levelBoxWidth + 6)
      doc.setFillColor(248, 250, 252)
      doc.setDrawColor(203, 213, 225)
      doc.roundedRect(boxX, y, levelBoxWidth, 68, 2, 2, "FD")

      // Cabecera de la caja
      doc.setFillColor(idx === 0 ? 30 : 15, idx === 0 ? 58 : 23, idx === 0 ? 138 : 42)
      doc.roundedRect(boxX, y, levelBoxWidth, 9, 2, 2, "F")
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8)
      doc.setTextColor(255, 255, 255)
      doc.text(lvl.level, boxX + 3, y + 6)

      // Audiencia
      doc.setFont("helvetica", "italic")
      doc.setFontSize(7.5)
      doc.setTextColor(100, 116, 139)
      doc.text(`Destinado a: ${lvl.target}`, boxX + 4, y + 15, { maxWidth: levelBoxWidth - 8 })

      // Lista de responsabilidades
      let respY = y + 23
      lvl.responsibilities.forEach((resp) => {
        doc.setFont("helvetica", "normal")
        doc.setFontSize(7.5)
        doc.setTextColor(30, 41, 59)
        const lines = doc.splitTextToSize(`• ${resp}`, levelBoxWidth - 8)
        doc.text(lines, boxX + 4, respY)
        respY += lines.length * 3.8 + 1.5
      })
    })

    y += 75

    // Matriz de Roles y Alcance
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.setTextColor(15, 23, 42)
    doc.text("Matriz de Roles y Niveles de Acceso", margin, y)

    y += 5
    // Cabecera tabla de roles
    doc.setFillColor(241, 245, 249)
    doc.setDrawColor(226, 232, 240)
    doc.rect(margin, y, contentWidth, 7, "FD")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7.5)
    doc.setTextColor(15, 23, 42)
    doc.text("ROL", margin + 3, y + 4.8)
    doc.text("NIVEL", margin + 48, y + 4.8)
    doc.text("DESCRIPCIÓN FUNCIONAL", margin + 70, y + 4.8)
    doc.text("PERMISOS CLAVE", margin + 130, y + 4.8)

    y += 7
    ROLES_MATRIX.forEach((r, idx) => {
      const rowHeight = 10
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252)
        doc.rect(margin, y, contentWidth, rowHeight, "F")
      }
      doc.setDrawColor(241, 245, 249)
      doc.line(margin, y + rowHeight, margin + contentWidth, y + rowHeight)

      doc.setFont("helvetica", "bold")
      doc.setFontSize(7)
      doc.setTextColor(30, 58, 138)
      doc.text(r.roleName, margin + 3, y + 4, { maxWidth: 43 })

      doc.setFont("helvetica", "normal")
      doc.setTextColor(100, 116, 139)
      doc.text(r.tier, margin + 48, y + 4)

      doc.setTextColor(51, 65, 85)
      doc.text(r.description, margin + 70, y + 4, { maxWidth: 58 })

      doc.setFont("helvetica", "italic")
      doc.setTextColor(71, 85, 105)
      doc.text(r.permissions.join(", "), margin + 130, y + 4, { maxWidth: 50 })

      y += rowHeight
    })

    // Nota de seguridad RLS
    y += 6
    doc.setFillColor(238, 242, 255)
    doc.setDrawColor(199, 210, 254)
    doc.roundedRect(margin, y, contentWidth, 18, 2, 2, "FD")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(30, 58, 138)
    doc.text("SEGURIDAD MULTI-TENANT (ROW LEVEL SECURITY)", margin + 4, y + 5)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(55, 48, 163)
    doc.text(
      "La base de datos aplica políticas RLS estrictas a nivel de PostgreSQL. Los usuarios de una entidad jamás pueden consultar ni alterar datos pertenecientes a otra entidad, aún cuando intenten forzar peticiones a las APIs internas.",
      margin + 4,
      y + 10,
      { maxWidth: contentWidth - 8 }
    )

    // =========================================================================
    // PÁGINA 3 (SÓLO GESTOR): SECUENCIA OBLIGATORIA DE CONFIGURACIÓN INICIAL
    // =========================================================================
    if (!isEntity) {
      doc.addPage()
      currentPage++
      addHeaderAndFooter("Configuración Inicial")

      let flowY = 18
      doc.setFont("helvetica", "bold")
      doc.setFontSize(13)
      doc.setTextColor(15, 23, 42)
      doc.text(ENTITY_INITIAL_SETUP_FLOW.title.toUpperCase(), margin, flowY)

      flowY += 6
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(71, 85, 105)
      const flowDesc = doc.splitTextToSize(ENTITY_INITIAL_SETUP_FLOW.description, contentWidth)
      doc.text(flowDesc, margin, flowY)
      flowY += flowDesc.length * 3.8 + 4

      // Callout de advertencia de integridad técnica
      doc.setFillColor(254, 242, 242)
      doc.setDrawColor(252, 165, 165)
      doc.roundedRect(margin, flowY, contentWidth, 12, 1.5, 1.5, "FD")
      doc.setFont("helvetica", "bold")
      doc.setFontSize(7.5)
      doc.setTextColor(185, 28, 28)
      doc.text("REGLA ESTRICTA DE PRELACIÓN TÉCNICA (5 PASOS OBLIGATORIOS):", margin + 3, flowY + 4.5)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(153, 27, 27)
      doc.text(
        "Es estrictamente indispensable completar los 5 pasos en este orden exacto. Alterar la secuencia provocará errores de integridad referencial (ej. cargos sin grupo salarial o contratos sin datos contractuales ni plantillas).",
        margin + 3,
        flowY + 8.5,
        { maxWidth: contentWidth - 6 }
      )

      flowY += 16

      // Las 5 tarjetas secuenciales
      const stepBoxHeight = 37
      ENTITY_INITIAL_SETUP_FLOW.steps.forEach((step, idx) => {
        const boxY = flowY + idx * (stepBoxHeight + 3)

        doc.setFillColor(248, 250, 252)
        doc.setDrawColor(226, 232, 240)
        doc.roundedRect(margin, boxY, contentWidth, stepBoxHeight, 2, 2, "FD")

        // Badge indicador circular del paso
        doc.setFillColor(30, 58, 138)
        doc.circle(margin + 6, boxY + 7, 4.2, "F")
        doc.setFont("helvetica", "bold")
        doc.setFontSize(8)
        doc.setTextColor(255, 255, 255)
        doc.text(step.stepNumber.toString(), margin + 6, boxY + 9.8, { align: "center" })

        // Título del paso y ruta
        doc.setFont("helvetica", "bold")
        doc.setFontSize(9)
        doc.setTextColor(15, 23, 42)
        doc.text(step.title, margin + 13, boxY + 6.5)

        doc.setFont("helvetica", "normal")
        doc.setFontSize(7)
        doc.setTextColor(37, 99, 235)
        doc.text(`Ruta de Acceso: ${step.route}`, margin + 13, boxY + 10.5)

        // Objetivo
        doc.setFont("helvetica", "bold")
        doc.setFontSize(7.5)
        doc.setTextColor(71, 85, 105)
        doc.text("Objetivo:", margin + 13, boxY + 16)
        doc.setFont("helvetica", "normal")
        doc.setTextColor(30, 41, 59)
        const objLines = doc.splitTextToSize(step.objective, contentWidth - 36)
        doc.text(objLines, margin + 27, boxY + 16)

        // Por qué va en este orden
        const whyY = boxY + 16 + objLines.length * 3.4 + 1
        doc.setFont("helvetica", "bold")
        doc.setFontSize(7.5)
        doc.setTextColor(180, 83, 9)
        doc.text("Por qué este orden:", margin + 13, whyY)
        doc.setFont("helvetica", "normal")
        doc.setTextColor(71, 85, 105)
        const whyLines = doc.splitTextToSize(step.whyOrderMatters, contentWidth - 50)
        doc.text(whyLines, margin + 41, whyY)

        // Conector entre pasos
        if (idx < ENTITY_INITIAL_SETUP_FLOW.steps.length - 1) {
          doc.setDrawColor(203, 213, 225)
          doc.setLineWidth(0.6)
          doc.line(margin + 6, boxY + stepBoxHeight, margin + 6, boxY + stepBoxHeight + 3)
        }
      })
    }

    // ==========================================
    // PÁGINAS DE VISTAS PRINCIPALES DEL SISTEMA
    // ==========================================
    // Renderizamos las secciones correspondientes al manual seleccionado
    for (const section of activeSections) {
      doc.addPage()
      currentPage++
      addHeaderAndFooter(section.title)

      let secY = 17

      // Banner superior de sección
      const isGlobal = section.category === "global"
      const bannerBg = isGlobal ? [15, 23, 42] : [30, 58, 138] // navy vs blue
      doc.setFillColor(bannerBg[0], bannerBg[1], bannerBg[2])
      doc.roundedRect(margin, secY, contentWidth, 14, 2, 2, "F")

      doc.setFont("helvetica", "bold")
      doc.setFontSize(11)
      doc.setTextColor(255, 255, 255)
      doc.text(section.title.toUpperCase(), margin + 5, secY + 6.5)

      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(203, 213, 225)
      doc.text(section.subtitle, margin + 5, secY + 11.5)

      // Ruta en pastilla a la derecha
      if (section.route) {
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(pageWidth - margin - 48, secY + 3.5, 44, 7, 1.5, 1.5, "F")
        doc.setFont("helvetica", "bold")
        doc.setFontSize(7)
        doc.setTextColor(15, 23, 42)
        doc.text(section.route, pageWidth - margin - 26, secY + 8, { align: "center" })
      }

      secY += 18

      // Ficha de Permisos y Roles
      doc.setFillColor(248, 250, 252)
      doc.setDrawColor(226, 232, 240)
      doc.roundedRect(margin, secY, contentWidth, 13, 1.5, 1.5, "FD")

      doc.setFont("helvetica", "bold")
      doc.setFontSize(7.5)
      doc.setTextColor(71, 85, 105)
      doc.text("Roles Autorizados:", margin + 4, secY + 5)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(15, 23, 42)
      doc.text(section.rolesAllowed.join(", "), margin + 32, secY + 5, { maxWidth: contentWidth - 36 })

      doc.setFont("helvetica", "bold")
      doc.setTextColor(71, 85, 105)
      doc.text("Permisos Requeridos:", margin + 4, secY + 10)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(37, 99, 235)
      doc.text(
        section.permissionsRequired.length > 0 ? section.permissionsRequired.join(", ") : "Acceso público de entidad",
        margin + 35,
        secY + 10
      )

      secY += 16

      // Propósito y Descripción
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(15, 23, 42)
      doc.text("Propósito de la Vista:", margin, secY)

      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(51, 65, 85)
      const purpLines = doc.splitTextToSize(section.purpose, contentWidth - 35)
      doc.text(purpLines, margin + 34, secY)
      secY += purpLines.length * 4.2 + 3

      // ==========================================
      // ESQUEMA VISUAL DE LA INTERFAZ (UI MOCKUP)
      // ==========================================
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(30, 58, 138)
      doc.text("REPRESENTACIÓN VISUAL DE LA INTERFAZ (ESQUEMA DE PANTALLA)", margin, secY)

      secY += 4
      const mockupHeight = 76

      let hasRenderedRealImage = false
      if (section.realImagePath) {
        try {
          const imgBase64 = await loadImageBase64(section.realImagePath)
          if (imgBase64) {
            doc.setFillColor(248, 250, 252)
            doc.setDrawColor(203, 213, 225)
            doc.setLineWidth(0.4)
            doc.roundedRect(margin, secY, contentWidth, mockupHeight, 2, 2, "FD")
            doc.addImage(imgBase64, "PNG", margin + 0.8, secY + 0.8, contentWidth - 1.6, mockupHeight - 1.6, undefined, "FAST")
            hasRenderedRealImage = true
          }
        } catch {
          hasRenderedRealImage = false
        }
      }

      if (!hasRenderedRealImage) {
        doc.setFillColor(255, 255, 255)
        doc.setDrawColor(203, 213, 225)
        doc.setLineWidth(0.4)
        doc.roundedRect(margin, secY, contentWidth, mockupHeight, 2, 2, "FD")

        // Barra superior de ventana simulada (estilo browser / applet)
        doc.setFillColor(241, 245, 249)
        doc.roundedRect(margin, secY, contentWidth, 7, 2, 2, "F")
        // Tres botoncitos de ventana
        doc.setFillColor(239, 68, 68)
        doc.circle(margin + 4, secY + 3.5, 1.2, "F")
        doc.setFillColor(245, 158, 11)
        doc.circle(margin + 8, secY + 3.5, 1.2, "F")
        doc.setFillColor(16, 185, 129)
        doc.circle(margin + 12, secY + 3.5, 1.2, "F")

        // Título en la barra de ventana
        doc.setFont("helvetica", "bold")
        doc.setFontSize(6.5)
        doc.setTextColor(100, 116, 139)
        doc.text(`SiteCorp UI · ${section.mockup.headerTitle}`, margin + 18, secY + 4.8)

        // Encabezado interno de la vista simulada
        let innerY = secY + 12
        doc.setFont("helvetica", "bold")
        doc.setFontSize(9)
        doc.setTextColor(15, 23, 42)
        doc.text(section.mockup.headerTitle, margin + 6, innerY)

        // Badges
        let badgeX = margin + 6 + doc.getTextWidth(section.mockup.headerTitle) + 4
        section.mockup.badges.forEach((b) => {
          doc.setFillColor(224, 231, 255)
          doc.roundedRect(badgeX, innerY - 3, doc.getTextWidth(b) + 4, 4.5, 1, 1, "F")
          doc.setFont("helvetica", "bold")
          doc.setFontSize(6)
          doc.setTextColor(67, 56, 202)
          doc.text(b, badgeX + 2, innerY)
          badgeX += doc.getTextWidth(b) + 6
        })

        innerY += 4
        doc.setFont("helvetica", "normal")
        doc.setFontSize(7)
        doc.setTextColor(100, 116, 139)
        doc.text(section.mockup.headerSubtitle, margin + 6, innerY)

        // Botones de acción simulados a la derecha
        if (section.mockup.actionButtons && section.mockup.actionButtons.length > 0) {
          let btnX = pageWidth - margin - 6
          for (let i = section.mockup.actionButtons.length - 1; i >= 0; i--) {
            const btnText = section.mockup.actionButtons[i]
            const btnW = doc.getTextWidth(btnText) + 6
            btnX -= btnW
            doc.setFillColor(i === 0 ? 37 : 241, i === 0 ? 99 : 245, i === 0 ? 235 : 249)
            doc.roundedRect(btnX, innerY - 6, btnW, 5.5, 1, 1, "F")
            doc.setFont("helvetica", "bold")
            doc.setFontSize(6)
            doc.setTextColor(i === 0 ? 255 : 30, i === 0 ? 255 : 41, i === 0 ? 255 : 59)
            doc.text(btnText, btnX + 3, innerY - 2.2)
            btnX -= 2
          }
        }

        innerY += 6

        // Pestañas si existen
        if (section.mockup.tabs && section.mockup.tabs.length > 0) {
          let tabX = margin + 6
          section.mockup.tabs.forEach((tab, tidx) => {
            const tabW = doc.getTextWidth(tab) + 6
            doc.setFillColor(tidx === 0 ? 238 : 248, tidx === 0 ? 242 : 250, tidx === 0 ? 255 : 252)
            doc.setDrawColor(tidx === 0 ? 99 : 226, tidx === 0 ? 102 : 232, tidx === 0 ? 241 : 240)
            doc.roundedRect(tabX, innerY, tabW, 5, 1, 1, "FD")
            doc.setFont("helvetica", tidx === 0 ? "bold" : "normal")
            doc.setFontSize(6.5)
            doc.setTextColor(tidx === 0 ? 37 : 100, tidx === 0 ? 99 : 116, tidx === 0 ? 235 : 139)
            doc.text(tab, tabX + 3, innerY + 3.5)
            tabX += tabW + 2
          })
          innerY += 8
        }

        // KPIs si existen
        if (section.mockup.kpis && section.mockup.kpis.length > 0) {
          const kpiCount = section.mockup.kpis.length
          const kpiWidth = (contentWidth - 12 - (kpiCount - 1) * 3) / kpiCount
          section.mockup.kpis.forEach((kpi, kidx) => {
            const kpiX = margin + 6 + kidx * (kpiWidth + 3)
            doc.setFillColor(248, 250, 252)
            doc.setDrawColor(226, 232, 240)
            doc.roundedRect(kpiX, innerY, kpiWidth, 11, 1, 1, "FD")

            doc.setFont("helvetica", "normal")
            doc.setFontSize(5.5)
            doc.setTextColor(100, 116, 139)
            doc.text(kpi.label, kpiX + 2.5, innerY + 3.5, { maxWidth: kpiWidth - 5 })

            doc.setFont("helvetica", "bold")
            doc.setFontSize(8)
            doc.setTextColor(
              kpi.color === "danger"
                ? 239
                : kpi.color === "warning"
                ? 217
                : kpi.color === "success"
                ? 16
                : 15,
              kpi.color === "danger"
                ? 68
                : kpi.color === "warning"
                ? 119
                : kpi.color === "success"
                ? 185
                : 23,
              kpi.color === "danger"
                ? 68
                : kpi.color === "warning"
                ? 6
                : kpi.color === "success"
                ? 129
                : 42
            )
            doc.text(kpi.value, kpiX + 2.5, innerY + 8)

            if (kpi.trend) {
              doc.setFont("helvetica", "normal")
              doc.setFontSize(5)
              doc.setTextColor(148, 163, 184)
              doc.text(kpi.trend, kpiX + 2.5, innerY + 10.2)
            }
          })
          innerY += 13.5
        }

        // Tabla de datos simulada
        if (section.mockup.tableColumns && section.mockup.tableRows) {
          const tableW = contentWidth - 12
          const colCount = section.mockup.tableColumns.length
          const tColWidth = tableW / colCount

          // Cabecera tabla
          doc.setFillColor(241, 245, 249)
          doc.rect(margin + 6, innerY, tableW, 4.5, "F")
          doc.setFont("helvetica", "bold")
          doc.setFontSize(5.5)
          doc.setTextColor(71, 85, 105)

          section.mockup.tableColumns.forEach((col, cidx) => {
            doc.text(col.toUpperCase(), margin + 8 + cidx * tColWidth, innerY + 3.2, {
              maxWidth: tColWidth - 3,
            })
          })

          innerY += 4.5
          // Filas tabla
          section.mockup.tableRows.slice(0, 3).forEach((row, ridx) => {
            doc.setFillColor(ridx % 2 === 1 ? 250 : 255, ridx % 2 === 1 ? 250 : 255, ridx % 2 === 1 ? 250 : 255)
            doc.rect(margin + 6, innerY, tableW, 4.8, "F")
            doc.setDrawColor(241, 245, 249)
            doc.line(margin + 6, innerY + 4.8, margin + 6 + tableW, innerY + 4.8)

            doc.setFont("helvetica", "normal")
            doc.setFontSize(5.5)
            doc.setTextColor(30, 41, 59)

            section.mockup.tableColumns!.forEach((col, cidx) => {
              const cellVal = row[col] || "-"
              doc.text(cellVal, margin + 8 + cidx * tColWidth, innerY + 3.4, {
                maxWidth: tColWidth - 3,
              })
            })

            innerY += 4.8
          })
        }
      }

      secY += mockupHeight + 5

      // ==========================================
      // PROCEDIMIENTO PASO A PASO
      // ==========================================
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(15, 23, 42)
      doc.text("Flujo Operativo Paso a Paso:", margin, secY)

      secY += 4
      if (section.workflows && section.workflows.length > 0) {
        section.workflows.forEach((wf) => {
          doc.setFont("helvetica", "bold")
          doc.setFontSize(8)
          doc.setTextColor(37, 99, 235)
          doc.text(`▸ ${wf.title}:`, margin + 3, secY)
          secY += 4

          wf.steps.forEach((step, sidx) => {
            doc.setFont("helvetica", "bold")
            doc.setFontSize(7.5)
            doc.setTextColor(71, 85, 105)
            doc.text(`${sidx + 1}.`, margin + 6, secY)

            doc.setFont("helvetica", "normal")
            doc.setTextColor(30, 41, 59)
            const stepLines = doc.splitTextToSize(step, contentWidth - 16)
            doc.text(stepLines, margin + 11, secY)
            secY += stepLines.length * 3.6 + 1
          })
          secY += 1.5
        })
      }

      // Reglas de Negocio / Validaciones críticas
      if (secY < pageHeight - 32) {
        doc.setFillColor(254, 242, 242)
        doc.setDrawColor(254, 202, 202)
        const boxH = Math.min(20, pageHeight - secY - 14)
        doc.roundedRect(margin, secY, contentWidth, boxH, 1.5, 1.5, "FD")

        doc.setFont("helvetica", "bold")
        doc.setFontSize(7.5)
        doc.setTextColor(153, 27, 27)
        doc.text("REGLAS DE NEGOCIO Y CRITERIOS DE VALIDACIÓN:", margin + 4, secY + 4.5)

        let ruleY = secY + 8.5
        section.businessRules.forEach((rule) => {
          if (ruleY < secY + boxH - 2) {
            doc.setFont("helvetica", "normal")
            doc.setFontSize(7)
            doc.setTextColor(185, 28, 28)
            const ruleLines = doc.splitTextToSize(`• ${rule}`, contentWidth - 8)
            doc.text(ruleLines, margin + 4, ruleY)
            ruleY += ruleLines.length * 3.2 + 0.8
          }
        })
      }
    }

    // ==========================================
    // PÁGINA FINAL: GLOSARIO Y MARCO NORMATIVO
    // ==========================================
    doc.addPage()
    currentPage++
    addHeaderAndFooter("Glosario y Marco Normativo")

    let gY = 18
    doc.setFont("helvetica", "bold")
    doc.setFontSize(15)
    doc.setTextColor(15, 23, 42)
    doc.text("Glosario Operativo y Marco Regulatorio", margin, gY)

    gY += 6
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(71, 85, 105)
    doc.text(
      "Definiciones oficiales de conceptos clave y legislación laboral aplicable en la operación del sistema SiteCorp.",
      margin,
      gY
    )

    gY += 8
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(30, 58, 138)
    doc.text("GLOSARIO DE TÉRMINOS", margin, gY)

    gY += 5
    GLOSSARY_TERMS.forEach((gt) => {
      doc.setFillColor(248, 250, 252)
      doc.setDrawColor(226, 232, 240)
      doc.roundedRect(margin, gY, contentWidth, 12, 1, 1, "FD")

      doc.setFont("helvetica", "bold")
      doc.setFontSize(8)
      doc.setTextColor(30, 58, 138)
      doc.text(gt.term, margin + 4, gY + 4.5)

      doc.setFont("helvetica", "normal")
      doc.setFontSize(7.5)
      doc.setTextColor(51, 65, 85)
      const defLines = doc.splitTextToSize(gt.definition, contentWidth - 8)
      doc.text(defLines, margin + 4, gY + 8.5)

      gY += 14
    })

    // Marco normativo
    gY += 4
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(30, 58, 138)
    doc.text("MARCO NORMATIVO APLICABLE Y COMPLIANCE LABORAL", margin, gY)

    gY += 6
    const legalFramework = [
      ["Ley de Productividad y Competitividad Laboral (D.L. 728)", "Regula los contratos modulares, periodo de prueba, desnaturalización y ceses."],
      ["Ley 29783 de Seguridad y Salud en el Trabajo & D.S. 005-2012-TR", "Base legal de la Matriz IPERC, entrega de EPP, investigación de accidentes y Comité SST."],
      ["Decreto Legislativo 713 - Descansos Remunerados y Vacaciones", "Norma el récord vacacional de 30 días anuales y la indemnización por descanso no gozado."],
      ["Reglamento de Prestaciones Económicas de Essalud (Ley 26790)", "Establece el periodo de 20 días asumidos por el empleador y subsidios desde el día 21."],
    ]

    legalFramework.forEach(([law, desc]) => {
      doc.setFillColor(241, 245, 249)
      doc.rect(margin, gY, contentWidth, 9, "F")
      doc.setFont("helvetica", "bold")
      doc.setFontSize(7.5)
      doc.setTextColor(15, 23, 42)
      doc.text(law, margin + 4, gY + 4)

      doc.setFont("helvetica", "normal")
      doc.setFontSize(7)
      doc.setTextColor(71, 85, 105)
      doc.text(desc, margin + 4, gY + 7.5)

      gY += 11
    })

    // Disparo de descarga directa en el navegador
    const pdfBlob = doc.output("blob")
    const blobUrl = URL.createObjectURL(pdfBlob)
    const downloadAnchor = document.createElement("a")
    downloadAnchor.href = blobUrl
    downloadAnchor.download = isEntity
      ? `Manual_SiteCorp_Gestion_Entidad_v${MANUAL_METADATA.version}.pdf`
      : `Manual_SiteCorp_Gestores_Plataforma_v${MANUAL_METADATA.version}.pdf`
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    document.body.removeChild(downloadAnchor)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
  }
}
