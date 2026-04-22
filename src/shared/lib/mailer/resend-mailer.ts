import 'server-only'
import { Resend } from 'resend'
import type { Mailer, InvitationEmailInput, SendResult } from './types'
import {
  InvitationEmail,
  renderInvitationPlaintext,
  renderInvitationSubject,
} from './templates/invitation'

/**
 * Mailer de producción. Wrappea Resend SDK.
 *
 * Notas:
 * - `react` y `text` se envían en paralelo. Resend auto-renderiza el React
 *   element a HTML usando `@react-email/render` internamente.
 * - `reply_to` deliberadamente NO se setea (decisión del user — MVP sin
 *   buzón atendido). Respuestas caen al `From` silenciosamente.
 * - En caso de error, se lanza `Error` plano con el mensaje de Resend. El
 *   caller (members action) lo envuelve en `InvitationEmailFailedError` para
 *   la UI — mantenemos el mailer agnóstico de `DomainError`.
 */
export class ResendMailer implements Mailer {
  private readonly client: Resend
  private readonly from: string

  constructor(params: { apiKey: string; from: string }) {
    this.client = new Resend(params.apiKey)
    this.from = params.from
  }

  async sendInvitation(input: InvitationEmailInput): Promise<SendResult> {
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: input.to,
      subject: renderInvitationSubject(input),
      react: InvitationEmail(input),
      text: renderInvitationPlaintext(input),
    })

    if (error) {
      throw new Error(`[resend] ${error.name ?? 'error'}: ${error.message ?? 'unknown'}`, {
        cause: error,
      })
    }
    if (!data) {
      throw new Error('[resend] send returned no data and no error')
    }
    return { id: data.id, provider: 'resend' }
  }
}
