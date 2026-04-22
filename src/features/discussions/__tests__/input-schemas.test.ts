import { describe, expect, it } from 'vitest'
import {
  createCommentInputSchema,
  createPostInputSchema,
  markPostReadInputSchema,
  reactInputSchema,
} from '../schemas'

const validBody = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hola' }] }],
}

describe('createPostInputSchema', () => {
  it('acepta título + body opcional', () => {
    expect(createPostInputSchema.safeParse({ placeId: 'p-1', title: 'Tema' }).success).toBe(true)
    expect(
      createPostInputSchema.safeParse({ placeId: 'p-1', title: 'Tema', body: validBody }).success,
    ).toBe(true)
    expect(
      createPostInputSchema.safeParse({ placeId: 'p-1', title: 'Tema', body: null }).success,
    ).toBe(true)
  })

  it('rechaza título sólo-whitespace', () => {
    expect(createPostInputSchema.safeParse({ placeId: 'p-1', title: '   ' }).success).toBe(false)
  })

  it('rechaza título > 160 chars', () => {
    expect(
      createPostInputSchema.safeParse({ placeId: 'p-1', title: 'x'.repeat(161) }).success,
    ).toBe(false)
  })

  it('rechaza placeId vacío', () => {
    expect(createPostInputSchema.safeParse({ placeId: '', title: 'Tema' }).success).toBe(false)
  })
})

describe('createCommentInputSchema', () => {
  it('acepta body obligatorio + quote opcional', () => {
    expect(createCommentInputSchema.safeParse({ postId: 'po-1', body: validBody }).success).toBe(
      true,
    )
    expect(
      createCommentInputSchema.safeParse({
        postId: 'po-1',
        body: validBody,
        quotedCommentId: 'c-1',
      }).success,
    ).toBe(true)
  })

  it('rechaza sin body', () => {
    expect(createCommentInputSchema.safeParse({ postId: 'po-1' }).success).toBe(false)
  })
})

describe('reactInputSchema', () => {
  it('acepta emoji del set cerrado', () => {
    for (const emoji of ['THUMBS_UP', 'HEART', 'LAUGH', 'PRAY', 'THINKING', 'CRY'] as const) {
      expect(
        reactInputSchema.safeParse({ targetType: 'POST', targetId: 'p-1', emoji }).success,
      ).toBe(true)
    }
  })

  it('rechaza emoji fuera del set', () => {
    expect(
      reactInputSchema.safeParse({
        targetType: 'POST',
        targetId: 'p-1',
        emoji: 'FIRE',
      }).success,
    ).toBe(false)
  })

  it('rechaza targetType inválido', () => {
    expect(
      reactInputSchema.safeParse({
        targetType: 'THREAD',
        targetId: 'p-1',
        emoji: 'HEART',
      }).success,
    ).toBe(false)
  })
})

describe('markPostReadInputSchema', () => {
  it('acepta dwellMs positivo', () => {
    expect(markPostReadInputSchema.safeParse({ postId: 'po-1', dwellMs: 5_000 }).success).toBe(true)
  })

  it('rechaza dwellMs negativo', () => {
    expect(markPostReadInputSchema.safeParse({ postId: 'po-1', dwellMs: -1 }).success).toBe(false)
  })

  it('rechaza dwellMs absurdo (> 24h)', () => {
    expect(
      markPostReadInputSchema.safeParse({
        postId: 'po-1',
        dwellMs: 25 * 60 * 60 * 1000,
      }).success,
    ).toBe(false)
  })
})
