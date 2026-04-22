import { describe, expect, it } from 'vitest'
import {
  EDIT_WINDOW_MS,
  assertEditWindowOpen,
  canDeleteContent,
  canEditAuthorContent,
  canEditPost,
  editWindowOpen,
} from '../domain/invariants'
import { EditWindowExpired } from '../domain/errors'

const ACTOR_AUTHOR = { userId: 'user-a', isAdmin: false } as const
const ACTOR_OTHER = { userId: 'user-b', isAdmin: false } as const
const ACTOR_ADMIN = { userId: 'user-b', isAdmin: true } as const

describe('editWindowOpen', () => {
  it('true dentro de los 60s desde createdAt', () => {
    const createdAt = new Date('2026-05-07T12:00:00Z')
    const now = new Date('2026-05-07T12:00:59.999Z')
    expect(editWindowOpen(createdAt, now)).toBe(true)
  })

  it('false al cumplirse exactamente 60s', () => {
    const createdAt = new Date('2026-05-07T12:00:00Z')
    const now = new Date(createdAt.getTime() + EDIT_WINDOW_MS)
    expect(editWindowOpen(createdAt, now)).toBe(false)
  })

  it('false pasados los 60s', () => {
    const createdAt = new Date('2026-05-07T12:00:00Z')
    const now = new Date('2026-05-07T12:01:10Z')
    expect(editWindowOpen(createdAt, now)).toBe(false)
  })
})

describe('assertEditWindowOpen', () => {
  it('no lanza dentro de la ventana', () => {
    const createdAt = new Date('2026-05-07T12:00:00Z')
    const now = new Date('2026-05-07T12:00:30Z')
    expect(() => assertEditWindowOpen(createdAt, now, 'post-1')).not.toThrow()
  })

  it('lanza EditWindowExpired fuera de la ventana con elapsedMs', () => {
    const createdAt = new Date('2026-05-07T12:00:00Z')
    const now = new Date('2026-05-07T12:02:00Z') // +120s
    try {
      assertEditWindowOpen(createdAt, now, 'post-1')
      expect.fail('esperaba EditWindowExpired')
    } catch (err) {
      expect(err).toBeInstanceOf(EditWindowExpired)
      expect((err as EditWindowExpired).context).toMatchObject({
        entityId: 'post-1',
        elapsedMs: 120_000,
      })
    }
  })
})

describe('canEditAuthorContent', () => {
  const createdAt = new Date('2026-05-07T12:00:00Z')
  const within = new Date('2026-05-07T12:00:30Z')
  const after = new Date('2026-05-07T12:02:00Z')

  it('autor dentro de 60s: true', () => {
    expect(canEditAuthorContent(ACTOR_AUTHOR, 'user-a', createdAt, within)).toBe(true)
  })

  it('autor después de 60s: false', () => {
    expect(canEditAuthorContent(ACTOR_AUTHOR, 'user-a', createdAt, after)).toBe(false)
  })

  it('otro usuario nunca edita', () => {
    expect(canEditAuthorContent(ACTOR_OTHER, 'user-a', createdAt, within)).toBe(false)
  })

  it('admin tampoco edita contenido ajeno (solo hide/delete)', () => {
    expect(canEditAuthorContent(ACTOR_ADMIN, 'user-a', createdAt, within)).toBe(false)
  })

  it('authorUserId null (erasure): false', () => {
    expect(canEditAuthorContent(ACTOR_AUTHOR, null, createdAt, within)).toBe(false)
  })
})

describe('canDeleteContent', () => {
  const createdAt = new Date('2026-05-07T12:00:00Z')
  const within = new Date('2026-05-07T12:00:30Z')
  const after = new Date('2026-05-07T12:02:00Z')

  it('autor dentro de 60s: true', () => {
    expect(canDeleteContent(ACTOR_AUTHOR, 'user-a', createdAt, within)).toBe(true)
  })

  it('autor después de 60s: false (admin debe hacerlo)', () => {
    expect(canDeleteContent(ACTOR_AUTHOR, 'user-a', createdAt, after)).toBe(false)
  })

  it('admin siempre puede borrar contenido ajeno', () => {
    expect(canDeleteContent(ACTOR_ADMIN, 'user-a', createdAt, after)).toBe(true)
  })

  it('otro usuario no-admin nunca borra ajeno', () => {
    expect(canDeleteContent(ACTOR_OTHER, 'user-a', createdAt, within)).toBe(false)
  })

  it('admin puede borrar contenido con author nulificado (erasure)', () => {
    expect(canDeleteContent(ACTOR_ADMIN, null, createdAt, after)).toBe(true)
  })
})

describe('canEditPost', () => {
  const createdAt = new Date('2026-05-07T12:00:00Z')
  const within = new Date('2026-05-07T12:00:30Z')
  const after = new Date('2026-05-07T12:02:00Z')

  it('autor dentro de 60s: true', () => {
    expect(canEditPost(ACTOR_AUTHOR, 'user-a', createdAt, within)).toBe(true)
  })

  it('autor fuera de 60s: false', () => {
    expect(canEditPost(ACTOR_AUTHOR, 'user-a', createdAt, after)).toBe(false)
  })

  it('admin puede editar contenido ajeno en cualquier momento', () => {
    expect(canEditPost(ACTOR_ADMIN, 'user-a', createdAt, after)).toBe(true)
  })

  it('otro user no-admin nunca edita ajeno', () => {
    expect(canEditPost(ACTOR_OTHER, 'user-a', createdAt, within)).toBe(false)
  })

  it('admin puede editar post con author nulificado (erasure)', () => {
    expect(canEditPost(ACTOR_ADMIN, null, createdAt, after)).toBe(true)
  })
})
