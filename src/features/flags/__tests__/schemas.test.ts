import { describe, expect, it } from 'vitest'
import { flagInputSchema, reviewFlagInputSchema } from '../schemas'

describe('flagInputSchema', () => {
  it('acepta las 5 razones del set cerrado', () => {
    for (const reason of ['SPAM', 'HARASSMENT', 'OFFTOPIC', 'MISINFO', 'OTHER'] as const) {
      expect(
        flagInputSchema.safeParse({
          targetType: 'COMMENT',
          targetId: 'c-1',
          reason,
        }).success,
      ).toBe(true)
    }
  })

  it('acepta reasonNote opcional hasta 500 chars', () => {
    expect(
      flagInputSchema.safeParse({
        targetType: 'COMMENT',
        targetId: 'c-1',
        reason: 'OTHER',
        reasonNote: 'x'.repeat(500),
      }).success,
    ).toBe(true)
  })

  it('rechaza reasonNote > 500 chars', () => {
    expect(
      flagInputSchema.safeParse({
        targetType: 'COMMENT',
        targetId: 'c-1',
        reason: 'OTHER',
        reasonNote: 'x'.repeat(501),
      }).success,
    ).toBe(false)
  })

  it('rechaza targetType fuera del set POST/COMMENT', () => {
    expect(
      flagInputSchema.safeParse({
        targetType: 'PLACE',
        targetId: 'p-1',
        reason: 'SPAM',
      }).success,
    ).toBe(false)
  })
})

describe('reviewFlagInputSchema', () => {
  it('acepta las 2 decisiones válidas', () => {
    for (const decision of ['REVIEWED_ACTIONED', 'REVIEWED_DISMISSED'] as const) {
      expect(reviewFlagInputSchema.safeParse({ flagId: 'f-1', decision }).success).toBe(true)
    }
  })

  it('rechaza reabrir flag (status OPEN)', () => {
    expect(reviewFlagInputSchema.safeParse({ flagId: 'f-1', decision: 'OPEN' }).success).toBe(false)
  })

  it('default sideEffect=null cuando no se provee', () => {
    const parsed = reviewFlagInputSchema.safeParse({
      flagId: 'f-1',
      decision: 'REVIEWED_ACTIONED',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.sideEffect).toBeNull()
    }
  })

  it('acepta ACTIONED + sideEffect=HIDE_TARGET', () => {
    expect(
      reviewFlagInputSchema.safeParse({
        flagId: 'f-1',
        decision: 'REVIEWED_ACTIONED',
        sideEffect: 'HIDE_TARGET',
      }).success,
    ).toBe(true)
  })

  it('acepta ACTIONED + sideEffect=DELETE_TARGET', () => {
    expect(
      reviewFlagInputSchema.safeParse({
        flagId: 'f-1',
        decision: 'REVIEWED_ACTIONED',
        sideEffect: 'DELETE_TARGET',
      }).success,
    ).toBe(true)
  })

  it('rechaza DISMISSED + sideEffect (inconsistencia semántica)', () => {
    expect(
      reviewFlagInputSchema.safeParse({
        flagId: 'f-1',
        decision: 'REVIEWED_DISMISSED',
        sideEffect: 'HIDE_TARGET',
      }).success,
    ).toBe(false)
    expect(
      reviewFlagInputSchema.safeParse({
        flagId: 'f-1',
        decision: 'REVIEWED_DISMISSED',
        sideEffect: 'DELETE_TARGET',
      }).success,
    ).toBe(false)
  })

  it('acepta DISMISSED sin sideEffect', () => {
    expect(
      reviewFlagInputSchema.safeParse({
        flagId: 'f-1',
        decision: 'REVIEWED_DISMISSED',
        sideEffect: null,
      }).success,
    ).toBe(true)
  })

  it('rechaza sideEffect con valor fuera del enum', () => {
    expect(
      reviewFlagInputSchema.safeParse({
        flagId: 'f-1',
        decision: 'REVIEWED_ACTIONED',
        sideEffect: 'NUKE_FROM_ORBIT',
      }).success,
    ).toBe(false)
  })
})
