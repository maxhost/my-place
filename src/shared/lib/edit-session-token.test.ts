import { describe, expect, it, vi } from 'vitest'

let currentSecret: string | undefined = 'x'.repeat(48) + 'unit-test-secret'

vi.mock('@/shared/config/env', () => ({
  serverEnv: new Proxy({} as Record<string, unknown>, {
    get(_, prop: string) {
      if (prop === 'APP_EDIT_SESSION_SECRET') return currentSecret
      return undefined
    },
  }),
}))

import {
  EDIT_SESSION_GRACE_MS,
  EditSessionInvalid,
  assertEditSessionToken,
  signEditSessionToken,
  type EditSessionPayload,
} from './edit-session-token'

describe('edit-session-token', () => {
  const basePayload: EditSessionPayload = {
    subjectType: 'POST',
    subjectId: 'post-1',
    userId: 'user-1',
    openedAt: '2026-04-21T23:00:00.000Z',
  }

  it('firma + verifica round-trip happy path', () => {
    const token = signEditSessionToken(basePayload)
    const now = new Date('2026-04-21T23:00:30.000Z')
    expect(() => assertEditSessionToken(token, basePayload, now)).not.toThrow()
  })

  it('bad_signature si se altera cualquier campo del payload', () => {
    const token = signEditSessionToken(basePayload)
    const now = new Date('2026-04-21T23:00:30.000Z')
    expect(() =>
      assertEditSessionToken(token, { ...basePayload, subjectId: 'post-2' }, now),
    ).toThrow(EditSessionInvalid)
  })

  it('bad_signature si se cambia subjectType (POST vs COMMENT)', () => {
    const token = signEditSessionToken(basePayload)
    const now = new Date('2026-04-21T23:00:30.000Z')
    expect(() =>
      assertEditSessionToken(token, { ...basePayload, subjectType: 'COMMENT' }, now),
    ).toThrow(EditSessionInvalid)
  })

  it('expired si pasó más del grace window', () => {
    const token = signEditSessionToken(basePayload)
    const now = new Date(Date.parse(basePayload.openedAt) + EDIT_SESSION_GRACE_MS + 1_000)
    try {
      assertEditSessionToken(token, basePayload, now)
      expect.fail('esperaba EditSessionInvalid')
    } catch (err) {
      expect(err).toBeInstanceOf(EditSessionInvalid)
      expect((err as EditSessionInvalid).context).toMatchObject({
        reason: 'expired',
      })
    }
  })

  it('future_opened_at si openedAt está más de 5s en el futuro', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const token = signEditSessionToken({ ...basePayload, openedAt: future })
    const now = new Date()
    try {
      assertEditSessionToken(token, { ...basePayload, openedAt: future }, now)
      expect.fail('esperaba EditSessionInvalid')
    } catch (err) {
      expect(err).toBeInstanceOf(EditSessionInvalid)
      expect((err as EditSessionInvalid).context).toMatchObject({
        reason: 'future_opened_at',
      })
    }
  })

  it('malformed si openedAt no es ISO parseable', () => {
    try {
      assertEditSessionToken('anything', { ...basePayload, openedAt: 'not-a-date' }, new Date())
      expect.fail('esperaba EditSessionInvalid')
    } catch (err) {
      expect(err).toBeInstanceOf(EditSessionInvalid)
      expect((err as EditSessionInvalid).context).toMatchObject({
        reason: 'malformed',
      })
    }
  })

  it('tokens firmados con secrets distintos no verifican cruzado', () => {
    const token = signEditSessionToken(basePayload)
    const prev = currentSecret
    currentSecret = 'y'.repeat(48) + 'otro-secret'
    const now = new Date('2026-04-21T23:00:30.000Z')
    try {
      expect(() => assertEditSessionToken(token, basePayload, now)).toThrow(EditSessionInvalid)
    } finally {
      currentSecret = prev
    }
  })

  it('falla si APP_EDIT_SESSION_SECRET no está seteada', () => {
    const prev = currentSecret
    currentSecret = undefined
    try {
      expect(() => signEditSessionToken(basePayload)).toThrow(/APP_EDIT_SESSION_SECRET/)
    } finally {
      currentSecret = prev
    }
  })
})
