/**
 * Capa de Infraestructura - SiteCorp Auth API
 *
 * Contendrá en fases posteriores los adaptadores concretos:
 * - Persistencia PostgreSQL (esquema sitecorp_auth)
 * - Hashers criptográficos (Argon2id y bcrypt)
 * - Servicio de tokens JWT (RFC 7519 vía Jose)
 * - Transporte SMTP (Nodemailer)
 * - Controladores HTTP REST
 *
 * En la Fase 4D esta capa permanece sin conexiones externas ni persistencia activa.
 */

export const INFRASTRUCTURE_LAYER_STATUS = "INITIALIZED_ISOLATED" as const;
