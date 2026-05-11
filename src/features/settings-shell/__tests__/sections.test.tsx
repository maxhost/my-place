import { describe, expect, it } from 'vitest'
import { buildSettingsShellSections } from '../domain/sections'

describe('buildSettingsShellSections', () => {
  it('admin (no owner): incluye Place + Contenido sin items owner-only', () => {
    const result = buildSettingsShellSections({ isOwner: false })
    const slugSet = new Set(result.flatMap((g) => g.items.map((i) => i.href)))

    // Items visibles para admin (no owner-only)
    expect(slugSet).toContain('/settings/hours')
    expect(slugSet).toContain('/settings/access')
    expect(slugSet).toContain('/settings/library')
    expect(slugSet).toContain('/settings/flags')

    // Items owner-only NO visibles para admin
    expect(slugSet).not.toContain('/settings/members')
    expect(slugSet).not.toContain('/settings/groups')
    expect(slugSet).not.toContain('/settings/tiers')
    expect(slugSet).not.toContain('/settings/editor')
  })

  it('owner: incluye TODOS los items (Place + Comunidad + Contenido)', () => {
    const result = buildSettingsShellSections({ isOwner: true })
    const slugSet = new Set(result.flatMap((g) => g.items.map((i) => i.href)))

    expect(slugSet).toContain('/settings/hours')
    expect(slugSet).toContain('/settings/access')
    expect(slugSet).toContain('/settings/editor')
    expect(slugSet).toContain('/settings/members')
    expect(slugSet).toContain('/settings/groups')
    expect(slugSet).toContain('/settings/tiers')
    expect(slugSet).toContain('/settings/library')
    expect(slugSet).toContain('/settings/flags')
  })

  it('NO incluye el slug "" (general / dashboard) — futuro', () => {
    const result = buildSettingsShellSections({ isOwner: true })
    const allHrefs = result.flatMap((g) => g.items.map((i) => i.href))
    expect(allHrefs).not.toContain('/settings/')
    expect(allHrefs).not.toContain('/settings')
  })

  it('todos los hrefs son /settings/<slug> (sin prefijo placeSlug — multi-subdomain)', () => {
    const result = buildSettingsShellSections({ isOwner: true })
    for (const group of result) {
      for (const item of group.items) {
        expect(item.href).toMatch(/^\/settings\/[a-z]+$/)
      }
    }
  })

  it('todos los items tienen icon (de lucide-react)', () => {
    const result = buildSettingsShellSections({ isOwner: true })
    for (const group of result) {
      for (const item of group.items) {
        expect(item.icon).toBeDefined()
      }
    }
  })

  it('groups vacíos se filtran (admin sin items owner-only en Comunidad)', () => {
    // Comunidad tiene members/groups/tiers, todos owner-only.
    // Admin (no owner) → group Comunidad debería quedar vacío y filtrarse.
    const result = buildSettingsShellSections({ isOwner: false })
    const groupIds = result.map((g) => g.id)
    expect(groupIds).not.toContain('comunidad')
    // Pero Place y Contenido sí (tienen items visibles para admin)
    expect(groupIds).toContain('place')
    expect(groupIds).toContain('contenido')
  })

  it('respeta el orden de groups (Place → Comunidad → Contenido) y de items dentro de cada group', () => {
    const result = buildSettingsShellSections({ isOwner: true })
    expect(result.map((g) => g.id)).toEqual(['place', 'comunidad', 'contenido'])
    // Orden dentro de Place: hours, access, editor
    const place = result.find((g) => g.id === 'place')
    expect(place?.items.map((i) => i.href)).toEqual([
      '/settings/hours',
      '/settings/access',
      '/settings/editor',
    ])
  })
})
