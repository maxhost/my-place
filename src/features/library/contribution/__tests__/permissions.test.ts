import { describe, expect, it } from 'vitest'
import type { LibraryViewer } from '@/features/library/public'
import { canWriteCategory, type CategoryWriteContext } from '../domain/permissions'

/**
 * Tests para `canWriteCategory` (S1a — write access scopes).
 *
 * Ver ADR `2026-05-12-library-permissions-model.md`:
 * owner siempre escribe (bypass), después se evalúa por kind.
 * Simétrico con `canReadCategory` del sub-slice `library/access`.
 */

const owner: LibraryViewer = {
  userId: 'owner-1',
  isAdmin: true,
  isOwner: true,
  groupIds: [],
  tierIds: [],
}

const admin: LibraryViewer = {
  userId: 'admin-1',
  isAdmin: true,
  isOwner: false,
  groupIds: [],
  tierIds: [],
}

const memberPlain: LibraryViewer = {
  userId: 'member-1',
  isAdmin: false,
  isOwner: false,
  groupIds: [],
  tierIds: [],
}

const memberInGroupA: LibraryViewer = {
  userId: 'member-2',
  isAdmin: false,
  isOwner: false,
  groupIds: ['grp-a'],
  tierIds: [],
}

const memberInTierX: LibraryViewer = {
  userId: 'member-3',
  isAdmin: false,
  isOwner: false,
  groupIds: [],
  tierIds: ['tier-x'],
}

const memberInOtherGroupAndTier: LibraryViewer = {
  userId: 'member-4',
  isAdmin: false,
  isOwner: false,
  groupIds: ['grp-z'],
  tierIds: ['tier-z'],
}

const ownerOnlyCtx: CategoryWriteContext = {
  writeAccessKind: 'OWNER_ONLY',
  groupWriteIds: [],
  tierWriteIds: [],
  userWriteIds: [],
}

const groupsCtx: CategoryWriteContext = {
  writeAccessKind: 'GROUPS',
  groupWriteIds: ['grp-a', 'grp-b'],
  tierWriteIds: [],
  userWriteIds: [],
}

const groupsCtxEmpty: CategoryWriteContext = {
  writeAccessKind: 'GROUPS',
  groupWriteIds: [],
  tierWriteIds: [],
  userWriteIds: [],
}

const tiersCtx: CategoryWriteContext = {
  writeAccessKind: 'TIERS',
  groupWriteIds: [],
  tierWriteIds: ['tier-x', 'tier-y'],
  userWriteIds: [],
}

const usersCtx: CategoryWriteContext = {
  writeAccessKind: 'USERS',
  groupWriteIds: [],
  tierWriteIds: [],
  userWriteIds: ['member-1', 'consultant-99'],
}

describe('canWriteCategory — owner bypass (ADR 2026-05-12)', () => {
  it('owner SIEMPRE escribe, sin importar el kind ni el set', () => {
    expect(canWriteCategory(ownerOnlyCtx, owner)).toBe(true)
    expect(canWriteCategory(groupsCtx, owner)).toBe(true)
    expect(canWriteCategory(groupsCtxEmpty, owner)).toBe(true)
    expect(canWriteCategory(tiersCtx, owner)).toBe(true)
    expect(canWriteCategory(usersCtx, owner)).toBe(true)
  })

  it('admin NO bypassa escritura (sólo owner)', () => {
    // El admin que no es owner debe matchear el scope explícitamente.
    expect(canWriteCategory(ownerOnlyCtx, admin)).toBe(false)
    expect(canWriteCategory(groupsCtx, admin)).toBe(false)
    expect(canWriteCategory(tiersCtx, admin)).toBe(false)
    expect(canWriteCategory(usersCtx, admin)).toBe(false)
  })
})

describe('canWriteCategory — kind=OWNER_ONLY', () => {
  it('nadie excepto owner escribe', () => {
    expect(canWriteCategory(ownerOnlyCtx, memberPlain)).toBe(false)
    expect(canWriteCategory(ownerOnlyCtx, memberInGroupA)).toBe(false)
    expect(canWriteCategory(ownerOnlyCtx, memberInOtherGroupAndTier)).toBe(false)
  })
})

describe('canWriteCategory — kind=GROUPS', () => {
  it('miembro en algún grupo del set: true', () => {
    expect(canWriteCategory(groupsCtx, memberInGroupA)).toBe(true)
  })

  it('miembro sin grupos: false', () => {
    expect(canWriteCategory(groupsCtx, memberPlain)).toBe(false)
  })

  it('miembro en otro grupo distinto al set: false', () => {
    expect(canWriteCategory(groupsCtx, memberInOtherGroupAndTier)).toBe(false)
  })

  it('set vacío: nadie escribe (default cerrado, salvo owner)', () => {
    expect(canWriteCategory(groupsCtxEmpty, memberInGroupA)).toBe(false)
    expect(canWriteCategory(groupsCtxEmpty, memberPlain)).toBe(false)
  })
})

describe('canWriteCategory — kind=TIERS', () => {
  it('miembro con tier en el set: true', () => {
    expect(canWriteCategory(tiersCtx, memberInTierX)).toBe(true)
  })

  it('miembro sin tiers: false', () => {
    expect(canWriteCategory(tiersCtx, memberPlain)).toBe(false)
  })

  it('miembro con tier distinto al set: false', () => {
    expect(canWriteCategory(tiersCtx, memberInOtherGroupAndTier)).toBe(false)
  })
})

describe('canWriteCategory — kind=USERS', () => {
  it('user listado en el set: true', () => {
    expect(canWriteCategory(usersCtx, memberPlain)).toBe(true) // 'member-1' está en set
  })

  it('user no listado: false', () => {
    expect(canWriteCategory(usersCtx, memberInGroupA)).toBe(false)
    expect(canWriteCategory(usersCtx, memberInTierX)).toBe(false)
  })
})
