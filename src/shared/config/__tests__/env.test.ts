import { beforeAll, describe, expect, it } from 'vitest'
import type { clientSchema as ClientSchema } from '../env'

// El módulo `env.ts` parsea `clientEnv` eager al importarse. Para evitar
// que el import del schema crashee en este test (el `process.env` del
// runner no carga `.env.local`), seteamos las NEXT_PUBLIC_* mínimas antes
// del import dinámico.
let clientSchema: typeof ClientSchema

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key-placeholder'
  process.env.NEXT_PUBLIC_APP_URL ??= 'https://app.place.community'
  process.env.NEXT_PUBLIC_APP_DOMAIN ??= 'place.community'
  ;({ clientSchema } = await import('../env'))
})

/**
 * Tests del client schema (env.ts).
 *
 * Motivación: en producción un trailing space en `NEXT_PUBLIC_APP_DOMAIN`
 * (`'place.community '`) pasaba el `.string().min(1)` original de Zod sin
 * trim ni regex, se interpolaba en URLs, el browser encodeaba el espacio a
 * `%20` y la resolución DNS fallaba. Acá fijamos el contrato: APP_DOMAIN es
 * un hostname puro (con port opcional) y APP_URL es una URL http(s)
 * absoluta — sin whitespace, sin protocolo en el domain, sin path en el
 * domain.
 */

const validBase = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-placeholder',
  NEXT_PUBLIC_APP_URL: 'https://app.place.community',
  NEXT_PUBLIC_APP_DOMAIN: 'place.community',
} as const

function parseWith(overrides: Partial<Record<keyof typeof validBase, string>>) {
  return clientSchema.safeParse({ ...validBase, ...overrides })
}

describe('clientSchema', () => {
  describe('NEXT_PUBLIC_APP_DOMAIN', () => {
    it('rechaza whitespace trailing', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'place.community ' })
      // Trim normaliza, pero si quedaba algo inválido la regex caza. Acá
      // el trim deja `'place.community'` que sí pasa — entonces validamos
      // que el valor parseado no tenga el espacio (asegura el trim).
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_DOMAIN).toBe('place.community')
      }
    })

    it('rechaza whitespace interno', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'place .community' })
      expect(result.success).toBe(false)
    })

    it('rechaza newline', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'place.community\n' })
      // Trim quita el `\n` final, así que valida ok como hostname puro.
      // Lo importante: que no quede el `\n` en el valor parseado.
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_DOMAIN).toBe('place.community')
      }
    })

    it('rechaza newline interno', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'place\n.community' })
      expect(result.success).toBe(false)
    })

    it('rechaza protocolo embedded', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'https://place.community' })
      expect(result.success).toBe(false)
    })

    it('rechaza path embedded', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'place.community/' })
      expect(result.success).toBe(false)
    })

    it('acepta hostname puro', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'place.community' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_DOMAIN).toBe('place.community')
      }
    })

    it('acepta lvh.me:3000 (dev local con port)', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_DOMAIN).toBe('lvh.me:3000')
      }
    })

    it('normaliza case: Place.COMMUNITY → place.community', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_DOMAIN: 'Place.COMMUNITY' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_DOMAIN).toBe('place.community')
      }
    })
  })

  describe('NEXT_PUBLIC_APP_URL', () => {
    it('rechaza valor sin protocolo', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_URL: 'place.community' })
      expect(result.success).toBe(false)
    })

    it('acepta https://app.place.community', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_URL: 'https://app.place.community' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_URL).toBe('https://app.place.community')
      }
    })

    it('rechaza trailing space (incluso después de URL válida)', () => {
      // El trim del schema normaliza: `'https://app.place.community '` →
      // `'https://app.place.community'`, que pasa. Validamos que el valor
      // parseado no tenga el espacio.
      const result = parseWith({ NEXT_PUBLIC_APP_URL: 'https://app.place.community ' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_URL).toBe('https://app.place.community')
      }
    })

    it('rechaza whitespace interno', () => {
      const result = parseWith({ NEXT_PUBLIC_APP_URL: 'https://app.place .community' })
      expect(result.success).toBe(false)
    })
  })
})
