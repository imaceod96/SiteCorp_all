import { createHash, randomUUID } from "node:crypto";
import * as net from "node:net";
import * as tls from "node:tls";
import {
  ITransactionalEmailService,
  SendActivationEmailInput,
  SendCompanyInvitationEmailInput,
  SendPasswordRecoveryEmailInput,
  TransactionalEmailCategory,
  TransactionalEmailDeliveryReceipt,
} from "../../interfaces";

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly appPublicUrl: string;
  readonly transportMode: "smtp_live" | "smtp_controlled";
  readonly connectionTimeoutMs?: number;
}

export class EmailSecurityPolicyViolationError extends Error {
  public readonly code = "EMAIL_SECURITY_POLICY_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "EmailSecurityPolicyViolationError";
  }
}

export interface SmtpWireMessage {
  readonly messageId: string;
  readonly category: TransactionalEmailCategory;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly toEmail: string;
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string;
  readonly tokenSha256Fingerprint: string;
  readonly expiresAtIso: string;
}

export interface ISmtpWireTransport {
  readonly mode: "smtp_live" | "smtp_controlled";
  sendMail(message: SmtpWireMessage): Promise<{ accepted: boolean; sentAt: string }>;
}

/**
 * Transporte SMTP controlado en memoria para pruebas automatizadas y entornos aislados.
 * No envía correos reales al exterior y permite verificar plantillas, destinatarios
 * y ausencia de contraseñas o fugas en logs.
 */
export class ControlledSmtpTransport implements ISmtpWireTransport {
  public readonly mode = "smtp_controlled" as const;
  private readonly outbox: SmtpWireMessage[] = [];

  async sendMail(
    message: SmtpWireMessage
  ): Promise<{ accepted: boolean; sentAt: string }> {
    this.outbox.push(Object.freeze({ ...message }));
    return {
      accepted: true,
      sentAt: new Date().toISOString(),
    };
  }

  /**
   * Devuelve los mensajes capturados en memoria exclusivamente para aserciones de test.
   */
  public getCapturedMessages(): readonly SmtpWireMessage[] {
    return [...this.outbox];
  }

  /**
   * Devuelve metadatos auditables redactando cualquier URL o token de un solo uso.
   */
  public getSanitizedAuditLog(): readonly {
    messageId: string;
    category: TransactionalEmailCategory;
    toEmail: string;
    subject: string;
    tokenSha256Fingerprint: string;
    expiresAtIso: string;
  }[] {
    return this.outbox.map((m) => ({
      messageId: m.messageId,
      category: m.category,
      toEmail: m.toEmail,
      subject: m.subject,
      tokenSha256Fingerprint: m.tokenSha256Fingerprint,
      expiresAtIso: m.expiresAtIso,
    }));
  }

  public clear(): void {
    this.outbox.length = 0;
  }
}

/**
 * Transporte SMTP real sobre TCP/TLS configurable por variables de entorno.
 */
export class TcpSmtpTransport implements ISmtpWireTransport {
  public readonly mode = "smtp_live" as const;

  constructor(private readonly config: SmtpConfig) {}

  async sendMail(
    message: SmtpWireMessage
  ): Promise<{ accepted: boolean; sentAt: string }> {
    const timeoutMs = this.config.connectionTimeoutMs ?? 10_000;

    return new Promise((resolve, reject) => {
      const socket = this.config.secure
        ? tls.connect({
            host: this.config.host,
            port: this.config.port,
            servername: this.config.host,
          })
        : net.createConnection({
            host: this.config.host,
            port: this.config.port,
          });

      let step = 0;
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        if (err) {
          reject(err);
        } else {
          resolve({ accepted: true, sentAt: new Date().toISOString() });
        }
      };

      socket.setTimeout(timeoutMs, () => {
        finish(new Error("SMTP connection timed out"));
      });

      socket.on("error", (err) => finish(err));

      const writeLine = (line: string) => {
        socket.write(`${line}\r\n`);
      };

      socket.on("data", (chunk) => {
        const resp = chunk.toString("utf8");
        const code = parseInt(resp.slice(0, 3), 10);
        if (Number.isNaN(code) || code >= 400) {
          finish(new Error(`SMTP server rejected operation with code ${code}`));
          return;
        }

        if (step === 0 && code === 220) {
          step = 1;
          writeLine(`EHLO sitecorp.local`);
        } else if (step === 1 && code === 250) {
          if (this.config.user && this.config.password) {
            step = 2;
            const authToken = Buffer.from(
              `\u0000${this.config.user}\u0000${this.config.password}`,
              "utf8"
            ).toString("base64");
            writeLine(`AUTH PLAIN ${authToken}`);
          } else {
            step = 3;
            writeLine(`MAIL FROM:<${message.fromEmail}>`);
          }
        } else if (step === 2 && code === 235) {
          step = 3;
          writeLine(`MAIL FROM:<${message.fromEmail}>`);
        } else if (step === 3 && code === 250) {
          step = 4;
          writeLine(`RCPT TO:<${message.toEmail}>`);
        } else if (step === 4 && code === 250) {
          step = 5;
          writeLine(`DATA`);
        } else if (step === 5 && code === 354) {
          step = 6;
          const mime = [
            `Message-ID: <${message.messageId}>`,
            `From: "${message.fromName}" <${message.fromEmail}>`,
            `To: <${message.toEmail}>`,
            `Subject: ${message.subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=UTF-8`,
            ``,
            message.htmlBody,
            `.`,
          ].join("\r\n");
          writeLine(mime);
        } else if (step === 6 && code === 250) {
          step = 7;
          writeLine(`QUIT`);
          finish();
        }
      });
    });
  }
}

export function loadSmtpConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SmtpConfig {
  const host = (env.SMTP_HOST ?? "127.0.0.1").trim();
  const port = parseInt(env.SMTP_PORT ?? "587", 10);
  const secure = (env.SMTP_SECURE ?? "false").trim().toLowerCase() === "true";
  const user = env.SMTP_USER?.trim() || undefined;
  const password = env.SMTP_PASSWORD || undefined;
  const fromEmail = (env.SMTP_FROM_EMAIL ?? "no-reply@sitecorp.local").trim();
  const fromName = (env.SMTP_FROM_NAME ?? "SiteCorp Seguridad").trim();
  const appPublicUrl = (
    env.APP_PUBLIC_URL ??
    env.VITE_APP_URL ??
    "https://app.sitecorp.local"
  )
    .trim()
    .replace(/\/+$/, "");

  const rawMode = (env.SMTP_TRANSPORT_MODE ?? "smtp_controlled")
    .trim()
    .toLowerCase();
  const transportMode =
    rawMode === "smtp_live" ? "smtp_live" : "smtp_controlled";

  return Object.freeze({
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    user,
    password,
    fromEmail,
    fromName,
    appPublicUrl,
    transportMode,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertNoPasswordInEmailContent(
  subject: string,
  textBody: string,
  htmlBody: string
): void {
  const combined = `${subject}\n${textBody}\n${htmlBody}`;
  const forbiddenPatterns = [
    /\$argon2id\$/i,
    /contrase[ñn]a\s+temporal\s*:/i,
    /temporary\s+password\s*:/i,
    /initialpassword/i,
    /clave\s+temporal\s+es/i,
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(combined)) {
      throw new EmailSecurityPolicyViolationError(
        "Política de seguridad violada: está estrictamente prohibido enviar contraseñas o hashes por correo electrónico."
      );
    }
  }
}

function validateRawSingleUseToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  if (trimmed.length < 16 || trimmed.length > 256) {
    throw new EmailSecurityPolicyViolationError(
      "El token de enlace transaccional debe tener entre 16 y 256 caracteres."
    );
  }
  if (/^\$argon2/i.test(trimmed)) {
    throw new EmailSecurityPolicyViolationError(
      "Política de seguridad violada: se intentó incluir un hash de contraseña como token de correo."
    );
  }
  return trimmed;
}

/**
 * Servicio autónomo de correo transaccional (SMTP) para activación de cuentas,
 * recuperación de contraseñas e invitaciones multiempresa.
 *
 * Cumple con los requisitos de Fase 4G.7:
 * - Configurado por variables de entorno.
 * - Utiliza exclusivamente enlaces de un solo uso con caducidad.
 * - Prohibición total de enviar contraseñas por correo electrónico.
 * - Ningún token crudo ni secreto SMTP se expone en logs ni en recibos de entrega.
 */
export class SmtpTransactionalEmailService
  implements ITransactionalEmailService
{
  private readonly transport: ISmtpWireTransport;

  constructor(
    private readonly config: SmtpConfig = loadSmtpConfigFromEnv(),
    transport?: ISmtpWireTransport
  ) {
    this.transport =
      transport ??
      (config.transportMode === "smtp_live"
        ? new TcpSmtpTransport(config)
        : new ControlledSmtpTransport());
  }

  public getTransport(): ISmtpWireTransport {
    return this.transport;
  }

  async sendActivationEmail(
    input: SendActivationEmailInput
  ): Promise<TransactionalEmailDeliveryReceipt> {
    const token = validateRawSingleUseToken(input.rawToken);
    const toEmail = input.toEmail.trim().toLowerCase();
    const recipientName = input.recipientName?.trim() || toEmail;
    const companyLabel = input.companyName?.trim() || "SiteCorp";
    const expiresIso = input.expiresAt.toISOString();

    const activationUrl = `${this.config.appPublicUrl}/activate?token=${encodeURIComponent(token)}`;
    const subject = `Activación de cuenta en ${companyLabel}`;

    const textBody = [
      `Hola ${recipientName},`,
      ``,
      `Se ha preparado tu cuenta en ${companyLabel}.`,
      `Por seguridad, SiteCorp nunca envía contraseñas por correo electrónico.`,
      `Para activar tu cuenta y definir tu contraseña personal, utiliza este enlace de un solo uso:`,
      `${activationUrl}`,
      ``,
      `Este enlace caduca el ${expiresIso} y quedará invalidado tras su primer uso.`,
    ].join("\n");

    const htmlBody = [
      `<!DOCTYPE html><html><body>`,
      `<p>Hola <strong>${escapeHtml(recipientName)}</strong>,</p>`,
      `<p>Se ha preparado tu cuenta en <strong>${escapeHtml(companyLabel)}</strong>.</p>`,
      `<p>Por seguridad, SiteCorp nunca envía contraseñas por correo electrónico. Para activar tu cuenta y definir tu contraseña personal, accede al siguiente enlace de un solo uso:</p>`,
      `<p><a href="${escapeHtml(activationUrl)}">Activar cuenta en SiteCorp</a></p>`,
      `<p><small>Este enlace caduca el ${escapeHtml(expiresIso)} y solo puede utilizarse una vez.</small></p>`,
      `</body></html>`,
    ].join("");

    assertNoPasswordInEmailContent(subject, textBody, htmlBody);

    return this.dispatchMessage({
      category: "account_activation",
      toEmail,
      subject,
      textBody,
      htmlBody,
      rawToken: token,
      expiresAtIso: expiresIso,
    });
  }

  async sendPasswordRecoveryEmail(
    input: SendPasswordRecoveryEmailInput
  ): Promise<TransactionalEmailDeliveryReceipt> {
    const token = validateRawSingleUseToken(input.rawToken);
    const toEmail = input.toEmail.trim().toLowerCase();
    const recipientName = input.recipientName?.trim() || toEmail;
    const expiresIso = input.expiresAt.toISOString();

    const recoveryUrl = `${this.config.appPublicUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const subject = `Restablecimiento de contraseña en SiteCorp`;

    const textBody = [
      `Hola ${recipientName},`,
      ``,
      `Hemos recibido una solicitud para restablecer tu contraseña en SiteCorp.`,
      `Por seguridad, nunca enviamos contraseñas por correo electrónico.`,
      `Para establecer una nueva contraseña, abre este enlace de un solo uso:`,
      `${recoveryUrl}`,
      ``,
      `Este enlace caduca el ${expiresIso} y quedará invalidado tras su primer uso.`,
    ].join("\n");

    const htmlBody = [
      `<!DOCTYPE html><html><body>`,
      `<p>Hola <strong>${escapeHtml(recipientName)}</strong>,</p>`,
      `<p>Hemos recibido una solicitud para restablecer tu contraseña en SiteCorp.</p>`,
      `<p>Para establecer una nueva contraseña de forma segura, utiliza este enlace de un solo uso:</p>`,
      `<p><a href="${escapeHtml(recoveryUrl)}">Restablecer contraseña</a></p>`,
      `<p><small>Este enlace caduca el ${escapeHtml(expiresIso)} y solo puede utilizarse una vez.</small></p>`,
      `</body></html>`,
    ].join("");

    assertNoPasswordInEmailContent(subject, textBody, htmlBody);

    return this.dispatchMessage({
      category: "password_recovery",
      toEmail,
      subject,
      textBody,
      htmlBody,
      rawToken: token,
      expiresAtIso: expiresIso,
    });
  }

  async sendCompanyInvitationEmail(
    input: SendCompanyInvitationEmailInput
  ): Promise<TransactionalEmailDeliveryReceipt> {
    const token = validateRawSingleUseToken(input.rawInvitationToken);
    const toEmail = input.toEmail.trim().toLowerCase();
    const recipientName = input.recipientName?.trim() || toEmail;
    const companyName = input.companyName.trim();
    const roleCode = input.roleCode.trim();
    const expiresIso = input.expiresAt.toISOString();

    const acceptUrl = `${this.config.appPublicUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
    const subject = `Invitación a ${companyName} en SiteCorp`;

    const textBody = [
      `Hola ${recipientName},`,
      ``,
      `Has sido invitado a unirte a ${companyName} con el rol '${roleCode}' en SiteCorp.`,
      `Para aceptar la invitación mediante este enlace único, accede a:`,
      `${acceptUrl}`,
      ``,
      `Este enlace caduca el ${expiresIso}.`,
    ].join("\n");

    const htmlBody = [
      `<!DOCTYPE html><html><body>`,
      `<p>Hola <strong>${escapeHtml(recipientName)}</strong>,</p>`,
      `<p>Has sido invitado a unirte a <strong>${escapeHtml(companyName)}</strong> con el rol <code>${escapeHtml(roleCode)}</code> en SiteCorp.</p>`,
      `<p><a href="${escapeHtml(acceptUrl)}">Aceptar invitación</a></p>`,
      `<p><small>Este enlace caduca el ${escapeHtml(expiresIso)}.</small></p>`,
      `</body></html>`,
    ].join("");

    assertNoPasswordInEmailContent(subject, textBody, htmlBody);

    return this.dispatchMessage({
      category: "company_invitation",
      toEmail,
      subject,
      textBody,
      htmlBody,
      rawToken: token,
      expiresAtIso: expiresIso,
    });
  }

  private async dispatchMessage(params: {
    category: TransactionalEmailCategory;
    toEmail: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    rawToken: string;
    expiresAtIso: string;
  }): Promise<TransactionalEmailDeliveryReceipt> {
    const messageId = `${randomUUID()}@sitecorp.local`;
    const tokenSha256Fingerprint = createHash("sha256")
      .update(params.rawToken, "utf8")
      .digest("hex");

    const result = await this.transport.sendMail({
      messageId,
      category: params.category,
      fromEmail: this.config.fromEmail,
      fromName: this.config.fromName,
      toEmail: params.toEmail,
      subject: params.subject,
      textBody: params.textBody,
      htmlBody: params.htmlBody,
      tokenSha256Fingerprint,
      expiresAtIso: params.expiresAtIso,
    });

    return Object.freeze({
      messageId,
      category: params.category,
      recipientEmail: params.toEmail,
      accepted: result.accepted,
      sentAt: result.sentAt,
      transportMode: this.transport.mode,
    });
  }
}
