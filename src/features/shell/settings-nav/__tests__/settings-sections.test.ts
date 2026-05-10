import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SECTIONS,
  deriveActiveSettingsSection,
  deriveVisibleSettingsSections,
} from '../domain/settings-sections'

describe('SETTINGS_SECTIONS', () => {
  it('expone las 9 secciones canónicas en orden (post F.5 plan rich-text)', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.slug)).toEqual([
      '',
      'hours',
      'library',
      'access',
      'members',
      'flags',
      'groups',
      'tiers',
      'editor',
    ])
  })

  it('cada sección tiene label en español', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'General',
      'Horarios',
      'Biblioteca',
      'Acceso',
      'Miembros',
      'Reportes',
      'Grupos',
      'Tiers',
      'Editor',
    ])
  })

  it('"Miembros", "Grupos", "Tiers" y "Editor" son los items con requiredRole=owner', () => {
    const ownerOnly = SETTINGS_SECTIONS.filter(
      (s) => 'requiredRole' in s && s.requiredRole === 'owner',
    ).map((s) => s.slug)
    expect(ownerOnly).toEqual(['members', 'groups', 'tiers', 'editor'])
  })

  it('"access" está inmediatamente antes de "members" (semántica: workflows admin antes de directorio)', () => {
    const slugs = SETTINGS_SECTIONS.map((s) => s.slug)
    const accessIdx = slugs.indexOf('access')
    const membersIdx = slugs.indexOf('members')
    expect(accessIdx).toBeGreaterThanOrEqual(0)
    expect(membersIdx).toBe(accessIdx + 1)
  })

  it('"groups" está inmediatamente antes de "tiers" (semántica: gestión de permisos antes de segmentación de membresía)', () => {
    const slugs = SETTINGS_SECTIONS.map((s) => s.slug)
    const groupsIdx = slugs.indexOf('groups')
    const tiersIdx = slugs.indexOf('tiers')
    expect(groupsIdx).toBeGreaterThanOrEqual(0)
    expect(tiersIdx).toBe(groupsIdx + 1)
  })
})

describe('deriveVisibleSettingsSections', () => {
  it('owner ve los 9 items (incluyendo "Miembros", "Grupos", "Tiers" y "Editor")', () => {
    const result = deriveVisibleSettingsSections({ isOwner: true })
    expect(result.length).toBe(SETTINGS_SECTIONS.length)
    expect(result.map((s) => s.slug)).toContain('members')
    expect(result.map((s) => s.slug)).toContain('groups')
    expect(result.map((s) => s.slug)).toContain('tiers')
    expect(result.map((s) => s.slug)).toContain('editor')
  })

  it('non-owner (admin) NO ve items con requiredRole=owner ("Miembros", "Grupos", "Tiers" ni "Editor")', () => {
    const result = deriveVisibleSettingsSections({ isOwner: false })
    expect(result.map((s) => s.slug)).not.toContain('members')
    expect(result.map((s) => s.slug)).not.toContain('groups')
    expect(result.map((s) => s.slug)).not.toContain('tiers')
    expect(result.map((s) => s.slug)).not.toContain('editor')
  })

  it('non-owner ve los 5 items default (admin baseline incluye access)', () => {
    const result = deriveVisibleSettingsSections({ isOwner: false })
    expect(result.map((s) => s.slug)).toEqual(['', 'hours', 'library', 'access', 'flags'])
  })

  it('preserva el orden original de SETTINGS_SECTIONS para owner', () => {
    const owner = deriveVisibleSettingsSections({ isOwner: true })
    expect(owner.map((s) => s.slug)).toEqual(SETTINGS_SECTIONS.map((s) => s.slug))
  })
})

describe('deriveActiveSettingsSection', () => {
  it('matchea `/settings` exacto como sección General (slug vacío)', () => {
    expect(deriveActiveSettingsSection('/settings')).toBe('')
  })

  it('tolera trailing slash en `/settings/`', () => {
    expect(deriveActiveSettingsSection('/settings/')).toBe('')
  })

  it('matchea sub-pages directas', () => {
    expect(deriveActiveSettingsSection('/settings/hours')).toBe('hours')
    expect(deriveActiveSettingsSection('/settings/library')).toBe('library')
    expect(deriveActiveSettingsSection('/settings/access')).toBe('access')
    expect(deriveActiveSettingsSection('/settings/members')).toBe('members')
    expect(deriveActiveSettingsSection('/settings/flags')).toBe('flags')
    expect(deriveActiveSettingsSection('/settings/groups')).toBe('groups')
    expect(deriveActiveSettingsSection('/settings/tiers')).toBe('tiers')
    expect(deriveActiveSettingsSection('/settings/editor')).toBe('editor')
  })

  it('tolera trailing slash en sub-pages', () => {
    expect(deriveActiveSettingsSection('/settings/hours/')).toBe('hours')
  })

  it('matchea sub-rutas profundas dentro de una sección como esa sección', () => {
    expect(deriveActiveSettingsSection('/settings/library/foo')).toBe('library')
    expect(deriveActiveSettingsSection('/settings/members/transfer')).toBe('members')
  })

  it('retorna null para pathnames fuera de /settings', () => {
    expect(deriveActiveSettingsSection('/')).toBeNull()
    expect(deriveActiveSettingsSection('/conversations')).toBeNull()
    expect(deriveActiveSettingsSection('/library/recetas')).toBeNull()
    expect(deriveActiveSettingsSection('/m/user-1')).toBeNull()
    expect(deriveActiveSettingsSection('/inbox')).toBeNull()
  })

  it('retorna null para pathnames vacíos o malformed', () => {
    expect(deriveActiveSettingsSection('')).toBeNull()
    expect(deriveActiveSettingsSection('settings')).toBeNull() // sin slash inicial
  })
})
