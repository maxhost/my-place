import { describe, expect, it } from 'vitest'
import {
  QUOTE_EXCERPT_MAX_CHARS,
  assertQuotedCommentAlive,
  assertQuotedCommentBelongsToPost,
  buildQuoteSnapshot,
} from '../domain/invariants'
import { InvalidQuoteTarget } from '../domain/errors'
import type { QuoteSourceComment, RichTextDocument } from '../domain/types'

const bodyOf = (text: string): RichTextDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const sourceComment = (overrides: Partial<QuoteSourceComment> = {}): QuoteSourceComment => ({
  id: 'comment-target',
  authorSnapshot: { displayName: 'Ana', avatarUrl: null },
  body: bodyOf('Hola, esta es la cita original.'),
  createdAt: new Date('2026-05-07T12:00:00Z'),
  deletedAt: null,
  ...overrides,
})

describe('buildQuoteSnapshot', () => {
  it('construye snapshot con label, excerpt y createdAt congelados', () => {
    const snap = buildQuoteSnapshot(sourceComment(), 'comment-new')
    expect(snap).toEqual({
      commentId: 'comment-target',
      authorLabel: 'Ana',
      bodyExcerpt: 'Hola, esta es la cita original.',
      createdAt: new Date('2026-05-07T12:00:00Z'),
    })
  })

  it('trunca excerpt respetando el límite', () => {
    const longText = 'palabra '.repeat(200)
    const snap = buildQuoteSnapshot(sourceComment({ body: bodyOf(longText) }), null)
    expect(snap.bodyExcerpt.length).toBeLessThanOrEqual(QUOTE_EXCERPT_MAX_CHARS + 1)
    expect(snap.bodyExcerpt.endsWith('…')).toBe(true)
  })

  it('rechaza self-quote (mismo id que el nuevo comment)', () => {
    const existingTargetId = 'c-1'
    expect(() =>
      buildQuoteSnapshot(sourceComment({ id: existingTargetId }), existingTargetId),
    ).toThrow(InvalidQuoteTarget)
  })
})

describe('assertQuotedCommentBelongsToPost', () => {
  it('acepta cita del mismo post', () => {
    expect(() =>
      assertQuotedCommentBelongsToPost({ id: 'c-1', postId: 'p-1' }, 'p-1'),
    ).not.toThrow()
  })

  it('rechaza cita cross-post', () => {
    expect(() => assertQuotedCommentBelongsToPost({ id: 'c-1', postId: 'p-2' }, 'p-1')).toThrow(
      InvalidQuoteTarget,
    )
  })
})

describe('assertQuotedCommentAlive', () => {
  it('deja pasar si deletedAt es null', () => {
    expect(() => assertQuotedCommentAlive(sourceComment())).not.toThrow()
  })

  it('lanza si el target está deletado', () => {
    expect(() => assertQuotedCommentAlive(sourceComment({ deletedAt: new Date() }))).toThrow(
      InvalidQuoteTarget,
    )
  })
})
