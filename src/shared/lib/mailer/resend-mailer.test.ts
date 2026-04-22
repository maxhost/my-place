import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { InvitationEmailInput } from './types'

// Mock del SDK: capturamos las llamadas y controlamos la respuesta.
// Definimos una clase en vez de `vi.fn().mockImplementation` porque el consumer
// usa `new Resend(...)` — las factory functions de vi.fn no son construibles.
const sendMock = vi.fn()
vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: sendMock }
    constructor(_apiKey: string) {}
  },
}))

// Import DESPUÉS del mock para que ResendMailer instancie el `Resend` mockeado.
import { ResendMailer } from './resend-mailer'

function makeInput(overrides: Partial<InvitationEmailInput> = {}): InvitationEmailInput {
  return {
    to: 'maria@example.com',
    placeName: 'The Place',
    placeSlug: 'the-place',
    inviterDisplayName: 'Max',
    inviteUrl: 'https://lvh.me/invite/accept/tok_abc',
    expiresAt: new Date('2026-04-27T12:00:00Z'),
    ...overrides,
  }
}

describe('ResendMailer', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('envía con el from configurado y todas las piezas del email', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_abc123' }, error: null })
    const mailer = new ResendMailer({
      apiKey: 're_testkey_123',
      from: 'Place <hola@ogas.ar>',
    })

    const result = await mailer.sendInvitation(makeInput())

    expect(sendMock).toHaveBeenCalledTimes(1)
    const payload = sendMock.mock.calls[0]![0]
    expect(payload.from).toBe('Place <hola@ogas.ar>')
    expect(payload.to).toBe('maria@example.com')
    expect(payload.subject).toContain('Max')
    expect(payload.subject).toContain('The Place')
    expect(payload.text).toContain('https://lvh.me/invite/accept/tok_abc')
    expect(payload.text).toContain('The Place')
    // `react` es un ReactElement; no igualamos su contenido, solo existencia.
    expect(payload.react).toBeDefined()
    expect(result).toEqual({ id: 'msg_abc123', provider: 'resend' })
  })

  it('no setea reply_to (MVP sin buzón atendido)', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_x' }, error: null })
    const mailer = new ResendMailer({ apiKey: 're_k', from: 'a@b.com' })

    await mailer.sendInvitation(makeInput())

    const payload = sendMock.mock.calls[0]![0]
    expect(payload.reply_to).toBeUndefined()
    expect(payload.replyTo).toBeUndefined()
  })

  it('tira Error con mensaje del proveedor cuando Resend devuelve error', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'The <from> domain is not verified' },
    })
    const mailer = new ResendMailer({ apiKey: 're_k', from: 'a@unverified.com' })

    await expect(mailer.sendInvitation(makeInput())).rejects.toThrow(/validation_error/)
    await expect(mailer.sendInvitation(makeInput())).rejects.toThrow(/not verified/)
  })

  it('tira si Resend devuelve data=null y error=null (contrato raro pero posible)', async () => {
    sendMock.mockResolvedValue({ data: null, error: null })
    const mailer = new ResendMailer({ apiKey: 're_k', from: 'a@b.com' })

    await expect(mailer.sendInvitation(makeInput())).rejects.toThrow(/no data/)
  })
})
