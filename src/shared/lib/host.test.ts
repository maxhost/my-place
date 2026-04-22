import { describe, expect, it } from 'vitest'
import { resolveHost } from './host'

describe('resolveHost', () => {
  describe('en desarrollo (appDomain=lvh.me:3000)', () => {
    const appDomain = 'lvh.me:3000'

    it('dominio raíz → marketing', () => {
      expect(resolveHost('lvh.me:3000', appDomain)).toEqual({ kind: 'marketing' })
    })

    it('app.lvh.me:3000 → inbox', () => {
      expect(resolveHost('app.lvh.me:3000', appDomain)).toEqual({ kind: 'inbox' })
    })

    it('{slug}.lvh.me:3000 → place', () => {
      expect(resolveHost('thecompany.lvh.me:3000', appDomain)).toEqual({
        kind: 'place',
        slug: 'thecompany',
      })
    })
  })

  describe('en desarrollo legacy (appDomain=localhost:3000)', () => {
    const appDomain = 'localhost:3000'

    it('dominio raíz → marketing', () => {
      expect(resolveHost('localhost:3000', appDomain)).toEqual({ kind: 'marketing' })
    })

    it('app.localhost:3000 → inbox', () => {
      expect(resolveHost('app.localhost:3000', appDomain)).toEqual({ kind: 'inbox' })
    })

    it('{slug}.localhost:3000 → place', () => {
      expect(resolveHost('thecompany.localhost:3000', appDomain)).toEqual({
        kind: 'place',
        slug: 'thecompany',
      })
    })

    it('subdomain reservado (admin) → reserved', () => {
      expect(resolveHost('admin.localhost:3000', appDomain)).toEqual({
        kind: 'reserved',
        slug: 'admin',
      })
    })

    it('hostname irrelevante cae a marketing como fallback seguro', () => {
      expect(resolveHost('alguna-preview.vercel.app', appDomain)).toEqual({ kind: 'marketing' })
    })
  })

  describe('en producción (appDomain=place.app)', () => {
    const appDomain = 'place.app'

    it('place.app → marketing', () => {
      expect(resolveHost('place.app', appDomain)).toEqual({ kind: 'marketing' })
    })

    it('app.place.app → inbox', () => {
      expect(resolveHost('app.place.app', appDomain)).toEqual({ kind: 'inbox' })
    })

    it('prueba.place.app → place con slug=prueba', () => {
      expect(resolveHost('prueba.place.app', appDomain)).toEqual({
        kind: 'place',
        slug: 'prueba',
      })
    })

    it('mayúsculas se normalizan', () => {
      expect(resolveHost('PRUEBA.PLACE.APP', appDomain)).toEqual({
        kind: 'place',
        slug: 'prueba',
      })
    })

    it('subdomain api → reserved', () => {
      expect(resolveHost('api.place.app', appDomain)).toEqual({
        kind: 'reserved',
        slug: 'api',
      })
    })
  })
})
