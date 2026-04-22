import { describe, expect, it } from 'vitest'
import { mapFlagToView } from '../server/flag-view-mapper'
import type { Flag, FlagTargetSnapshot } from '../domain/types'

const baseFlag: Flag = {
  id: 'f-1',
  targetType: 'POST',
  targetId: 'p-1',
  placeId: 'pl-1',
  reporterUserId: 'u-reporter',
  reason: 'SPAM',
  reasonNote: 'nota del reporter',
  status: 'OPEN',
  createdAt: new Date('2026-04-21T10:00:00Z'),
  reviewedAt: null,
  reviewerAdminUserId: null,
  reviewNote: null,
}

const postBody = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Cuerpo del post reportado' }],
    },
  ],
}

const commentBody = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Cuerpo del comment reportado' }],
    },
  ],
}

describe('mapFlagToView', () => {
  it('mapea un flag sobre POST visible con title + excerpt', () => {
    const snapshot: FlagTargetSnapshot = {
      targetType: 'POST',
      targetId: 'p-1',
      title: 'Título del post',
      body: postBody,
      hiddenAt: null,
      slug: 'titulo-del-post',
    }
    const view = mapFlagToView(baseFlag, snapshot)
    expect(view.id).toBe('f-1')
    expect(view.targetType).toBe('POST')
    expect(view.contentStatus).toBe('VISIBLE')
    expect(view.title).toBe('Título del post')
    expect(view.preview).toBe('Cuerpo del post reportado')
    expect(view.postSlug).toBe('titulo-del-post')
    expect(view.reasonNote).toBe('nota del reporter')
  })

  it('mapea un flag sobre POST con hiddenAt → contentStatus=HIDDEN', () => {
    const snapshot: FlagTargetSnapshot = {
      targetType: 'POST',
      targetId: 'p-1',
      title: 'Título oculto',
      body: postBody,
      hiddenAt: new Date('2026-04-21T11:00:00Z'),
      slug: 'titulo-oculto',
    }
    const view = mapFlagToView(baseFlag, snapshot)
    expect(view.contentStatus).toBe('HIDDEN')
    expect(view.title).toBe('Título oculto')
    expect(view.preview).toBe('Cuerpo del post reportado')
  })

  it('mapea un flag sobre COMMENT sin title + con postSlug del padre', () => {
    const commentFlag: Flag = { ...baseFlag, targetType: 'COMMENT', targetId: 'c-1' }
    const snapshot: FlagTargetSnapshot = {
      targetType: 'COMMENT',
      targetId: 'c-1',
      body: commentBody,
      deletedAt: null,
      postId: 'p-1',
      postSlug: 'post-padre',
    }
    const view = mapFlagToView(commentFlag, snapshot)
    expect(view.targetType).toBe('COMMENT')
    expect(view.title).toBeNull()
    expect(view.preview).toBe('Cuerpo del comment reportado')
    expect(view.contentStatus).toBe('VISIBLE')
    expect(view.postId).toBe('p-1')
    expect(view.postSlug).toBe('post-padre')
  })

  it('mapea COMMENT con deletedAt → contentStatus=DELETED', () => {
    const commentFlag: Flag = { ...baseFlag, targetType: 'COMMENT', targetId: 'c-1' }
    const snapshot: FlagTargetSnapshot = {
      targetType: 'COMMENT',
      targetId: 'c-1',
      body: commentBody,
      deletedAt: new Date('2026-04-21T11:00:00Z'),
      postId: 'p-1',
      postSlug: 'post-padre',
    }
    const view = mapFlagToView(commentFlag, snapshot)
    expect(view.contentStatus).toBe('DELETED')
  })

  it('snapshot=null → contentStatus=DELETED + preview vacío + title null', () => {
    const view = mapFlagToView(baseFlag, null)
    expect(view.contentStatus).toBe('DELETED')
    expect(view.preview).toBe('')
    expect(view.title).toBeNull()
    expect(view.postSlug).toBeNull()
    expect(view.postId).toBeNull()
    expect(view.id).toBe('f-1')
    expect(view.reason).toBe('SPAM')
    expect(view.reasonNote).toBe('nota del reporter')
  })

  it('reporter note se pasa tal cual (incluido null)', () => {
    const flagSinNota: Flag = { ...baseFlag, reasonNote: null }
    const snapshot: FlagTargetSnapshot = {
      targetType: 'POST',
      targetId: 'p-1',
      title: 'x',
      body: postBody,
      hiddenAt: null,
      slug: 'x',
    }
    const view = mapFlagToView(flagSinNota, snapshot)
    expect(view.reasonNote).toBeNull()
  })

  it('propaga status + reviewedAt + reviewNote del flag (para tab Resueltos)', () => {
    const reviewedFlag: Flag = {
      ...baseFlag,
      status: 'REVIEWED_ACTIONED',
      reviewedAt: new Date('2026-04-21T12:00:00Z'),
      reviewerAdminUserId: 'admin-1',
      reviewNote: 'aplicada ocultación',
    }
    const snapshot: FlagTargetSnapshot = {
      targetType: 'POST',
      targetId: 'p-1',
      title: 't',
      body: postBody,
      hiddenAt: new Date('2026-04-21T12:00:00Z'),
      slug: 't',
    }
    const view = mapFlagToView(reviewedFlag, snapshot)
    expect(view.status).toBe('REVIEWED_ACTIONED')
    expect(view.reviewedAt?.toISOString()).toBe('2026-04-21T12:00:00.000Z')
    expect(view.reviewNote).toBe('aplicada ocultación')
  })
})
