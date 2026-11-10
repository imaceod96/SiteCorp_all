# SiteCorp — Ejecución Local en macOS (Apple Silicon) con Docker Desktop

Este repositorio (rama `loing`) está configurado para ejecutar **SiteCorp en modo 100 % autónomo (`self_hosted`)** en macOS Apple Silicon (`M1` / `M2` / `M3` / `M4`) mediante **Docker Compose**, utilizando **PostgreSQL 16**, el backend propio **Fastify v5 (`@sitecorp/auth-api`)**, almacenamiento local persistente, servidor SMTP local de pruebas (**Mailpit**) y el frontend **React + Vite**, sin realizar ninguna petición a Supabase Cloud.

---

## 1. Arquitectura de Servicios en Docker Compose

| Servicio | Contenedor | Imagen / Base (Multi-Arch `linux/arm64`) | Puerto Local | Función |
| :--- | :--- | :--- | :--- | :--- |
| **`frontend`** | `sitecorp-frontend` | `node:20-alpine` (Vite + Proxy `/api`) | `http://localhost:3000` | Interfaz web React en modo `self_hosted`. Redirige `/api/*` y `/health/*` en el mismo origen hacia `http://auth-api:4010`. |
| **`auth-api`** | `sitecorp-auth-api` | `node:20-alpine` (Fastify v5 + Argon2id + Ed25519) | `http://localhost:4010` | Backend autónomo de autenticación, autorización multiempresa, pasarela SQL/RPC/Edge y Storage local. |
| **`postgres`** | `sitecorp-postgres` | `postgres:16-alpine` | `localhost:5432` | Base de datos relacional PostgreSQL 16 con esquemas `sitecorp_auth` y `public` (migraciones `0001`–`0006`). |
| **`mailpit`** | `sitecorp-mailpit` | `axllent/mailpit:latest` | Web UI: `http://localhost:8025`<br>SMTP: `localhost:1025` | Servidor SMTP local de pruebas para capturar correos de recuperación de contraseña, activación e invitaciones. |

### Persistencia de Datos (Volúmenes Nombrados)
- **`sitecorp_postgres_data`**: conserva todos los datos de PostgreSQL 16 (`/var/lib/postgresql/data`) entre reinicios.
- **`sitecorp_storage_data`**: conserva todos los archivos subidos a los buckets privados (`avatars`, `documents`, `worker_documents`, etc.) y el par de claves de desarrollo Ed25519 generado automáticamente en el primer arranque (`/var/lib/sitecorp/storage`).

---

## 2. Requisitos Previos en tu Mac

1. **Docker Desktop para Mac (Apple Silicon)** instalado y en ejecución.
2. **Git** instalado.
3. Puertos locales `3000`, `4010`, `5432`, `1025` y `8025` libres (o personalizables mediante un archivo `.env` a partir de `.env.docker.example`).

---

## 3. Paso a Paso para Arrancar SiteCorp en tu Mac

### Paso 1: Clonar el repositorio en la rama `loing`

```bash
git clone -b loing https://github.com/imaceod96/SiteCorp_all.git
cd SiteCorp_all
```

*(Opcional)* Si deseas personalizar puertos o variables locales, copia la plantilla de ejemplo:

```bash
cp .env.docker.example .env
```

> **Nota sobre claves Ed25519 y CSRF en desarrollo local:** No necesitas generar manualmente claves PEM para probar en tu Mac. En modo `development` (`SITECORP_AUTO_GENERATE_DEV_KEYS=true`), el contenedor `auth-api` genera automáticamente en su primer arranque un par de claves asimétricas Ed25519 y un secreto HMAC-SHA256 de 32 bytes para CSRF, guardándolos en el volumen persistente `sitecorp_storage_data` sin exponer ningún secreto en Git.

---

### Paso 2: Construir y levantar todos los contenedores

```bash
docker compose up -d --build
```

Al iniciar:
1. `sitecorp-postgres` arranca PostgreSQL 16 y supera su chequeo de salud (`pg_isready`).
2. `sitecorp-auth-api` aplica automáticamente de forma transaccional e idempotente las **6 migraciones (`0001` a `0006`)** (`SITECORP_AUTO_MIGRATE=true`) y expone la API en el puerto `4010`.
3. `sitecorp-frontend` levanta el servidor en **`http://localhost:3000`** con proxy integrado `/api` -> `http://auth-api:4010`.

Puedes verificar que todos los contenedores estén saludables (`healthy` / `running`) con:

```bash
docker compose ps
```

---

### Paso 3: Crear el Administrador Local de Prueba (`admin:bootstrap`)

Por seguridad, el sistema **no incluye usuarios ni contraseñas predeterminadas inseguras**. Para crear tu primer superadministrador de plataforma en PostgreSQL 16 con una contraseña fuerte generada criptográficamente (que se mostrará una sola vez en tu terminal):

```bash
docker compose exec auth-api npm run admin:bootstrap -- \
  --email admin@sitecorp.local \
  --generate-password \
  --confirm
```

O bien, si prefieres definir tú mismo la contraseña (debe tener al menos 12 caracteres, mayúscula, minúscula, número y símbolo):

```bash
docker compose exec auth-api npm run admin:bootstrap -- \
  --email admin@sitecorp.local \
  --password 'TuClaveSegura#2026!' \
  --confirm
```

Este comando:
1. Crea el usuario activo en `sitecorp_auth.users` y almacena su hash **Argon2id** en `sitecorp_auth.user_credentials`.
2. Sincroniza su perfil activo en `public.profiles` y su estado en `public.user_password_lifecycle`.
3. Le otorga los permisos de operador de plataforma (`users.manage`, `security.manage`, `security.admin`) y bloquea futuras ejecuciones del bootstrap inicial.

---

### Paso 4: Abrir SiteCorp en el navegador

1. Abre **`http://localhost:3000`** en Safari, Chrome o Firefox en tu Mac.
2. Inicia sesión con el correo (`admin@sitecorp.local`) y la contraseña obtenida en el Paso 3.
3. Para inspeccionar correos enviados por el sistema (invitaciones o recuperación de contraseña), abre la interfaz web de **Mailpit** en **`http://localhost:8025`**.

---

## 4. Comandos Útiles de Operación en Mac

### Consultar logs en tiempo real

```bash
# Logs de todos los servicios
docker compose logs -f

# Logs únicamente del backend Fastify (auth-api)
docker compose logs -f auth-api

# Logs del frontend
docker compose logs -f frontend
```

### Verificar estado de las migraciones en PostgreSQL 16

```bash
docker compose exec auth-api npm run db:migrate -- status
```

### Detener los contenedores conservando todos los datos

```bash
docker compose stop
```
*(O `docker compose down` sin `-v`: detiene y elimina los contenedores de red, pero **conserva intactos** los volúmenes `sitecorp_postgres_data` y `sitecorp_storage_data`).*

### Reiniciar desde cero borrando los datos locales (solo si deseas limpiar la base de datos)

```bash
docker compose down -v
```

---

## 5. Ejecución Local Híbrida (Sin contenedor de Frontend/Backend)

Si en algún momento deseas correr el frontend y `auth-api` directamente con Node.js en tu Mac contra el contenedor de PostgreSQL 16:

1. Levanta únicamente PostgreSQL y Mailpit:
   ```bash
   docker compose up -d postgres mailpit
   ```
2. Ejecuta migraciones y bootstrap en `services/auth-api`:
   ```bash
   DATABASE_URL="postgresql://sitecorp:sitecorp_local_dev_only@127.0.0.1:5432/sitecorp" \
     npm --prefix services/auth-api run db:migrate

   DATABASE_URL="postgresql://sitecorp:sitecorp_local_dev_only@127.0.0.1:5432/sitecorp" \
   SITECORP_ALLOW_INITIAL_ADMIN_BOOTSTRAP=true \
     npm --prefix services/auth-api run admin:bootstrap -- --email admin@sitecorp.local --generate-password --confirm
   ```
3. Arranca `auth-api` en el puerto `4010`:
   ```bash
   DATABASE_URL="postgresql://sitecorp:sitecorp_local_dev_only@127.0.0.1:5432/sitecorp" \
   SITECORP_AUTH_ENV=development \
   SITECORP_AUTO_GENERATE_DEV_KEYS=true \
   SITECORP_HTTP_ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000" \
   SITECORP_HTTP_COOKIE_SECURE=false \
   SITECORP_HTTP_COOKIE_SAMESITE=Lax \
     npm --prefix services/auth-api run dev
   ```
4. En otra terminal, arranca el frontend en el puerto `3000`:
   ```bash
   VITE_AUTH_PROVIDER=self_hosted VITE_AUTH_API_URL=http://localhost:3000 npm run dev
   ```
