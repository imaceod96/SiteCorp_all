/**
 * Generación documental — Resolución de variables documentales (dominio).
 *
 * Convierte un SNAPSHOT documental (`DocumentData`) en los valores que recibe la plantilla:
 * distingue `value` de `missing` y nunca produce undefined/null/[object Object] como texto.
 *
 * El CATÁLOGO de variables (tipos, catálogo, auxiliares y formateadores de presentación) vive
 * en el dominio de plantillas: es el contrato que las propias plantillas declaran. Así la
 * generación depende de las plantillas —dirección que ya existía— y no se forma ningún ciclo
 * entre dominios.
 *
 * La importación apunta al módulo de DOMINIO del otro contexto (no a su barrel) porque este
 * archivo es dominio puro: así no arrastra su infraestructura ni el cliente de Supabase.
 */

import { toRomanNumeral } from "@/utils/roman-numerals"
import {
  DOCUMENT_VARIABLES,
  describeDocumentDuration,
  documentSignatureDay,
  documentSignatureMonth,
  documentSignatureYear,
  documentVariableByKey,
  formatDocumentAmount,
  formatDocumentDate,
  formatDocumentDateShort,
  formatDocumentHours,
  formatSc404Dias,
  type DocumentTypeCode,
  type DocumentVariableDefinition,
  type DocumentVariableResolution,
} from "@/domains/document-templates/domain/document-variables"
import type {
  AddendumDocumentData,
  ContractDocumentData,
  DocumentData,
  PayrollMovementDocumentData,
  ResolutionDocumentData,
  Sc404DocumentData,
} from "./document-data"

/* ------------------------------------------------------------------ */
/* Resolución (§43/§44/§46)                                            */
/* ------------------------------------------------------------------ */

const isContractData = (data: DocumentData): data is ContractDocumentData =>
  data.document_type === "CONTRACT"

const isSc404Data = (data: DocumentData): data is Sc404DocumentData =>
  data.document_type === "SC_4_04"

const isResolutionData = (data: DocumentData): data is ResolutionDocumentData =>
  data.document_type === "RESOLUTION"

const isPayrollMovementData = (data: DocumentData): data is PayrollMovementDocumentData =>
  data.document_type === "PAYROLL_MOVEMENT"

const textOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const text = typeof value === "string" ? value.trim() : String(value)
  return text === "" ? null : text
}

/** Resuelve el valor sin formato de una variable (o null si falta / no aplica). */
const rawValueFor = (
  data: DocumentData,
  definition: DocumentVariableDefinition
): string | number | null => {
  if (isContractData(data)) {
    switch (definition.key) {
      case "entity.name": return textOrNull(data.entity.name)
      case "entity.organism": return textOrNull(data.entity.organism)
      case "entity.branch": return textOrNull(data.entity.branch)
      case "entity.labor_code": return textOrNull(data.entity.labor_code)
      case "entity.address": return textOrNull(data.entity.address)
      case "entity.province": return textOrNull(data.entity.province)
      case "entity.municipality": return textOrNull(data.entity.municipality)
      case "entity.revolution_year": return data.entity.revolution_year

      case "representative.name": return textOrNull(data.representative.name)
      case "representative.position": return textOrNull(data.representative.position)

      case "worker.full_name": return textOrNull(data.worker.full_name)
      case "worker.identification": return textOrNull(data.worker.identification)
      case "worker.birth_date": return textOrNull(data.worker.birth_date)
      case "worker.profession": return textOrNull(data.worker.profession)
      case "worker.address": return textOrNull(data.worker.address)
      case "worker.province": return textOrNull(data.worker.province)
      case "worker.municipality": return textOrNull(data.worker.municipality)

      case "job.name": return textOrNull(data.job.name)
      case "job.salary_group":
        return data.job.salary_group_sequence != null
          ? toRomanNumeral(data.job.salary_group_sequence)
          : null
      case "job.occupational_category": return textOrNull(data.job.occupational_category)
      case "position.name": return textOrNull(data.position.name)
      case "position.code": return textOrNull(data.position.code)
      case "position.work_location": return textOrNull(data.position.work_location)

      case "schedule.daily_hours": return data.schedule.daily_hours
      case "schedule.weekly_hours": return data.schedule.weekly_hours
      case "schedule.monthly_hours": return data.schedule.monthly_hours
      case "schedule.text": return textOrNull(data.schedule.text)
      case "schedule.break": return data.schedule.break_minutes

      case "contract.type": return textOrNull(data.contract.type_name)
      case "contract.start_date": return textOrNull(data.contract.start_date)
      case "contract.end_date": return textOrNull(data.contract.end_date)
      case "contract.duration":
        return describeDocumentDuration(data.contract.start_date, data.contract.end_date)
      case "contract.signature_date": return textOrNull(data.contract.signature_date)
      case "contract.signature_day": return documentSignatureDay(data.contract.signature_date)
      case "contract.signature_month": return documentSignatureMonth(data.contract.signature_date)
      case "contract.signature_year": return documentSignatureYear(data.contract.signature_date)
      case "contract.signature_place": return textOrNull(data.contract.signature_place)
      case "contract.payment_method": return textOrNull(data.contract.payment_method)
      case "contract.payment_schedule": return textOrNull(data.contract.payment_schedule)

      case "compensation.base_salary": return data.compensation.base_salary
      case "compensation.additional_payments": return data.compensation.additional_payments
      case "compensation.abnormal_conditions_payments": return data.compensation.abnormal_conditions_payments
      case "compensation.other_payments": return data.compensation.other_payments
      case "compensation.total": return data.compensation.total
      case "compensation.currency": return textOrNull(data.compensation.currency)

      // Short aliases c.* (delegate to same resolution as long keys)
      case "c.ent": return textOrNull(data.entity.name)
      case "c.org": return textOrNull(data.entity.organism)
      case "c.ram": return textOrNull(data.entity.branch)
      case "c.cod": return textOrNull(data.entity.labor_code)
      case "c.dir": return textOrNull(data.entity.address)
      case "c.prov": return textOrNull(data.entity.province)
      case "c.mun": return textOrNull(data.entity.municipality)
      case "c.rev": return data.entity.revolution_year
      case "c.rep_nom": return textOrNull(data.representative.name)
      case "c.rep_cargo": return textOrNull(data.representative.position)
      case "c.nom": return textOrNull(data.worker.full_name)
      case "c.ci": return textOrNull(data.worker.identification)
      case "c.nac": return textOrNull(data.worker.birth_date)
      case "c.prof": return textOrNull(data.worker.profession)
      case "c.dir_trab": return textOrNull(data.worker.address)
      case "c.prov_trab": return textOrNull(data.worker.province)
      case "c.mun_trab": return textOrNull(data.worker.municipality)
      case "c.cargo": return textOrNull(data.job.name)
      case "c.grupo":
        return data.job.salary_group_sequence != null
          ? toRomanNumeral(data.job.salary_group_sequence)
          : null
      case "c.cat_ocup": return textOrNull(data.job.occupational_category)
      case "c.puesto": return textOrNull(data.position.name)
      case "c.cod_puesto": return textOrNull(data.position.code)
      case "c.lug_trab": return textOrNull(data.position.work_location)
      case "c.horas_dia": return data.schedule.daily_hours
      case "c.horas_sem": return data.schedule.weekly_hours
      case "c.horas_mes": return data.schedule.monthly_hours
      case "c.horario": return textOrNull(data.schedule.text)
      case "c.descanso": return data.schedule.break_minutes
      case "c.tipo": return textOrNull(data.contract.type_name)
      case "c.inicio": return textOrNull(data.contract.start_date)
      case "c.fin": return textOrNull(data.contract.end_date)
      case "c.duracion":
        return describeDocumentDuration(data.contract.start_date, data.contract.end_date)
      case "c.firma": return textOrNull(data.contract.signature_date)
      case "c.firma_dia": return documentSignatureDay(data.contract.signature_date)
      case "c.firma_mes": return documentSignatureMonth(data.contract.signature_date)
      case "c.firma_anio": return documentSignatureYear(data.contract.signature_date)
      case "c.lugar_firma": return textOrNull(data.contract.signature_place)
      case "c.formaPago": return textOrNull(data.contract.payment_method)
      case "c.momentoPago": return textOrNull(data.contract.payment_schedule)
      case "c.salario": return data.compensation.base_salary
      case "c.pagos_adic": return data.compensation.additional_payments
      case "c.cond_anorm": return data.compensation.abnormal_conditions_payments
      case "c.otros_pagos": return data.compensation.other_payments
      case "c.total": return data.compensation.total
      case "c.moneda": return textOrNull(data.compensation.currency)
      default: return null
    }
  }

  // ---------------- SC-4-04 (resolución según origen) ----------------
  if (isSc404Data(data)) {
    const isVacation = data.origin.source_type === "VACATION"
    const isMedical = data.origin.source_type === "MEDICAL_CERTIFICATE"
    // Fecha de incorporación: médico → return_date; vacaciones → primer día hábil
    // posterior al período según el horario del Puesto (calculada en document-data).
    const incorporation = data.origin.incorporation_date
    const incorporationDay = incorporation ? Number(incorporation.slice(8, 10)) : null
    const incorporationMonth = incorporation ? Number(incorporation.slice(5, 7)) : null
    const incorporationYear = incorporation ? Number(incorporation.slice(0, 4)) : null

    switch (definition.key) {
      case "entity.name": return textOrNull(data.entity.name)
      case "entity.code": return textOrNull(data.entity.code)
      case "worker.full_name": return textOrNull(data.worker.full_name)
      case "worker.identification": return textOrNull(data.worker.identification)
      case "area.name": return textOrNull(data.area_name)

      // Variables unificadas: la misma celda del Word sirve para ambos orígenes.
      // Fechas del período en formato oficial DD/MM/AA (§1 Fase 21).
      case "sc404.fecha_desde": return formatDocumentDateShort(data.origin.start_date)
      case "sc404.fecha_hasta":
        // §20/§21: return_date es reincorporación; NO se inventa fin de licencia.
        return isVacation ? formatDocumentDateShort(data.origin.end_date) : null
      case "sc404.dias":
        // §14: vacaciones → días NATURALES; §18: certificado → days explícito.
        return isVacation ? data.origin.natural_days : data.origin.days

      // Fecha de incorporación: casillas independientes Día / Mes / Año (§7/§8 Fase 21).
      case "sc404.incorporacion_dia": return incorporationDay !== null ? String(incorporationDay) : null
      case "sc404.incorporacion_mes": return incorporationMonth !== null ? String(incorporationMonth) : null
      case "sc404.incorporacion_anio":
        // Año de dos dígitos (26), como el formulario oficial.
        return incorporationYear !== null ? String(incorporationYear).slice(-2) : null

      case "certificado.es_licencia_subsidio": return isMedical ? "X" : null
      case "sc404.es_licencia_subsidio": return isMedical ? "X" : null

      // Wrappers sc404.* de los datos comunes (catálogo visible exclusivo §Fase 22).
      case "sc404.fecha_emision": return formatDocumentDateShort(data.issued_at)
      case "sc404.entidad_nombre": return textOrNull(data.entity.name)
      case "sc404.entidad_codigo": return textOrNull(data.entity.code)
      case "sc404.trabajador_nombre": return textOrNull(data.worker.first_name)
      case "sc404.trabajador_primer_apellido": return textOrNull(data.worker.first_surname)
      case "sc404.trabajador_segundo_apellido": return textOrNull(data.worker.second_surname)
      case "sc404.trabajador_ci": return textOrNull(data.worker.identification)
      case "sc404.area": return textOrNull(data.area_name)
      case "sc404.es_vacaciones": return isVacation ? "X" : null

      case "certificado.fecha_salida": return isMedical ? formatDocumentDateShort(data.origin.start_date) : null
      case "certificado.fecha_reincorporacion": return isMedical ? formatDocumentDateShort(data.origin.return_date) : null
      case "certificado.dias": return isMedical ? data.origin.days : null

      case "vacaciones.fecha_desde": return isVacation ? formatDocumentDateShort(data.origin.start_date) : null
      case "vacaciones.fecha_hasta": return isVacation ? formatDocumentDateShort(data.origin.end_date) : null
      case "vacaciones.dias_naturales": return isVacation ? data.origin.natural_days : null
      case "vacaciones.dias_consumidos": return isVacation ? data.origin.charged_days : null
      case "vacaciones.reincorporacion": return isVacation ? formatDocumentDateShort(incorporation) : null

      case "documento.fecha_emision": return formatDocumentDateShort(data.issued_at)

      // Short aliases s.* (delegate to same resolution as long keys)
      case "s.fem": return formatDocumentDateShort(data.issued_at)
      case "s.ent": return textOrNull(data.entity.name)
      case "s.cod": return textOrNull(data.entity.code)
      case "s.nom": return textOrNull(data.worker.first_name)
      case "s.ap1": return textOrNull(data.worker.first_surname)
      case "s.ap2": return textOrNull(data.worker.second_surname)
      case "s.ci": return textOrNull(data.worker.identification)
      case "s.area": return textOrNull(data.area_name)
      case "s.f_des": return formatDocumentDateShort(data.origin.start_date)
      case "s.f_has":
        return isVacation ? formatDocumentDateShort(data.origin.end_date) : null
      case "s.dias":
        return isVacation ? data.origin.natural_days : data.origin.days
      case "s.inc_d": return incorporationDay !== null ? String(incorporationDay) : null
      case "s.inc_m": return incorporationMonth !== null ? String(incorporationMonth) : null
      case "s.inc_a":
        return incorporationYear !== null ? String(incorporationYear).slice(-2) : null
      case "s.vac": return isVacation ? "X" : null
      case "s.lic": return isMedical ? "X" : null
      default: return null
    }
  }

  // ---------------- Resolución (Especialista Principal) ----------------
  if (isResolutionData(data)) {
    const date = data.resolution.date
    switch (definition.key) {
      case "r.nom": return textOrNull(data.worker.full_name)
      case "r.car": return textOrNull(data.job.name)
      case "r.ent": return textOrNull(data.entity.name)
      case "r.emp": return textOrNull(data.parent_company.name)
      case "r.sal": return data.job.salary_amount
      case "r.ge":
        return data.job.salary_group_sequence != null
          ? toRomanNumeral(data.job.salary_group_sequence)
          : null
      case "r.fun": return textOrNull(data.job.work_content)
      case "r.mun": return textOrNull(data.entity.municipality)
      case "r.dia":
        return date != null ? String(Number(date.slice(0, 10).split("-")[2])) : null
      case "r.mes": return documentSignatureMonth(date)
      case "r.ano":
        return date != null ? String(Number(date.slice(0, 10).split("-")[0])) : null
      case "r.rev": return textOrNull(data.entity.revolution_year)
      case "r.rep": return textOrNull(data.representative.name)
      default: return null
    }
  }

  // ---------------- Movimiento de Nómina (Altas / Reubicaciones / Bajas) ----------------
  if (isPayrollMovementData(data)) {
    const date = data.effective_date
    switch (definition.key) {
      case "m.org": return textOrNull(data.entity.organism)
      case "m.emp": return textOrNull(data.entity.company)
      case "m.uni": return textOrNull(data.entity.unit)
      case "m.exp": return textOrNull(data.worker.identification)
      case "m.dia": return date ? Number(date.slice(0, 10).split("-")[2]) : null
      case "m.mes": return documentSignatureMonth(date)
      case "m.ano": return date ? Number(date.slice(0, 10).split("-")[0]) : null
      case "m.nom": return textOrNull(data.worker.first_name)
      case "m.ap1": return textOrNull(data.worker.first_surname)
      case "m.ap2": return textOrNull(data.worker.second_surname)
      case "m.sex_m": return data.worker.gender_code === "M" ? "X" : null
      case "m.sex_f": return data.worker.gender_code === "F" ? "X" : null
      case "m.alta": return data.event_type === "ALTA" ? "X" : null
      case "m.reu": return data.event_type === "REUBICACION" ? "X" : null
      case "m.baja": return data.event_type === "BAJA" ? "X" : null
      case "m.area_act": return textOrNull(data.actual.area)
      case "m.cargo_act": return textOrNull(data.actual.job)
      case "m.area_nva": return textOrNull(data.next.area)
      case "m.cargo_nvo": return textOrNull(data.next.job)
      case "m.ge_act":
        return data.actual.salary_group_sequence != null
          ? toRomanNumeral(data.actual.salary_group_sequence)
          : null
      case "m.sal_act": return data.actual.salary_amount
      case "m.ge_nvo":
        return data.next.salary_group_sequence != null
          ? toRomanNumeral(data.next.salary_group_sequence)
          : null
      case "m.sal_nvo": return data.next.salary_amount
      default: return null
    }
  }

  // ---------------- Anexo ----------------
  const previous = (code: string): { value: string | null; display: string | null } =>
    data.previous_conditions[code] || { value: null, display: null }
  const next = (code: string): { value: string | null; display: string | null } =>
    data.new_conditions[code] || { value: null, display: null }
  const amountSide = (side: { value: string | null; display: string | null }): string | null => {
    if (side.value !== null && side.value !== undefined && side.value !== "") return side.value
    // El display incluye moneda ("3 500,00 CUP"): se usa sólo como último recurso
    return side.display
  }

  switch (definition.key) {
    case "entity.name": return textOrNull(data.entity.name)
    case "entity.organism": return textOrNull(data.entity.organism)
    case "entity.branch": return textOrNull(data.entity.branch)
    case "entity.labor_code": return textOrNull(data.entity.labor_code)
    case "entity.address": return textOrNull(data.entity.address)
    case "entity.province": return textOrNull(data.entity.province)
    case "entity.municipality": return textOrNull(data.entity.municipality)
    case "entity.revolution_year": return data.entity.revolution_year

    case "representative.name": return textOrNull(data.representative.name)
    case "representative.position": return textOrNull(data.representative.position)

    case "worker.full_name": return textOrNull(data.worker.full_name)
    case "worker.identification": return textOrNull(data.worker.identification)
    case "worker.birth_date": return textOrNull(data.worker.birth_date)
    case "worker.profession": return textOrNull(data.worker.profession)
    case "worker.address": return textOrNull(data.worker.address)
    case "worker.province": return textOrNull(data.worker.province)
    case "worker.municipality": return textOrNull(data.worker.municipality)

    case "addendum.number": return data.addendum.number
    case "addendum.reason":
      return textOrNull(data.addendum.reason) ?? textOrNull(data.addendum.reason_code)
    case "addendum.effective_date": return textOrNull(data.addendum.effective_date)
    case "addendum.signature_date": return textOrNull(data.addendum.signature_date)
    case "addendum.signature_day": return documentSignatureDay(data.addendum.signature_date)
    case "addendum.signature_month": return documentSignatureMonth(data.addendum.signature_date)
    case "addendum.signature_year": return documentSignatureYear(data.addendum.signature_date)
    case "addendum.signature_place": return textOrNull(data.addendum.signature_place)

    case "addendum.previous.job": return previous("JOB").display ?? previous("JOB").value
    case "addendum.previous.salary_group": return previous("SALARY_GROUP").display ?? previous("SALARY_GROUP").value
    case "addendum.previous.occupational_category": return previous("OCCUPATIONAL_CATEGORY").display ?? previous("OCCUPATIONAL_CATEGORY").value
    case "addendum.previous.salary": return amountSide(previous("SALARY"))

    case "addendum.new.job": return next("JOB").display ?? next("JOB").value
    case "addendum.new.salary_group": return next("SALARY_GROUP").display ?? next("SALARY_GROUP").value
    case "addendum.new.occupational_category": return next("OCCUPATIONAL_CATEGORY").display ?? next("OCCUPATIONAL_CATEGORY").value
    case "addendum.new.salary": return amountSide(next("SALARY"))
    case "addendum.new.other_payments": return amountSide(next("OTHER_PAYMENT"))
    case "addendum.new.total":
      return data.totals.after ?? amountSide(next("TOTAL_COMPENSATION"))

    // Short aliases a.* (delegate to same resolution as long keys)
    case "a.ent": return textOrNull(data.entity.name)
    case "a.org": return textOrNull(data.entity.organism)
    case "a.ram": return textOrNull(data.entity.branch)
    case "a.cod": return textOrNull(data.entity.labor_code)
    case "a.dir": return textOrNull(data.entity.address)
    case "a.prov": return textOrNull(data.entity.province)
    case "a.mun": return textOrNull(data.entity.municipality)
    case "a.rev": return data.entity.revolution_year
    case "a.rep_nom": return textOrNull(data.representative.name)
    case "a.rep_cargo": return textOrNull(data.representative.position)
    case "a.nom": return textOrNull(data.worker.full_name)
    case "a.ci": return textOrNull(data.worker.identification)
    case "a.nac": return textOrNull(data.worker.birth_date)
    case "a.prof": return textOrNull(data.worker.profession)
    case "a.dir_trab": return textOrNull(data.worker.address)
    case "a.prov_trab": return textOrNull(data.worker.province)
    case "a.mun_trab": return textOrNull(data.worker.municipality)
    case "a.num": return data.addendum.number
    case "a.motivo":
      return textOrNull(data.addendum.reason) ?? textOrNull(data.addendum.reason_code)
    case "a.efectiva": return textOrNull(data.addendum.effective_date)
    case "a.firma": return textOrNull(data.addendum.signature_date)
    case "a.firma_dia": return documentSignatureDay(data.addendum.signature_date)
    case "a.firma_mes": return documentSignatureMonth(data.addendum.signature_date)
    case "a.firma_anio": return documentSignatureYear(data.addendum.signature_date)
    case "a.lugar_firma": return textOrNull(data.addendum.signature_place)
    case "a.ant_cargo": return previous("JOB").display ?? previous("JOB").value
    case "a.ant_grupal": return previous("SALARY_GROUP").display ?? previous("SALARY_GROUP").value
    case "a.ant_cat": return previous("OCCUPATIONAL_CATEGORY").display ?? previous("OCCUPATIONAL_CATEGORY").value
    case "a.ant_salario": return amountSide(previous("SALARY"))
    case "a.nue_cargo": return next("JOB").display ?? next("JOB").value
    case "a.nue_grupal": return next("SALARY_GROUP").display ?? next("SALARY_GROUP").value
    case "a.nue_cat": return next("OCCUPATIONAL_CATEGORY").display ?? next("OCCUPATIONAL_CATEGORY").value
    case "a.nue_salario": return amountSide(next("SALARY"))
    case "a.nue_otros": return amountSide(next("OTHER_PAYMENT"))
    case "a.nue_total":
      return data.totals.after ?? amountSide(next("TOTAL_COMPENSATION"))
    default: return null
  }
}

const formatByDataType = (
  definition: DocumentVariableDefinition,
  raw: string | number | null
): string | null => {
  if (raw === null || raw === undefined) return null
  
  // Special formatting for s.dias: append "días" / "día"
  if (definition.key === "s.dias") {
    return formatSc404Dias(raw)
  }
  
  switch (definition.dataType) {
    case "date": return formatDocumentDate(typeof raw === "string" ? raw : String(raw))
    case "amount": return formatDocumentAmount(raw)
    case "hours": return formatDocumentHours(raw)
    case "integer":
    case "text":
    default:
      return typeof raw === "string" ? raw : String(raw)
  }
}

/**
 * Resuelve UNA variable documental (§43). Distingue `value` de `missing`:
 * nunca produce undefined/null/[object Object] como texto.
 */
export const resolveDocumentVariable = (
  data: DocumentData,
  variableKey: string
): DocumentVariableResolution => {
  const definition = documentVariableByKey(variableKey)
  if (!definition) {
    return { status: "missing", value: null }
  }
  if (!definition.documentTypes.includes(data.document_type)) {
    return { status: "missing", value: null }
  }
  const raw = rawValueFor(data, definition)
  const formatted = formatByDataType(definition, raw)
  if (formatted === null || formatted === "") {
    return { status: "missing", value: null }
  }
  return { status: "value", value: formatted }
}

export interface ResolvedDocumentVariables {
  documentType: DocumentTypeCode
  /** key → valor ya formateado (sólo variables con valor). */
  values: Record<string, string>
  /** Variables sin valor, con su etiqueta legible (§47). */
  missing: { key: string; label: string }[]
}

/** Resuelve TODAS las variables aplicables al documento (§44). Base directa de 11B. */
export const resolveAllDocumentVariables = (data: DocumentData): ResolvedDocumentVariables => {
  const values: Record<string, string> = {}
  const missing: { key: string; label: string }[] = []

  DOCUMENT_VARIABLES.filter((definition) =>
    definition.documentTypes.includes(data.document_type)
  ).forEach((definition) => {
    const resolution = resolveDocumentVariable(data, definition.key)
    if (resolution.status === "value" && resolution.value !== null) {
      values[definition.key] = resolution.value
    } else {
      missing.push({ key: definition.key, label: definition.label })
    }
  })

  return { documentType: data.document_type, values, missing }
}
