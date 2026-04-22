import { describe, expect, it } from 'vitest'
import {
  DORMANT_THRESHOLD_MS,
  assertCommentAlive,
  assertPostOpenForActivity,
  derivePostState,
  isDormant,
} from '../domain/invariants'
import { CommentDeletedError, PostHiddenError } from '../domain/errors'

describe('derivePostState', () => {
  it('VISIBLE sin hiddenAt', () => {
    expect(derivePostState({ hiddenAt: null })).toBe('VISIBLE')
  })

  it('HIDDEN si hiddenAt', () => {
    expect(derivePostState({ hiddenAt: new Date() })).toBe('HIDDEN')
  })
})

describe('isDormant', () => {
  it('true si pasaron más de 30 días', () => {
    const now = new Date('2026-05-07T00:00:00Z')
    const old = new Date(now.getTime() - DORMANT_THRESHOLD_MS - 1)
    expect(isDormant(old, now)).toBe(true)
  })

  it('false si están en el borde de 30 días', () => {
    const now = new Date('2026-05-07T00:00:00Z')
    const borderline = new Date(now.getTime() - DORMANT_THRESHOLD_MS)
    expect(isDormant(borderline, now)).toBe(false)
  })
})

describe('assertPostOpenForActivity', () => {
  it('no lanza con post visible', () => {
    expect(() => assertPostOpenForActivity({ id: 'p-1', hiddenAt: null })).not.toThrow()
  })

  it('lanza PostHiddenError en post oculto', () => {
    expect(() =>
      assertPostOpenForActivity({
        id: 'p-1',
        hiddenAt: new Date(),
      }),
    ).toThrow(PostHiddenError)
  })
})

describe('assertCommentAlive', () => {
  it('no lanza con deletedAt null', () => {
    expect(() => assertCommentAlive({ id: 'c-1', deletedAt: null })).not.toThrow()
  })

  it('lanza CommentDeletedError si deletedAt está seteado', () => {
    expect(() => assertCommentAlive({ id: 'c-1', deletedAt: new Date() })).toThrow(
      CommentDeletedError,
    )
  })
})
