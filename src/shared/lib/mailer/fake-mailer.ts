import type { Mailer, InvitationEmailInput, SendResult } from './types'

/**
 * Mailer que captura los envíos en memoria en vez de mandarlos. Usos:
 *
 * 1. Tests: inyectable vía `setMailer(new FakeMailer())` en `provider.ts`.
 *    Las aserciones leen `.captures` y verifican payload.
 * 2. Dev local sin `RESEND_API_KEY`: el factory lo devuelve por default,
 *    loguea la URL de la invitación a stdout para que el dev copy-pastee
 *    sin necesitar cuenta de Resend para probar el flow.
 *
 * No es un mock a medias: implementa la misma interfaz `Mailer` y retorna
 * `SendResult` con un id sintético determinístico (útil para correlacionar
 * con webhooks fake en tests end-to-end futuros).
 */
export class FakeMailer implements Mailer {
  readonly captures: Array<{
    kind: 'invitation'
    input: InvitationEmailInput
    messageId: string
    sentAt: Date
  }> = []

  private counter = 0

  async sendInvitation(input: InvitationEmailInput): Promise<SendResult> {
    this.counter += 1
    const messageId = `fake_inv_${this.counter.toString(36)}_${Date.now().toString(36)}`
    this.captures.push({
      kind: 'invitation',
      input,
      messageId,
      sentAt: new Date(),
    })

    // Stdout visible para dev — no usar `logger` porque puede redactarse el URL
    // o silenciarse por log-level. El objetivo acá es *copiar el URL del terminal*.
    console.log(
      `[FakeMailer] invitation to ${input.to} (${input.placeName})\n  URL: ${input.inviteUrl}`,
    )

    return { id: messageId, provider: 'fake' }
  }

  /** Limpia los captures. Usar en `beforeEach` de los tests. */
  reset(): void {
    this.captures.length = 0
    this.counter = 0
  }

  /** Último email capturado o null. Conveniente para aserciones. */
  get lastInvitation(): InvitationEmailInput | null {
    for (let i = this.captures.length - 1; i >= 0; i -= 1) {
      const capture = this.captures[i]
      if (capture && capture.kind === 'invitation') return capture.input
    }
    return null
  }
}
