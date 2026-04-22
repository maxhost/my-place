/**
 * Interfaz pública del mailer. Abstracción pensada para que el código de feature
 * no dependa de Resend directamente; esto habilita testing con `FakeMailer` y
 * una eventual migración de proveedor (SES, Postmark, etc.) sin tocar actions.
 *
 * Decisión de diseño: un método por tipo de email (en vez de un único
 * `send(template, data)` genérico). La ventaja: el llamador tiene tipos
 * estrictos en el payload y el template queda acoplado al sender — imposible
 * mandar "invitación" con datos de "welcome".
 *
 * Cuando aparezcan más templates (welcome, digest), agregar métodos hermanos.
 */

export interface InvitationEmailInput {
  to: string
  placeName: string
  placeSlug: string
  inviterDisplayName: string
  inviteUrl: string
  expiresAt: Date
}

export interface SendResult {
  /**
   * ID del mensaje devuelto por el provider. En Resend es un UUID; en
   * `FakeMailer` es un id sintético determinístico. Persistido en
   * `Invitation.providerMessageId` para correlacionar con webhooks.
   */
  id: string
  provider: 'resend' | 'fake'
}

export interface Mailer {
  sendInvitation(input: InvitationEmailInput): Promise<SendResult>
}
