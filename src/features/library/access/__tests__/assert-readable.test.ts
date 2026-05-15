import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryViewer } from '@/features/library/public'
import { AuthorizationError, NotFoundError } from '@/shared/errors/domain-error'

/**
 * Tests del helper `assertCategoryReadable` / `canViewCategory`
 * (Plan A S1 — enforcement read-access biblioteca).
 *
 * Decisión B del plan: el gate es `canReadCategory || canWriteCategory`
 * (write implica read — un contributor fuera del read-scope no debe
 * perder lectura de la categoría donde escribe). Decisión F: punto
 * único de verdad para los 10 call-sites.
 */

const findReadScopeMock = vi.fn()
const findWriteScopeMock = vi.fn()

vi.mock('../server/queries', () => ({
  findReadScope: (...a: unknown[]) => findReadScopeMock(...a),
}))
vi.mock('@/features/library/contribution/public.server', () => ({
  findWriteScope: (...a: unknown[]) => findWriteScopeMock(...a),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { assertCategoryReadable, canViewCategory } from '../server/assert-readable'

const CAT = 'cat-1'

const owner: LibraryViewer = {
  userId: 'u-owner',
  isAdmin: true,
  isOwner: true,
  groupIds: [],
  tierIds: [],
}
const adminNotOwner: LibraryViewer = {
  userId: 'u-admin',
  isAdmin: true,
  isOwner: false,
  groupIds: [],
  tierIds: [],
}
const memberInGroup: LibraryViewer = {
  userId: 'u-g',
  isAdmin: false,
  isOwner: false,
  groupIds: ['g-allowed'],
  tierIds: [],
}
const memberPlain: LibraryViewer = {
  userId: 'u-plain',
  isAdmin: false,
  isOwner: false,
  groupIds: [],
  tierIds: [],
}

function readScope(over: Partial<Record<string, unknown>> = {}) {
  return { kind: 'PUBLIC', groupIds: [], tierIds: [], userIds: [], ...over }
}
function writeScope(over: Partial<Record<string, unknown>> = {}) {
  return { kind: 'OWNER_ONLY', groupIds: [], tierIds: [], userIds: [], ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  findWriteScopeMock.mockResolvedValue(writeScope())
})

describe('canViewCategory', () => {
  it('PUBLIC: cualquier miembro ve', async () => {
    findReadScopeMock.mockResolvedValue(readScope({ kind: 'PUBLIC' }))
    expect(await canViewCategory(CAT, memberPlain)).toBe(true)
  })

  it('owner siempre ve aunque sea GROUPS sin match', async () => {
    findReadScopeMock.mockResolvedValue(readScope({ kind: 'GROUPS', groupIds: ['otro'] }))
    expect(await canViewCategory(CAT, owner)).toBe(true)
  })

  it('admin NO-owner NO bypassa lectura restringida (decisión ADR)', async () => {
    findReadScopeMock.mockResolvedValue(readScope({ kind: 'GROUPS', groupIds: ['g-allowed'] }))
    findWriteScopeMock.mockResolvedValue(writeScope({ kind: 'OWNER_ONLY' }))
    expect(await canViewCategory(CAT, adminNotOwner)).toBe(false)
  })

  it('GROUPS: match por groupIds → ve', async () => {
    findReadScopeMock.mockResolvedValue(readScope({ kind: 'GROUPS', groupIds: ['g-allowed'] }))
    expect(await canViewCategory(CAT, memberInGroup)).toBe(true)
  })

  it('GROUPS: sin match → no ve', async () => {
    findReadScopeMock.mockResolvedValue(readScope({ kind: 'GROUPS', groupIds: ['g-otro'] }))
    expect(await canViewCategory(CAT, memberPlain)).toBe(false)
  })

  it('write implica read: sin read-scope pero con write-scope GROUPS match → ve', async () => {
    findReadScopeMock.mockResolvedValue(readScope({ kind: 'GROUPS', groupIds: ['g-otro'] }))
    findWriteScopeMock.mockResolvedValue(writeScope({ kind: 'GROUPS', groupIds: ['g-allowed'] }))
    expect(await canViewCategory(CAT, memberInGroup)).toBe(true)
  })

  it('categoría inexistente → false (no throw)', async () => {
    findReadScopeMock.mockResolvedValue(null)
    expect(await canViewCategory(CAT, owner)).toBe(false)
  })
})

describe('assertCategoryReadable', () => {
  it('legible → no throw', async () => {
    findReadScopeMock.mockResolvedValue(readScope({ kind: 'PUBLIC' }))
    await expect(assertCategoryReadable(CAT, memberPlain)).resolves.toBeUndefined()
  })

  it('denegado → AuthorizationError', async () => {
    findReadScopeMock.mockResolvedValue(readScope({ kind: 'USERS', userIds: ['otro'] }))
    findWriteScopeMock.mockResolvedValue(writeScope({ kind: 'OWNER_ONLY' }))
    await expect(assertCategoryReadable(CAT, memberPlain)).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('categoría inexistente → NotFoundError', async () => {
    findReadScopeMock.mockResolvedValue(null)
    await expect(assertCategoryReadable(CAT, owner)).rejects.toBeInstanceOf(NotFoundError)
  })
})
