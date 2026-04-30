import { describe, expect, it } from 'vitest'
import {
  canArchiveItem,
  canCreateInCategory,
  canEditCategory,
  canEditItem,
  type CategoryForPermissions,
  type LibraryViewer,
} from '../domain/permissions'

const adminViewer: LibraryViewer = { userId: 'admin-1', isAdmin: true }
const memberViewer: LibraryViewer = { userId: 'member-1', isAdmin: false }
const memberB: LibraryViewer = { userId: 'member-2', isAdmin: false }

const adminOnlyCat: CategoryForPermissions = {
  contributionPolicy: 'ADMIN_ONLY',
  designatedUserIds: [],
}
const designatedCat: CategoryForPermissions = {
  contributionPolicy: 'DESIGNATED',
  designatedUserIds: ['member-1'],
}
const openCat: CategoryForPermissions = {
  contributionPolicy: 'MEMBERS_OPEN',
  designatedUserIds: [],
}

describe('canCreateInCategory', () => {
  it('admin: siempre true (admin_only / designated / members_open)', () => {
    expect(canCreateInCategory(adminOnlyCat, adminViewer)).toBe(true)
    expect(canCreateInCategory(designatedCat, adminViewer)).toBe(true)
    expect(canCreateInCategory(openCat, adminViewer)).toBe(true)
  })

  it('admin_only: member común NO', () => {
    expect(canCreateInCategory(adminOnlyCat, memberViewer)).toBe(false)
  })

  it('designated: solo el listado puede', () => {
    expect(canCreateInCategory(designatedCat, memberViewer)).toBe(true)
    expect(canCreateInCategory(designatedCat, memberB)).toBe(false)
  })

  it('members_open: cualquier miembro puede', () => {
    expect(canCreateInCategory(openCat, memberViewer)).toBe(true)
    expect(canCreateInCategory(openCat, memberB)).toBe(true)
  })
})

describe('canEditCategory', () => {
  it('solo admin/owner', () => {
    expect(canEditCategory(adminViewer)).toBe(true)
    expect(canEditCategory(memberViewer)).toBe(false)
  })
})

describe('canEditItem / canArchiveItem', () => {
  const itemByMember = { authorUserId: 'member-1' }
  const itemByOther = { authorUserId: 'someone-else' }
  const itemOrphan = { authorUserId: null }

  it('admin: siempre puede', () => {
    expect(canEditItem(itemByOther, adminViewer)).toBe(true)
    expect(canArchiveItem(itemOrphan, adminViewer)).toBe(true)
  })

  it('author: puede editar/archivar lo suyo', () => {
    expect(canEditItem(itemByMember, memberViewer)).toBe(true)
    expect(canArchiveItem(itemByMember, memberViewer)).toBe(true)
  })

  it('miembro NO author: rechazado', () => {
    expect(canEditItem(itemByOther, memberViewer)).toBe(false)
    expect(canArchiveItem(itemByOther, memberViewer)).toBe(false)
  })

  it('item huérfano (post-erasure 365d): solo admin', () => {
    expect(canEditItem(itemOrphan, memberViewer)).toBe(false)
    expect(canArchiveItem(itemOrphan, memberViewer)).toBe(false)
  })
})
