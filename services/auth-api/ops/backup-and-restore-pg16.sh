#!/usr/bin/env bash
# =============================================================================
# SITECORP — FASE 4G.8: SCRIPT DE COPIA DE SEGURIDAD Y RESTAURACIÓN POSTGRESQL 16
# =============================================================================
set -euo pipefail

PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-sitecorp_prod}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sitecorp/pg16}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/${PG_DB}_${TIMESTAMP}.dump"
SHA_FILE="${DUMP_FILE}.sha256"

echo "[SITECORP BACKUP] Generando respaldo comprimido (-Fc) de ${PG_DB}..."
pg_dump -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -Fc --no-owner --no-acl -f "$DUMP_FILE"
sha256sum "$DUMP_FILE" > "$SHA_FILE"
chmod 600 "$DUMP_FILE" "$SHA_FILE"

echo "[SITECORP BACKUP] Verificando integridad SHA-256 y catálogo del archivo..."
sha256sum -c "$SHA_FILE"
pg_restore --list "$DUMP_FILE" > /dev/null

if [[ "${VERIFY_RESTORE:-false}" == "true" ]]; then
  VERIFY_DB="${PG_DB}_restore_check_${TIMESTAMP}"
  echo "[SITECORP BACKUP] Ejecutando prueba de restauración en base efímera ${VERIFY_DB}..."
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "CREATE DATABASE \"${VERIFY_DB}\" ENCODING 'UTF8';"
  pg_restore -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$VERIFY_DB" --no-owner --no-acl "$DUMP_FILE"
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "DROP DATABASE \"${VERIFY_DB}\";"
  echo "[SITECORP BACKUP] Prueba de restauración completada con éxito."
fi

find "$BACKUP_DIR" -type f -name "${PG_DB}_*.dump*" -mtime +"$RETENTION_DAYS" -delete
echo "[SITECORP BACKUP] Respaldo finalizado correctamente: ${DUMP_FILE}"
