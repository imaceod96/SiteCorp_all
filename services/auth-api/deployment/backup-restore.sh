#!/usr/bin/env bash
# =============================================================================
# SITECORP AUTH API — PROCEDIMIENTO DE RESPALDO Y RECUPERACIÓN (POSTGRESQL)
# =============================================================================
# Este script automatiza el respaldo consistente y cifrado del esquema
# 'sitecorp_auth' y la base de datos de autenticación en un VPS Linux.
#
# Uso:
#   ./backup-restore.sh backup [/ruta/al/destino]
#   ./backup-restore.sh restore /ruta/al/archivo_backup.sql.gz
#   ./backup-restore.sh status
# =============================================================================

set -euo pipefail

BACKUP_DIR="${2:-/var/backups/sitecorp-auth}"
DB_NAME="${PGDATABASE:-sitecorp_prod}"
DB_USER="${PGUSER:-sitecorp_auth_admin}"
DB_HOST="${PGHOST:-127.0.0.1}"
DB_PORT="${PGPORT:-5432}"
SCHEMA_NAME="sitecorp_auth"
RETENTION_DAYS=14
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

cmd_backup() {
    log "Iniciando respaldo de seguridad para esquema '${SCHEMA_NAME}' en base de datos '${DB_NAME}'..."
    mkdir -p "${BACKUP_DIR}"
    chmod 700 "${BACKUP_DIR}"

    local dump_file="${BACKUP_DIR}/sitecorp_auth_${TIMESTAMP}.sql.gz"
    local checksum_file="${dump_file}.sha256"

    # Exportar con pg_dump en transacción consistente (--single-transaction)
    # y comprimir con gzip nivel 9
    PGPASSWORD="${PGPASSWORD:-}" pg_dump \
        -h "${DB_HOST}" \
        -p "${DB_PORT}" \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        -n "${SCHEMA_NAME}" \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        --quote-all-identifiers \
        | gzip -9 > "${dump_file}"

    chmod 600 "${dump_file}"
    sha256sum "${dump_file}" | awk '{print $1}' > "${checksum_file}"
    chmod 600 "${checksum_file}"

    local size_bytes
    size_bytes=$(stat -c%s "${dump_file}")

    log "Respaldo completado exitosamente: ${dump_file} (${size_bytes} bytes)"
    log "Checksum SHA-256: $(cat "${checksum_file}")"

    # Rotación: eliminar respaldos con más de RETENTION_DAYS días
    log "Limpiando respaldos antiguos (> ${RETENTION_DAYS} días)..."
    find "${BACKUP_DIR}" -type f -name "sitecorp_auth_*.sql.gz*" -mtime +"${RETENTION_DAYS}" -delete
    log "Rotación finalizada."
}

cmd_restore() {
    local target_file="${2:-}"
    if [[ -z "${target_file}" || ! -f "${target_file}" ]]; then
        echo "Error: Debe especificar un archivo de respaldo válido existente."
        echo "Uso: $0 restore /ruta/al/archivo.sql.gz"
        exit 1
    fi

    log "ADVERTENCIA: Se restaurará el esquema '${SCHEMA_NAME}' en '${DB_NAME}' desde '${target_file}'."
    read -r -p "¿Desea continuar con la restauración? (escriba 'SI' en mayúsculas): " confirm
    if [[ "${confirm}" != "SI" ]]; then
        log "Operación cancelada por el operador."
        exit 0
    fi

    local checksum_file="${target_file}.sha256"
    if [[ -f "${checksum_file}" ]]; then
        log "Verificando integridad SHA-256..."
        local expected
        local actual
        expected=$(cat "${checksum_file}" | tr -d '[:space:]')
        actual=$(sha256sum "${target_file}" | awk '{print $1}')
        if [[ "${expected}" != "${actual}" ]]; then
            log "ERROR FATAL: El checksum del archivo no coincide. Archivo alterado o corrupto."
            exit 1
        fi
        log "Integridad verificada con éxito."
    fi

    log "Ejecutando restauración en PostgreSQL..."
    gunzip -c "${target_file}" | PGPASSWORD="${PGPASSWORD:-}" psql \
        -h "${DB_HOST}" \
        -p "${DB_PORT}" \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        --single-transaction \
        -v ON_ERROR_STOP=1

    log "Restauración completada satisfactoriamente."
}

cmd_status() {
    log "Estado de respaldos en '${BACKUP_DIR}':"
    if [[ -d "${BACKUP_DIR}" ]]; then
        ls -lh "${BACKUP_DIR}"/sitecorp_auth_*.sql.gz 2>/dev/null || echo "No hay respaldos disponibles."
    else
        echo "Directorio de respaldos no existe."
    fi
}

case "${1:-}" in
    backup)
        cmd_backup "$@"
        ;;
    restore)
        cmd_restore "$@"
        ;;
    status)
        cmd_status
        ;;
    *)
        echo "Uso: $0 {backup|restore|status} [argumentos]"
        exit 1
        ;;
esac
