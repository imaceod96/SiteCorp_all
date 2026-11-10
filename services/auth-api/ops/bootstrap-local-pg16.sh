#!/usr/bin/env bash
# ==============================================================================
# SITECORP — FASE 4G.8: BOOTSTRAP DE SERVIDOR POSTGRESQL 16.15 CONVENCIONAL AISLADO
# ==============================================================================
set -euo pipefail

PG16_ROOT="/tmp/pg16"
PG16_DEBS="/tmp/pg16-debs"
PG16_CLUSTER="/tmp/pg16-cluster"
PG16_SOCK="/tmp/pg16-sock"
PG16_PORT="${PG16_PORT:-54332}"
PG16_BIN="${PG16_ROOT}/usr/lib/postgresql/16/bin"
export LD_LIBRARY_PATH="${PG16_ROOT}/usr/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu"

if [ -x "${PG16_BIN}/pg_isready" ] && "${PG16_BIN}/pg_isready" -h 127.0.0.1 -p "${PG16_PORT}" >/dev/null 2>&1; then
  echo "[OK] PostgreSQL 16.15 ya está activo en 127.0.0.1:${PG16_PORT}"
  exit 0
fi

if [ ! -x "${PG16_BIN}/postgres" ]; then
  echo "[1/3] Descargando y extrayendo binarios oficiales de PostgreSQL 16 (PGDG Bookworm)..."
  mkdir -p "${PG16_DEBS}" "${PG16_ROOT}" /etc/apt/keyrings
  if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  fi
  apt-get update -qq
  (
    cd "${PG16_DEBS}"
    apt-get download -qq \
      postgresql-16 \
      postgresql-client-16 \
      libpq5 \
      libllvm14 \
      libicu72 \
      liblz4-1 \
      libxslt1.1 \
      libxml2 \
      libgssapi-krb5-2 \
      libldap-2.5-0
    for deb in *.deb; do
      dpkg -x "${deb}" "${PG16_ROOT}"
    done
  )
fi

if ! id -u pgtest >/dev/null 2>&1; then
  useradd -m -s /bin/bash pgtest
fi

mkdir -p "${PG16_CLUSTER}" "${PG16_SOCK}"
chown -R pgtest:pgtest "${PG16_CLUSTER}" "${PG16_SOCK}"

if [ ! -f "${PG16_CLUSTER}/PG_VERSION" ]; then
  echo "[2/3] Inicializando clúster PostgreSQL 16 en ${PG16_CLUSTER}..."
  su - pgtest -c "LD_LIBRARY_PATH='${LD_LIBRARY_PATH}' ${PG16_BIN}/initdb -D '${PG16_CLUSTER}' -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null"
fi

echo "[3/3] Iniciando motor PostgreSQL 16 en 127.0.0.1:${PG16_PORT}..."
su - pgtest -c "LD_LIBRARY_PATH='${LD_LIBRARY_PATH}' ${PG16_BIN}/pg_ctl -D '${PG16_CLUSTER}' -l /tmp/pg16.log -o \"-p ${PG16_PORT} -k ${PG16_SOCK} -h 127.0.0.1\" start >/dev/null"

"${PG16_BIN}/pg_isready" -h 127.0.0.1 -p "${PG16_PORT}"
echo "[OK] Servidor PostgreSQL 16 operativo en 127.0.0.1:${PG16_PORT}"
