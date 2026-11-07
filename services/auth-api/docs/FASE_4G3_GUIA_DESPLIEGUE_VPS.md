# SITECORP AUTH API — GUÍA OPERATIVA DE DESPLIEGUE EN VPS LINUX (ETECSA)

**Documento**: `FASE_4G3_GUIA_DESPLIEGUE_VPS.md`  
**Servicio**: `@sitecorp/auth-api`  
**Entorno Objetivo**: Servidor Virtual Privado (VPS) Linux en centros de datos nacionales (ETECSA) o infraestructura dedicada equivalente.  
**Estado**: Preparación y Operación Autónoma (Fase 4G.3).

---

## 1. REQUISITOS DE INFRAESTRUCTURA Y HARDWARE

Para garantizar alta resiliencia y estabilidad bajo recursos acotados típicos de VPS nacionales:

| Recurso | Mínimo Admitido | Recomendado | Consideraciones Operativas |
| :--- | :--- | :--- | :--- |
| **Arquitectura CPU** | 1 vCPU (x86_64) | 2 vCPU (x86_64) | Argon2id se calibra con `p=1` para no monopolizar todos los hilos del sistema. |
| **Memoria RAM** | 1 GB | 2 GB | Configurar swap obligatoria de 2 GB (`/swapfile`) para absorber picos temporales. |
| **Almacenamiento** | 20 GB SSD | 40 GB NVMe/SSD | Almacenamiento de bases de datos PostgreSQL, logs rotados y copias de seguridad. |
| **Sistema Operativo**| Ubuntu 22.04 LTS / Debian 12 | Ubuntu 24.04 LTS / Debian 12 | Kernel 5.15+ con soporte completo para `systemd` sandbox y `cgroups v2`. |
| **Runtime Node.js**  | Node.js 20 LTS (Active) | Node.js 22 LTS (Iron) | Motor JavaScript oficial con soporte para Ed25519 nativo y OpenSSL 3.0+. |
| **Motor Base Datos** | PostgreSQL 15 | PostgreSQL 16 | Motor relacional local con transacciones ACID y extensiones estándar (`uuid-ossp`). |

---

## 2. PREPARACIÓN DEL SERVIDOR Y SEGURIDAD BASE

### 2.1 Creación de usuario de servicio sin privilegios
```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/sitecorp sitecorp
sudo mkdir -p /opt/sitecorp/services/auth-api
sudo mkdir -p /etc/sitecorp
sudo chown -R sitecorp:sitecorp /opt/sitecorp
sudo chmod 750 /opt/sitecorp
```

### 2.2 Configuración de Swap y Memoria Virtual
En un VPS con 1-2 GB de RAM, habilitar swap previene terminaciones abruptas del kernel por OOM (*Out Of Memory*):
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.d/99-sitecorp.conf
sudo sysctl --system
```

### 2.3 Cortafuegos (UFW) y Aislamiento de Puertos
**Regla inmutable**: La API Fastify (`4010`) y PostgreSQL (`5432`) NUNCA se exponen a internet; solo escuchan en `127.0.0.1`.
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH Seguro'
sudo ufw allow 80/tcp comment 'HTTP Redirection'
sudo ufw allow 443/tcp comment 'HTTPS Reverse Proxy'
sudo ufw enable
```

---

## 3. VARIABLES DE ENTORNO EN PRODUCCIÓN (`/etc/sitecorp/auth-api.env`)

El archivo debe tener permisos `600` perteneciente al usuario `sitecorp`:
```bash
sudo touch /etc/sitecorp/auth-api.env
sudo chown sitecorp:sitecorp /etc/sitecorp/auth-api.env
sudo chmod 600 /etc/sitecorp/auth-api.env
```

Contenido de referencia:
```ini
# Entorno
NODE_ENV=production
SITECORP_AUTH_ENV=production

# Red Interna (escucha exclusivamente en loopback tras Nginx)
SITECORP_HTTP_HOST=127.0.0.1
SITECORP_HTTP_PORT=4010
SITECORP_HTTP_TRUSTED_PROXIES=127.0.0.1,::1

# Orígenes Web Autorizados (solo HTTPS corporativo de SiteCorp)
SITECORP_HTTP_ALLOWED_ORIGINS=https://app.sitecorp.cu

# Base de Datos PostgreSQL
DATABASE_URL=postgresql://sitecorp_auth_admin:SECRETO_DB_SEGURO@127.0.0.1:5432/sitecorp_prod?sslmode=disable
DATABASE_POOL_MAX=10
DATABASE_IDLE_TIMEOUT_MS=30000
DATABASE_CONNECT_TIMEOUT_MS=5000

# Cookies y CSRF
SITECORP_HTTP_COOKIE_SECURE=true
SITECORP_HTTP_COOKIE_SAMESITE=Strict
SITECORP_HTTP_REFRESH_MAX_AGE_SECONDS=1209600
SITECORP_CSRF_HMAC_SECRET=CLAVE_HMAC_CSPRNG_DE_AL_MENOS_64_CARACTERES_HEX_GENERADA_LOCALMENTE
SITECORP_CSRF_TTL_SECONDS=1209600

# Concurrencia y Rate Limiting
SITECORP_ARGON2_MAX_CONCURRENT=2
SITECORP_ARGON2_MAX_QUEUE=8
SITECORP_ARGON2_QUEUE_TIMEOUT_MS=2500

# Criptografía Ed25519 (Par asimétrico generado previamente con openssl genpkey -algorithm ed25519)
SITECORP_JWT_ISSUER=urn:sitecorp:auth-api
SITECORP_JWT_AUDIENCE=urn:sitecorp:api
SITECORP_JWT_ACTIVE_KID=ed25519-prod-2026-v1
SITECORP_JWT_ACCESS_TTL_SECONDS=900
SITECORP_JWT_REQUIRE_SESSION_ID=true
SITECORP_JWT_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SITECORP_JWT_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"

# Logging Estructurado
SITECORP_LOG_LEVEL=info
SITECORP_LOG_ENABLED=true
```

---

## 4. PROCEDIMIENTO DE COMPILACIÓN E INSTALACIÓN

1. **Clonar repositorio y navegar al servicio**:
   ```bash
   cd /opt/sitecorp/services/auth-api
   ```
2. **Instalar dependencias de producción**:
   ```bash
   npm ci --omit=dev
   ```
3. **Compilar TypeScript a JavaScript estricto**:
   ```bash
   npm run build
   ```
4. **Verificar permisos del directorio**:
   ```bash
   sudo chown -R sitecorp:sitecorp /opt/sitecorp/services/auth-api
   ```

---

## 5. PROCEDIMIENTO DE MIGRACIONES VERSIONADAS

Antes de iniciar el servicio por primera vez o tras cada actualización:

1. **Comprobar estado actual de migraciones**:
   ```bash
   sudo -u sitecorp npm run db:migrate -- status
   ```
2. **Aplicar migraciones pendientes (`0001` y `0002`)**:
   ```bash
   sudo -u sitecorp npm run db:migrate -- up
   ```
   *Nota: El ejecutor adquiere `pg_advisory_xact_lock`, verifica la tabla `sitecorp_auth.schema_migrations`, comprueba los checksums SHA-256 de las migraciones previas y ejecuta el avance en una transacción ACID.*

---

## 6. BOOTSTRAP CONTROLADO DEL PRIMER ADMINISTRADOR

Por diseño, el servidor no crea administradores automáticos al iniciar. Para inicializar al primer operador con privilegios de seguridad:

1. **Crear la cuenta base del usuario** (si no existe aún en `sitecorp_auth.users`).
2. **Asegurar que el usuario no tiene cambio de clave pendiente**.
3. **Ejecutar la herramienta CLI con activación manual explícita**:
   ```bash
   sudo -u sitecorp SITECORP_ALLOW_INITIAL_ADMIN_BOOTSTRAP=true npm run admin:bootstrap -- --email admin.inicial@sitecorp.cu --confirm
   ```
   *El comando valida que no existan permisos activos previos en la base de datos (ejecución única fail-closed), asigna `security.admin`, `security.manage` y `users.manage`, y registra el evento inmutable de auditoría.*

---

## 7. GESTIÓN DEL SERVICIO SYSTEMD

1. **Copiar unidad del servicio**:
   ```bash
   sudo cp /opt/sitecorp/services/auth-api/deployment/sitecorp-auth.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable sitecorp-auth.service
   ```
2. **Iniciar y verificar estado**:
   ```bash
   sudo systemctl start sitecorp-auth.service
   sudo systemctl status sitecorp-auth.service
   ```
3. **Inspección de logs estructurados en journald**:
   ```bash
   sudo journalctl -u sitecorp-auth -f -o cat
   ```

---

## 8. CONFIGURACIÓN DEL PROXY INVERSO NGINX (HTTPS)

1. **Copiar configuración**:
   ```bash
   sudo cp /opt/sitecorp/services/auth-api/deployment/nginx-sitecorp-auth.conf /etc/nginx/sites-available/auth.sitecorp.cu.conf
   sudo ln -s /etc/nginx/sites-available/auth.sitecorp.cu.conf /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## 9. SON चुनौतीपूर्ण DE SALUD Y MONITOREO

- **Sonda de Liveness (`/health/live`)**:
  - `curl -f http://127.0.0.1:4010/health/live`
  - Responde `200 OK` si el loop de eventos y Fastify están vivos.
- **Sonda de Readiness (`/health/ready`)**:
  - `curl -f http://127.0.0.1:4010/health/ready`
  - Responde `200 OK` si la conexión a PostgreSQL está activa y el llavero Ed25519 está disponible.
  - Responde `503 Service Unavailable` si la base de datos no responde en el timeout configurado (`readinessTimeoutMs`).

---

## 10. PLAN DE RESPALDO Y RECUPERACIÓN ANTE DESASTRES

1. **Configuración de Cron diario (02:00 AM)**:
   ```bash
   sudo crontab -u sitecorp -e
   # Añadir:
   0 2 * * * /opt/sitecorp/services/auth-api/deployment/backup-restore.sh backup /var/backups/sitecorp-auth >> /var/log/sitecorp_backup.log 2>&1
   ```
2. **Restauración manual**:
   ```bash
   sudo -u sitecorp /opt/sitecorp/services/auth-api/deployment/backup-restore.sh restore /var/backups/sitecorp-auth/sitecorp_auth_YYYYMMDD_HHMMSS.sql.gz
   ```
