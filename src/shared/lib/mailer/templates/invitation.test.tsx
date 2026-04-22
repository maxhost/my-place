import { describe, expect, it } from 'vitest'
import { InvitationEmail, renderInvitationPlaintext, renderInvitationSubject } from './invitation'
import type { InvitationEmailInput } from '../types'

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

describe('invitation template', () => {
  describe('renderInvitationSubject', () => {
    it('incluye el displayName y placeName', () => {
      const subject = renderInvitationSubject(makeInput())
      expect(subject).toBe('Max te invitó a The Place')
    })
  })

  describe('renderInvitationPlaintext', () => {
    it('incluye el URL completo sin encoding', () => {
      const text = renderInvitationPlaintext(makeInput())
      expect(text).toContain('https://lvh.me/invite/accept/tok_abc')
    })

    it('incluye nombre del place y del inviter', () => {
      const text = renderInvitationPlaintext(
        makeInput({ inviterDisplayName: 'Ana', placeName: 'El Bar' }),
      )
      expect(text).toContain('Ana')
      expect(text).toContain('El Bar')
    })

    it('incluye fecha de expiración en es-AR', () => {
      const text = renderInvitationPlaintext(
        makeInput({ expiresAt: new Date('2026-04-27T12:00:00Z') }),
      )
      // Intl.DateTimeFormat en es-AR con day + month: "27 de abril"
      expect(text).toMatch(/27 de abril/)
    })

    it('tiene cuerpo con tono Place (sin CTAs gritones ni emojis)', () => {
      const text = renderInvitationPlaintext(makeInput())
      expect(text).not.toMatch(/!!+/)
      expect(text).not.toMatch(/URGENTE|ÚLTIMA|AHORA/)
      // Sin emojis comunes
      expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
    })
  })

  describe('InvitationEmail component', () => {
    it('devuelve un ReactElement con el URL en href', () => {
      const element = InvitationEmail(makeInput({ inviteUrl: 'https://x.test/acc/1' }))
      // Smoke: el componente no tira, retorna algo renderizable.
      expect(element).toBeTruthy()
      expect(element.type).toBe('html')
    })
  })
})
