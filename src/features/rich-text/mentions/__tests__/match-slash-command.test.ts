import { describe, expect, it } from 'vitest'
import { matchSlashCommand } from '../ui/trigger-detection'

/**
 * Audit #10. Tests baseline del matcher de slash commands. Fijan el behavior
 * actual antes de refactorizar a registry — el refactor debe pasar los
 * mismos tests sin cambios.
 *
 * Cubren los 3 paths del matcher:
 * 1. Match exacto del comando completo (`/event`, `/library`, `/library/<sub>`).
 * 2. Match con query opcional separado por espacio (`/event hola`).
 * 3. Prefix match cuando el user está typeando (`/eve`, `/lib`).
 */
describe('matchSlashCommand', () => {
  describe('match exacto', () => {
    it('/event → trigger event con query vacía', () => {
      const m = matchSlashCommand('/event')
      expect(m?.trigger).toEqual({ kind: 'event', query: '' })
    })

    it('/event hola → trigger event con query="hola"', () => {
      const m = matchSlashCommand('/event hola')
      expect(m?.trigger).toEqual({ kind: 'event', query: 'hola' })
    })

    it('/library → trigger library-category con query vacía', () => {
      const m = matchSlashCommand('/library')
      expect(m?.trigger).toEqual({ kind: 'library-category', query: '' })
    })

    it('/library/recursos → trigger library-item con categorySlug + query vacía', () => {
      const m = matchSlashCommand('/library/recursos')
      expect(m?.trigger).toEqual({ kind: 'library-item', categorySlug: 'recursos', query: '' })
    })

    it('/library/recursos/ (con slash trailing) → idem (slash absorbido)', () => {
      const m = matchSlashCommand('/library/recursos/')
      expect(m?.trigger).toEqual({ kind: 'library-item', categorySlug: 'recursos', query: '' })
    })

    it('/library/recursos hola → trigger library-item con query="hola"', () => {
      const m = matchSlashCommand('/library/recursos hola')
      expect(m?.trigger).toEqual({
        kind: 'library-item',
        categorySlug: 'recursos',
        query: 'hola',
      })
    })
  })

  describe('prefix match (user typeando)', () => {
    it('/e → prefix de event → trigger event vacío', () => {
      expect(matchSlashCommand('/e')?.trigger).toEqual({ kind: 'event', query: '' })
    })

    it('/ev → prefix de event', () => {
      expect(matchSlashCommand('/ev')?.trigger).toEqual({ kind: 'event', query: '' })
    })

    it('/eve → prefix de event', () => {
      expect(matchSlashCommand('/eve')?.trigger).toEqual({ kind: 'event', query: '' })
    })

    it('/l → prefix de library → trigger library-category', () => {
      expect(matchSlashCommand('/l')?.trigger).toEqual({ kind: 'library-category', query: '' })
    })

    it('/lib → prefix de library', () => {
      expect(matchSlashCommand('/lib')?.trigger).toEqual({ kind: 'library-category', query: '' })
    })
  })

  describe('contexto previo (no inicio de línea)', () => {
    it('texto previo + space + /event → matchea', () => {
      const m = matchSlashCommand('hola /event')
      expect(m?.trigger).toEqual({ kind: 'event', query: '' })
    })

    it('texto previo + newline + /event → matchea', () => {
      const m = matchSlashCommand('hola\n/event')
      expect(m?.trigger).toEqual({ kind: 'event', query: '' })
    })
  })

  describe('no match', () => {
    it('texto sin slash → null', () => {
      expect(matchSlashCommand('hola')).toBeNull()
    })

    it('/xyz (comando desconocido) → null', () => {
      expect(matchSlashCommand('/xyz')).toBeNull()
    })

    it('texto sin separador antes de slash → null', () => {
      expect(matchSlashCommand('hola/event')).toBeNull()
    })
  })

  describe('shape del match.replaceableString (lo que se sustituye al seleccionar)', () => {
    it('/event hola → replaceable es "/event hola" completo', () => {
      const m = matchSlashCommand('/event hola')
      expect(m?.match.replaceableString).toBe('/event hola')
    })

    it('/library → replaceable es "/library" completo', () => {
      const m = matchSlashCommand('/library')
      expect(m?.match.replaceableString).toBe('/library')
    })
  })
})
