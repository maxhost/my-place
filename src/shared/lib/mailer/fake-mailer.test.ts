import { describe, expect, it, beforeEach, vi } from 'vitest'
import { FakeMailer } from './fake-mailer'
import type { InvitationEmailInput } from './types'

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

describe('FakeMailer', () => {
  let consoleLog: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleLog.mockClear()
  })

  it('captura cada invitation en memoria con payload y messageId', async () => {
    const mailer = new FakeMailer()
    const input = makeInput()

    const result = await mailer.sendInvitation(input)

    expect(mailer.captures).toHaveLength(1)
    const capture = mailer.captures[0]!
    expect(capture).toMatchObject({
      kind: 'invitation',
      input,
      messageId: result.id,
    })
    expect(capture.sentAt).toBeInstanceOf(Date)
    expect(result.provider).toBe('fake')
    expect(result.id).toMatch(/^fake_inv_/)
  })

  it('emite messageIds únicos aunque se envíe el mismo input dos veces', async () => {
    const mailer = new FakeMailer()
    const input = makeInput()

    const a = await mailer.sendInvitation(input)
    const b = await mailer.sendInvitation(input)

    expect(a.id).not.toBe(b.id)
    expect(mailer.captures).toHaveLength(2)
  })

  it('lastInvitation devuelve el último capturado', async () => {
    const mailer = new FakeMailer()
    expect(mailer.lastInvitation).toBeNull()

    await mailer.sendInvitation(makeInput({ to: 'first@example.com' }))
    await mailer.sendInvitation(makeInput({ to: 'second@example.com' }))

    expect(mailer.lastInvitation?.to).toBe('second@example.com')
  })

  it('reset limpia captures y contador', async () => {
    const mailer = new FakeMailer()
    await mailer.sendInvitation(makeInput())
    mailer.reset()

    expect(mailer.captures).toEqual([])
    const result = await mailer.sendInvitation(makeInput())
    // el counter reinició → id empieza desde 1 de nuevo
    expect(result.id).toMatch(/^fake_inv_1_/)
  })

  it('loguea el URL a stdout para que el dev pueda copiarlo', async () => {
    const mailer = new FakeMailer()
    const input = makeInput({ inviteUrl: 'https://example.com/invite/xyz' })

    await mailer.sendInvitation(input)

    // No asertamos count total porque vitest o pino pueden escribir a console en
    // paralelo; solo que exista una llamada con nuestro payload.
    const matching = consoleLog.mock.calls.find(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('[FakeMailer]'),
    )
    expect(matching).toBeDefined()
    const logged = matching![0] as string
    expect(logged).toContain('https://example.com/invite/xyz')
    expect(logged).toContain(input.to)
    expect(logged).toContain(input.placeName)
  })
})
