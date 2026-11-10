/**
 * Contrato formal de envío de correos transaccionales (SMTP) para SiteCorp.
 *
 * Reglas estrictas de seguridad (Fase 4G.7):
 * 1. Prohibido enviar contraseñas en claro, temporales o hashes por correo electrónico.
 * 2. Los enlaces de activación y recuperación utilizan exclusivamente tokens de un solo uso con caducidad.
 * 3. Ningún token crudo ni secreto SMTP debe registrarse en logs.
 */

export type TransactionalEmailCategory =
  | "account_activation"
  | "password_recovery"
  | "company_invitation";

export interface SendActivationEmailInput {
  readonly toEmail: string;
  readonly recipientName?: string;
  readonly rawToken: string;
  readonly expiresAt: Date;
  readonly companyName?: string;
}

export interface SendPasswordRecoveryEmailInput {
  readonly toEmail: string;
  readonly recipientName?: string;
  readonly rawToken: string;
  readonly expiresAt: Date;
}

export interface SendCompanyInvitationEmailInput {
  readonly toEmail: string;
  readonly recipientName?: string;
  readonly companyName: string;
  readonly roleCode: string;
  readonly rawInvitationToken: string;
  readonly expiresAt: Date;
}

export interface TransactionalEmailDeliveryReceipt {
  readonly messageId: string;
  readonly category: TransactionalEmailCategory;
  readonly recipientEmail: string;
  readonly accepted: boolean;
  readonly sentAt: string;
  readonly transportMode: "smtp_live" | "smtp_controlled";
}

export interface ITransactionalEmailService {
  sendActivationEmail(
    input: SendActivationEmailInput
  ): Promise<TransactionalEmailDeliveryReceipt>;

  sendPasswordRecoveryEmail(
    input: SendPasswordRecoveryEmailInput
  ): Promise<TransactionalEmailDeliveryReceipt>;

  sendCompanyInvitationEmail(
    input: SendCompanyInvitationEmailInput
  ): Promise<TransactionalEmailDeliveryReceipt>;
}
