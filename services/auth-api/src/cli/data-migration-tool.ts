import { createHash } from "node:crypto";
import { IDatabaseClient, ITransactionManager } from "../interfaces";

export interface TableMigrationSnapshot {
  readonly tableName: string;
  readonly rowCount: number;
  readonly uuids: readonly string[];
  readonly sha256Digest: string;
  readonly rows: readonly Record<string, unknown>[];
}

export interface DataMigrationBundle {
  readonly bundleVersion: "1.0.0";
  readonly exportedAt: string;
  readonly companyClientIds: readonly string[];
  readonly tables: Record<string, TableMigrationSnapshot>;
  readonly bundleSha256: string;
}

export interface MigrationReconciliationReport {
  readonly passed: boolean;
  readonly verifiedAt: string;
  readonly totalTablesVerified: number;
  readonly totalRowsVerified: number;
  readonly uuidPreservationPassed: boolean;
  readonly referentialIntegrityPassed: boolean;
  readonly orphanCount: number;
  readonly checksumMatchPassed: boolean;
  readonly businessRulesPassed: boolean;
  readonly tableComparisons: ReadonlyArray<{
    tableName: string;
    expectedCount: number;
    actualCount: number;
    expectedSha256: string;
    actualSha256: string;
    matched: boolean;
  }>;
  readonly discrepancies: readonly string[];
}

export interface MigrationTableSpec {
  readonly tableName: string;
  readonly tenantCol: "id" | "company_client_id" | "organization_entity_id";
}

/**
 * Orden topológico estricto de exportación/importación para preservar claves foráneas
 * y disparadores de coherencia multiempresa en PostgreSQL 16.
 */
export const MIGRATION_TOPOLOGICAL_TABLES: readonly MigrationTableSpec[] = [
  { tableName: "company_clients", tenantCol: "id" },
  { tableName: "organization_entities", tenantCol: "company_client_id" },
  { tableName: "organization_jobs", tenantCol: "organization_entity_id" },
  { tableName: "organization_positions", tenantCol: "organization_entity_id" },
  { tableName: "workers", tenantCol: "company_client_id" },
  { tableName: "employment_contracts", tenantCol: "company_client_id" },
  { tableName: "worker_vacations", tenantCol: "company_client_id" },
  { tableName: "prenomina_periods", tenantCol: "company_client_id" },
  { tableName: "prenomina_worker_entries", tenantCol: "company_client_id" },
  { tableName: "salary_bonuses", tenantCol: "company_client_id" },
  { tableName: "salary_deductions", tenantCol: "company_client_id" },
  { tableName: "payroll_closures", tenantCol: "company_client_id" },
  { tableName: "cadre_reserves", tenantCol: "company_client_id" },
  { tableName: "cadre_evaluations", tenantCol: "company_client_id" },
  { tableName: "cadre_movements", tenantCol: "company_client_id" },
  { tableName: "training_courses", tenantCol: "company_client_id" },
  { tableName: "worker_trainings", tenantCol: "company_client_id" },
  { tableName: "ppe_deliveries", tenantCol: "company_client_id" },
  { tableName: "work_accidents", tenantCol: "company_client_id" },
  { tableName: "evaluation_committees", tenantCol: "company_client_id" },
  { tableName: "disciplinary_measures", tenantCol: "company_client_id" },
  { tableName: "document_templates", tenantCol: "company_client_id" },
  { tableName: "generated_documents", tenantCol: "company_client_id" },
  { tableName: "storage_objects", tenantCol: "company_client_id" },
] as const;

function buildTenantWhereClause(
  spec: MigrationTableSpec,
  placeholders: string
): string {
  if (spec.tenantCol === "organization_entity_id") {
    return `organization_entity_id IN (SELECT id FROM public.organization_entities WHERE company_client_id IN (${placeholders}))`;
  }
  return `"${spec.tenantCol}" IN (${placeholders})`;
}

function canonicalizeRowForHash(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort();
  const normalized: Record<string, unknown> = {};
  for (const k of keys) {
    // Excluir timestamps de auditoría que puedan diferir en formato de zona horaria textual
    if (k === "created_at" || k === "updated_at" || k === "closed_at") {
      continue;
    }
    const val = row[k];
    if (val instanceof Date) {
      normalized[k] = val.toISOString().slice(0, 10);
    } else if (typeof val === "number" || (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val))) {
      normalized[k] = Number(val);
    } else {
      normalized[k] = val;
    }
  }
  return JSON.stringify(normalized);
}

export function computeTableRowsDigest(
  rows: readonly Record<string, unknown>[]
): string {
  const sorted = [...rows].sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? ""))
  );
  const hash = createHash("sha256");
  for (const r of sorted) {
    hash.update(canonicalizeRowForHash(r), "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

export class DataMigrationEngine {
  constructor(
    private readonly db: IDatabaseClient,
    private readonly txManager: ITransactionManager
  ) {}

  /**
   * Exporta un paquete determinista y verificable de empresas sintéticas o de ensayo
   * conservando UUID originales, relaciones y resumen criptográfico SHA-256.
   */
  async exportCompanyBundle(
    companyClientIds: readonly string[]
  ): Promise<DataMigrationBundle> {
    if (companyClientIds.length === 0) {
      throw new Error("Debe especificar al menos un companyClientId para exportar.");
    }

    const executor = this.db.getActiveExecutor();
    const tables: Record<string, TableMigrationSnapshot> = {};
    const placeholders = companyClientIds.map((_, i) => `$${i + 1}`).join(", ");

    for (const spec of MIGRATION_TOPOLOGICAL_TABLES) {
      const whereClause = buildTenantWhereClause(spec, placeholders);
      const res = await executor.query<Record<string, unknown>>(
        `SELECT * FROM public."${spec.tableName}"
         WHERE ${whereClause}
         ORDER BY id ASC;`,
        companyClientIds
      );
      const rows = res.rows;
      const uuids = rows.map((r) => String(r.id));
      const sha256Digest = computeTableRowsDigest(rows);
      tables[spec.tableName] = {
        tableName: spec.tableName,
        rowCount: rows.length,
        uuids,
        sha256Digest,
        rows,
      };
    }

    const bundleDigestHash = createHash("sha256");
    for (const spec of MIGRATION_TOPOLOGICAL_TABLES) {
      const snap = tables[spec.tableName]!;
      bundleDigestHash.update(`${spec.tableName}:${snap.rowCount}:${snap.sha256Digest}\n`);
    }

    return {
      bundleVersion: "1.0.0",
      exportedAt: new Date().toISOString(),
      companyClientIds: [...companyClientIds],
      tables,
      bundleSha256: bundleDigestHash.digest("hex"),
    };
  }

  /**
   * Importa de forma transaccional un paquete de migración en la base PostgreSQL destino,
   * preservando los UUID originales y el orden topológico de claves foráneas.
   */
  async importCompanyBundle(bundle: DataMigrationBundle): Promise<{
    importedTables: number;
    importedRows: number;
  }> {
    let importedTables = 0;
    let importedRows = 0;

    await this.txManager.runInTransaction(async (tx) => {
      for (const spec of MIGRATION_TOPOLOGICAL_TABLES) {
        const snap = bundle.tables[spec.tableName];
        if (!snap || snap.rows.length === 0) {
          continue;
        }
        importedTables += 1;

        for (const row of snap.rows) {
          const cols = Object.keys(row).filter((k) => row[k] !== undefined);
          const quotedCols = cols.map((c) => `"${c}"`).join(", ");
          const params = cols.map((_, idx) => `$${idx + 1}`).join(", ");
          const values = cols.map((c) => {
            const v = row[c];
            if (v !== null && typeof v === "object" && !(v instanceof Date)) {
              return JSON.stringify(v);
            }
            return v;
          });

          await tx.executor.query(
            `INSERT INTO public."${spec.tableName}" (${quotedCols})
             VALUES (${params})
             ON CONFLICT (id) DO NOTHING;`,
            values
          );
          importedRows += 1;
        }
      }
    });

    return { importedTables, importedRows };
  }

  /**
   * Ejecuta la validación integral de reconciliación (conteos, UUIDs, huérfanos,
   * checksums SHA-256 y reglas de negocio) contra la base de datos destino.
   */
  async verifyReconciliation(
    expectedBundle: DataMigrationBundle
  ): Promise<MigrationReconciliationReport> {
    const executor = this.db.getActiveExecutor();
    const companyIds = expectedBundle.companyClientIds;
    const placeholders = companyIds.map((_, i) => `$${i + 1}`).join(", ");
    const discrepancies: string[] = [];
    const tableComparisons: Array<{
      tableName: string;
      expectedCount: number;
      actualCount: number;
      expectedSha256: string;
      actualSha256: string;
      matched: boolean;
    }> = [];

    let totalRowsVerified = 0;
    let uuidPreservationPassed = true;
    let checksumMatchPassed = true;

    for (const spec of MIGRATION_TOPOLOGICAL_TABLES) {
      const expectedSnap = expectedBundle.tables[spec.tableName];
      if (!expectedSnap) continue;

      const whereClause = buildTenantWhereClause(spec, placeholders);
      const res = await executor.query<Record<string, unknown>>(
        `SELECT * FROM public."${spec.tableName}"
         WHERE ${whereClause}
         ORDER BY id ASC;`,
        companyIds
      );
      const actualRows = res.rows;
      const actualUuids = actualRows.map((r) => String(r.id));
      const actualSha256 = computeTableRowsDigest(actualRows);

      totalRowsVerified += actualRows.length;

      const sameUuids =
        expectedSnap.uuids.length === actualUuids.length &&
        expectedSnap.uuids.every((id, idx) => id === actualUuids[idx]);
      if (!sameUuids) {
        uuidPreservationPassed = false;
        discrepancies.push(
          `Discrepancia de UUIDs en '${spec.tableName}': esperados=${expectedSnap.uuids.length}, actuales=${actualUuids.length}`
        );
      }

      const sameHash = expectedSnap.sha256Digest === actualSha256;
      if (!sameHash) {
        checksumMatchPassed = false;
        discrepancies.push(
          `Discrepancia de checksum SHA-256 en '${spec.tableName}': esperado=${expectedSnap.sha256Digest}, actual=${actualSha256}`
        );
      }

      const matched =
        expectedSnap.rowCount === actualRows.length && sameUuids && sameHash;
      tableComparisons.push({
        tableName: spec.tableName,
        expectedCount: expectedSnap.rowCount,
        actualCount: actualRows.length,
        expectedSha256: expectedSnap.sha256Digest,
        actualSha256,
        matched,
      });
    }

    // Detección de registros huérfanos e incoherencias multiempresa
    const orphanQuery = await executor.query<{ orphan_count: string | number }>(
      `SELECT (
         (SELECT COUNT(*) FROM public.workers w
          LEFT JOIN public.company_clients c ON c.id = w.company_client_id
          WHERE w.company_client_id IN (${placeholders}) AND c.id IS NULL)
         +
         (SELECT COUNT(*) FROM public.employment_contracts ec
          LEFT JOIN public.workers w ON w.id = ec.worker_id
          WHERE ec.company_client_id IN (${placeholders})
            AND (w.id IS NULL OR w.company_client_id <> ec.company_client_id))
         +
         (SELECT COUNT(*) FROM public.cadre_reserves cr
          LEFT JOIN public.workers w ON w.id = cr.worker_id
          WHERE cr.company_client_id IN (${placeholders})
            AND (w.id IS NULL OR w.company_client_id <> cr.company_client_id))
         +
         (SELECT COUNT(*) FROM public.worker_trainings wt
          LEFT JOIN public.training_courses tc ON tc.id = wt.course_id
          WHERE wt.company_client_id IN (${placeholders})
            AND (tc.id IS NULL OR tc.company_client_id <> wt.company_client_id))
       )::INTEGER AS orphan_count;`,
      companyIds
    );
    const orphanCount = Number(orphanQuery.rows[0]?.orphan_count ?? 0);
    const referentialIntegrityPassed = orphanCount === 0;
    if (!referentialIntegrityPassed) {
      discrepancies.push(`Se detectaron ${orphanCount} registros huérfanos o con incoherencia de empresa.`);
    }

    // Verificación de invariantes de reglas de negocio (contratos con fechas coherentes y nómina no negativa)
    const businessRuleCheck = await executor.query<{ violations: string | number }>(
      `SELECT (
         (SELECT COUNT(*) FROM public.employment_contracts
          WHERE company_client_id IN (${placeholders})
            AND end_date IS NOT NULL AND end_date < start_date)
         +
         (SELECT COUNT(*) FROM public.payroll_closures
          WHERE company_client_id IN (${placeholders})
            AND (total_net < 0 OR total_gross < 0))
       )::INTEGER AS violations;`,
      companyIds
    );
    const businessViolations = Number(businessRuleCheck.rows[0]?.violations ?? 0);
    const businessRulesPassed = businessViolations === 0;
    if (!businessRulesPassed) {
      discrepancies.push(
        `Se detectaron ${businessViolations} violaciones de reglas de negocio en contratos o cierres de nómina.`
      );
    }

    const passed =
      discrepancies.length === 0 &&
      uuidPreservationPassed &&
      referentialIntegrityPassed &&
      checksumMatchPassed &&
      businessRulesPassed;

    return {
      passed,
      verifiedAt: new Date().toISOString(),
      totalTablesVerified: tableComparisons.length,
      totalRowsVerified,
      uuidPreservationPassed,
      referentialIntegrityPassed,
      orphanCount,
      checksumMatchPassed,
      businessRulesPassed,
      tableComparisons,
      discrepancies,
    };
  }

  /**
   * Reversión limpia y transaccional de los datos importados para las empresas indicadas
   * en orden inverso al topológico.
   */
  async rollbackCompanyMigration(
    companyClientIds: readonly string[]
  ): Promise<{ deletedRows: number }> {
    let deletedRows = 0;
    const placeholders = companyClientIds.map((_, i) => `$${i + 1}`).join(", ");
    const reversed = [...MIGRATION_TOPOLOGICAL_TABLES].reverse();

    await this.txManager.runInTransaction(async (tx) => {
      for (const spec of reversed) {
        const whereClause = buildTenantWhereClause(spec, placeholders);
        const res = await tx.executor.query(
          `DELETE FROM public."${spec.tableName}"
           WHERE ${whereClause};`,
          companyClientIds
        );
        deletedRows += res.rowCount ?? 0;
      }
    });

    return { deletedRows };
  }
}
