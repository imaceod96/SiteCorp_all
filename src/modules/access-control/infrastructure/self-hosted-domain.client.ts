import type { IAuthenticationProvider } from "../domain/auth-provider.contracts"

export type AutonomousBucketId =
  | "avatars"
  | "document-templates"
  | "documents"
  | "platform_documents"
  | "worker_documents"

export type AutonomousTenantPermission =
  | "companies.view"
  | "companies.manage"
  | "entities.view"
  | "entities.manage"
  | "positions.view"
  | "positions.manage"
  | "workers.view"
  | "workers.manage"
  | "contracts.view"
  | "contracts.manage"
  | "vacations.view"
  | "vacations.manage"
  | "documents.view"
  | "documents.manage"
  | "audit.view"

export interface AutonomousCompanyClient {
  id: string
  code: string
  name: string
  description: string | null
  logoUrl: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AutonomousOrganizationEntity {
  id: string
  companyClientId: string
  parentId: string | null
  code: string | null
  name: string
  entityType: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AutonomousPosition {
  id: string
  jobId: string
  organizationEntityId: string
  name: string
  description: string | null
  positionOrder: number
  authorizedQuantity: number
  workLocation: string | null
  dailyHours: number
  weeklyHours: number
  monthlyHours: number
  breakMinutes: number
  scheduleNotes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AutonomousWorker {
  id: string
  companyClientId: string
  identificationNumber: string
  firstName: string
  lastName: string
  secondLastName: string | null
  email: string | null
  address: string | null
  photoUrl: string | null
  employmentStartDate: string | null
  createdAt: string
  updatedAt: string
}

export interface AutonomousContract {
  id: string
  companyClientId: string
  workerId: string
  positionId: string | null
  organizationEntityId: string | null
  status: string
  startDate: string
  endDate: string | null
  baseSalary: number
  signatureDate: string | null
  createdAt: string
  updatedAt: string
}

export interface AutonomousLaborMovement {
  id: string
  companyClientId: string
  workerId: string
  organizationEntityId: string | null
  movementType:
    | "ALTA"
    | "BAJA"
    | "REINGRESO"
    | "CAMBIO_PUESTO"
    | "CAMBIO_CONTRATO"
    | "MODIFICACION_SALARIAL"
  effectiveDate: string
  previousPositionId: string | null
  newPositionId: string | null
  reason: string | null
  createdBy: string | null
  createdAt: string
}

export interface AutonomousVacationBalance {
  id: string
  companyClientId: string
  workerId: string
  year: number
  openingBalance: number
  daysAccrued: number
  daysTaken: number
  balance: number
  createdAt: string
  updatedAt: string
}

export interface AutonomousStorageObject {
  id: string
  bucketId: AutonomousBucketId
  objectName: string
  companyClientId: string | null
  userId: string | null
  mimeType: string
  sizeBytes: number
  sha256Checksum: string
  storagePath: string
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface AutonomousAuditEntry {
  id: string
  companyClientId: string | null
  userId: string | null
  action: string
  entityType: string
  entityId: string | null
  module: string
  previousState: Record<string, unknown> | null
  newState: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
}

export interface AutonomousUserAccessOverview {
  isPlatformAdmin: boolean
  operatorPermissions: string[]
  memberships: Array<{
    companyClientId: string
    companyCode: string
    companyName: string
    roleCode: string
    permissions: AutonomousTenantPermission[]
  }>
}

export interface SelfHostedDomainClientOptions {
  baseUrl?: string
  authProvider: IAuthenticationProvider
  fetchFn?: typeof fetch
}

export class SelfHostedDomainHttpError extends Error {
  public readonly statusCode: number
  public readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = "SelfHostedDomainHttpError"
    this.statusCode = statusCode
    this.code = code
  }
}

/**
 * Cliente autónomo para operaciones de dominio multiempresa y Storage en modo `self_hosted`.
 * Consume exclusivamente `/api/v1/domain/*` y `/api/v1/storage/*` sin invocar Supabase.
 */
export class SelfHostedDomainClient {
  private readonly baseUrl: string
  private readonly authProvider: IAuthenticationProvider
  private readonly fetchFn: typeof fetch

  constructor(options: SelfHostedDomainClientOptions) {
    const win = (
      globalThis as unknown as {
        window?: { __SITECORP_AUTH_URL__?: string }
      }
    ).window
    const defaultBaseUrl = win?.__SITECORP_AUTH_URL__
      ? win.__SITECORP_AUTH_URL__
      : "http://127.0.0.1:4010"

    this.baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/+$/, "")
    this.authProvider = options.authProvider
    this.fetchFn =
      options.fetchFn ??
      (typeof fetch !== "undefined"
        ? fetch.bind(globalThis)
        : (undefined as unknown as typeof fetch))
  }

  private async buildAuthHeaders(extraHeaders?: Record<string, string>): Promise<Record<string, string>> {
    const session = await this.authProvider.getSession()
    if (!session?.accessToken) {
      throw new SelfHostedDomainHttpError(
        401,
        "UNAUTHENTICATED",
        "No existe una sesión activa en el proveedor autónomo."
      )
    }

    return {
      Accept: "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...extraHeaders,
    }
  }

  private async requestJson<T>(
    path: string,
    init: { method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }
  ): Promise<T> {
    const headers = await this.buildAuthHeaders(
      init.body !== undefined ? { "Content-Type": "application/json" } : undefined
    )

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: init.method,
      headers,
      credentials: "include",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })

    const json = (await response.json().catch(() => null)) as Record<string, any> | null
    if (!response.ok) {
      const code = json?.error?.code ?? json?.code ?? "HTTP_ERROR"
      const message =
        json?.error?.message ?? json?.message ?? `Error HTTP ${response.status} en ${path}`
      throw new SelfHostedDomainHttpError(response.status, code, message)
    }

    return (json?.data ?? json) as T
  }

  // =========================================================================
  // 1. Acceso, Membresías y Permisos
  // =========================================================================
  async getMyAccessOverview(): Promise<AutonomousUserAccessOverview> {
    const data = await this.requestJson<{ access: AutonomousUserAccessOverview }>(
      "/api/v1/domain/me/access",
      { method: "GET" }
    )
    return data.access
  }

  async grantCompanyMembership(
    companyId: string,
    input: {
      targetUserId: string
      roleCode?: string
      permissions: readonly AutonomousTenantPermission[]
    }
  ): Promise<{ id: string; userId: string; companyClientId: string; roleCode: string }> {
    const data = await this.requestJson<{
      membership: { id: string; userId: string; companyClientId: string; roleCode: string }
    }>(`/api/v1/domain/companies/${encodeURIComponent(companyId)}/memberships`, {
      method: "POST",
      body: input,
    })
    return data.membership
  }

  async revokeCompanyMembership(companyId: string, targetUserId: string): Promise<{ revoked: boolean }> {
    return this.requestJson<{ revoked: boolean }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/memberships/${encodeURIComponent(targetUserId)}`,
      { method: "DELETE" }
    )
  }

  // =========================================================================
  // 2. Empresas y Entidades Organizativas
  // =========================================================================
  async listCompanies(): Promise<AutonomousCompanyClient[]> {
    const data = await this.requestJson<{ companies: AutonomousCompanyClient[] }>(
      "/api/v1/domain/companies",
      { method: "GET" }
    )
    return data.companies
  }

  async getCompanyById(companyId: string): Promise<AutonomousCompanyClient> {
    const data = await this.requestJson<{ company: AutonomousCompanyClient }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}`,
      { method: "GET" }
    )
    return data.company
  }

  async createCompany(input: {
    code: string
    name: string
    description?: string
    logoUrl?: string
  }): Promise<AutonomousCompanyClient> {
    const data = await this.requestJson<{ company: AutonomousCompanyClient }>(
      "/api/v1/domain/companies",
      { method: "POST", body: input }
    )
    return data.company
  }

  async listEntities(companyId: string): Promise<AutonomousOrganizationEntity[]> {
    const data = await this.requestJson<{ entities: AutonomousOrganizationEntity[] }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/entities`,
      { method: "GET" }
    )
    return data.entities
  }

  async createEntity(
    companyId: string,
    input: {
      parentId?: string
      code?: string
      name: string
      entityType?: string
    }
  ): Promise<AutonomousOrganizationEntity> {
    const data = await this.requestJson<{ entity: AutonomousOrganizationEntity }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/entities`,
      { method: "POST", body: input }
    )
    return data.entity
  }

  // =========================================================================
  // 3. Puestos y Plazas
  // =========================================================================
  async listPositions(companyId: string): Promise<AutonomousPosition[]> {
    const data = await this.requestJson<{ positions: AutonomousPosition[] }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/positions`,
      { method: "GET" }
    )
    return data.positions
  }

  async createPosition(
    companyId: string,
    input: {
      organizationEntityId: string
      jobTitle: string
      positionName: string
      authorizedQuantity?: number
      dailyHours?: number
    }
  ): Promise<AutonomousPosition> {
    const data = await this.requestJson<{ position: AutonomousPosition }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/positions`,
      { method: "POST", body: input }
    )
    return data.position
  }

  // =========================================================================
  // 4. Trabajadores
  // =========================================================================
  async listWorkers(companyId: string): Promise<AutonomousWorker[]> {
    const data = await this.requestJson<{ workers: AutonomousWorker[] }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/workers`,
      { method: "GET" }
    )
    return data.workers
  }

  async getWorkerById(companyId: string, workerId: string): Promise<AutonomousWorker> {
    const data = await this.requestJson<{ worker: AutonomousWorker }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/workers/${encodeURIComponent(workerId)}`,
      { method: "GET" }
    )
    return data.worker
  }

  async createWorker(
    companyId: string,
    input: {
      identificationNumber: string
      firstName: string
      lastName: string
      secondLastName?: string
      email?: string
      address?: string
      photoUrl?: string
    }
  ): Promise<AutonomousWorker> {
    const data = await this.requestJson<{ worker: AutonomousWorker }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/workers`,
      { method: "POST", body: input }
    )
    return data.worker
  }

  async updateWorker(
    companyId: string,
    workerId: string,
    input: {
      firstName?: string
      lastName?: string
      secondLastName?: string | null
      email?: string | null
      address?: string | null
      photoUrl?: string | null
    }
  ): Promise<AutonomousWorker> {
    const data = await this.requestJson<{ worker: AutonomousWorker }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/workers/${encodeURIComponent(workerId)}`,
      { method: "PATCH", body: input }
    )
    return data.worker
  }

  async deleteWorker(companyId: string, workerId: string): Promise<{ deleted: boolean }> {
    return this.requestJson<{ deleted: boolean }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/workers/${encodeURIComponent(workerId)}`,
      { method: "DELETE" }
    )
  }

  // =========================================================================
  // 5. Contratos y Movimientos Laborales
  // =========================================================================
  async listContracts(companyId: string): Promise<AutonomousContract[]> {
    const data = await this.requestJson<{ contracts: AutonomousContract[] }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/contracts`,
      { method: "GET" }
    )
    return data.contracts
  }

  async createContract(
    companyId: string,
    input: {
      workerId: string
      positionId?: string
      organizationEntityId?: string
      startDate: string
      endDate?: string
      baseSalary: number
    }
  ): Promise<AutonomousContract> {
    const data = await this.requestJson<{ contract: AutonomousContract }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/contracts`,
      { method: "POST", body: input }
    )
    return data.contract
  }

  async listWorkerMovements(
    companyId: string,
    workerId?: string
  ): Promise<AutonomousLaborMovement[]> {
    const query = workerId ? `?workerId=${encodeURIComponent(workerId)}` : ""
    const data = await this.requestJson<{ movements: AutonomousLaborMovement[] }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/movements${query}`,
      { method: "GET" }
    )
    return data.movements
  }

  async recordLaborMovement(
    companyId: string,
    input: {
      workerId: string
      organizationEntityId?: string
      movementType:
        | "ALTA"
        | "BAJA"
        | "REINGRESO"
        | "CAMBIO_PUESTO"
        | "CAMBIO_CONTRATO"
        | "MODIFICACION_SALARIAL"
      effectiveDate: string
      previousPositionId?: string
      newPositionId?: string
      reason?: string
    }
  ): Promise<AutonomousLaborMovement> {
    const data = await this.requestJson<{ movement: AutonomousLaborMovement }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/movements`,
      { method: "POST", body: input }
    )
    return data.movement
  }

  // =========================================================================
  // 6. Vacaciones
  // =========================================================================
  async getWorkerVacations(
    companyId: string,
    workerId?: string
  ): Promise<AutonomousVacationBalance[]> {
    const query = workerId ? `?workerId=${encodeURIComponent(workerId)}` : ""
    const data = await this.requestJson<{ vacations: AutonomousVacationBalance[] }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/vacations${query}`,
      { method: "GET" }
    )
    return data.vacations
  }

  async recordVacationMovement(
    companyId: string,
    input: {
      workerId: string
      year: number
      movementType: "ACCRUAL" | "TAKEN" | "ADJUSTMENT"
      days: number
      notes?: string
    }
  ): Promise<AutonomousVacationBalance> {
    const data = await this.requestJson<{ vacation: AutonomousVacationBalance }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/vacations/movement`,
      { method: "POST", body: input }
    )
    return data.vacation
  }

  // =========================================================================
  // 7. Documentos y Storage Autónomo
  // =========================================================================
  async uploadFile(input: {
    bucketId: AutonomousBucketId
    objectName: string
    contentBase64: string
    mimeType: string
    companyClientId?: string
  }): Promise<AutonomousStorageObject> {
    const data = await this.requestJson<{ object: AutonomousStorageObject }>(
      "/api/v1/storage/upload",
      { method: "POST", body: input }
    )
    return data.object
  }

  async listCompanyObjects(
    companyId: string,
    bucketId?: AutonomousBucketId
  ): Promise<AutonomousStorageObject[]> {
    const query = bucketId ? `?bucketId=${encodeURIComponent(bucketId)}` : ""
    const data = await this.requestJson<{ objects: AutonomousStorageObject[] }>(
      `/api/v1/storage/companies/${encodeURIComponent(companyId)}/objects${query}`,
      { method: "GET" }
    )
    return data.objects
  }

  async downloadFile(
    bucketId: AutonomousBucketId,
    objectName: string
  ): Promise<{ content: Uint8Array; mimeType: string; sha256Checksum: string | null }> {
    const headers = await this.buildAuthHeaders({ Accept: "*/*" })
    const encodedPath = objectName
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")

    const response = await this.fetchFn(
      `${this.baseUrl}/api/v1/storage/objects/${encodeURIComponent(bucketId)}/${encodedPath}`,
      {
        method: "GET",
        headers,
        credentials: "include",
      }
    )

    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as Record<string, any> | null
      const code = json?.error?.code ?? json?.code ?? "STORAGE_DOWNLOAD_ERROR"
      const message =
        json?.error?.message ?? json?.message ?? `Error HTTP ${response.status} al descargar`
      throw new SelfHostedDomainHttpError(response.status, code, message)
    }

    const arrayBuffer = await response.arrayBuffer()
    return {
      content: new Uint8Array(arrayBuffer),
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
      sha256Checksum: response.headers.get("x-checksum-sha256"),
    }
  }

  async deleteFile(
    bucketId: AutonomousBucketId,
    objectName: string
  ): Promise<{ deleted: boolean }> {
    const encodedPath = objectName
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")

    return this.requestJson<{ deleted: boolean }>(
      `/api/v1/storage/objects/${encodeURIComponent(bucketId)}/${encodedPath}`,
      { method: "DELETE" }
    )
  }

  // =========================================================================
  // 8. Auditoría
  // =========================================================================
  async listCompanyAuditLogs(companyId: string): Promise<AutonomousAuditEntry[]> {
    const data = await this.requestJson<{ auditEvents: AutonomousAuditEntry[] }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/audit`,
      { method: "GET" }
    )
    return data.auditEvents
  }

  // =========================================================================
  // 9. Cuadros y Reservas (Fase 4G.7)
  // =========================================================================
  async createCadreReserve(
    companyId: string,
    input: {
      workerId: string
      targetPositionId: string
      reserveCategory?: "TITULAR" | "RESERVA_INMEDIATA" | "RESERVA_PERSPECTIVA" | "CANTERA"
      readinessLevel?: "LISTO" | "EN_PREPARACION" | "INICIAL"
      designatedDate?: string
      expirationDate?: string | null
      notes?: string | null
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ reserve: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/cadre-reserves`,
      { method: "POST", body: input }
    )
    return data.reserve
  }

  async listCadreReserves(companyId: string): Promise<Array<Record<string, unknown>>> {
    const data = await this.requestJson<{ reserves: Array<Record<string, unknown>> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/cadre-reserves`,
      { method: "GET" }
    )
    return data.reserves
  }

  async createCadreEvaluation(
    companyId: string,
    input: {
      workerId: string
      positionId?: string | null
      evaluationPeriod: string
      evaluationDate?: string
      overallRating: "SUPERIOR" | "SATISFACTORIO" | "REGULAR" | "DEFICIENTE"
      score?: number | null
      strengths?: string | null
      recommendations?: string | null
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ evaluation: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/cadre-evaluations`,
      { method: "POST", body: input }
    )
    return data.evaluation
  }

  async createCadreMovement(
    companyId: string,
    input: {
      workerId: string
      fromPositionId?: string | null
      toPositionId?: string | null
      movementKind: "PROMOCION" | "ROTACION" | "DEMOCION" | "LIBERACION" | "DESIGNACION_DIRECTA"
      effectiveDate?: string
      resolutionNumber?: string | null
      notes?: string | null
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ movement: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/cadre-movements`,
      { method: "POST", body: input }
    )
    return data.movement
  }

  // =========================================================================
  // 10. Plantillas Documentales Avanzadas y Generación (Fase 4G.7)
  // =========================================================================
  async createDocumentTemplate(
    companyId: string,
    input: {
      code: string
      name: string
      category?: string
      contentHtml?: string
    }
  ): Promise<{
    template: Record<string, unknown>
    initialVersion: Record<string, unknown>
  }> {
    return this.requestJson<{
      template: Record<string, unknown>
      initialVersion: Record<string, unknown>
    }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/document-templates`,
      { method: "POST", body: input }
    )
  }

  async createTemplateVariable(
    companyId: string,
    templateId: string,
    input: {
      variableKey: string
      label: string
      dataType?: "TEXT" | "NUMBER" | "DATE" | "CURRENCY" | "BOOLEAN"
      isRequired?: boolean
      defaultValue?: string | null
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ variable: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/document-templates/${encodeURIComponent(templateId)}/variables`,
      { method: "POST", body: input }
    )
    return data.variable
  }

  async createTemplateSection(
    companyId: string,
    templateId: string,
    input: {
      sectionCode: string
      title: string
      contentTemplate: string
      sortOrder?: number
      isOptional?: boolean
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ section: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/document-templates/${encodeURIComponent(templateId)}/sections`,
      { method: "POST", body: input }
    )
    return data.section
  }

  async generateDocument(
    companyId: string,
    input: {
      templateId: string
      workerId?: string | null
      contractId?: string | null
      documentTitle: string
      variables: Record<string, string | number | boolean | null>
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ generatedDocument: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/generated-documents`,
      { method: "POST", body: input }
    )
    return data.generatedDocument
  }

  // =========================================================================
  // 11. Invitaciones y Notificaciones (Fase 4G.7)
  // =========================================================================
  async createCompanyInvitation(
    companyId: string,
    input: {
      invitedEmail: string
      roleCode?: string
      expiresInHours?: number
    }
  ): Promise<{
    invitation: Record<string, unknown>
    emailDelivery: Record<string, unknown> | null
  }> {
    return this.requestJson<{
      invitation: Record<string, unknown>
      emailDelivery: Record<string, unknown> | null
    }>(`/api/v1/domain/companies/${encodeURIComponent(companyId)}/invitations`, {
      method: "POST",
      body: input,
    })
  }

  async listCompanyInvitations(companyId: string): Promise<Array<Record<string, unknown>>> {
    const data = await this.requestJson<{ invitations: Array<Record<string, unknown>> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/invitations`,
      { method: "GET" }
    )
    return data.invitations
  }

  // =========================================================================
  // 12. Nómina y Prenómina Avanzada (Fase 4G.7)
  // =========================================================================
  async createPrenominaPeriod(
    companyId: string,
    input: {
      organizationEntityId?: string | null
      periodYear: number
      periodMonth: number
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ period: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/prenomina-periods`,
      { method: "POST", body: input }
    )
    return data.period
  }

  async upsertPrenominaWorkerEntry(
    companyId: string,
    periodId: string,
    input: {
      workerId: string
      workedDays: number
      workedHours?: number
      overtimeHours?: number
      baseAmount: number
      bonusAmount?: number
      deductionAmount?: number
      notes?: string | null
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ entry: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/prenomina-periods/${encodeURIComponent(periodId)}/entries`,
      { method: "POST", body: input }
    )
    return data.entry
  }

  async createSalaryBonus(
    companyId: string,
    input: {
      workerId: string
      prenominaPeriodId?: string | null
      bonusType?: "ANTIGUEDAD" | "MAESTRIA_DOCTORADO" | "RESULTADOS" | "CONDICIONES_LABORALES" | "ESTIMULO" | "OTRO"
      concept: string
      amount: number
      effectiveDate?: string
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ bonus: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/salary-bonuses`,
      { method: "POST", body: input }
    )
    return data.bonus
  }

  async createSalaryDeduction(
    companyId: string,
    input: {
      workerId: string
      prenominaPeriodId?: string | null
      deductionType?: "SEGURIDAD_SOCIAL" | "IMPUESTO_INGRESOS" | "AUSENCIA" | "RETENCION_JUDICIAL" | "ANTICIPO" | "OTRO"
      concept: string
      amount: number
      effectiveDate?: string
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ deduction: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/salary-deductions`,
      { method: "POST", body: input }
    )
    return data.deduction
  }

  async closePrenominaPeriod(
    companyId: string,
    periodId: string,
    notes?: string
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ closure: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/prenomina-periods/${encodeURIComponent(periodId)}/close`,
      { method: "POST", body: { notes } }
    )
    return data.closure
  }

  // =========================================================================
  // 13. Capacitación, SST, Comisiones y Disciplina (Fase 4G.7)
  // =========================================================================
  async createTrainingCourse(
    companyId: string,
    input: {
      code: string
      title: string
      provider?: string | null
      modality?: "PRESENCIAL" | "VIRTUAL" | "MIXTA"
      durationHours: number
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ course: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/training-courses`,
      { method: "POST", body: input }
    )
    return data.course
  }

  async recordWorkerTraining(
    companyId: string,
    input: {
      workerId: string
      courseId: string
      startDate: string
      endDate?: string | null
      status?: "MATRICULADO" | "EN_CURSO" | "APROBADO" | "DESAPROBADO" | "BAJA"
      grade?: number | null
      certificateNumber?: string | null
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ training: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/worker-trainings`,
      { method: "POST", body: input }
    )
    return data.training
  }

  async createEvaluationCommittee(
    companyId: string,
    input: {
      organizationEntityId?: string | null
      name: string
      resolutionNumber: string
      constitutedDate?: string
      members?: ReadonlyArray<{ workerId: string; role: string }>
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ committee: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/evaluation-committees`,
      { method: "POST", body: input }
    )
    return data.committee
  }

  async recordDisciplinaryMeasure(
    companyId: string,
    input: {
      workerId: string
      organizationEntityId?: string | null
      measureType:
        | "AMONESTACION_PUBLICA"
        | "MULTA"
        | "SUSPENSION_VINCULO"
        | "TRASLADO_PROVISIONAL"
        | "TRASLADO_DEFINITIVO"
        | "SEPARACION_DEFINITIVA"
      resolutionNumber: string
      reason: string
    }
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ measure: Record<string, unknown> }>(
      `/api/v1/domain/companies/${encodeURIComponent(companyId)}/disciplinary-measures`,
      { method: "POST", body: input }
    )
    return data.measure
  }

  async invokeAutonomousRpc(
    rpcName: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    const data = await this.requestJson<{ result: unknown }>(
      `/api/v1/domain/rpc/${encodeURIComponent(rpcName)}`,
      { method: "POST", body: args }
    )
    return data.result
  }

  async invokeAutonomousEdgeFunction(
    functionName: string,
    body: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const data = await this.requestJson<{ result: Record<string, unknown> }>(
      `/api/v1/domain/functions/${encodeURIComponent(functionName)}`,
      { method: "POST", body }
    )
    return data.result
  }
}
